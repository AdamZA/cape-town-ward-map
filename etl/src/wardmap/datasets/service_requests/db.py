"""SQLite mirror of the City's service-request table.

One normaliser (`normalise`) feeds both the CSV bootstrap and the API delta sync, so the two
paths cannot drift. Ward assignment is spatial (point-in-polygon against our pinned boundaries);
the source `Ward` field uses the previous delimitation and is kept only for diagnostics.
"""

from __future__ import annotations

import csv
import sqlite3
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from wardmap import geo
from wardmap.config import CPT_BBOX, CURRENT_VINTAGE, DB_PATH
from wardmap.provenance import sha256_file

SCHEMA = """
CREATE TABLE IF NOT EXISTS request (
  notification INTEGER PRIMARY KEY,
  created TEXT NOT NULL,          -- ISO date (UTC day)
  changed TEXT NOT NULL,
  completed TEXT,
  lon REAL, lat REAL,             -- NULL when missing (0,0) or outside the metro bbox
  src_ward TEXT, src_subcouncil TEXT, suburb TEXT,
  complaint_type_id INTEGER REFERENCES lookup(id),
  work_center_id INTEGER REFERENCES lookup(id),
  notification_type_id INTEGER REFERENCES lookup(id),
  src_object_id INTEGER
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS lookup (id INTEGER PRIMARY KEY, kind TEXT, name TEXT, UNIQUE(kind, name));
-- ward_no NULL = checked, not inside any ward (or no coordinates).
CREATE TABLE IF NOT EXISTS ward_assignment (
  notification INTEGER, vintage INTEGER, ward_no INTEGER,
  PRIMARY KEY (notification, vintage)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sync_log (
  run_at TEXT, mode TEXT, since TEXT, fetched INTEGER, upserted INTEGER,
  live_count INTEGER, local_count INTEGER
);
"""
INDEXES = """
CREATE INDEX IF NOT EXISTS ix_request_created ON request(created);
CREATE INDEX IF NOT EXISTS ix_request_changed ON request(changed);
"""

COLUMNS = [
    "notification",
    "created",
    "changed",
    "completed",
    "lon",
    "lat",
    "src_ward",
    "src_subcouncil",
    "suburb",
    "complaint_type_id",
    "work_center_id",
    "notification_type_id",
    "src_object_id",
]


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    con.executescript(SCHEMA)
    return con


def get_meta(con: sqlite3.Connection, key: str) -> str | None:
    row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def set_meta(con: sqlite3.Connection, key: str, value: str) -> None:
    con.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", (key, value))


# ---- normalisation -----------------------------------------------------------------------------


def to_iso_day(v: Any) -> str | None:
    """Epoch ms (API) or 'YYYY/MM/DD hh:mm:ss+00' (CSV) -> 'YYYY-MM-DD'."""
    if v is None or v == "":
        return None
    if isinstance(v, int | float):
        return datetime.fromtimestamp(v / 1000, tz=UTC).date().isoformat()
    s = str(v).strip()
    return s[:10].replace("/", "-")


def norm_ward(v: Any) -> str | None:
    """Source ward codes are inconsistent ('001', '96', '000', 'MUL'). Keep as text, de-pad."""
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    return str(int(s)) if s.isdigit() else s.upper()


def norm_coord(lon: Any, lat: Any) -> tuple[float | None, float | None]:
    try:
        x, y = float(lon), float(lat)
    except (TypeError, ValueError):
        return None, None
    x0, y0, x1, y1 = CPT_BBOX
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return None, None
    return x, y


def _blank_none(v: Any) -> Any:
    return None if v is None or (isinstance(v, str) and not v.strip()) else v


class Lookups:
    """Interns repeated strings (complaint type, work centre, notification type) as ids."""

    def __init__(self, con: sqlite3.Connection):
        self.con = con
        self.cache = {(k, n): i for i, k, n in con.execute("SELECT id, kind, name FROM lookup")}

    def id(self, kind: str, name: str | None) -> int | None:
        name = _blank_none(name)
        if name is None:
            return None
        key = (kind, name)
        if key not in self.cache:
            cur = self.con.execute("INSERT INTO lookup(kind, name) VALUES (?, ?)", key)
            self.cache[key] = cur.lastrowid
        return self.cache[key]


