"""Small ArcGIS REST helpers: layer metadata, counts, grouped stats, keyset paging, GeoJSON."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from wardmap.fetch import get_json


def layer_info(layer_url: str) -> dict[str, Any]:
    return get_json(layer_url, {"f": "json"})


def count(layer_url: str, where: str = "1=1") -> int:
    return get_json(f"{layer_url}/query", {"where": where, "returnCountOnly": "true", "f": "json"})[
        "count"
    ]


def stats(layer_url: str, where: str, stats: list[dict], group_by: list[str]) -> list[dict]:
    body = get_json(
        f"{layer_url}/query",
        {
            "where": where,
            "outStatistics": json.dumps(stats),
            "groupByFieldsForStatistics": ",".join(group_by),
            "f": "json",
        },
    )
    return [f["attributes"] for f in body["features"]]


def query_pages(
    layer_url: str, where: str, oid_field: str, page_size: int = 1000
) -> Iterator[list[dict]]:
    """Yield pages of attribute dicts using keyset pagination on the object id.

    Keyset (``oid > last ORDER BY oid``) stays correct when rows are inserted mid-scan, unlike
    ``resultOffset``.
    """
    last = -1
    while True:
        body = get_json(
            f"{layer_url}/query",
            {
                "where": f"({where}) AND {oid_field} > {last}",
                "outFields": "*",
                "orderByFields": f"{oid_field} ASC",
                "resultRecordCount": page_size,
                "returnGeometry": "false",
                "f": "json",
            },
        )
        rows = [f["attributes"] for f in body.get("features", [])]
        if not rows:
            return
        yield rows
        last = rows[-1][oid_field]


def geojson(layer_url: str, where: str = "1=1", out_fields: str = "*") -> dict[str, Any]:
    """Fetch all features of a (small) polygon layer as GeoJSON in WGS84."""
    features: list[dict] = []
    offset = 0
    while True:
        body = get_json(
            f"{layer_url}/query",
            {
                "where": where,
                "outFields": out_fields,
                "outSR": 4326,
                "geometryPrecision": 6,
                "resultOffset": offset,
                "resultRecordCount": 200,
                "f": "geojson",
            },
        )
        page = body.get("features", [])
        features.extend(page)
        if len(page) < 200 and not body.get("exceededTransferLimit"):
            break
        offset += len(page)
    return {"type": "FeatureCollection", "features": features}


def geojson_any(bases: tuple[str, ...], layer: int, where: str = "1=1") -> tuple[dict, str]:
    """Like `geojson`, trying each mirror of a service in turn. Returns (collection, layer url)."""
    for base in bases:
        try:
            return geojson(f"{base}/{layer}", where), f"{base}/{layer}"
        except Exception as e:  # noqa: BLE001 - try the next mirror on any failure
            print(f"  {base} failed: {e}")
    raise RuntimeError(f"layer {layer} unavailable on {bases}")
