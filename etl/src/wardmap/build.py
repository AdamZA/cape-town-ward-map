"""Build every published file in data/, in dependency order, then write data/index.json."""

from __future__ import annotations

from wardmap.config import CURRENT_VINTAGE, DB_PATH
from wardmap.models import Index, IndexEntry
from wardmap.publish import write_model


def build_all() -> None:
    from wardmap.datasets import allocations, boundaries, wards
    from wardmap.datasets.service_requests import aggregate

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
    if DB_PATH.exists():
        aggregate.build(CURRENT_VINTAGE, wards.population(CURRENT_VINTAGE))
    else:
        # CI without the DB: keep the committed aggregate (it is refreshed by its own workflow).
        print(f"no service-request DB at {DB_PATH}; keeping existing data/{sr_file}")
    entries.append(
        IndexEntry(dataset="service_requests", file=sr_file, ward_vintage=CURRENT_VINTAGE)
    )

    write_model(
        "index.json",
        Index(default_vintage=CURRENT_VINTAGE, boundaries=boundary_entries, datasets=entries),
    )
