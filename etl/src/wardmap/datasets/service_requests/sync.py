"""Keep the local mirror current.

Delta sync:
  1. Contract check: the live layer must still have the fields we rely on (schema drift and item
     replacement have happened before). Failure is loud; the site keeps its last good data.
  2. since = watermark - OVERLAP_DAYS (dates are day-granular and edits land late).
  3. Count changed rows; refuse mass re-touches above --max-delta (use --full instead).
  4. Keyset-page the changes and upsert. The watermark only moves after every page succeeds.
  5. Reconcile per-created-year (then per-month) counts with the live layer. Months short
     locally are re-fetched. Deltas can't see deletions, so remaining drift beyond tolerance
     fails with a request to run --full.

Full rebuild (--full): download a fresh bulk CSV into a new DB file, run a delta on top of it
(the CSV export lags the live table), then swap it into place atomically.
"""

from __future__ import annotations

import sys
from datetime import UTC, date, datetime, timedelta

from wardmap import arcgis
from wardmap.config import DB_PATH, RAW, SR_CSV, SR_ITEM_ID, SR_LAYER
from wardmap.datasets.service_requests import db
from wardmap.fetch import download

OVERLAP_DAYS = 7
DRIFT_TOLERANCE = 0.005
REQUIRED_FIELDS = {
    "Notification": "esriFieldTypeInteger",
    "CreatedOnDT": "esriFieldTypeDate",
    "ChangedOnDT": "esriFieldTypeDate",
    "CompletedDT": "esriFieldTypeDate",
    "Longitude": "esriFieldTypeDouble",
    "Latitude": "esriFieldTypeDouble",
    "ObjectId": "esriFieldTypeOID",
    "C3_Complaint_Type": "esriFieldTypeString",
    "Work_Center": "esriFieldTypeString",
    "Notification_type": "esriFieldTypeString",
    "Ward": "esriFieldTypeString",
    "Sub_Council": "esriFieldTypeString",
    "Suburb_Clean": "esriFieldTypeString",
}


class SyncError(RuntimeError):
    pass


def contract_check() -> dict:
    info = arcgis.layer_info(SR_LAYER)
    live = {f["name"]: f["type"] for f in info["fields"]}
    problems = [
        f"{name}: expected {t}, found {live.get(name, 'missing')}"
        for name, t in REQUIRED_FIELDS.items()
        if live.get(name) != t
    ]
    if problems:
        raise SyncError("service-request layer schema changed:\n  " + "\n  ".join(problems))
    extra = sorted(set(live) - set(REQUIRED_FIELDS) - {"Suburb"})
    if extra:
        print(f"  note: new fields on the live layer (ignored): {extra}")
    return info


def _ts(d: date) -> str:
    return f"TIMESTAMP '{d.isoformat()} 00:00:00'"


def delta(con, max_delta: int, page_size: int) -> tuple[str, int]:
    watermark = db.get_meta(con, "watermark")
    if not watermark:
        raise SyncError("DB has no watermark; bootstrap with `wardmap sr load-csv` or use --full")
    since = date.fromisoformat(watermark) - timedelta(days=OVERLAP_DAYS)
    where = f"ChangedOnDT >= {_ts(since)}"
    n = arcgis.count(SR_LAYER, where)
    print(f"  {n:,} rows changed since {since}")
    if n > max_delta:
        raise SyncError(
            f"{n:,} changed rows exceeds --max-delta {max_delta:,} (the City may have mass-updated "
            "records). Run `wardmap sr sync --full`."
        )
    lk = db.Lookups(con)
    fetched, newest = 0, watermark
    with con:  # one transaction: all pages or nothing
        for page in arcgis.query_pages(SR_LAYER, where, "ObjectId", page_size):
            rows = [db.normalise(r, lk) for r in page]
            db.upsert(con, rows)
            fetched += len(rows)
            newest = max(newest, max(r[2] for r in rows))
            print(f"  fetched {fetched:,}/{n:,}", end="\r")
        db.set_meta(con, "watermark", newest)
    print(f"\n  watermark {watermark} -> {newest}")
    return since.isoformat(), fetched


def _dups(con, start: date, end: date) -> int:
    """Known duplicate rows upstream (same Notification, different ObjectId) in [start, end)."""
    keys = con.execute(
        "SELECT value FROM meta WHERE key >= ? AND key < ?",
        (f"dups:{start:%Y-%m}", f"dups:{end:%Y-%m}"),
    ).fetchall()
    return sum(int(v) for (v,) in keys)


def _counts(con, start: date, end: date) -> tuple[int, int]:
    """(live rows minus known duplicates, local rows) for requests created in [start, end)."""
    live = arcgis.count(SR_LAYER, f"CreatedOnDT >= {_ts(start)} AND CreatedOnDT < {_ts(end)}")
    local = con.execute(
        "SELECT count(*) FROM request WHERE created >= ? AND created < ?",
        (start.isoformat(), end.isoformat()),
    ).fetchone()[0]
    return live - _dups(con, start, end), local


