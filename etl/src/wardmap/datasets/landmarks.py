"""Public places for the map's layer toggles and each ward's "What's here" list.

Almost everything comes from the City's own facility layers. The City publishes no layer of
shopping centres, so those come from OpenStreetMap (ODbL; attributed wherever shown).

Adding a category = one entry in CITY_LAYERS (or a new pin function) plus one in CATEGORIES.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import shapely

from wardmap import arcgis, geo
from wardmap.config import CCT_LICENCE, CCT_THEMES, OSM_LICENCE, OVERPASS, SOURCES
from wardmap.datasets import boundaries
from wardmap.fetch import post_json
from wardmap.models import (
    FieldMeta,
    Gap,
    LandmarkCategory,
    LandmarkGroup,
    LandmarkRow,
    LandmarksEnvelope,
)
from wardmap.provenance import SourceRecord, read_sidecar, today, write_source_geojson
from wardmap.publish import write_model

DIR = SOURCES / "landmarks"
MAX_OUTSIDE_M = 1000  # keep places this close to the metro's wards (beaches, piers)

GROUPS = {
    "safety": "Safety",
    "health": "Health",
    "learning": "Learning",
    "community": "Community and recreation",
    "shopping": "Shopping",
    "heritage": "Heritage",
}

# key -> (label, group). Display order.
CATEGORIES: dict[str, tuple[str, str]] = {
    "police": ("Police stations", "safety"),
    "fire": ("Fire stations", "safety"),
    "courts": ("Municipal courts", "safety"),
    "hospitals": ("Hospitals", "health"),
    "clinics": ("Clinics and day centres", "health"),
    "schools": ("Schools", "learning"),
    "libraries": ("Libraries", "learning"),
    "community_centres": ("Community centres and halls", "community"),
    "sports_grounds": ("Sports grounds", "community"),
    "stadia": ("Stadiums", "community"),
    "pools": ("Swimming pools", "community"),
    "beaches": ("Beaches", "community"),
    "malls": ("Shopping centres", "shopping"),
    "monuments": ("Monuments and memorials", "heritage"),
}

# Words kept in capitals when tidying the City's upper-case names.
ACRONYMS = {"CDC", "CHC", "MOU", "SAPS", "TB", "HIV", "NG", "VGK", "AGS", "UCT", "CPUT", "UWC"}
ACRONYMS |= {"II", "III", "IV", "SA", "RSA", "MPC", "YMCA", "CBD"}


def tidy(name: str) -> str:
    """'GORDON'S BAY CDC' -> "Gordon's Bay CDC"; leaves mixed-case names alone."""
    name = " ".join(name.split())
    if name != name.upper():
        return name

    def word(w: str) -> str:
        core = re.sub(r"[^A-Z]", "", w)
        if core in ACRONYMS or re.fullmatch(r"([A-Z]\.)+", w) or re.fullmatch(r"[IVX]{2,}", core):
            return w  # acronyms, initials, regnal numbers (Edward VII)
        # Lower-case, then capitalise the first letter of each hyphenated part ("(FREE" -> "(Free").
        return "-".join(
            re.sub(r"[a-z]", lambda m: m.group().upper(), p.lower(), count=1) for p in w.split("-")
        )

    return " ".join(word(w) for w in name.split(" "))


HEALTH_CLASSES = {  # City layer's CLS domain
    1: "Clinic",
    2: "Clinic and community day centre",
    3: "Community day centre",
    4: "District hospital",
    5: "Mobile clinic",
    6: "Private hospital",
    7: "Psychiatric hospital",
    8: "Regional hospital",
    9: "Satellite clinic",
    10: "Tertiary hospital",
    11: "Youth reproductive health",
}
HOSPITAL_CLASSES = {4, 6, 7, 8, 10}


@dataclass(frozen=True)
class CityLayer:
    file: str
    title: str
    path: str  # service/MapServer/layer under Theme_Based
    props: Callable[[dict], dict]  # City attributes -> {name, detail?, category?}


def _monument(a: dict) -> dict:
    detail = a.get("MTVT")
    if detail and len(detail) > 220:
        detail = detail[:217].rsplit(" ", 1)[0] + "..."
    return {"name": a["NAME"], "detail": detail}


def _health(a: dict) -> dict:
    cls = a.get("CLS")
    return {
        "name": a["NAME"],
        "detail": HEALTH_CLASSES.get(cls),
        "category": "hospitals" if cls in HOSPITAL_CLASSES else "clinics",
    }


