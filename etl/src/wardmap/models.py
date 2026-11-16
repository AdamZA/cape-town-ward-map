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
        None, description="Share of the ward's area inside that subcouncil's boundary"
    )
    councillor: Councillor | None = None
    population: int | None = None
    electricity_city_share: float | None = Field(
        None,
        description="Share of the ward's modelled population where the City (not Eskom) "
        "supplies electricity",
    )
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


# ---- supply outages -----------------------------------------------------------------------------


class OutageRow(Strict):
    ward_no: int
    water_reports: int = Field(description="Located no-water reports logged in the period")
    water_days: int = Field(description="Days with at least `min_reports` no-water reports")
    power_reports: int | None = Field(
        None,
        description="Located no-power reports in City-supplied areas; null where Eskom supplies "
        "most residents",
    )
    power_days: int | None = Field(
        None, description="Days with at least `min_reports` no-power reports (City-supplied areas)"
    )
    flags: list[str] = []


class OutagesEnvelope(EnvelopeBase):
    dataset: Literal["outages"] = "outages"
    min_reports: int = Field(description="Reports on one day needed to count it as an outage day")
    rows: list[OutageRow]


# ---- places (search) ---------------------------------------------------------------------------


class PlaceWard(Strict):
    ward_no: int
    share: float = Field(description="Share of the place's area inside this ward")


class PlaceRow(Strict):
    name: str
    bbox: list[float] = Field(description="[west, south, east, north] in WGS84")
    wards: list[PlaceWard] = Field(description="Wards covering the place, largest share first")


class PlacesEnvelope(EnvelopeBase):
    dataset: Literal["places"] = "places"
    rows: list[PlaceRow]


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


# ---- landmarks (map layers) ----------------------------------------------------------------------


class LandmarkGroup(Strict):
    key: str
    label: str


class LandmarkCategory(Strict):
    key: str
    label: str
    group: str = Field(description="Key into the envelope's `groups`")
    source: str = Field(description="Key into the envelope's `sources`")


class LandmarkRow(Strict):
    category: str
    name: str
    detail: str | None = Field(None, description="Facility type or what a monument commemorates")
    lon: float
    lat: float
    ward_no: int | None = Field(None, description="Null when outside every ward (e.g. offshore)")


class LandmarksEnvelope(EnvelopeBase):
    dataset: Literal["landmarks"] = "landmarks"
    groups: list[LandmarkGroup] = Field(description="In display order")
    categories: list[LandmarkCategory] = Field(description="In display order")
    rows: list[LandmarkRow]


# ---- land use (zoning mix) ----------------------------------------------------------------------


class LandUseRow(Strict):
    ward_no: int
    shares: dict[str, float] = Field(
        description="Share of the ward's zoned land per group (keys of `groups`); sums to 1"
    )
    zoned_km2: float = Field(description="Land counted in the shares")
    excluded_km2: float = Field(
        description="Public roads, 'limited use' land and parcels with no zoning recorded"
    )
    parcel_coverage: float = Field(
        description="Share of the ward's area covered by recorded land parcels (can exceed 1 "
        "slightly where parcels overlap); low where land is unsurveyed or informally settled"
    )


class LandUseEnvelope(EnvelopeBase):
    dataset: Literal["land_use"] = "land_use"
    groups: list[LandmarkGroup] = Field(description="Land-use groups (keys of `shares`), in order")
    rows: list[LandUseRow]


# ---- elections ---------------------------------------------------------------------------------


class PartyResult(Strict):
    party: str
    votes: int
    share: float = Field(description="Share of valid votes on this ballot, 0-1")
    seats: int | None = Field(None, description="Council seats won (municipality rows only)")


class MunicipalityResult(Strict):
    code: str = Field(description="IEC/MDB municipality code, e.g. CPT, WC011")
    name: str
    province: str
    kind: Literal["metro", "local"]
    seats_total: int = Field(description="Council size, including independent ward councillors")
    independent_seats: int = Field(description="Seats won by independent ward candidates")
    registered: int = Field(description="Registered voters")
    turnout: float = Field(description="Ballots cast (valid + spoilt) / registered, PR ballot")
    largest_party: str = Field(description="Party with the most seats (ties: most votes)")
    majority: bool = Field(description="Largest party holds more than half the seats")
    parties: list[PartyResult] = Field(
        description="Parties that won seats, then others by votes (up to 12); PR ballot votes"
    )


class NationalParty(Strict):
    party: str
    seats: int = Field(description="Seats won across all metro and local councils")
    councils_largest: int = Field(description="Councils where it has the most seats")
    councils_majority: int = Field(description="Councils where it has more than half the seats")
    registered_in_majority: int = Field(
        description="Registered voters living in councils where it has a majority"
    )


class ElectionsEnvelope(EnvelopeBase):
    dataset: Literal["elections"] = "elections"
    year: int
    municipalities: list[MunicipalityResult]
    national: list[NationalParty] = Field(description="Parties with any seats, most seats first")


class PreviousResult(Strict):
    year: int
    coverage: float = Field(
        description="Share of this ward's registered voters in voting districts that existed then"
    )
    parties: list[PartyResult] = Field(description="PR ballot shares on this ward's area")


