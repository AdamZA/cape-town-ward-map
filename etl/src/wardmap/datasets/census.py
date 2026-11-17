"""Census 2011 employment and household services per ward.

Source: the Municipal Demarcation Board's "Ward Profile 2021" layer, which re-counts Census 2011
(Statistics South Africa) onto the 2021 wards. Its Cape Town total is 3 740 028 people, Census
2011's figure for the metro. It's the most local employment figure published; Census 2022 hasn't
been released by ward.

Published for the 2021 wards as they are, and moved onto the 2026 wards by where people live:
each 2021 ward's counts are split between the 2026 wards in proportion to the residents (from
the population grid) living in each overlap. Counts are split, then rates recomputed.

Education is left out: the profile counts schoolchildren with adults, so "share with Grade 12"
would mostly measure how young an area is.
"""

from __future__ import annotations

import pandas as pd

from wardmap import arcgis, geo
from wardmap.config import MDB_LICENCE, MDB_SERVICES, SOURCES
from wardmap.datasets import boundaries, population
from wardmap.models import CensusEnvelope, CensusRow, FieldMeta, Source
from wardmap.provenance import SourceRecord, read_sidecar, today, write_sidecar
from wardmap.publish import write_model

LAYER = f"{MDB_SERVICES}/WardProfile2021_gdb/FeatureServer/0"
SOURCE_VINTAGE = 2021
CENSUS_YEAR = 2011
CENSUS_TOTAL = 3_740_026  # Census 2011, City of Cape Town (Stats SA)
FILE = SOURCES / "census" / "ward-profile-2011-on-2021-wards.csv"

COUNTS = {
    "population": ["Total_Pop"],
    "employed": ["Employed"],
    "unemployed": ["Unemployed"],
    "discouraged": ["Discouraged_Work_Seeker"],
    "not_active": ["Not_Economically_Active"],
    "water_in_dwelling": ["Tap_In_Dwelling"],
    "water_known": [
        "Tap_In_Dwelling",
        "tap_in_Yard",
        "Tap_CommStand_Less_200m",
        "Tap_CommStand_bet_200m_500m",
        "Tap_CommStand_bet_500m_1000m",
        "Tap_CommStand_More_1000m",
        "No_access_to_piped_water",
    ],
    "flush": ["Flush_Toilet_SewerSystem", "Flush_Toilet_SepticTank"],
    "toilet_known": [
        "None_Toilet",
        "Flush_Toilet_SewerSystem",
        "Flush_Toilet_SepticTank",
        "Chemical_Toilet",
        "Pit_Toilet_VIP",
        "Pit_Toilet_NoVentilation",
        "Bucket_Toilet",
        "Other_Toilet",
    ],
    "refuse_weekly": ["Removed_Weekly"],
    "refuse_known": [
        "Removed_Weekly",
        "Removed_Seldom",
        "Communal_dump",
        "Own_dump",
        "No_Disposal",
        "Other_Refuse",
    ],
}


def pin() -> None:
    rows = [r for page in arcgis.query_pages(LAYER, "CAT_B='CPT'", "OBJECTID") for r in page]
    df = pd.DataFrame(rows)
    fields = sorted({f for fs in COUNTS.values() for f in fs})
    df = df[["WardNo", *fields]].rename(columns={"WardNo": "ward_no"}).sort_values("ward_no")
    if sorted(df["ward_no"]) != list(range(1, 117)):
        raise ValueError(f"expected 2021 wards 1..116, got {len(df)} rows")
    total = int(df["Total_Pop"].sum())
    if abs(total - CENSUS_TOTAL) > 100:
        raise ValueError(f"total population {total} is not Census 2011's {CENSUS_TOTAL}")
    FILE.parent.mkdir(parents=True, exist_ok=True)
    FILE.write_text(df.to_csv(index=False, lineterminator="\n"), encoding="utf-8", newline="\n")
    write_sidecar(
        FILE,
        SourceRecord(
            title="Ward Profile 2021 (Census 2011 on the 2021 wards), City of Cape Town",
            publisher="Municipal Demarcation Board, from Statistics South Africa's Census 2011",
            url=LAYER,
            retrieved_at=today(),
            licence=MDB_LICENCE,
            notes=f"Attributes of the CAT_B='CPT' features (116 wards). Total population {total}, "
            f"matching Census 2011's {CENSUS_TOTAL} for the metro.",
        ),
    )


