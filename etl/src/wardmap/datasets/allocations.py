"""Ward allocation projects from the City's annual budget annexure (PDF).

Each budget year has `sources/annexures/<year>.toml` (URL, layout, ward vintage, year columns)
next to the pinned PDF. Allocations are published against the ward vintage they were budgeted
under and are never apportioned to other vintages: projects are discrete, so the frontend lists
predecessor wards' projects with their overlap instead.
"""

from __future__ import annotations

import importlib
import tomllib
from functools import cache
from pathlib import Path

from wardmap.config import SOURCES, VINTAGE_WARD_COUNT
from wardmap.fetch import download
from wardmap.models import AllocationRow, AllocationsEnvelope, FieldMeta, Gap, Source
from wardmap.provenance import SourceRecord, read_sidecar, today, write_sidecar
from wardmap.publish import write_model

DIR = SOURCES / "annexures"


def years() -> list[str]:
    return sorted(p.stem for p in DIR.glob("*.toml"))


def config(year: str) -> dict:
    return tomllib.loads((DIR / f"{year}.toml").read_text(encoding="utf-8"))


def pdf_path(year: str) -> Path:
    return DIR / f"{year}.pdf"


def pin(year: str, local: bool = False) -> None:
    cfg = config(year)
    path = pdf_path(year)
    if local:
        if not path.exists():
            raise FileNotFoundError(f"place the PDF at {path} first")
        method = "manual"
    else:
        method = download(cfg["url"], path, wayback=True)
    write_sidecar(
        path,
        SourceRecord(
            title=cfg["title"],
            publisher="City of Cape Town",
            url=cfg["url"],
            retrieved_at=today(),
            licence="Public budget document",
            method=method,
            notes={
                "wayback": "City document server unreachable; retrieved from the Internet "
                "Archive's copy of the same URL (checksum recorded).",
                "manual": "Placed by hand; checksum recorded.",
            }.get(method),
        ),
    )


@cache
def parse(year: str):
    cfg = config(year)
    layout = importlib.import_module(f"wardmap.datasets.annexure_layouts.{cfg['layout']}")
    return layout.parse(pdf_path(year), first_page=cfg["first_page"])


def ward_subcouncils(year: str) -> dict[int, int]:
    """Ward -> subcouncil as printed in the annexure (for its ward vintage)."""
    return {r.ward_no: r.subcouncil for r in parse(year).rows if r.ward_no is not None}


def _month_year(iso: str) -> str:
    """'2024-05' or '2024-05-30' -> 'May 2024'."""
    import calendar

    y, m = iso.split("-")[:2]
    return f"{calendar.month_name[int(m)]} {y}"


def _kind(wbs: str | None) -> str:
    if wbs and wbs.startswith("CPX"):
        return "capital"
    if wbs and wbs.startswith("WPX"):
        return "operating"
    return "other"


def build(year: str) -> None:
    cfg = config(year)
    parsed = parse(year)
    vintage = cfg["ward_vintage"]
    wards = {r.ward_no for r in parsed.rows if r.ward_no is not None}
    expected = set(range(1, VINTAGE_WARD_COUNT[vintage] + 1))
    if wards != expected:
        raise ValueError(
            f"{year}: wards missing {sorted(expected - wards)}, extra {sorted(wards - expected)}"
        )
    rec = read_sidecar(pdf_path(year))
    rows = [
        AllocationRow(
            ward_no=r.ward_no,
            subcouncil=r.subcouncil,
            wbs=r.wbs,
            description=r.description,
            department=r.department,
            kind=_kind(r.wbs),
            amounts=dict(zip(cfg["years"], r.amounts, strict=True)),
        )
        for r in parsed.rows
    ]
    env = AllocationsEnvelope(
        ward_vintage=vintage,
        as_of=cfg["published"],
        budget_year=cfg["budget_year"],
        years=cfg["years"],
        sources={
            "annexure": Source(
                title=rec.title,
                publisher=rec.publisher,
                url=rec.url,
                retrieved_at=rec.retrieved_at,
                licence=rec.licence,
                notes=(rec.notes or "")
                + f" Parsed and checked against {len(parsed.checks)} printed totals.",
            )
        },
        fields={
            "amounts": FieldMeta(
                label="Allocation",
                unit="R",
                source="annexure",
                method="ward-allocations",
                description="Budgeted amount as adopted; not actual spending.",
            ),
        },
        gaps=[
            Gap(
                code="budget_not_spend",
                message="These are budgeted allocations as adopted in "
                f"{_month_year(cfg['published'])}, not what was actually spent. Later adjustment budgets "
                "may have changed them.",
            ),
            Gap(
                code="ward_vintage",
                message=f"This budget uses the {vintage} ward boundaries "
                f"({VINTAGE_WARD_COUNT[vintage]} wards). Ward numbers and areas changed in "
                "November 2026.",
            ),
            Gap(
                code="multi_ward",
                message="Some allocations are for several wards in a "
                "subcouncil (including unallocated amounts) and can't be attributed to one ward.",
            ),
        ],
        rows=rows,
    )
    write_model(f"allocations-{year}.json", env)
