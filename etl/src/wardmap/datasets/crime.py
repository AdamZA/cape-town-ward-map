"""Reported crime per police station, and which police precincts cover each ward.

Two inputs, handled differently because their terms differ:

- SAPS crime statistics (public quarterly workbooks). Each workbook repeats one quarter across
  five years per station and crime category; the four quarters of a financial year together
  give five years of annual counts. We pin the station rows (all of South Africa) as
  sources/crime/station-years.csv.gz.
- SAPS police precinct boundaries. Their download terms forbid passing the boundaries on, so
  they live only in raw/saps/ (git-ignored, downloaded by hand). We derive and pin a ward ->
  precinct table: the share of each ward's residents (GHSL population grid) living in each
  precinct, and each precinct's population. Nothing else from the boundaries is published.

The site shows each ward's precinct figures and rates. It never splits a precinct's crimes
between wards (that would assume crime follows population).
"""

from __future__ import annotations

import gzip
import io
import re
from pathlib import Path

import numpy as np
import pandas as pd
import shapely

from wardmap import geo
from wardmap.config import CACHE, CPT_BBOX, RAW, SOURCES
from wardmap.datasets import boundaries, population
from wardmap.fetch import download
from wardmap.provenance import SourceRecord, today, write_sidecar

DIR = SOURCES / "crime"
STATS_FILE = DIR / "station-years.csv.gz"
SAPS_STATS_PAGE = "https://www.saps.gov.za/services/crimestats.php"
SAPS_DOWNLOADS = "https://www.saps.gov.za/services/downloads"
SAPS_BOUNDARY_PAGE = "https://www.saps.gov.za/services/boundary.php"
SAPS_LICENCE = (
    "SAPS copyright (https://www.saps.gov.za/copyright.php); counts reproduced with attribution"
)
BOUNDS = RAW / "saps" / "station_boundaries" / "station_boundaries" / "Police_bounds.shp"

# The four quarterly workbooks of the latest complete financial year (April to March).
FINANCIAL_YEAR = "2025/26"
WORKBOOKS = [f"2025/2025-2026_-_{q}_Quarter_WEB.xlsx" for q in ("1st", "2nd", "3rd", "4th")]

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september",
     "october", "november", "december"], start=1)}  # fmt: skip


def lookup_file(vintage: int) -> Path:
    return DIR / f"ward-precincts-{vintage}.csv"


