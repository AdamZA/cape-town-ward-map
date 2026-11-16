"""Water and electricity supply interruptions, as reported by residents.

There is no published record of outages per area, so this uses the City's service requests:
"no water" and "no power" reports. One outage produces many reports and one household's fault
produces one, so a day only counts as an *outage day* for a ward when at least MIN_REPORTS such
reports were logged in that ward that day. This measures days with clustered reports, not hours
without supply; see METHODOLOGY.md#outages.

Electricity: where Eskom supplies residents directly, faults are reported to Eskom, not the City,
so power figures are only published for wards where the City supplies most residents, and only
reports located in City-supplied areas are counted (electricity.py).
"""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import shapely

from wardmap.config import CURRENT_VINTAGE
from wardmap.datasets import boundaries, electricity
from wardmap.datasets.service_requests import db
from wardmap.models import FieldMeta, Gap, OutageRow, OutagesEnvelope, Period
from wardmap.publish import write_model

PERIOD_DAYS = 365
MIN_CITY_SHARE = 0.5  # publish power figures only where the City supplies most residents
PARTLY_ESKOM = 0.95
MIN_REPORTS = 3

WATER_TYPES = (
    "WAT: No Supply",
    "WAT: No Water 40mm and Above",
    "WMM: No Water Below 40mm",
    "WMM: No Water 20mm and below",
    "No Water Supply",
    "No Water WMD",
)
POWER_TYPES = (
    "No Power",
    "No Power - Single unit affected",
    "No Power - Multiple units affected",
    "No Power - Backyarder",
)


def outage_days(df: pd.DataFrame, min_reports: int = MIN_REPORTS) -> pd.Series:
    """df: one row per report with `ward_no` and `created` (date). -> outage days per ward."""
    per_day = df.groupby(["ward_no", "created"]).size()
    return per_day[per_day >= min_reports].groupby(level="ward_no").size()


def load(con, vintage: int, start: date, end: date) -> pd.DataFrame:
    types = WATER_TYPES + POWER_TYPES
    df = pd.read_sql_query(
        f"""SELECT r.created, r.lon, r.lat, a.ward_no, l.name AS complaint_type
            FROM request r
            JOIN lookup l ON l.id = r.complaint_type_id
            JOIN ward_assignment a ON a.notification = r.notification AND a.vintage = ?
            WHERE r.created >= ? AND r.created < ? AND a.ward_no IS NOT NULL
              AND l.name IN ({",".join("?" * len(types))})""",
        con,
        params=(vintage, start.isoformat(), end.isoformat(), *types),
    )
    df["kind"] = df["complaint_type"].map(lambda t: "water" if t in WATER_TYPES else "power")
    return df


def build(vintage: int = CURRENT_VINTAGE) -> None:
    con = db.connect()
    as_of = date.fromisoformat(con.execute("SELECT max(changed) FROM request").fetchone()[0])
    start, end = as_of - timedelta(days=PERIOD_DAYS), as_of
    df = load(con, vintage, start, end)
    con.close()

    water = df[df["kind"] == "water"]
    power = df[df["kind"] == "power"]
    power = power[shapely.contains_xy(electricity.city_area(), power["lon"], power["lat"])]
    share = electricity.city_share(vintage)
    w_n, w_d = water.groupby("ward_no").size(), outage_days(water)
    p_n, p_d = power.groupby("ward_no").size(), outage_days(power)
    ids, _ = boundaries.load(vintage)
    rows, gaps = [], []
    for w in ids:
        city = share[w] >= MIN_CITY_SHARE
        flags = []
        if not city:
            flags.append("eskom_supplied")
            gaps.append(
                Gap(
                    code="eskom_supplied",
                    ward_no=w,
                    message=f"Eskom supplies about {1 - share[w]:.0%} of this ward's residents "
                    "directly, and they report power faults to Eskom, not the City, so "
                    "electricity figures are not shown.",
                )
            )
        elif share[w] < PARTLY_ESKOM:
            flags.append("partly_eskom")
            gaps.append(
                Gap(
                    code="partly_eskom",
                    ward_no=w,
                    message=f"About {1 - share[w]:.0%} of this ward's residents are supplied by "
                    "Eskom directly; electricity figures cover only the City-supplied part.",
                )
            )
        rows.append(
            OutageRow(
                ward_no=w,
                water_reports=int(w_n.get(w, 0)),
                water_days=int(w_d.get(w, 0)),
                power_reports=int(p_n.get(w, 0)) if city else None,
                power_days=int(p_d.get(w, 0)) if city else None,
                flags=flags,
            )
        )
    gaps.insert(
        0,
        Gap(
            code="reports_not_outages",
            message="These count days on which several residents reported having no water or "
            "no power, not how long supply was off. Planned maintenance, announced outages and "
            "load-shedding are often not reported, and reports without a usable location are "
            "left out.",
        ),
    )

    from wardmap.datasets.service_requests.aggregate import sr_source

    env = OutagesEnvelope(
        ward_vintage=vintage,
        as_of=as_of.isoformat(),
        period=Period(start=start.isoformat(), end=(end - timedelta(days=1)).isoformat()),
        min_reports=MIN_REPORTS,
        sources={"sr": sr_source(vintage), "electricity": electricity.source()},
        fields={
            "water_days": FieldMeta(
                label="Days with no-water reports",
                unit="days",
                source="sr",
                method="outages",
                description=f"Days in the year with {MIN_REPORTS} or more reports of no water.",
            ),
            "water_reports": FieldMeta(
                label="No-water reports", unit="reports", source="sr", method="outages"
            ),
            "power_days": FieldMeta(
                label="Days with no-power reports",
                unit="days",
                source="sr",
                method="outages",
                description=f"Days in the year with {MIN_REPORTS} or more reports of no power "
                "to the City (City-supplied areas only).",
            ),
            "power_reports": FieldMeta(
                label="No-power reports", unit="reports", source="sr", method="outages"
            ),
        },
        gaps=gaps,
        rows=rows,
    )
    write_model(f"outages-{vintage}.json", env)
