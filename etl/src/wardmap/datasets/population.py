"""Modelled population per ward.

Stats SA has not released Census 2022 at ward level, and the City's modelled estimates are
published for named areas without polygons. So we:

1. Take the GHSL GHS-POP 2025 grid (EU JRC, ~100 m cells, CC BY 4.0), cropped to Cape Town.
2. Assign each cell to the ward containing its centre and sum.
3. Scale all wards by one factor so the metro total equals the City's 2025 estimate
   (the City's figure is the locally calibrated total; GHSL gives the spatial distribution).

The result is an estimate and is labelled as such wherever it appears (METHODOLOGY.md#population).
"""

from __future__ import annotations

import json
import shutil
import zipfile
from dataclasses import dataclass

import numpy as np
import rasterio
from rasterio.windows import from_bounds

from wardmap import geo
from wardmap.config import CACHE, CCT_LICENCE, CPT_BBOX, POPULATION_LAYER, SOURCES
from wardmap.fetch import download, get_json
from wardmap.provenance import SourceRecord, today, write_sidecar

DIR = SOURCES / "population"
GRID_FILE = DIR / "ghs-pop-2025-cpt.tif"
ESTIMATES_FILE = DIR / "city-estimates-2025.json"

GHSL_TILE = "GHS_POP_E2025_GLOBE_R2023A_4326_3ss_V1_0_R13_C20"
GHSL_URL = (
    "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/"
    f"GHS_POP_E2025_GLOBE_R2023A_4326_3ss/V1-0/tiles/{GHSL_TILE}.zip"
)
GHSL_CITATION = (
    "Schiavina M., Freire S., Carioli A., MacManus K. (2023): GHS-POP R2023A - GHS population "
    "grid multitemporal (1975-2030). European Commission, Joint Research Centre (JRC). "
    "doi:10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE"
)


def pin() -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    # City total (all areas summed) for calibration.
    body = get_json(
        f"{POPULATION_LAYER}/query",
        {"where": "1=1", "outFields": "*", "resultRecordCount": 2000, "f": "json"},
    )
    rows = sorted(
        (
            {
                "name": f["attributes"]["Suburb_Name"],
                "population": f["attributes"]["Estimated_population"],
            }
            for f in body["features"]
        ),
        key=lambda r: r["name"],
    )
    ESTIMATES_FILE.write_text(
        json.dumps(rows, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    write_sidecar(
        ESTIMATES_FILE,
        SourceRecord(
            title="Population Estimates 2025 (Suburb Level)",
            publisher="City of Cape Town",
            url=POPULATION_LAYER,
            retrieved_at=today(),
            licence=CCT_LICENCE,
            notes="Modelled annual planning estimates based on Census 2022; used for the metro total.",
        ),
    )

    # GHSL tile -> crop to Cape Town -> compressed GeoTIFF in sources/.
    zpath = CACHE / "ghsl" / f"{GHSL_TILE}.zip"
    if not zpath.exists():
        download(GHSL_URL, zpath)
    with zipfile.ZipFile(zpath) as z, z.open(f"{GHSL_TILE}.tif") as src_f:
        tmp = CACHE / "ghsl" / f"{GHSL_TILE}.tif"
        with tmp.open("wb") as out:
            shutil.copyfileobj(src_f, out)
    with rasterio.open(tmp) as src:
        win = from_bounds(*CPT_BBOX, transform=src.transform).round_offsets().round_lengths()
        data = src.read(1, window=win).astype("float32")
        profile = src.profile | {
            "height": data.shape[0],
            "width": data.shape[1],
            "transform": src.window_transform(win),
            "dtype": "float32",
            "compress": "deflate",
            "predictor": 3,
            "tiled": False,
        }
    with rasterio.open(GRID_FILE, "w", **profile) as dst:
        dst.write(data, 1)
    write_sidecar(
        GRID_FILE,
        SourceRecord(
            title="GHS-POP R2023A, epoch 2025, 3 arc-second grid (cropped to Cape Town)",
            publisher="European Commission, Joint Research Centre (GHSL)",
            url=GHSL_URL,
            retrieved_at=today(),
            licence="CC BY 4.0",
            notes=GHSL_CITATION,
        ),
    )


@dataclass
class WardPopulation:
    by_ward: dict[int, float]
    city_total: float
    grid_total_in_wards: float
    scale: float


def ward_population(ward_ids: list[int], ward_geoms: np.ndarray) -> WardPopulation:
    city_total = sum(r["population"] for r in json.loads(ESTIMATES_FILE.read_text("utf-8")))
    with rasterio.open(GRID_FILE) as src:
        data = src.read(1)
        t = src.transform
    rows, cols = np.nonzero(data > 0)
    lon = t.c + (cols + 0.5) * t.a
    lat = t.f + (rows + 0.5) * t.e
    ward = geo.assign_points(lon, lat, ward_geoms, ward_ids)
    vals = data[rows, cols]
    inside = ward >= 0
    sums = np.bincount(ward[inside], weights=vals[inside], minlength=max(ward_ids) + 1)
    grid_total = float(sums.sum())
    scale = city_total / grid_total
    return WardPopulation(
        by_ward={w: float(sums[w] * scale) for w in ward_ids},
        city_total=city_total,
        grid_total_in_wards=grid_total,
        scale=scale,
    )
