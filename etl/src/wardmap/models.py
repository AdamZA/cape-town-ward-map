"""Published data contracts. These pydantic models are the single schema source: `wardmap schemas`
exports them as JSON Schema, from which the frontend's TypeScript types are generated.

Every file in data/ (except boundary GeoJSON) is an Envelope: metadata + provenance + rows.
Bump SCHEMA_VERSION on any breaking change to these models.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1


class Strict(BaseModel):
    # Defaults are always written, so the published schema marks them required.
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


class Source(Strict):
    title: str
    publisher: str
    url: str
    retrieved_at: str = Field(description="ISO date the data was retrieved")
    licence: str
    notes: str | None = None


class FieldMeta(Strict):
    label: str
    unit: str | None = None
    source: str = Field(description="Key into the envelope's `sources`")
    method: str | None = Field(None, description="Anchor in METHODOLOGY.md")
    description: str | None = None


class Gap(Strict):
    code: str
    message: str
    ward_no: int | None = Field(None, description="Null for gaps that apply to the whole dataset")


class Period(Strict):
    start: str = Field(alias="from")
    end: str = Field(alias="to")
    model_config = ConfigDict(
        extra="forbid", populate_by_name=True, json_schema_serialization_defaults_required=True
    )


class EnvelopeBase(Strict):
    dataset: str
    schema_version: int = SCHEMA_VERSION
    ward_vintage: int = Field(description="Year the ward delimitation took effect (2021, 2026)")
    as_of: str = Field(
        description="ISO date (or year-month) the figures describe, not when the file was built"
    )
    period: Period | None = None
    sources: dict[str, Source]
    fields: dict[str, FieldMeta]
    gaps: list[Gap] = []


# ---- wards -------------------------------------------------------------------------------------


class Councillor(Strict):
    name: str
    party: str | None = None


class WardRow(Strict):
    ward_no: int
    area_km2: float
    subcouncil: int | None = None
    subcouncil_share: float | None = Field(
        None, description="Share of the ward's area inside that subcouncil boundary"
    )
    councillor: Councillor | None = None
    population: int | None = None
    flags: list[str] = []


class WardsEnvelope(EnvelopeBase):
    dataset: Literal["wards"] = "wards"
    rows: list[WardRow]


# ---- service requests --------------------------------------------------------------------------


class ServiceRequestRow(Strict):
    ward_no: int
    requests: int = Field(description="Located requests created in the cohort period")
    per_1000: float | None = Field(None, description="Cohort requests per 1,000 residents per year")
    median_days: int | None = None
    median_censored: bool = Field(
        False, description="True when fewer than half are closed: the median is 'more than' this"
    )
    p80_days: int | None = None
    p80_censored: bool = False
    pct_closed_30d: float | None = None
    pct_no_completion: float | None = Field(
        None, description="Share of cohort requests with no completion date recorded at as_of"
    )
    pct_located: float | None = Field(
        None,
        description="Estimated share of this area's requests that have a usable location "
        "(unlocated requests are attributed via their suburb)",
    )
    flags: list[str] = []


class ServiceRequestsEnvelope(EnvelopeBase):
    dataset: Literal["service_requests"] = "service_requests"
    rows: list[ServiceRequestRow]
    citywide: ServiceRequestRow  # same metrics over all located requests; ward_no is 0


# ---- ward allocations --------------------------------------------------------------------------


class AllocationRow(Strict):
    ward_no: int | None = Field(None, description="Null for multi-ward projects in a subcouncil")
    subcouncil: int
    wbs: str | None = None
    description: str
    department: str | None = None
    kind: Literal["operating", "capital", "other"]
    amounts: dict[str, int] = Field(description="Rand allocation by financial year, e.g. '2024/25'")


class AllocationsEnvelope(EnvelopeBase):
    dataset: Literal["allocations"] = "allocations"
    budget_year: str = Field(description="Financial year of the budget, e.g. '2024/25'")
    years: list[str] = Field(description="Financial-year columns present in `amounts`")
    rows: list[AllocationRow]


# ---- crosswalk ---------------------------------------------------------------------------------


class CrosswalkRow(Strict):
    from_ward: int
    to_ward: int
    share_of_from: float
    share_of_to: float


class CrosswalkEnvelope(EnvelopeBase):
    dataset: Literal["crosswalk"] = "crosswalk"
    from_vintage: int
    rows: list[CrosswalkRow]


# ---- index -------------------------------------------------------------------------------------


class IndexEntry(Strict):
    dataset: str
    file: str
    ward_vintage: int
    budget_year: str | None = None


class BoundaryEntry(Strict):
    ward_vintage: int
    file: str
    source: Source


class Index(Strict):
    schema_version: int = SCHEMA_VERSION
    default_vintage: int
    boundaries: list[BoundaryEntry]
    datasets: list[IndexEntry]


ENVELOPES: dict[str, type[BaseModel]] = {
    "wards": WardsEnvelope,
    "service_requests": ServiceRequestsEnvelope,
    "allocations": AllocationsEnvelope,
    "crosswalk": CrosswalkEnvelope,
    "index": Index,
}
