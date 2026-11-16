"""Ward and subcouncil boundaries, and the 2021 -> 2026 ward crosswalk.

Sources:
- 2026 wards: City of Cape Town open data (ODP_SPLIT_5 layer 6), cross-checked against the
  Municipal Demarcation Board's 2026 layer at pin time.
- 2021 wards: Municipal Demarcation Board (the City no longer publishes them).

Subcouncils are not taken from the City's subcouncil layer: it has 20 of the 21 subcouncils.
See wards.py.
"""

from __future__ import annotations

import json

import numpy as np
import shapely

from wardmap import arcgis, geo
from wardmap.config import (
    CCT_LICENCE,
    CCT_ODP5,
    CCT_ODP5_MIRROR,
    CCT_WARDS_LAYER,
    MDB_LICENCE,
    MDB_WARDS,
    SOURCES,
    VINTAGE_WARD_COUNT,
)
from wardmap.models import (
    BoundaryEntry,
    CrosswalkEnvelope,
    CrosswalkRow,
    FieldMeta,
    Gap,
    Source,
)
from wardmap.provenance import SourceRecord, read_sidecar, today, write_sidecar
from wardmap.publish import write_geojson, write_model

DIR = SOURCES / "boundaries"
SIMPLIFY_TOLERANCE_DEG = 0.0002  # ~20 m; plenty for a city-scale choropleth
COORD_GRID = 1e-5  # ~1 m


def ward_file(vintage: int):
    return DIR / f"wards-{vintage}.geojson"


# ---- pin ---------------------------------------------------------------------------------------


def _cct_layer(layer: int, where: str = "1=1") -> tuple[dict, str]:
    for base in (CCT_ODP5, CCT_ODP5_MIRROR):
        try:
            return arcgis.geojson(f"{base}/{layer}", where), f"{base}/{layer}"
        except Exception as e:  # noqa: BLE001 - try the mirror on any failure
            print(f"  {base} failed: {e}")
    raise RuntimeError(f"City layer {layer} unavailable on both servers")


