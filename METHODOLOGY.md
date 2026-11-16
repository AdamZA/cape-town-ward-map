# Methodology

How every figure on the map is produced, and what it can and can't tell you. The aim is to show
public data neutrally: no rankings, no judgements, sources beside every number, and gaps stated
plainly.

## Wards

The map shows the **118 wards of the 2026 delimitation**, which took effect after the
November 2026 local government elections. Boundaries come from the City of Cape Town's open data
service. The layer's description text still says "2016 wards", but every feature is tagged
`WARD_YEAR = 2026`. Before using it we check that there are exactly 118 wards and compare each
one with the Municipal Demarcation Board's 2026 ward layer; the lowest per-ward
intersection-over-union was 0.975.

Older datasets use the **2021 delimitation (116 wards)**, taken from the Municipal Demarcation
Board. Ward numbers do not mean the same place across the two.

## Crosswalk

To relate 2021 wards to 2026 wards we overlay the two boundary sets and record, for each pair
that overlaps, the share of each ward's area in the overlap. The crosswalk is used to:

- list the budget projects of the older wards that overlap a current ward (projects are never
  split or reassigned);
- infer subcouncils (see below).

The 2021 and 2026 boundaries come from different publishers and differ slightly at the edge of the
metro. Where more than 2% of a 2026 ward lies outside every 2021 ward, this is recorded as a gap.

## Subcouncil

Cape Town has had 20 subcouncils since 30 August 2024 (there were 21 before). Each ward is shown
in the subcouncil covering most of its area on the City's subcouncil map. Where that is under 90%
of the ward, the panel says how much lies in the subcouncil shown. The 2024/25 budget annexure
predates the change and still lists 21 subcouncils; its multi-ward items use those old numbers.

## Population

Stats SA has not released Census 2022 results at ward level. The City publishes modelled 2025
population estimates for about 190 named areas, but without boundaries. So ward population is
**modelled**:

1. Take the GHSL GHS-POP 2025 population grid (European Commission JRC, about 100 m cells,
   CC BY 4.0).
2. Assign each cell to the ward containing its centre and add them up.
3. Scale every ward by the same factor (about 1.035) so the metro total matches the City's 2025
   estimate (5.32 million).

Figures are rounded to the nearest 100 and always labelled as estimates. They are good enough to
put request counts on a per-resident basis. They are not good enough to compare wards whose
populations differ by a few percent.

## Service requests

Source: the City's *Service Requests Jan 2023 to Present* open dataset: every service request
(C3 notification) logged with the City, with its creation, last-change and completion dates.

We keep a local mirror of the full table, about 4.5 million requests, in SQLite:

- **Bootstrap:** from the open-data hub's bulk CSV export.
- **Monthly updates:** fetch only rows changed since the last update, with a 7-day overlap.
- **Reconciliation:** after each update, the number of requests per creation year (and month,
  where they differ) is compared with the live dataset. Missing months are re-fetched. Any other
  mismatch stops the update for a person to look at.
- **Duplicates:** the City's table contains some exact duplicate rows (same notification number).
  Each notification is counted once.

Each request is placed in a 2026 ward **by its coordinates**. The table's own `Ward` field uses
the previous ward boundaries, so it is not used.

**Cohort.** Figures cover requests *created* during a 12-month window that ends 90 days before
the date of the data. Every request in it has therefore had at least 90 days to be resolved.

**Requests per 1,000 residents** = requests in the cohort ÷ modelled ward population × 1,000.
This reflects how readily people report problems as well as how many problems there are, and
it should not be read as a measure of performance.

## Resolution time

- **Resolved within 30 days**: share of cohort requests with a completion date no more than 30
  days after creation. This is the default map colour because it varies meaningfully between
  wards.
- **Median days to resolve**: half of the ward's requests were resolved within this many days.
  Requests with no completion date count as *not yet resolved*; they are not dropped, which
  would flatter wards with large backlogs. If fewer than half have a completion date, the median
  is shown as "more than 90 days". Dates are recorded to the day, so most wards fall between 1
  and 3 days.
- **Days to resolve 80% of requests**: the same calculation for the 80th percentile.
- **No completion date recorded**: share of cohort requests with no completion date. These may be
  open, or closed without a date being recorded; the data doesn't say which.

Wards with fewer than 30 located requests in the cohort show "Too few requests to report".

Wards differ in the *mix* of requests (an electricity outage and a missed refuse collection are
resolved very differently), so differences between wards are not necessarily differences in
service.

## Location coverage

Roughly a third of requests have no usable coordinates (missing, `0,0`, or outside the metro), so
they can't be placed in a ward. They are concentrated in particular request types and areas. For
each ward we estimate the share of its requests that *could* be placed:

1. Unlocated requests still carry a suburb name.
2. Each suburb's unlocated requests are attributed to wards in the same proportions as that
   suburb's located requests.
3. Coverage = located ÷ (located + attributed unlocated).