CITY_LAYERS: dict[str, CityLayer] = {
    "police": CityLayer(
        "police.geojson",
        "Police Stations",
        "Safety_Security/MapServer/7",
        lambda a: {"name": f"{a['STN']} Police Station", "detail": "SAPS"},
    ),
    "fire": CityLayer(
        "fire.geojson",
        "Fire Stations",
        "Safety_Security/MapServer/6",
        lambda a: {
            "name": f"{a['FIRE_STN_NAME']} FIRE STATION",
            "detail": (a.get("FIRE_STN_CLASS") or "").capitalize() or None,
        },
    ),
    "courts": CityLayer(
        "courts.geojson",
        "Municipal Courts",
        "Community_Services/MapServer/3",
        lambda a: {"name": a["CRT_NAME"]},
    ),
    "health": CityLayer("health.geojson", "Health Care Facilities", "Health/MapServer/1", _health),
    "schools": CityLayer(
        "schools.geojson", "Schools", "Community_Services/MapServer/6", lambda a: {"name": a["INST_NAME"]}
    ),
    "libraries": CityLayer(
        "libraries.geojson",
        "Libraries",
        "Community_Services/MapServer/4",
        lambda a: {
            "name": f"{a['NAME']} LIBRARY" if a["NAME"].isupper() else f"{a['NAME']} Library",
            "detail": f"{a['CTGY']} library" if a.get("CTGY") else None,
        },
    ),
    "community_centres": CityLayer(
        "community-centres.geojson",
        "Community Centres",
        "Community_Services/MapServer/8",
        lambda a: {"name": a["FCLT_NAME"]},
    ),
    "sports_grounds": CityLayer(
        "sports-grounds.geojson",
        "Sports Grounds",
        "Community_Services/MapServer/13",
        lambda a: {"name": a["FCLT_NAME"]},
    ),
    "stadia": CityLayer(
        "stadia.geojson", "Stadia", "Community_Services/MapServer/25", lambda a: {"name": a["FCLT_NAME"]}
    ),
    "pools": CityLayer(
        "pools.geojson",
        "Swimming Pools",
        "Community_Services/MapServer/14",
        lambda a: {"name": a["FCLT_NAME"], "detail": a.get("FCLT_SUB_CTGR")},
    ),
    "beaches": CityLayer(
        "beaches.geojson", "Beaches", "Community_Services/MapServer/17", lambda a: {"name": a["FCLT_NAME"]}
    ),
    "monuments": CityLayer(
        "monuments.geojson", "Monuments", "Community_Services/MapServer/0", _monument
    ),
}  # fmt: skip
MALLS_FILE = "malls.geojson"


def _point_features(fc: dict, props: Callable[[dict], dict]) -> list[dict]:
    out = []
    for f in fc["features"]:
        g = f.get("geometry")
        if not g or g["type"] != "Point":
            continue
        p = {k: v for k, v in props(f["properties"]).items() if v}
        if not p.get("name"):
            continue
        p["name"] = tidy(str(p["name"]))
        out.append({"type": "Feature", "geometry": g, "properties": p})
    out.sort(key=lambda f: (f["properties"]["name"], f["geometry"]["coordinates"]))
    return out


def _pin_city(key: str, layer: CityLayer) -> None:
    url = f"{CCT_THEMES}/{layer.path}"
    fc = arcgis.geojson(url)
    write_source_geojson(
        DIR / layer.file,
        {"type": "FeatureCollection", "features": _point_features(fc, layer.props)},
        SourceRecord(
            title=layer.title,
            publisher="City of Cape Town",
            url=url,
            retrieved_at=today(),
            licence=CCT_LICENCE,
            notes="Upper-case names tidied to title case.",
        ),
    )


MALLS_QUERY = (
    '[out:json][timeout:120];nwr["shop"="mall"]["name"](-34.4,18.2,-33.4,19.1);out center tags;'
)


def _pin_malls() -> None:
    feats = []
    for e in post_json(OVERPASS, {"data": MALLS_QUERY})["elements"]:
        c = e.get("center") or {"lon": e.get("lon"), "lat": e.get("lat")}
        if c.get("lon") is None:
            continue
        feats.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(c["lon"], 6), round(c["lat"], 6)],
                },
                "properties": {"name": e["tags"]["name"], "osm": f"{e['type']}/{e['id']}"},
            }
        )
    feats.sort(key=lambda f: (f["properties"]["name"], f["properties"]["osm"]))
    write_source_geojson(
        DIR / MALLS_FILE,
        {"type": "FeatureCollection", "features": feats},
        SourceRecord(
            title="Shopping centres (shop=mall)",
            publisher="OpenStreetMap contributors",
            url="https://www.openstreetmap.org/",
            retrieved_at=today(),
            licence=OSM_LICENCE,
            notes=f"Overpass API query: {MALLS_QUERY}",
        ),
    )