def _write(path, fc: dict, rec: SourceRecord) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(fc, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    write_sidecar(path, rec)


def _mdb_wards(vintage: int) -> dict:
    fc = arcgis.geojson(MDB_WARDS[vintage], where="CAT_B='CPT'", out_fields="WardNo")
    for f in fc["features"]:
        f["properties"] = {"ward_no": int(f["properties"]["WardNo"])}
    return fc


def _check_ward_set(fc: dict, vintage: int, label: str) -> None:
    nos = sorted(f["properties"]["ward_no"] for f in fc["features"])
    expected = list(range(1, VINTAGE_WARD_COUNT[vintage] + 1))
    if nos != expected:
        raise ValueError(f"{label}: expected wards 1..{expected[-1]}, got {len(nos)} features")


def _iou_by_ward(a: dict, b: dict) -> dict[int, float]:
    def by_no(fc):
        return {f["properties"]["ward_no"]: f for f in fc["features"]}

    ga, gb = by_no(a), by_no(b)
    out = {}
    for no in ga:
        pa = geo.project(geo.geoms([ga[no]]))[0]
        pb = geo.project(geo.geoms([gb[no]]))[0]
        out[no] = shapely.area(shapely.intersection(pa, pb)) / shapely.area(shapely.union(pa, pb))
    return out


def pin() -> None:
    # 2026 wards from the City; verify vintage and agreement with the MDB.
    fc, url = _cct_layer(CCT_WARDS_LAYER)
    years = {f["properties"]["WARD_YEAR"] for f in fc["features"]}
    if years != {2026}:
        raise ValueError(f"City ward layer is not the 2026 delimitation (WARD_YEAR={years})")
    for f in fc["features"]:
        f["properties"] = {"ward_no": int(f["properties"]["WARD_NAME"])}
    _check_ward_set(fc, 2026, "City 2026 wards")
    mdb = _mdb_wards(2026)
    _check_ward_set(mdb, 2026, "MDB 2026 wards")
    iou = _iou_by_ward(fc, mdb)
    worst = sorted(iou.items(), key=lambda kv: kv[1])[:3]
    print(f"  City vs MDB 2026 IoU: min {worst[0][1]:.4f}, worst wards {worst}")
    if worst[0][1] < 0.95:
        raise ValueError(f"City and MDB 2026 ward boundaries disagree: {worst}")
    _write(
        ward_file(2026),
        fc,
        SourceRecord(
            title="Wards (2026 delimitation)",
            publisher="City of Cape Town",
            url=url,
            retrieved_at=today(),
            licence=CCT_LICENCE,
            notes=(
                "Layer metadata still describes 2016 wards, but every feature has WARD_YEAR=2026 "
                "and there are 118 wards. Cross-checked against the Municipal Demarcation Board "
                f"2026 layer: per-ward intersection-over-union min {worst[0][1]:.4f}."
            ),
        ),
    )

    mdb21 = _mdb_wards(2021)
    _check_ward_set(mdb21, 2021, "MDB 2021 wards")
    _write(
        ward_file(2021),
        mdb21,
        SourceRecord(
            title="Wards (2021 delimitation), City of Cape Town (CPT)",
            publisher="Municipal Demarcation Board",
            url=MDB_WARDS[2021],
            retrieved_at=today(),
            licence=MDB_LICENCE,
            notes="Service name says 2020; these are the wards used for the 2021 elections.",
        ),
    )


# ---- build -------------------------------------------------------------------------------------


def load(vintage: int) -> tuple[list[int], np.ndarray]:
    """Ward numbers and (unprojected, valid) geometries for a vintage, sorted by ward number."""
    feats = sorted(geo.load_features(ward_file(vintage)), key=lambda f: f["properties"]["ward_no"])
    return [f["properties"]["ward_no"] for f in feats], geo.geoms(feats)


def source(path) -> Source:
    rec = read_sidecar(path)
    return Source(
        title=rec.title,
        publisher=rec.publisher,
        url=rec.url,
        retrieved_at=rec.retrieved_at,
        licence=rec.licence,
        notes=rec.notes,
    )


def build() -> list[BoundaryEntry]:
    entries = []
    for vintage in sorted(VINTAGE_WARD_COUNT):
        ids, g = load(vintage)
        simple = geo.simplify_coverage(g, SIMPLIFY_TOLERANCE_DEG)
        simple = shapely.set_precision(simple, COORD_GRID)
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": no,
                    "properties": {"ward_no": no},
                    "geometry": json.loads(shapely.to_geojson(geom)),
                }
                for no, geom in zip(ids, simple, strict=True)
            ],
        }
        name = f"boundaries-{vintage}.geojson"
        write_geojson(name, fc)
        entries.append(
            BoundaryEntry(ward_vintage=vintage, file=name, source=source(ward_file(vintage)))
        )
    build_crosswalk(2021, 2026)
    return entries


def crosswalk(from_vintage: int, to_vintage: int) -> list[CrosswalkRow]:
    a_ids, a = load(from_vintage)
    b_ids, b = load(to_vintage)
    rows = geo.overlay_weights(geo.project(a), a_ids, geo.project(b), b_ids, min_share=0.005)
    return [
        CrosswalkRow(from_ward=f, to_ward=t, share_of_from=round(sf, 4), share_of_to=round(st, 4))
        for f, t, sf, st, _ in sorted(rows)
    ]


def build_crosswalk(from_vintage: int, to_vintage: int) -> None:
    rows = crosswalk(from_vintage, to_vintage)
    covered: dict[int, float] = {}
    for r in rows:
        covered[r.to_ward] = covered.get(r.to_ward, 0) + r.share_of_to
    gaps = [
        Gap(
            code="edge_mismatch",
            ward_no=w,
            message=f"{1 - c:.0%} of this ward's area lies outside every {from_vintage} ward. "
            "The two boundary sets come from different publishers and differ slightly at the "
            "metro edge.",
        )
        for w, c in sorted(covered.items())
        if c < 0.98
    ]
    env = CrosswalkEnvelope(
        gaps=gaps,
        ward_vintage=to_vintage,
        from_vintage=from_vintage,
        as_of=read_sidecar(ward_file(to_vintage)).retrieved_at,
        sources={
            "from": source(ward_file(from_vintage)),
            "to": source(ward_file(to_vintage)),
        },
        fields={
            "share_of_from": FieldMeta(
                label=f"Share of the {from_vintage} ward's area",
                unit="ratio",
                source="from",
                method="crosswalk",
            ),
            "share_of_to": FieldMeta(
                label=f"Share of the {to_vintage} ward's area",
                unit="ratio",
                source="to",
                method="crosswalk",
            ),
        },
        rows=rows,
    )
    write_model(f"crosswalk-{from_vintage}-{to_vintage}.json", env)