Wards under 60% coverage are flagged: their figures describe only part of their requests, and
their request rate is understated.

## Electricity

The City distributes electricity to most of Cape Town, but Eskom supplies some areas directly,
and residents there report faults (and pay) to Eskom. The City's "Electricity Supply Authority"
map layer is currently incomplete (its main City-supplied area is missing from the published
geometry), so we use the City's load-shedding areas instead. They cover exactly the area where the
City distributes electricity; everything outside them is treated as Eskom-supplied.

A ward's "electricity supplier" is the share of its modelled population (see Population) living
inside the City's load-shedding areas.

## Outages

There is no public record of how long water or electricity was off in each area, so this uses what
residents reported. The City's service requests include "no water" and "no power" reports. One
burst main produces many reports, and one household's fault produces one. So a day counts as a
**day with no-water (or no-power) reports** for a ward only when **3 or more** such reports with a
usable location were logged in the ward that day.

- Period: the 365 days ending on the latest change in the service-request data.
- Water types: WAT: No Supply; WAT: No Water 40mm and Above; WMM: No Water Below 40mm;
  WMM: No Water 20mm and below; No Water Supply; No Water WMD.
- Power types: No Power; No Power – Single unit affected / Multiple units affected / Backyarder.
- Power figures are shown only for wards where the City supplies at least half of residents, and
  only reports inside City-supplied areas are counted (see Electricity).

This counts days with clustered reports, not hours without supply. Planned maintenance, announced
outages and load-shedding are often not reported. Reports without a usable location are left out,
so wards with low location coverage are undercounted.

## Search

Suburb search uses the City's official suburbs. A suburb is listed with every ward covering at
least 2% of its area, with the share, because suburbs and wards don't line up. "My location" uses
the device's position and the ward boundaries directly; the position never leaves the browser.

## Land use

"What kind of place" comes from the City's zoning scheme: what each land parcel **may legally be
used for**, not what is on it today (a parcel zoned for business may be empty; informal homes
often sit on land zoned for something else). For each ward we add up parcel areas per zone and
group the zones (houses, incremental housing, flats and group housing, business and mixed use,
industrial, community, parks and conservation, farmland and rural, transport and utilities).
Public roads, "limited use" holding land and parcels with no zoning recorded are left out of the
shares and reported separately.

The City's layer has about 850,000 parcels, so we don't download it. At pin time the City's
server sums the areas of parcels wholly inside each ward, and we fetch only the parcels crossing
the ward's edge and clip them to it. Requests are made one at a time.

In a few wards most of the area isn't in any recorded land parcel (unsurveyed or informally
settled land). Where recorded parcels cover less than 60% of the ward, the site says so and
leaves the one-line description out of the summary.

The one-line description ("Zoned mostly for houses (64%) ...") is generated from these shares by
fixed rules, with the percentages shown; no wording is written by hand per ward.

## Landmarks

The map's place layers (police and fire stations, municipal courts, hospitals and clinics,
schools, libraries, community centres, sports grounds, stadiums, pools, beaches and monuments)
come from the City's facility registers. The City has no shopping-centre layer, so those come
from OpenStreetMap (`shop=mall`, © OpenStreetMap contributors, ODbL). Names are tidied from the
City's upper case; places are assigned to the ward containing them. Registers can be incomplete
or out of date, and a place's absence from the map doesn't mean it isn't there.

## Fetching politely

Every request to an upstream service goes through one module (`etl/src/wardmap/fetch.py`),
which sends requests to each host one at a time with a minimum gap (1.5 s for the City's own
servers, 5 s for OpenStreetMap's Overpass API), backs off on errors and honours `Retry-After`.
Monthly refreshes fetch only what changed since the last run.

## Ward allocations

Each year the City budgets a fixed amount per ward (R1 million in 2024/25) for projects proposed
by the ward councillor and approved by the subcouncil. These are published as a budget annexure
PDF. We parse it with a per-year configuration and check the parse against **every printed
total**: each ward, each subcouncil's multi-ward block, each subcouncil, and the grand total. A
single mismatch stops the build.

These are **budgeted allocations as adopted**, not what was actually spent. Later adjustment
budgets may have changed them. The 2024/25 budget uses the 2021 wards, so the map lists the
projects of each older ward that overlaps the selected ward, with how much of it overlaps.
Multi-ward and unallocated amounts are shown separately because they can't be attributed to one
ward.

## Colour

Wards are coloured on a single-hue scale in five quantile classes: darker means a higher value,
with no colour meaning "good" or "bad". The scale is checked for colour-blind legibility and
contrast. Grey means there is not enough data.

## Provenance

Every published file records its sources, the date each was retrieved, and the period the
figures describe. Every pinned input file in `sources/` has a sidecar with its original URL,
retrieval date and SHA-256. Where a City document server was unreachable, the file came from the
Internet Archive's copy of the same URL, and the sidecar says so.
