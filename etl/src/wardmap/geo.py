"""Geometry helpers: load GeoJSON, project for areas, point-in-polygon, overlay crosswalks."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer

from wardmap.config import AREA_CRS

_to_area = Transformer.from_crs("EPSG:4326", AREA_CRS, always_xy=True)


def load_features(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def geoms(features: list[dict]) -> np.ndarray:
    out = np.array([shapely.from_geojson(json.dumps(f["geometry"])) for f in features])
    return shapely.make_valid(out)


def project(g: np.ndarray) -> np.ndarray:
    """WGS84 -> UTM 34S, so areas are in square metres."""
    return shapely.transform(g, lambda xy: np.column_stack(_to_area.transform(xy[:, 0], xy[:, 1])))


def assign_points(
    lon: np.ndarray, lat: np.ndarray, polys: np.ndarray, ids: list[int]
) -> np.ndarray:
    """Return the polygon id containing each point, or -1. Points on shared edges go to one ward."""
    points = shapely.points(lon, lat)
    tree = shapely.STRtree(polys)
    pt_idx, poly_idx = tree.query(points, predicate="intersects")
    out = np.full(len(points), -1, dtype=np.int64)
    # Later matches overwrite earlier ones; edge points are rare and the choice is arbitrary.
    out[pt_idx] = np.asarray(ids, dtype=np.int64)[poly_idx]
    return out


def overlay_weights(
    src: np.ndarray, src_ids: list, dst: np.ndarray, dst_ids: list, min_share: float = 0.001
) -> list[tuple]:
    """Area overlap between two polygon sets (already projected).

    Returns (src_id, dst_id, share_of_src, share_of_dst, overlap_m2) for each intersecting pair.
    Shares below ``min_share`` (slivers from boundary noise) are dropped.
    """
    tree = shapely.STRtree(dst)
    s_idx, d_idx = tree.query(src, predicate="intersects")
    inter = shapely.area(shapely.intersection(src[s_idx], dst[d_idx]))
    s_area = shapely.area(src)
    d_area = shapely.area(dst)
    rows = []
    for s, d, a in zip(s_idx, d_idx, inter, strict=True):
        share_src = a / s_area[s]
        if share_src < min_share and a / d_area[d] < min_share:
            continue
        rows.append((src_ids[s], dst_ids[d], float(share_src), float(a / d_area[d]), float(a)))
    return rows


def simplify_coverage(g: np.ndarray, tolerance_deg: float) -> np.ndarray:
    """Simplify a polygon coverage keeping shared edges shared (no gaps or slivers)."""
    return shapely.coverage_simplify(g, tolerance_deg)
