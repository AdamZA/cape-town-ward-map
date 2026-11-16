"""Per-ward service-request metrics.

Cohort: requests *created* in the 12 months ending FOLLOW_UP_DAYS before `as_of`, so every
request has had at least that long to be resolved. Open requests count as unresolved (not
dropped), so wards with large backlogs aren't flattered. When fewer than half (or 80%) are
closed, the median (or p80) is reported as "more than N days" (`*_censored`).

`as_of` is the latest ChangedOnDT in the mirror (data-derived, so rebuilding is deterministic).
"""

from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pandas as pd

from wardmap.config import CCT_LICENCE, CURRENT_VINTAGE, SR_LAYER, SR_PORTAL_PAGE
from wardmap.datasets.service_requests import db
from wardmap.models import (
    FieldMeta,
    Gap,
    Period,
    ServiceRequestRow,
    ServiceRequestsEnvelope,
    Source,
)
from wardmap.publish import write_model

FOLLOW_UP_DAYS = 90
COHORT_DAYS = 365
MIN_REQUESTS = 30
LOW_LOCATION = 0.6  # flag wards where under 60% of requests could be placed on the map


def sr_source(vintage: int) -> Source:
    con = db.connect()
    last_sync = (
        db.get_meta(con, "last_sync")
        or con.execute("SELECT max(changed) FROM request").fetchone()[0]
    )
    con.close()
    return Source(
        title="Service Requests Jan 2023 to Present",
        publisher="City of Cape Town",
        url=SR_PORTAL_PAGE,
        retrieved_at=last_sync,
        licence=CCT_LICENCE,
        notes=f"Mirrored locally and updated with deltas from {SR_LAYER}. Requests are "
        f"assigned to {vintage} wards by their coordinates.",
    )


def cohort_bounds(as_of: date) -> tuple[date, date]:
    end = as_of - timedelta(days=FOLLOW_UP_DAYS)  # exclusive
    return end - timedelta(days=COHORT_DAYS), end


def _quantile_days(durations: np.ndarray, n_total: int, q: float, censor_at: int):
    """durations: resolution days of closed requests. Open ones are +inf (unresolved)."""
    k = math.ceil(q * n_total)  # k-th smallest (1-based) is the q-quantile
    if len(durations) < k:
        return censor_at, True
    return int(np.sort(durations)[k - 1]), False


def metrics(
    df: pd.DataFrame, population: float | None, ward_no: int, pct_located: float | None
) -> ServiceRequestRow:
    n = len(df)
    pct_located = round(pct_located * 100, 1) if pct_located is not None else None
    if n < MIN_REQUESTS:
        return ServiceRequestRow(
            ward_no=ward_no, requests=n, pct_located=pct_located, flags=["insufficient_data"]
        )
    flags = []
    if pct_located is not None and pct_located < LOW_LOCATION * 100:
        flags.append("low_location_coverage")
    closed = df["days"].dropna().to_numpy()
    censor_at = FOLLOW_UP_DAYS
    med, med_c = _quantile_days(closed, n, 0.5, censor_at)
    p80, p80_c = _quantile_days(closed, n, 0.8, censor_at)
    return ServiceRequestRow(
        ward_no=ward_no,
        requests=n,
        per_1000=round(n / population * 1000, 1) if population else None,
        median_days=med,
        median_censored=med_c,
        p80_days=p80,
        p80_censored=p80_c,
        pct_closed_30d=round(float((closed <= 30).sum()) / n * 100, 1),
        pct_no_completion=round(float(df["completed"].isna().sum()) / n * 100, 1),
        pct_located=pct_located,
        flags=flags,
    )


def location_coverage(df: pd.DataFrame) -> dict[int, float]:
    """Estimated share of each ward's requests that have a usable location.

    Unlocated requests still carry a suburb. Each suburb's unlocated requests are attributed to
    wards in proportion to where that suburb's *located* requests fall.
    """
    located = df[df["ward_no"].notna()]
    unlocated = df[df["ward_no"].isna() & df["suburb"].notna()]
    by_sw = located.groupby(["suburb", "ward_no"]).size()
    share = by_sw / by_sw.groupby(level="suburb").transform("sum")
    unl = unlocated.groupby("suburb").size()
    est = (
        (share * unl.reindex(share.index.get_level_values("suburb")).to_numpy())
        .groupby(level="ward_no")
        .sum()
    )
    loc = located.groupby("ward_no").size()
    cov = loc / (loc + est.reindex(loc.index).fillna(0))
    return {int(w): float(v) for w, v in cov.items()}


