"""Paths, source locations and ward vintages. Every upstream URL lives here and nowhere else."""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SOURCES = REPO / "sources"
RAW = REPO / "raw"
DATA = REPO / "data"
SCHEMAS = REPO / "schemas"
CACHE = RAW / "cache"
DB_PATH = RAW / "db" / "service_requests.sqlite"

# Ward vintages: the year a delimitation took effect. Cape Town: 116 wards (2021), 118 (2026).
CURRENT_VINTAGE = 2026
VINTAGE_WARD_COUNT = {2021: 116, 2026: 118}

# City of Cape Town GIS (on-prem; can be flaky, so only used by `pin`, never by CI).
CCT_ODP5 = (
    "https://citymaps.capetown.gov.za/agsext/rest/services/Theme_Based/ODP_SPLIT_5/FeatureServer"
)
CCT_ODP5_MIRROR = (
    "https://esapqa.capetown.gov.za/agsext/rest/services/Theme_Based/ODP_SPLIT_5/FeatureServer"
)
CCT_WARDS_LAYER = 6
CCT_SUBURBS_LAYER = 3
CCT_SUBCOUNCILS_LAYER = 5  # 20 subcouncils since 30 Aug 2024
# Load-shedding blocks: the City's own electricity distribution area (outside = Eskom-supplied).
CCT_BSI = (
    "https://citymaps.capetown.gov.za/agsext/rest/services/Theme_Based/"
    "Basic_Services_Infrastructure/MapServer"
)
CCT_BSI_MIRROR = (
    "https://esapqa.capetown.gov.za/agsext/rest/services/Theme_Based/"
    "Basic_Services_Infrastructure/MapServer"
)
CCT_LOADSHEDDING_BLOCKS_LAYER = 5
CCT_THEMES = "https://citymaps.capetown.gov.za/agsext/rest/services/Theme_Based"
CCT_ZONING_LAYER = f"{CCT_THEMES}/Land_Parcel_Zonning/MapServer/2"  # (sic) the City's spelling

# Electoral Commission of South Africa (IEC): static report files behind the results portal.
IEC_REPORTS = "https://results.elections.org.za/home/LGEPublicReports"
IEC_RESULTS_PAGE = "https://results.elections.org.za/home/Downloads/ME-Results/"
IEC_LICENCE = (
    "Electoral Commission of South Africa (copyright notice: reproduction for non-commercial "
    "use; https://www.elections.org.za/pw/Copyright-Notice)"
)
# Local government elections: year -> (IEC event id, ward vintage the election was fought on).
LGE = {
    2021: (1091, 2021),
    2026: (1887, 2026),
}
IEC_PROVINCES = {  # IEC report file codes
    "EC": "Eastern Cape",
    "FS": "Free State",
    "GP": "Gauteng",
    "KN": "KwaZulu-Natal",
    "NP": "Limpopo",
    "MP": "Mpumalanga",
    "NW": "North West",
    "NC": "Northern Cape",
    "WP": "Western Cape",
}
# The IEC results dashboard's static data files (per council, per election), e.g.
# MapsJason/2026/EEID1887Munic9006.js. They name each ward's elected candidate.
IEC_DASHBOARD_DATA = "https://results.elections.org.za/dashboards/lge/MapsJason"
IEC_DASHBOARD = "https://results.elections.org.za/dashboards/lge/LGEResultsDashboard.aspx"
IEC_MUNIC_IDS = {"CPT": 9006}
METROS = {"BUF", "CPT", "EKU", "ETH", "JHB", "MAN", "NMA", "TSH"}

# OpenStreetMap (malls only: the City publishes no shopping-centre layer).
OVERPASS = "https://overpass-api.de/api/interpreter"
OSM_LICENCE = "Open Database License (ODbL) 1.0, (c) OpenStreetMap contributors"

# Municipal Demarcation Board ward layers on ArcGIS Online (CAT_B = 'CPT' for Cape Town).
MDB_WARDS = {
    2021: "https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_Wards_2020/FeatureServer/0",
    2026: "https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_Wards_2026/FeatureServer/0",
}

# City of Cape Town ArcGIS Online (open data hub).
AGOL = "https://services6.arcgis.com/nyYfO9SxHU2ChQd9/arcgis/rest/services"
SR_ITEM_ID = "da3b6d46845e4671bde500e8de7e1d3e"
SR_LAYER = f"{AGOL}/schema_jan2023_iso/FeatureServer/0"
SR_CSV = (
    f"https://hub.arcgis.com/api/v3/datasets/{SR_ITEM_ID}_0/downloads/data"
    "?format=csv&spatialRefId=4326"
)
SR_PORTAL_PAGE = f"https://odp-cctegis.opendata.arcgis.com/datasets/{SR_ITEM_ID}"
POPULATION_ITEM_ID = "61bd1a6c374d44a093862784b79f6c23"
POPULATION_LAYER = f"{AGOL}/Population_Estimates_2026_(Suburb_Level)/FeatureServer/0"

CCT_LICENCE = "City of Cape Town Open Data Licence"
MDB_LICENCE = "Municipal Demarcation Board public data"

# Cape Town bounding box (lon/lat) used to discard obviously wrong coordinates.
CPT_BBOX = (18.2, -34.4, 19.1, -33.4)

# Projected CRS for area calculations (UTM 34S).
AREA_CRS = "EPSG:32734"
