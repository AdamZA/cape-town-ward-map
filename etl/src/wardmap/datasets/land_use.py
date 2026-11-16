"""What kind of place a ward is: the mix of zoning on its land.

The City's zoning layer has ~850,000 parcels, far too many to pin. Instead, at pin time, for each
ward we ask the City's server for

1. the summed parcel area per zone for parcels wholly inside the ward (a statistics query), and
2. the geometry of the few parcels crossing the ward edge, which we clip to the ward locally,

and pin the resulting ward x zone area table. Zoning is what land may legally be used for, not
what is on it today; the site says so wherever this is shown (METHODOLOGY.md#land-use).
"""

from __future__ import annotations

import json
import time

import numpy as np
import shapely

from wardmap import geo
from wardmap.config import CCT_LICENCE, CCT_ZONING_LAYER, SOURCES
from wardmap.datasets import boundaries
from wardmap.fetch import post_json
from wardmap.provenance import SourceRecord, today, write_sidecar

DIR = SOURCES / "land_use"
QUERY_SIMPLIFY_DEG = 0.0002  # ~20 m; keeps the query geometry small. Used for both halves.
PAGE = 1000


def zoning_file(vintage: int):
    return DIR / f"zoning-by-ward-{vintage}.json"


# Zone code -> group shown on the site. Public roads (TR2), the "limited use" holding zone and
# parcels with no zoning recorded are measured but left out of the shares (see `group_areas`).
GROUPS: dict[str, tuple[str, ...]] = {
    "houses": ("R1",),
    "incremental_housing": ("R2",),
    "flats_group_housing": ("GR1", "GR2", "GR3", "GR4", "GR5", "GR6"),
    "business_mixed": (
        "LB1", "LB2", "GB1", "GB2", "GB3", "GB4", "GB5", "GB6", "GB7", "MU1", "MU2", "MU3",
    ),
    "industrial": ("GI1", "GI2", "RI"),
    "community": ("CO1", "CO2"),
    "open_space": ("OS1", "OS2", "OS3"),
    "agriculture_rural": ("AG", "RU"),
    "transport_utility": ("TR1", "UT"),
}  # fmt: skip
GROUP_LABELS = {
    "houses": "Houses",
    "incremental_housing": "Incremental housing",
    "flats_group_housing": "Flats and group housing",
    "business_mixed": "Business and mixed use",
    "industrial": "Industrial",
    "community": "Community (schools, clinics, worship)",
    "open_space": "Parks and conservation",
    "agriculture_rural": "Farmland and rural",
    "transport_utility": "Transport and utilities",
}


def _rings(g) -> list:
    gj = json.loads(shapely.to_geojson(g))
    if gj["type"] == "Polygon":
        return gj["coordinates"]
    return [r for p in gj["coordinates"] for r in p]


def _paths(g) -> list:
    gj = json.loads(shapely.to_geojson(shapely.boundary(g)))
    return [gj["coordinates"]] if gj["type"] == "LineString" else gj["coordinates"]


def _ward_zoning(ward_geom) -> dict[str, int]:
    """Square metres per zone code inside one ward."""
    q = shapely.make_valid(shapely.simplify(ward_geom, QUERY_SIMPLIFY_DEG))
    url = f"{CCT_ZONING_LAYER}/query"
    sr = {"spatialReference": {"wkid": 4326}}
    stats = [
        {"statisticType": "sum", "onStatisticField": "SHAPE.STArea()", "outStatisticFieldName": "a"}
    ]
    inner = post_json(
        url,
        {
            "where": "1=1",
            "geometry": json.dumps({"rings": _rings(q)} | sr),
            "geometryType": "esriGeometryPolygon",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelContains",
            "outStatistics": json.dumps(stats),
            "groupByFieldsForStatistics": "INT_ZONE_CODE",
            "f": "json",
        },
    )
    out: dict[str, float] = {}
    for f in inner["features"]:
        a = f["attributes"]
        code = a["INT_ZONE_CODE"] or "none"
        out[code] = out.get(code, 0.0) + float(a["a"] or 0)

    # Parcels crossing the ward edge: fetch and clip (projected, so areas are in m2).
    q_m = geo.project(np.array([q]))[0]
    offset = 0
    while True:
        edge = post_json(
            url,
            {
                "where": "1=1",
                "geometry": json.dumps({"paths": _paths(q)} | sr),
                "geometryType": "esriGeometryPolyline",
                "inSR": 4326,
                "spatialRel": "esriSpatialRelIntersects",
                "outFields": "INT_ZONE_CODE",
                "outSR": 4326,
                "resultOffset": offset,
                "resultRecordCount": PAGE,
                "orderByFields": "OBJECTID",
                "f": "geojson",
            },
        )
        feats = [f for f in edge.get("features", []) if f.get("geometry")]
        if feats:
            clipped = shapely.area(shapely.intersection(geo.project(geo.geoms(feats)), q_m))
            for f, a in zip(feats, clipped, strict=True):
                code = (f.get("properties") or {}).get("INT_ZONE_CODE") or "none"
                out[code] = out.get(code, 0.0) + float(a)
        if len(edge.get("features", [])) < PAGE:
            break
        offset += PAGE
    return {k: round(v) for k, v in sorted(out.items()) if v >= 1}