def norm(name: str) -> str:
    """Station names differ in case and punctuation between SAPS files."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _fy(label: str) -> str | None:
    """'January 2026 to March 2026' -> '2025/26' (financial years run April to March)."""
    m = re.match(r"\s*([A-Za-z]+)\s+(\d{4})\s+to", label)
    if not m or m.group(1).lower() not in MONTHS:
        return None
    month, year = MONTHS[m.group(1).lower()], int(m.group(2))
    start = year if month >= 4 else year - 1
    return f"{start}/{str(start + 1)[-2:]}"


def _workbook_rows(path: Path) -> pd.DataFrame:
    d = pd.read_excel(path, "RAW Data", header=2, engine="calamine")
    d = d[d["Comp level"] == "Station"]
    quarter_cols = {c: _fy(c) for c in d.columns if isinstance(c, str) and _fy(c)}
    long = d.melt(
        id_vars=["Station", "District", "Province", "Crime_Category"],
        value_vars=list(quarter_cols),
        var_name="quarter",
        value_name="count",
    )
    long["financial_year"] = long["quarter"].map(quarter_cols)
    return long.drop(columns="quarter")


def pin_stats() -> None:
    parts = []
    for wb in WORKBOOKS:
        dest = CACHE / "saps" / Path(wb).name
        if not dest.exists():
            download(f"{SAPS_DOWNLOADS}/{wb}", dest)
        parts.append(_workbook_rows(dest))
    d = pd.concat(parts)
    d["count"] = pd.to_numeric(d["count"], errors="coerce").fillna(0).astype(int)
    out = (
        d.groupby(
            ["Province", "District", "Station", "Crime_Category", "financial_year"], as_index=False
        )["count"]
        .sum()
        .rename(columns=str.lower)
        .rename(columns={"crime_category": "category"})
    )
    # Each workbook holds the same quarter of five years, so the four together give five
    # complete financial years. Check that every year got all four quarters.
    per_year = d.groupby("financial_year").size()
    if per_year.nunique() != 1:
        raise ValueError(f"uneven quarters per financial year: {per_year.to_dict()}")
    out = out.sort_values(["province", "district", "station", "category", "financial_year"])
    DIR.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, filename="") as gz:
        gz.write(out.to_csv(index=False, lineterminator="\n").encode("utf-8"))
    STATS_FILE.write_bytes(buf.getvalue())
    write_sidecar(
        STATS_FILE,
        SourceRecord(
            title=f"Crime statistics per police station, financial years to {FINANCIAL_YEAR}",
            publisher="South African Police Service (SAPS)",
            url=SAPS_STATS_PAGE,
            retrieved_at=today(),
            licence=SAPS_LICENCE,
            method="aggregated",
            notes="Station-level rows of the four quarterly workbooks for "
            f"{FINANCIAL_YEAR} ({', '.join(WORKBOOKS)}), summed to financial years "
            "(April to March). Reported crimes; SAPS revises figures in later releases.",
        ),
    )


def pin_lookup(vintage: int) -> None:
    """Ward -> precinct shares of residents, from the hand-downloaded SAPS boundaries."""
    import shapefile  # pyshp; only needed here

    r = shapefile.Reader(str(BOUNDS), encoding="latin-1")
    names = [rec["COMPNT_NM"] for rec in r.records()]
    version = r.records()[0]["VERSION"]
    polys = shapely.make_valid(
        np.array([shapely.geometry.shape(s.__geo_interface__) for s in r.shapes()])
    )
    ids, wg = boundaries.load(vintage)
    metro = shapely.union_all(wg)
    tree = shapely.STRtree(polys)
    near = sorted(set(tree.query(metro, predicate="intersects").tolist()))

    lon, lat, vals = population.grid_cells()
    scale = population.ward_population(ids, wg).scale
    ward_of = geo.assign_points(lon, lat, wg, ids)
    prec_of = geo.assign_points(lon, lat, polys[near], near)
    df = pd.DataFrame({"ward": ward_of, "precinct": prec_of, "pop": vals * scale})
    in_wards = df[df["ward"] >= 0]
    by_pair = in_wards[in_wards["precinct"] >= 0].groupby(["ward", "precinct"])["pop"].sum()
    ward_pop = in_wards.groupby("ward")["pop"].sum()
    # Precinct population: every grid cell in the precinct, inside or outside the metro. The
    # grid is cropped to a box around Cape Town, so precincts reaching past the box are flagged
    # (precinct_in_grid < 1) and the site gives no rate for them.
    prec_pop = df[df["precinct"] >= 0].groupby("precinct")["pop"].sum()
    box_m = geo.project(np.array([shapely.box(*CPT_BBOX)]))[0]
    rows = []
    for (w, p), pop in by_pair.items():
        if pop / ward_pop[w] < 0.005:
            continue  # slivers
        pm = geo.project(polys[[p]])[0]
        inside = shapely.area(shapely.intersection(pm, box_m)) / shapely.area(pm)
        rows.append(
            {
                "ward_no": int(w),
                "station": names[p].title(),
                "share_of_ward": round(float(pop / ward_pop[w]), 4),
                "precinct_population": int(round(prec_pop[p], -2)),
                "precinct_in_grid": round(float(inside), 3),
            }
        )
    out = pd.DataFrame(rows).sort_values(["ward_no", "share_of_ward"], ascending=[True, False])
    path = lookup_file(vintage)
    DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(out.to_csv(index=False, lineterminator="\n"), encoding="utf-8", newline="\n")
    write_sidecar(
        path,
        SourceRecord(
            title=f"Police precincts covering each {vintage} ward (derived)",
            publisher="Derived by Cape Town Ward Map from SAPS police station boundaries",
            url=SAPS_BOUNDARY_PAGE,
            retrieved_at=today(),
            licence="Derived table; the SAPS boundaries themselves are not redistributed",
            method="manual",
            notes=f"SAPS station boundaries version {version}, downloaded by hand under SAPS terms "
            "and kept out of the repository. share_of_ward = share of the ward's residents "
            "(GHSL 2025 grid, scaled to the City's estimate) living in the precinct. "
            "precinct_population = the precinct's residents (same grid, inside or outside the "
            "metro); precinct_in_grid = share of the precinct's area inside the grid's box "
            f"{CPT_BBOX} (below 1, the population is undercounted).",
        ),
    )


# ---- build --------------------------------------------------------------------------------------

# Headline categories (SAPS name -> key, label, note). Display order.
CATEGORIES = {
    "Murder": ("murder", "Murder", None),
    "Attempted murder": ("attempted_murder", "Attempted murder", None),
    "Sexual offences": ("sexual_offences", "Sexual offences", "Includes rape and sexual assault"),
    "Contact crime (Crimes against the person)": (
        "contact",
        "Contact crime",
        "Violent crime against a person: murder, assault, sexual offences, robbery",
    ),
    "Robbery with aggravating circumstances": (
        "robbery_aggravated",
        "Robbery with a weapon or violence",
        None,
    ),
    "Carjacking": ("carjacking", "Carjacking", None),
    "Burglary at residential premises": ("burglary_home", "Home burglary", None),
    "Theft of motor vehicle and motorcycle": ("vehicle_theft", "Vehicle theft", None),
    "Property-related Crime": (
        "property",
        "Property crime",
        "Burglary, theft of and from vehicles, stock theft",
    ),
    "Drug-related crime": (
        "drugs",
        "Drug-related crime",
        "Mostly reflects police activity (arrests), not how common drugs are",
    ),
}
MIN_POPULATION = 5000  # below this, per-resident rates mislead (harbours, business districts)
MIN_IN_GRID = 0.95  # precincts reaching past the population grid are undercounted


def build(vintage: int) -> None:
    from wardmap.models import (
        CrimeCategory,
        CrimeEnvelope,
        CrimeWardRow,
        FieldMeta,
        Gap,
        Period,
        StationCrime,
        WardPrecinct,
    )
    from wardmap.provenance import read_sidecar
    from wardmap.publish import write_model

    stats = pd.read_csv(STATS_FILE)
    stats = stats[stats["category"].isin(CATEGORIES)]
    look = pd.read_csv(lookup_file(vintage))
    years = sorted(stats["financial_year"].unique())
    latest = years[-1]
    by_norm = {norm(s): s for s in stats["station"].unique()}

    stations: dict[str, StationCrime] = {}
    rate: dict[str, dict[str, float | None]] = {}
    for st, g in look.drop_duplicates("station").set_index("station").iterrows():
        s = stats[stats["station"] == by_norm[norm(st)]]
        counts = {
            CATEGORIES[c][0]: {
                fy: int(n) for fy, n in cg.set_index("financial_year")["count"].items()
            }
            for c, cg in s.groupby("category")
        }
        usable = g["precinct_population"] >= MIN_POPULATION and g["precinct_in_grid"] >= MIN_IN_GRID
        pop = int(g["precinct_population"]) if usable else None
        stations[st] = StationCrime(station=st, population=pop, counts=counts)
        rate[st] = {
            k: (round(v.get(latest, 0) / pop * 100_000, 1) if pop else None)
            for k, v in counts.items()
        }

    rows = []
    for w, g in look.groupby("ward_no"):
        precincts = [WardPrecinct(station=r.station, share=r.share_of_ward) for r in g.itertuples()]
        rates: dict[str, float | None] = {}
        for key, *_ in CATEGORIES.values():
            known = [
                (p.share, rate[p.station][key])
                for p in precincts
                if rate[p.station].get(key) is not None
            ]
            covered = sum(s for s, _ in known)
            # Only when precincts with a usable rate hold most of the ward's residents.
            rates[key] = (
                round(sum(s * r for s, r in known) / covered, 1) if covered >= 0.8 else None
            )
        rows.append(CrimeWardRow(ward_no=int(w), precincts=precincts, rates=rates))

    stats_src = read_sidecar(STATS_FILE)
    fy0 = int(latest[:4])
    write_model(
        f"crime-{vintage}.json",
        CrimeEnvelope(
            ward_vintage=vintage,
            as_of=stats_src.retrieved_at,
            period=Period(start=f"{fy0}-04", end=f"{fy0 + 1}-03"),
            sources={
                "stats": boundaries.source(STATS_FILE),
                "precincts": boundaries.source(lookup_file(vintage)),
            },
            fields={
                "counts": FieldMeta(label="Reported crimes", source="stats", method="crime"),
                "rates": FieldMeta(
                    label="Per 100,000 residents (police precinct)",
                    unit="per 100,000",
                    source="stats",
                    method="crime",
                    description="Crimes reported at the police station(s) covering the ward, per "
                    "100,000 residents of those precincts, weighted by where the ward's residents "
                    "live. Not crimes counted inside the ward.",
                ),
            },
            gaps=[
                Gap(
                    code="reported_only",
                    message="Reported crimes only: many crimes go unreported, and reporting "
                    "differs between communities and crime types.",
                ),
                Gap(
                    code="precinct_not_ward",
                    message="Police precincts don't follow ward boundaries. Figures are for the "
                    "precinct(s) covering the ward, not crimes inside the ward itself.",
                ),
                Gap(
                    code="residents_not_visitors",
                    message="Rates divide by residents. Precincts with many visitors or workers "
                    "(the city centre, beachfronts, shopping areas) show higher rates than their "
                    "residents experience. No rate is given for precincts with very few "
                    "residents or that reach past the population data.",
                ),
            ],
            financial_year=latest,
            years=years,
            categories=[
                CrimeCategory(key=k, label=lab, note=n) for k, lab, n in CATEGORIES.values()
            ],
            stations=sorted(stations.values(), key=lambda s: s.station),
            rows=rows,
        ),
    )
