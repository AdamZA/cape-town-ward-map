import sqlite3

import numpy as np
import pandas as pd
import pytest

from wardmap.datasets.service_requests import aggregate, db


@pytest.fixture
def con():
    c = sqlite3.connect(":memory:")
    c.executescript(db.SCHEMA)
    return c


def row(**kw):
    base = {
        "Notification": 1,
        "CreatedOnDT": "2026/01/02 00:00:00+00",
        "ChangedOnDT": "2026/01/03 00:00:00+00",
        "CompletedDT": "",
        "Longitude": "18.5",
        "Latitude": "-33.9",
        "Ward": "001",
        "Sub_Council": "Sub-Council 1",
        "Suburb_Clean": "ATHLONE",
        "C3_Complaint_Type": "Water",
        "Work_Center": "Depot",
        "Notification_type": "Leak",
        "ObjectId": "7",
    }
    return base | kw


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("001", "1"), ("96", "96"), ("000", "0"), ("MUL", "MUL"), ("", None), (None, None)],
)
def test_norm_ward(raw, expected):
    assert db.norm_ward(raw) == expected


def test_dates_from_csv_and_api_agree():
    assert db.to_iso_day("2026/01/02 00:00:00+00") == "2026-01-02"
    assert db.to_iso_day(1767312000000) == "2026-01-02"
    assert db.to_iso_day(None) is None


def test_coords_zero_or_outside_metro_are_dropped():
    assert db.norm_coord(0, 0) == (None, None)
    assert db.norm_coord("", "") == (None, None)
    assert db.norm_coord(28.0, -26.2) == (None, None)  # Johannesburg
    assert db.norm_coord(18.5, -33.9) == (18.5, -33.9)


def test_upsert_never_overwrites_newer_with_stale(con):
    lk = db.Lookups(con)
    db.upsert(
        con,
        [
            db.normalise(
                row(ChangedOnDT="2026/02/01 00:00:00+00", CompletedDT="2026/02/01 00:00:00+00"), lk
            )
        ],
    )
    db.upsert(con, [db.normalise(row(ChangedOnDT="2026/01/05 00:00:00+00"), lk)])
    assert con.execute("SELECT completed FROM request").fetchone()[0] == "2026-02-01"


def test_upsert_clears_ward_assignment(con):
    lk = db.Lookups(con)
    db.upsert(con, [db.normalise(row(), lk)])
    con.execute("INSERT INTO ward_assignment VALUES (1, 2026, 5)")
    db.upsert(con, [db.normalise(row(ChangedOnDT="2026/03/01 00:00:00+00"), lk)])
    assert con.execute("SELECT count(*) FROM ward_assignment").fetchone()[0] == 0


def _cohort(days: list[float | None]) -> pd.DataFrame:
    return pd.DataFrame({"days": days, "completed": ["x" if d is not None else None for d in days]})


def test_median_counts_open_requests_as_unresolved():
    # 40 requests: 15 closed in 1 day, 25 open. Fewer than half closed -> censored median.
    m = aggregate.metrics(_cohort([1.0] * 15 + [None] * 25), 1000, 1, None)
    assert m.median_censored is True
    assert m.median_days == aggregate.FOLLOW_UP_DAYS
    assert m.pct_no_completion == 62.5


def test_median_and_p80_exact():
    days = [float(d) for d in range(1, 41)]  # 1..40
    m = aggregate.metrics(_cohort(days), 2000, 1, 0.9)
    assert (m.median_days, m.median_censored) == (20, False)
    assert (m.p80_days, m.p80_censored) == (32, False)
    assert m.pct_closed_30d == 75.0
    assert m.per_1000 == 20.0
    assert m.pct_located == 90.0


def test_small_wards_are_suppressed():
    m = aggregate.metrics(_cohort([1.0] * 10), 1000, 1, None)
    assert m.flags == ["insufficient_data"]
    assert m.median_days is None


def test_low_location_coverage_is_flagged():
    m = aggregate.metrics(_cohort([1.0] * 40), 1000, 1, 0.4)
    assert "low_location_coverage" in m.flags


def test_location_coverage_attributes_unlocated_by_suburb():
    # Suburb A: 3 located in ward 1, 1 located in ward 2, 4 unlocated -> 3 to ward 1, 1 to ward 2.
    df = pd.DataFrame(
        {
            "ward_no": [1, 1, 1, 2, np.nan, np.nan, np.nan, np.nan],
            "suburb": ["A"] * 8,
        }
    )
    cov = aggregate.location_coverage(df)
    assert cov == pytest.approx({1: 0.5, 2: 0.5})