def _counts() -> pd.DataFrame:
    df = pd.read_csv(FILE).set_index("ward_no")
    return pd.DataFrame({k: df[fs].sum(axis=1) for k, fs in COUNTS.items()})


def _transfer(counts: pd.DataFrame, vintage: int) -> pd.DataFrame:
    """Split each source ward's counts between `vintage` wards by where residents live."""
    if vintage == SOURCE_VINTAGE:
        return counts
    old_ids, old_g = boundaries.load(SOURCE_VINTAGE)
    new_ids, new_g = boundaries.load(vintage)
    lon, lat, vals = population.grid_cells()
    old = geo.assign_points(lon, lat, old_g, old_ids)
    new = geo.assign_points(lon, lat, new_g, new_ids)
    both = (old >= 0) & (new >= 0)
    pairs = pd.DataFrame({"old": old[both], "new": new[both], "pop": vals[both]})
    w = pairs.groupby(["old", "new"])["pop"].sum()
    w = w / w.groupby(level="old").transform("sum")
    out = pd.DataFrame(0.0, index=pd.Index(new_ids, name="ward_no"), columns=counts.columns)
    for (o, n), share in w.items():
        out.loc[n] += counts.loc[o] * share
    return out


def _ratio(a: float, b: float) -> float | None:
    return round(float(a / b), 4) if b > 0 else None


def _row(ward: int, c: pd.Series) -> CensusRow:
    labour = c["employed"] + c["unemployed"]
    return CensusRow(
        ward_no=int(ward),
        population=int(round(c["population"])),
        unemployment=_ratio(c["unemployed"], labour),
        expanded_unemployment=_ratio(c["unemployed"] + c["discouraged"], labour + c["discouraged"]),
        employment_ratio=_ratio(c["employed"], labour + c["discouraged"] + c["not_active"]),
        water_in_dwelling=_ratio(c["water_in_dwelling"], c["water_known"]),
        flush_toilet=_ratio(c["flush"], c["toilet_known"]),
        refuse_weekly=_ratio(c["refuse_weekly"], c["refuse_known"]),
    )


def build(vintage: int) -> None:
    counts = _transfer(_counts(), vintage)
    rows = [_row(w, c) for w, c in counts.iterrows()]
    city = _row(0, counts.sum())
    rec = read_sidecar(FILE)

    def meta(label: str, desc: str) -> FieldMeta:
        return FieldMeta(
            label=label, unit="share", source="profile", method="census", description=desc
        )

    write_model(
        f"census-{vintage}.json",
        CensusEnvelope(
            ward_vintage=vintage,
            as_of=f"{CENSUS_YEAR}-10",
            census_year=CENSUS_YEAR,
            source_vintage=SOURCE_VINTAGE,
            sources={
                "profile": Source(
                    title=rec.title,
                    publisher=rec.publisher,
                    url=rec.url,
                    retrieved_at=rec.retrieved_at,
                    licence=rec.licence,
                    notes=rec.notes,
                )
            },
            fields={
                "unemployment": meta(
                    "Unemployment (Census 2011)",
                    "Unemployed as a share of people aged 15 to 64 who were working or looking "
                    "for work (the official definition).",
                ),
                "expanded_unemployment": meta(
                    "Unemployment incl. discouraged (Census 2011)",
                    "As above, also counting people who wanted work but had stopped looking.",
                ),
                "employment_ratio": meta(
                    "Adults 15 to 64 with a job (Census 2011)",
                    "Employed as a share of all people aged 15 to 64, including students, "
                    "carers and retired people.",
                ),
                "water_in_dwelling": meta(
                    "Piped water inside the home (Census 2011)",
                    "Share of people in households with a tap inside the dwelling.",
                ),
                "flush_toilet": meta(
                    "Flush toilet (Census 2011)",
                    "Share of people in households with a flush toilet (sewer or septic tank).",
                ),
                "refuse_weekly": meta(
                    "Refuse removed weekly (Census 2011)",
                    "Share of people in households whose refuse the municipality removes at "
                    "least once a week.",
                ),
            },
            citywide={
                k: v
                for k, v in city.model_dump().items()
                if k not in ("ward_no", "population") and v is not None
            },
            rows=rows,
        ),
    )