def load_cohort(con, vintage: int, start: date, end: date) -> pd.DataFrame:
    df = pd.read_sql_query(
        """SELECT r.created, r.completed, a.ward_no, r.lon IS NOT NULL AS has_coords,
                  r.suburb, l.name AS complaint_type
           FROM request r
           LEFT JOIN ward_assignment a ON a.notification = r.notification AND a.vintage = ?
           LEFT JOIN lookup l ON l.id = r.complaint_type_id
           WHERE r.created >= ? AND r.created < ?""",
        con,
        params=(vintage, start.isoformat(), end.isoformat()),
    )
    created = pd.to_datetime(df["created"])
    completed = pd.to_datetime(df["completed"])
    days = (completed - created).dt.days
    df["negative"] = days < 0
    # A completion date before creation is a data error: treat as unknown, count it as a gap.
    df["days"] = days.where(days >= 0)
    df.loc[df["negative"], "completed"] = None
    return df


def build(vintage: int = CURRENT_VINTAGE, population: dict[int, float] | None = None) -> None:
    from wardmap.datasets import boundaries, wards

    con = db.connect()
    as_of = date.fromisoformat(con.execute("SELECT max(changed) FROM request").fetchone()[0])
    start, end = cohort_bounds(as_of)
    df = load_cohort(con, vintage, start, end)
    con.close()
    if population is None:
        population = wards.population(vintage)

    located = df[df["ward_no"].notna()]
    coverage = location_coverage(df)
    ward_ids, _ = boundaries.load(vintage)
    rows = [
        metrics(located[located["ward_no"] == w], population.get(w), w, coverage.get(w))
        for w in ward_ids
    ]
    citywide = metrics(located, sum(population.values()), 0, len(located) / len(df))

    n_all = len(df)
    n_unlocated = n_all - len(located)
    no_coords = int((~df["has_coords"].astype(bool)).sum())
    top_unlocated = (
        df[df["ward_no"].isna()]["complaint_type"].fillna("(blank)").value_counts().head(3)
    )
    gaps = [
        Gap(
            code="unlocated",
            message=(
                f"{n_unlocated / n_all:.0%} of requests in this period ({n_unlocated:,} of "
                f"{n_all:,}) have no usable location and are not counted in any ward "
                f"({no_coords:,} have no coordinates). They are not evenly spread: the most common "
                "types among them are "
                + ", ".join(f"{k} ({v:,})" for k, v in top_unlocated.items())
                + "."
            ),
        ),
        Gap(
            code="complaint_mix",
            message=(
                "Wards differ in the mix of request types (e.g. electricity faults vs. refuse), "
                "and some types take longer to resolve than others. Compare wards with that in mind."
            ),
        ),
    ]
    if int(df["negative"].sum()):
        gaps.append(
            Gap(
                code="negative_duration",
                message=f"{int(df['negative'].sum()):,} requests have a completion date before "
                "their creation date; they are treated as unresolved.",
            )
        )
    for r in rows:
        if "low_location_coverage" in r.flags:
            gaps.append(
                Gap(
                    code="low_location_coverage",
                    ward_no=r.ward_no,
                    message=f"Only about {r.pct_located:.0f}% of requests from this area have a "
                    "usable location, so the figures here cover only part of its requests and "
                    "the request rate is understated.",
                )
            )
        if "insufficient_data" in r.flags:
            gaps.append(
                Gap(
                    code="insufficient_data",
                    ward_no=r.ward_no,
                    message=f"Fewer than {MIN_REQUESTS} located requests; metrics not shown.",
                )
            )

    src = "sr"
    env = ServiceRequestsEnvelope(
        ward_vintage=vintage,
        as_of=as_of.isoformat(),
        period=Period(start=start.isoformat(), end=(end - timedelta(days=1)).isoformat()),
        sources={
            src: sr_source(vintage),
            "population": wards.population_source(),
        },
        fields={
            "requests": FieldMeta(
                label="Requests logged", unit="requests", source=src, method="service-requests"
            ),
            "per_1000": FieldMeta(
                label="Requests per 1,000 residents",
                unit="per 1,000 per year",
                source=src,
                method="service-requests",
                description="Uses modelled ward population (see population).",
            ),
            "median_days": FieldMeta(
                label="Median days to resolve", unit="days", source=src, method="resolution-time"
            ),
            "p80_days": FieldMeta(
                label="Days to resolve 80% of requests",
                unit="days",
                source=src,
                method="resolution-time",
            ),
            "pct_closed_30d": FieldMeta(
                label="Resolved within 30 days", unit="%", source=src, method="resolution-time"
            ),
            "pct_no_completion": FieldMeta(
                label="No completion date recorded",
                unit="%",
                source=src,
                method="resolution-time",
                description="May include requests closed without a completion date.",
            ),
            "pct_located": FieldMeta(
                label="Requests with a usable location (est.)",
                unit="%",
                source=src,
                method="location-coverage",
                description="Where this is low, the ward's figures describe only part of its "
                "requests.",
            ),
        },
        gaps=gaps,
        rows=rows,
        citywide=citywide,
    )
    write_model(f"service_requests-{vintage}.json", env)