def _months(y: int):
    for m in range(1, 13):
        yield date(y, m, 1), date(y + (m == 12), m % 12 + 1, 1)


def backfill(con, start: date, end: date, page_size: int) -> int:
    """Re-fetch every row created in [start, end) (one calendar month). Used when a month is short
    locally, e.g. because the bulk CSV export was a partial snapshot. Also records how many
    upstream rows are exact duplicates of a notification, so reconcile can expect them."""
    lk = db.Lookups(con)
    n = 0
    seen: set[int] = set()
    where = f"CreatedOnDT >= {_ts(start)} AND CreatedOnDT < {_ts(end)}"
    with con:
        for page in arcgis.query_pages(SR_LAYER, where, "ObjectId", page_size):
            db.upsert(con, [db.normalise(r, lk) for r in page])
            seen.update(int(r["Notification"]) for r in page)
            n += len(page)
            print(f"  backfilled {n:,} rows created {start:%Y-%m}", end="\r")
        db.set_meta(con, f"dups:{start:%Y-%m}", str(n - len(seen)))
    print(f"\n  {start:%Y-%m}: {n:,} rows, {n - len(seen):,} duplicate notifications")
    return n


def reconcile(con, page_size: int, heal: bool = True) -> tuple[int, int]:
    """Compare live vs local counts per created year (then month, for drifting years).
    Months short locally are backfilled; months with *extra* local rows mean deletions upstream,
    which deltas can't see, so that fails with a request for --full. Returns (live, local)."""
    live_total = local_total = 0
    problems = []
    for y in range(2023, datetime.now(UTC).year + 1):
        live, local = _counts(con, date(y, 1, 1), date(y + 1, 1, 1))
        if live != local:
            for start, end in _months(y):
                m_live, m_local = _counts(con, start, end)
                if heal and m_local < m_live:
                    backfill(con, start, end, page_size)
                    m_live, m_local = _counts(con, start, end)
                if m_local != m_live:
                    print(f"  {start:%Y-%m}: live {m_live:,} local {m_local:,}")
            live, local = _counts(con, date(y, 1, 1), date(y + 1, 1, 1))
        drift = abs(local - live) / max(live, 1)
        print(f"  {y}: live {live:,} local {local:,} drift {drift:.3%}")
        live_total += live
        local_total += local
        if drift > DRIFT_TOLERANCE:
            problems.append(f"{y}: live {live:,} vs local {local:,}")
    if problems:
        raise SyncError(
            "local mirror has drifted from the live layer (likely deletions or a re-publish): "
            + "; ".join(problems)
            + ". Run `wardmap sr sync --full`."
        )
    return live_total, local_total


def sync(full: bool = False, max_delta: int = 750_000) -> None:
    try:
        info = contract_check()
        page_size = int(info.get("maxRecordCount") or 1000)
        if full:
            _full_rebuild(max_delta, page_size)
            return
        con = db.connect()
        if db.get_meta(con, "source_item_id") not in (None, SR_ITEM_ID):
            raise SyncError("DB was built from a different source item; run with --full")
        since, fetched = delta(con, max_delta, page_size)
        _finish(con, "delta", since, fetched, page_size)
    except SyncError as e:
        print(f"SYNC FAILED: {e}", file=sys.stderr)
        sys.exit(2)


def _finish(con, mode: str, since: str | None, fetched: int, page_size: int) -> None:
    live, local = reconcile(con, page_size)
    db.assign_wards(con)
    with con:
        db.set_meta(con, "source_item_id", SR_ITEM_ID)
        db.set_meta(con, "last_sync", datetime.now(UTC).date().isoformat())
        con.execute(
            "INSERT INTO sync_log VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                datetime.now(UTC).isoformat(timespec="seconds"),
                mode,
                since,
                fetched,
                fetched,
                live,
                local,
            ),
        )
    print(f"sync ok: live {live:,}, local {local:,}")
    con.close()


def _full_rebuild(max_delta: int, page_size: int) -> None:
    csv_path = RAW / "downloads" / "service_requests.csv"
    download(SR_CSV, csv_path)
    tmp = DB_PATH.with_suffix(".rebuild.sqlite")
    for p in (tmp, tmp.with_name(tmp.name + "-wal"), tmp.with_name(tmp.name + "-shm")):
        p.unlink(missing_ok=True)
    db.load_csv(csv_path, tmp)
    con = db.connect(tmp)
    since, fetched = delta(con, max_delta=10**9, page_size=page_size)
    _finish(con, "full", since, fetched, page_size)
    tmp.replace(DB_PATH)
    print(f"replaced {DB_PATH}")