def pin() -> None:
    for key, layer in CITY_LAYERS.items():
        _pin_city(key, layer)
    _pin_malls()


# ---- build ---------------------------------------------------------------------------------------


def _source_key(file: str) -> str:
    return file.removesuffix(".geojson").replace("-", "_")


def build(vintage: int) -> None:
    files = {k: layer.file for k, layer in CITY_LAYERS.items()} | {"malls": MALLS_FILE}
    raw: list[tuple[str, str, dict]] = []  # (category, source key, feature)
    for key, file in files.items():
        for f in geo.load_features(DIR / file):
            cat = f["properties"].get("category", key)
            raw.append((cat, _source_key(file), f))
    unknown = {c for c, _, _ in raw} - set(CATEGORIES)
    if unknown:
        raise ValueError(f"categories without a label: {unknown}")

    ids, wg = boundaries.load(vintage)
    lon = np.array([f["geometry"]["coordinates"][0] for _, _, f in raw])
    lat = np.array([f["geometry"]["coordinates"][1] for _, _, f in raw])
    ward = geo.assign_points(lon, lat, wg, ids)
    # Places outside every ward: keep those just off the edge (beaches, piers), drop the rest
    # (the OpenStreetMap query is a bounding box, so it reaches Paarl and Stellenbosch).
    metro = shapely.union_all(geo.project(wg))
    pts = geo.project(shapely.points(lon, lat))
    near = (ward >= 0) | (shapely.distance(pts, metro) <= MAX_OUTSIDE_M)
    edge = np.nonzero((ward < 0) & near)[0]
    if len(edge):  # e.g. beaches seaward of the ward line: give them to the nearest ward
        nearest = shapely.STRtree(geo.project(wg)).nearest(pts[edge])
        ward[edge] = np.asarray(ids)[nearest]

    seen: set[tuple] = set()
    rows: list[LandmarkRow] = []
    for (cat, _, f), x, y, w, keep in zip(raw, lon, lat, ward, near, strict=True):
        if not keep:
            continue
        key = (cat, f["properties"]["name"], round(float(x), 4), round(float(y), 4))
        if key in seen:
            continue  # the City's layers repeat a few points exactly
        seen.add(key)
        rows.append(
            LandmarkRow(
                category=cat,
                name=f["properties"]["name"],
                detail=f["properties"].get("detail"),
                lon=round(float(x), 5),
                lat=round(float(y), 5),
                ward_no=int(w) if w >= 0 else None,
            )
        )
    order = list(CATEGORIES)
    rows.sort(key=lambda r: (order.index(r.category), r.name, r.lon, r.lat))

    cat_source = {}
    for cat, src, _ in raw:
        cat_source.setdefault(cat, src)
    sources = {_source_key(file): boundaries.source(DIR / file) for file in files.values()}
    retrieved = max(read_sidecar(DIR / f).retrieved_at for f in files.values())
    env = LandmarksEnvelope(
        ward_vintage=vintage,
        as_of=retrieved,
        sources=sources,
        fields={
            "name": FieldMeta(
                label="Place",
                source="police",
                method="landmarks",
                description="Each row's source is its category's `source`.",
            )
        },
        gaps=[
            Gap(
                code="city_facilities_only",
                message="Places come from the City's facility registers (and OpenStreetMap for "
                "shopping centres). They can be incomplete or out of date, and include only the "
                "kinds of place listed.",
            )
        ]
        + [
            Gap(
                code="edge_places",
                message=f"{len(edge)} places just outside the ward boundaries (mostly beaches "
                "seaward of the ward line) are counted in the nearest ward.",
            )
        ],
        groups=[LandmarkGroup(key=k, label=v) for k, v in GROUPS.items()],
        categories=[
            LandmarkCategory(key=k, label=label, group=g, source=cat_source[k])
            for k, (label, g) in CATEGORIES.items()
            if k in cat_source
        ],
        rows=rows,
    )
    write_model(f"landmarks-{vintage}.json", env)