MIN_COVERAGE = 0.3  # parcels must cover this share of a ward (the rest: sea, unparcelled land)


def _plausible(by_code: dict[str, int], ward_m2: float) -> bool:
    return sum(by_code.values()) >= MIN_COVERAGE * ward_m2


def pin(vintage: int) -> None:
    ids, wg = boundaries.load(vintage)
    DIR.mkdir(parents=True, exist_ok=True)

    path = zoning_file(vintage)
    ward_m2 = dict(zip(ids, shapely.area(geo.project(wg)), strict=True))
    # Resume: keep wards already pinned with plausible coverage, re-query the rest.
    table = (
        {w: v for w, v in load(vintage).items() if _plausible(v, ward_m2[w])}
        if path.exists()
        else {}
    )

    # One ward at a time: these are heavy spatial queries on the City's server (fetch throttles
    # requests too). ~118 x 2-3 requests, roughly 20-30 minutes for a full pin.
    for i, w in enumerate(ids):
        if w in table:
            continue
        res = _ward_zoning(wg[i])
        if not _plausible(res, ward_m2[w]):
            # The server sometimes answers with no features and no error. Wait, then try once more.
            print(f"  ward {w}: implausible result ({sum(res.values()) / 1e6:.1f} km2); retrying")
            time.sleep(60)
            again = _ward_zoning(wg[i])
            if not again or again != res:  # empty is never a real answer for a ward
                raise RuntimeError(f"ward {w}: unstable answers from the server; re-run later")
            print(f"  ward {w}: same answer twice; accepting low parcel coverage")
        table[w] = res
        print(f"  ward {w}: {sum(res.values()) / 1e6:.1f} km2")
    path.write_text(
        json.dumps({str(w): table[w] for w in sorted(table)}, indent=1, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    write_sidecar(
        path,
        SourceRecord(
            title="Zoning (Integrated Zoning Scheme), summed per ward",
            publisher="City of Cape Town",
            url=CCT_ZONING_LAYER,
            retrieved_at=today(),
            licence=CCT_LICENCE,
            method="query",
            notes=(
                f"Square metres of each zone code per {vintage} ward: parcel areas summed by the "
                "City's server for parcels inside the ward, plus parcels crossing the ward edge "
                "clipped to it. Ward outlines simplified to ~20 m for the query."
            ),
        ),
    )


def group_areas(by_code: dict[str, int]) -> tuple[dict[str, float], float]:
    """(m2 per group, m2 left out of the shares: public roads, limited use, no zoning)."""
    code_group = {c: g for g, codes in GROUPS.items() for c in codes}
    out = {g: 0.0 for g in GROUPS}
    excluded = 0.0
    for code, a in by_code.items():
        g = code_group.get(code)
        if g is None:
            excluded += a  # TR2 / LU / none, and any code the City adds later
        else:
            out[g] += a
    return out, excluded


def load(vintage: int) -> dict[int, dict[str, int]]:
    return {int(w): v for w, v in json.loads(zoning_file(vintage).read_text("utf-8")).items()}


def build(vintage: int) -> None:
    from wardmap.models import FieldMeta, LandmarkGroup, LandUseEnvelope, LandUseRow
    from wardmap.provenance import read_sidecar
    from wardmap.publish import write_model

    path = zoning_file(vintage)
    ids, wg = boundaries.load(vintage)
    ward_m2 = dict(zip(ids, shapely.area(geo.project(wg)), strict=True))
    rows = []
    for w, by_code in sorted(load(vintage).items()):
        groups, excluded = group_areas(by_code)
        total = sum(groups.values())
        rows.append(
            LandUseRow(
                ward_no=w,
                shares={g: round(a / total, 3) if total else 0.0 for g, a in groups.items()},
                zoned_km2=round(total / 1e6, 2),
                excluded_km2=round(excluded / 1e6, 2),
                parcel_coverage=round((total + excluded) / ward_m2[w], 2),
            )
        )
    env = LandUseEnvelope(
        ward_vintage=vintage,
        as_of=read_sidecar(path).retrieved_at,
        sources={"zoning": boundaries.source(path)},
        fields={
            "shares": FieldMeta(
                label="Land by zoning",
                unit="share",
                source="zoning",
                method="land-use",
                description="Share of the ward's zoned land in each group. Zoning says what land "
                "may be used for, not what is on it today. Public roads, 'limited use' land and "
                "parcels with no zoning recorded are left out.",
            )
        },
        groups=[LandmarkGroup(key=k, label=v) for k, v in GROUP_LABELS.items()],
        rows=rows,
    )
    write_model(f"land_use-{vintage}.json", env)
