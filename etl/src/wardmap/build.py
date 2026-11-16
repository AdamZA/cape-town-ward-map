"""Build every published file in data/, in dependency order, then write data/index.json."""

from __future__ import annotations

from wardmap.config import CURRENT_VINTAGE, DB_PATH, LGE
from wardmap.models import Index, IndexEntry
from wardmap.publish import write_model


def build_all() -> None:
    from wardmap.datasets import (
        allocations,
        boundaries,
        elections,
        land_use,
        landmarks,
        places,
        wards,
    )
    from wardmap.datasets.service_requests import aggregate, outages

    boundary_entries = boundaries.build()
    entries = [
        IndexEntry(
            dataset="crosswalk", file="crosswalk-2021-2026.json", ward_vintage=CURRENT_VINTAGE
        )
    ]

    wards.build(CURRENT_VINTAGE)
    entries.append(
        IndexEntry(
            dataset="wards", file=f"wards-{CURRENT_VINTAGE}.json", ward_vintage=CURRENT_VINTAGE
        )
    )

    places.build(CURRENT_VINTAGE)
    entries.append(
        IndexEntry(
            dataset="places", file=f"places-{CURRENT_VINTAGE}.json", ward_vintage=CURRENT_VINTAGE
        )
    )

    landmarks.build(CURRENT_VINTAGE)
    land_use.build(CURRENT_VINTAGE)
    for name in ("landmarks", "land_use"):
        entries.append(
            IndexEntry(
                dataset=name, file=f"{name}-{CURRENT_VINTAGE}.json", ward_vintage=CURRENT_VINTAGE
            )
        )

    for year in elections.years():
        elections.build(year)
        vintage = LGE[year][1]
        entries.append(
            IndexEntry(dataset="elections", file=f"elections-{year}.json", ward_vintage=vintage)
        )
        for code in elections.WARD_MUNICIPALITIES:
            entries.append(
                IndexEntry(
                    dataset="election_wards",
                    file=f"election_wards-{code}-{year}.json",
                    ward_vintage=vintage,
                )
            )

    for year in allocations.years():
        allocations.build(year)
        cfg = allocations.config(year)
        entries.append(
            IndexEntry(
                dataset="allocations",
                file=f"allocations-{year}.json",
                ward_vintage=cfg["ward_vintage"],
                budget_year=cfg["budget_year"],
            )
        )

    sr_file = f"service_requests-{CURRENT_VINTAGE}.json"
    outage_file = f"outages-{CURRENT_VINTAGE}.json"
    if DB_PATH.exists():
        aggregate.build(CURRENT_VINTAGE, wards.population(CURRENT_VINTAGE))
        outages.build(CURRENT_VINTAGE)
    else:
        # CI without the DB: keep the committed aggregates (refreshed by their own workflow).
        print(f"no service-request DB at {DB_PATH}; keeping data/{sr_file}, data/{outage_file}")
    for name, file in (("service_requests", sr_file), ("outages", outage_file)):
        entries.append(IndexEntry(dataset=name, file=file, ward_vintage=CURRENT_VINTAGE))

    write_model(
        "index.json",
        Index(default_vintage=CURRENT_VINTAGE, boundaries=boundary_entries, datasets=entries),
    )
