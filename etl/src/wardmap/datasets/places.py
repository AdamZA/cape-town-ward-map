"""Place-name search: the City's official suburbs and the wards that cover each.

People often know their suburb but not their ward, and a suburb can span several wards. Each
suburb is published with every ward covering at least MIN_SHARE of its area, so the site can
show all the candidates (and the user narrows it down on the map or with their location).
"""

from __future__ import annotations

import shapely

from wardmap import arcgis, geo
from wardmap.config import (
    CCT_LICENCE,
    CCT_ODP5,
    CCT_ODP5_MIRROR,
    CCT_SUBURBS_LAYER,
    SOURCES,
)
from wardmap.datasets import boundaries
from wardmap.models import FieldMeta, PlaceRow, PlacesEnvelope, PlaceWard
from wardmap.provenance import SourceRecord, read_sidecar, today, write_source_geojson
from wardmap.publish import write_model

SUBURBS_FILE = SOURCES / "places" / "suburbs.geojson"
MIN_SHARE = 0.02  # ignore slivers where a suburb edge grazes a ward


def pin() -> None:
    fc, url = arcgis.geojson_any((CCT_ODP5, CCT_ODP5_MIRROR), CCT_SUBURBS_LAYER)
    for f in fc["features"]:
        f["properties"] = {"name": " ".join(f["properties"]["OFC_SBRB_NAME"].split()).title()}
    fc["features"].sort(key=lambda f: f["properties"]["name"])
    write_source_geojson(
        SUBURBS_FILE,
        fc,
        SourceRecord(
            title="Official Suburbs",
            publisher="City of Cape Town",
            url=url,
            retrieved_at=today(),
            licence=CCT_LICENCE,
            notes="Suburb names are title-cased from the City's upper-case names.",
        ),
    )


def build(vintage: int) -> None:
    feats = geo.load_features(SUBURBS_FILE)
    names = [f["properties"]["name"] for f in feats]
    g = geo.geoms(feats)
    ids, wg = boundaries.load(vintage)
    overlaps = geo.overlay_weights(geo.project(g), list(range(len(g))), geo.project(wg), ids)
    by_place: dict[int, list[PlaceWard]] = {}
    for i, w, share, _, _ in overlaps:
        if share >= MIN_SHARE:
            by_place.setdefault(i, []).append(PlaceWard(ward_no=w, share=round(share, 3)))

    # Several suburbs share a name (e.g. split parts); merge them into one entry.
    merged: dict[str, tuple[list[int], dict[int, float]]] = {}
    for i, name in enumerate(names):
        if i not in by_place:
            continue  # outside the metro's wards (e.g. sea polygons)
        idx, shares = merged.setdefault(name, ([], {}))
        idx.append(i)
        area = shapely.area(geo.project(g[[i]]))[0]
        for pw in by_place[i]:
            shares[pw.ward_no] = shares.get(pw.ward_no, 0.0) + pw.share * area
    rows = []
    for name, (idx, shares) in sorted(merged.items()):
        total = sum(shares.values())
        bounds = shapely.bounds(shapely.union_all(g[idx]))
        rows.append(
            PlaceRow(
                name=name,
                bbox=[round(float(v), 4) for v in bounds],
                wards=sorted(
                    (PlaceWard(ward_no=w, share=round(a / total, 3)) for w, a in shares.items()),
                    key=lambda pw: (-pw.share, pw.ward_no),
                ),
            )
        )
    src = read_sidecar(SUBURBS_FILE)
    env = PlacesEnvelope(
        ward_vintage=vintage,
        as_of=src.retrieved_at,
        sources={
            "suburbs": boundaries.source(SUBURBS_FILE),
            "boundaries": boundaries.source(boundaries.ward_file(vintage)),
        },
        fields={
            "wards": FieldMeta(
                label="Wards covering this suburb",
                source="suburbs",
                description=f"Every ward covering at least {MIN_SHARE:.0%} of the suburb's area.",
            )
        },
        rows=rows,
    )
    write_model(f"places-{vintage}.json", env)