class WardElectionRow(Strict):
    ward_no: int
    registered: int
    turnout: float = Field(description="Ballots cast / registered on the ward ballot")
    winner: str = Field(description="Party (or independent) with most ward-ballot votes")
    councillor: str | None = Field(None, description="Elected ward councillor (winning candidate)")
    parties: list[PartyResult] = Field(description="Ward ballot, most votes first (up to 8)")
    pr_parties: list[PartyResult] = Field(
        [], description="Party-list (PR) ballot in this ward, most votes first (up to 8)"
    )
    previous: PreviousResult | None = Field(
        None, description="Previous election's PR ballot on this ward's area (voting districts)"
    )


class ElectionWardsEnvelope(EnvelopeBase):
    dataset: Literal["election_wards"] = "election_wards"
    year: int
    municipality: str
    rows: list[WardElectionRow]


# ---- party funding -----------------------------------------------------------------------------


class DonorTotal(Strict):
    donor: str
    amount: float = Field(description="Rand declared from this donor in the period")
    declarations: int


class PartyDonations(Strict):
    party: str
    total: float
    by_financial_year: dict[str, float]
    top_donors: list[DonorTotal] = Field(description="Largest donors first (up to 10)")


class DonationRow(Strict):
    financial_year: str
    quarter: int
    section: Literal["quarter", "late"]
    party: str
    date: str
    donor: str
    type: str
    amount: float


class DonationsEnvelope(Strict):
    dataset: Literal["donations"] = "donations"
    schema_version: int = SCHEMA_VERSION
    as_of: str
    period: Period
    sources: dict[str, Source]
    gaps: list[Gap] = []
    parties: list[PartyDonations] = Field(description="Largest total first")
    rows: list[DonationRow]


# ---- party profiles ------------------------------------------------------------------------------


class Position(Strict):
    found: bool
    summary: str | None = Field(None, description="Neutral paraphrase (max ~25 words)")
    quote: str | None = Field(None, description="The party's own words, verbatim (max 30 words)")
    url: str | None = None
    date: str | None = Field(
        None, description="Date of the statement or document (ISO, or YYYY-MM)"
    )
    source_type: str | None = Field(
        None,
        description="manifesto | policy_document | party_statement | leader_statement | parliament",
    )
    searched: str | None = Field(None, description="Where we looked, when nothing was found")


class Manifesto(Strict):
    title: str
    url: str
    date: str | None
    election: str


class SourcedText(Strict):
    text: str
    url: str


class Economy(Strict):
    summary: str
    url: str
    date: str | None


class PartyProfile(Strict):
    name: str
    website: str | None
    manifesto: Manifesto | None
    priorities: list[SourcedText]
    economy: Economy | None
    positions: dict[str, Position] = Field(description="Keyed by the envelope's topic keys")


class Topic(Strict):
    key: str
    label: str


class PartiesEnvelope(Strict):
    dataset: Literal["parties"] = "parties"
    schema_version: int = SCHEMA_VERSION
    as_of: str
    sources: dict[str, Source]
    gaps: list[Gap] = []
    topics: list[Topic] = Field(description="Position topics, in display order")
    parties: list[PartyProfile]


# ---- crime --------------------------------------------------------------------------------------


class CrimeCategory(Strict):
    key: str
    label: str
    note: str | None = None


class StationCrime(Strict):
    station: str
    population: int | None = Field(
        description="Residents of the precinct (estimate); null where a rate would mislead"
    )
    counts: dict[str, dict[str, int]] = Field(description="category -> financial year -> count")


class WardPrecinct(Strict):
    station: str
    share: float = Field(description="Share of the ward's residents living in this precinct")


class CrimeWardRow(Strict):
    ward_no: int
    precincts: list[WardPrecinct] = Field(description="Largest share first")
    rates: dict[str, float | None] = Field(
        description="category -> crimes per 100,000 residents in the covering precinct(s), "
        "weighted by where the ward's residents live; latest financial year"
    )


class CrimeEnvelope(EnvelopeBase):
    dataset: Literal["crime"] = "crime"
    financial_year: str
    years: list[str]
    categories: list[CrimeCategory]
    stations: list[StationCrime]
    city_totals: dict[str, dict[str, int]] = Field(
        description="category -> financial year -> count, all City of Cape Town District stations"
    )
    rows: list[CrimeWardRow]


ENVELOPES: dict[str, type[BaseModel]] = {
    "crime": CrimeEnvelope,
    "parties": PartiesEnvelope,
    "donations": DonationsEnvelope,
    "elections": ElectionsEnvelope,
    "election_wards": ElectionWardsEnvelope,
    "landmarks": LandmarksEnvelope,
    "land_use": LandUseEnvelope,
    "wards": WardsEnvelope,
    "service_requests": ServiceRequestsEnvelope,
    "allocations": AllocationsEnvelope,
    "crosswalk": CrosswalkEnvelope,
    "outages": OutagesEnvelope,
    "places": PlacesEnvelope,
    "index": Index,
}