def normalise(row: dict[str, Any], lk: Lookups) -> tuple:
    """Source row (CSV or API attribute names are identical) -> request tuple in COLUMNS order."""
    lon, lat = norm_coord(row.get("Longitude"), row.get("Latitude"))
    created = to_iso_day(row["CreatedOnDT"])
    return (
        int(row["Notification"]),
        created,
        to_iso_day(row.get("ChangedOnDT")) or created,
        to_iso_day(row.get("CompletedDT")),
        lon,
        lat,
        norm_ward(row.get("Ward")),
        _blank_none(row.get("Sub_Council")),
        _blank_none(row.get("Suburb_Clean")) or _blank_none(row.get("Suburb")),
        lk.id("complaint_type", row.get("C3_Complaint_Type")),
        lk.id("work_center", row.get("Work_Center")),
        lk.id("notification_type", row.get("Notification_type")),
        int(row["ObjectId"]) if _blank_none(row.get("ObjectId")) is not None else None,
    )


UPSERT = f"""
INSERT INTO request ({",".join(COLUMNS)}) VALUES ({",".join("?" * len(COLUMNS))})
ON CONFLICT(notification) DO UPDATE SET
  {", ".join(f"{c}=excluded.{c}" for c in COLUMNS[1:])}
WHERE excluded.changed >= request.changed
"""


def upsert(con: sqlite3.Connection, rows: Iterable[tuple]) -> int:
    """Upsert normalised rows; a stale row never overwrites a newer one. Touched rows lose their
    ward assignment so it is recomputed (coordinates may have changed)."""
    rows = list(rows)
    con.executemany(UPSERT, rows)
    con.executemany("DELETE FROM ward_assignment WHERE notification=?", ((r[0],) for r in rows))
    return len(rows)


# ---- bulk CSV bootstrap ------------------------------------------------------------------------


def _batched(it: Iterator, n: int) -> Iterator[list]:
    batch = []
    for x in it:
        batch.append(x)
        if len(batch) == n:
            yield batch
            batch = []
    if batch:
        yield batch


def load_csv(path: Path, db_path: Path = DB_PATH) -> None:
    """Bootstrap a DB from the hub's bulk CSV export. Upserts, so it's safe on an existing DB."""
    con = connect(db_path)
    lk = Lookups(con)
    n = 0
    with path.open(encoding="utf-8-sig", newline="") as f, con:
        reader = csv.DictReader(f)
        for batch in _batched(reader, 50_000):
            con.executemany(UPSERT, [normalise(r, lk) for r in batch])
            n += len(batch)
            print(f"  loaded {n:,}", end="\r")
    with con:
        con.executescript(INDEXES)
        max_changed = con.execute("SELECT max(changed) FROM request").fetchone()[0]
        set_meta(con, "watermark", max_changed)
        set_meta(con, "bootstrap_csv", path.name)
    total = con.execute("SELECT count(*) FROM request").fetchone()[0]
    print(f"\nloaded {n:,} CSV rows; DB has {total:,} requests; watermark {max_changed}")
    con.close()


# ---- ward assignment ---------------------------------------------------------------------------


def assign_wards(
    con: sqlite3.Connection | None = None, vintages: tuple[int, ...] = (CURRENT_VINTAGE,)
) -> None:
    """Assign located requests to wards for the given vintages; only rows lacking an assignment
    are processed, unless the boundary file changed since the last run (then that vintage is
    redone)."""
    from wardmap.datasets import boundaries

    own = con is None
    con = con or connect()
    for vintage in vintages:
        sha = sha256_file(boundaries.ward_file(vintage))
        key = f"boundary_sha:{vintage}"
        if get_meta(con, key) != sha:
            with con:
                con.execute("DELETE FROM ward_assignment WHERE vintage=?", (vintage,))
                set_meta(con, key, sha)
        todo = con.execute(
            """SELECT r.notification, r.lon, r.lat FROM request r
               LEFT JOIN ward_assignment a ON a.notification=r.notification AND a.vintage=?
               WHERE a.notification IS NULL""",
            (vintage,),
        ).fetchall()
        if not todo:
            continue
        ids, polys = boundaries.load(vintage)
        arr = np.array(todo, dtype=object)
        notif = arr[:, 0].astype(np.int64)
        has = np.array([r[1] is not None for r in todo])
        ward = np.full(len(todo), -1, dtype=np.int64)
        if has.any():
            lon = arr[has, 1].astype(float)
            lat = arr[has, 2].astype(float)
            ward[has] = geo.assign_points(lon, lat, polys, ids)
        with con:
            con.executemany(
                "INSERT OR REPLACE INTO ward_assignment VALUES (?, ?, ?)",
                (
                    (int(n), vintage, int(w) if w >= 0 else None)
                    for n, w in zip(notif, ward, strict=True)
                ),
            )
        print(f"assigned {len(todo):,} requests to {vintage} wards ({(ward >= 0).sum():,} located)")
    if own:
        con.close()
