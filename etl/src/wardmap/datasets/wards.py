"""Ward facts: area, subcouncil, councillor and modelled population.

- Subcouncil: the City's subcouncil boundaries (20 since August 2024). Each ward gets the
  subcouncil covering most of its area; the share is recorded, and wards under 90% are flagged.
- Councillor: from a curated CSV (sources/councillors/<vintage>.csv) because there is no stable
  machine-readable source yet for the councillors elected in November 2026. Missing -> gap.
- Population: see population.py. Electricity supplier: see electricity.py.
"""

from __future__ import annotations

import csv
from functools import cache

from wardmap import geo
from wardmap.config import CURRENT_VINTAGE, SOURCES
from wardmap.datasets import boundaries, electricity
from wardmap.datasets import population as pop
from wardmap.models import Councillor, FieldMeta, Gap, Source, WardRow, WardsEnvelope
from wardmap.provenance import read_sidecar
from wardmap.publish import write_model


def councillor_file(vintage: int):
    return SOURCES / "councillors" / f"{vintage}.csv"


@cache
def _population(vintage: int) -> pop.WardPopulation:
    ids, g = boundaries.load(vintage)
    return pop.ward_population(ids, g)


def population(vintage: int) -> dict[int, float]:
    return _population(vintage).by_ward


def population_source() -> Source:
    grid = read_sidecar(pop.GRID_FILE)
    city = read_sidecar(pop.ESTIMATES_FILE)
    return Source(
        title="Modelled ward population (2025)",
        publisher="Derived: EU JRC GHS-POP 2025 grid, scaled to City of Cape Town 2025 estimate",
        url=grid.url,
        retrieved_at=min(grid.retrieved_at, city.retrieved_at),
        licence="CC BY 4.0 (GHSL); City of Cape Town Open Data Licence",
        notes=f"{grid.notes} City total from {city.url}.",
    )


def _councillors(vintage: int) -> tuple[dict[int, Councillor], Source | None]:
    path = councillor_file(vintage)
    if not path.exists():
        return {}, None
    with path.open(encoding="utf-8", newline="") as f:
        rows = {
            int(r["ward_no"]): Councillor(name=r["name"].strip(), party=(r.get("party") or None))
            for r in csv.DictReader(f)
            if r.get("name", "").strip()
        }
    return rows, boundaries.source(path)


def _subcouncils(vintage: int) -> dict[int, tuple[int, float]]:
    """Ward -> (subcouncil covering most of it, share of the ward's area)."""
    ids, wg = boundaries.load(vintage)
    feats = geo.load_features(boundaries.SUBCOUNCIL_FILE)
    sc_ids = [f["properties"]["subcouncil"] for f in feats]
    rows = geo.overlay_weights(geo.project(wg), ids, geo.project(geo.geoms(feats)), sc_ids)
    best: dict[int, tuple[int, float]] = {}
    for w, sc, share, _, _ in rows:
        if w not in best or share > best[w][1]:
            best[w] = (sc, share)
    return best


def build(vintage: int = CURRENT_VINTAGE) -> None:
    ids, g = boundaries.load(vintage)
    proj = geo.project(g)
    best = _subcouncils(vintage)
    supply = electricity.city_share(vintage)
    wp = _population(vintage)
    councillors, councillor_src = _councillors(vintage)

    rows, gaps = [], []
    for no, geom in zip(ids, proj, strict=True):
        s, share = best.get(no, (None, None))
        flags = []
        if share is not None and share < 0.9:
            flags.append("subcouncil_split")
        rows.append(
            WardRow(
                ward_no=no,
                area_km2=round(geom.area / 1e6, 2),
                subcouncil=s,
                subcouncil_share=round(share, 3) if share is not None else None,
                councillor=councillors.get(no),
                population=int(round(wp.by_ward[no], -2)),
                electricity_city_share=round(supply[no], 3),
                flags=flags,
            )
        )
        if no not in councillors:
            gaps.append(
                Gap(
                    code="councillor_missing",
                    ward_no=no,
                    message="Councillor for this ward not yet recorded.",
                )
            )

    sources = {
        "boundaries": boundaries.source(boundaries.ward_file(vintage)),
        "subcouncils": boundaries.source(boundaries.SUBCOUNCIL_FILE),
        "population": population_source(),
        "electricity": electricity.source(),
    }
    if councillor_src:
        sources["councillors"] = councillor_src
    else:
        gaps = [g for g in gaps if g.code != "councillor_missing"]
        gaps.append(
            Gap(
                code="councillors_missing",
                message="Ward councillors elected in November 2026 are not yet included: there is no "
                "stable machine-readable source yet. They will be added from the City's "
                "councillor listing or the IEC's results.",
            )
        )
    fields = {
        "area_km2": FieldMeta(label="Area", unit="km²", source="boundaries"),
        "subcouncil": FieldMeta(
            label="Subcouncil",
            source="subcouncils",
            method="subcouncil",
            description="The subcouncil covering most of the ward's area.",
        ),
    }
    if councillor_src:
        fields["councillor"] = FieldMeta(label="Ward councillor", source="councillors")
    env = WardsEnvelope(
        ward_vintage=vintage,
        as_of=sources["boundaries"].retrieved_at,
        sources=sources,
        fields=fields
        | {
            "population": FieldMeta(
                label="Estimated population",
                unit="people",
                source="population",
                method="population",
                description="Modelled estimate, rounded to the nearest 100. Not a census count.",
            ),
            "electricity_city_share": FieldMeta(
                label="Electricity supplier",
                unit="ratio",
                source="electricity",
                method="electricity",
                description="Share of residents (modelled) supplied by the City rather than "
                "by Eskom directly, from the City's load-shedding areas.",
            ),
        },
        gaps=gaps,
        rows=rows,
    )
    write_model(f"wards-{vintage}.json", env)
