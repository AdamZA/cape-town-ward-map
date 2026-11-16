"""Who supplies electricity where: the City of Cape Town or Eskom directly.

The City's "Electricity Supply Authority" layer is truncated (its main City-supplied polygon
is missing), so we use the City's load-shedding blocks instead: they cover exactly the City's
own distribution area, and everything outside them is supplied by Eskom directly.

Shares are population-weighted (GHSL grid cells), not area-weighted: Eskom areas include
large unpopulated tracts, and residents are what matter here. See METHODOLOGY.md#electricity.
"""

from __future__ import annotations

from functools import cache

import numpy as np
import shapely

from wardmap import arcgis, geo
from wardmap.config import (
    CCT_BSI,
    CCT_BSI_MIRROR,
    CCT_LICENCE,
    CCT_LOADSHEDDING_BLOCKS_LAYER,
    SOURCES,
)
from wardmap.datasets import boundaries
from wardmap.datasets import population as pop
from wardmap.models import Source
from wardmap.provenance import SourceRecord, today, write_source_geojson

BLOCKS_FILE = SOURCES / "electricity" / "loadshedding-blocks.geojson"


def pin() -> None:
    fc, url = arcgis.geojson_any((CCT_BSI, CCT_BSI_MIRROR), CCT_LOADSHEDDING_BLOCKS_LAYER)
    for f in fc["features"]:
        f["properties"] = {"block": int(f["properties"]["BlockID"])}
    fc["features"].sort(key=lambda f: f["properties"]["block"])
    if len(fc["features"]) < 15:
        raise ValueError(f"expected ~19 load-shedding blocks, got {len(fc['features'])}")
    write_source_geojson(
        BLOCKS_FILE,
        fc,
        SourceRecord(
            title="Loadshedding Blocks",
            publisher="City of Cape Town",
            url=url,
            retrieved_at=today(),
            licence=CCT_LICENCE,
            notes="The City's load-shedding areas, which together cover the area where the City "
            "distributes electricity. Used to tell City-supplied from Eskom-supplied areas.",
        ),
    )


def source() -> Source:
    return boundaries.source(BLOCKS_FILE)


@cache
def city_area() -> shapely.Geometry:
    return shapely.union_all(geo.geoms(geo.load_features(BLOCKS_FILE)))


@cache
def city_share(vintage: int) -> dict[int, float]:
    """Ward -> share of its modelled population in City-supplied areas."""
    ids, wg = boundaries.load(vintage)
    lon, lat, vals = pop.grid_cells()
    ward = geo.assign_points(lon, lat, wg, ids)
    city = shapely.contains_xy(city_area(), lon, lat)
    inside = ward >= 0
    total = np.bincount(ward[inside], weights=vals[inside], minlength=max(ids) + 1)
    sel = inside & city
    in_city = np.bincount(ward[sel], weights=vals[sel], minlength=max(ids) + 1)
    return {w: float(in_city[w] / total[w]) if total[w] else 0.0 for w in ids}
