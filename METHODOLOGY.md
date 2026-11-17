# Methodology

How every figure on the map is produced, and what it can and can't tell you. The map shows
public data without rankings or judgements. Every number has its source next to it, and gaps in
the data are stated.

## Wards

The map shows the **118 wards of the 2026 delimitation**, which took effect after the
November 2026 local government elections. Boundaries come from the City of Cape Town's open data
service. The layer's description text still says "2016 wards", but every feature is tagged
`WARD_YEAR = 2026`. Before using it we check that there are exactly 118 wards and compare each
one with the Municipal Demarcation Board's 2026 ward layer; the lowest per-ward
intersection-over-union was 0.975.

Earlier terms use earlier delimitations, all from the Municipal Demarcation Board: **2021 (116
wards)**, **2016 (116 wards)** and **2011 (111 wards)**. Ward numbers do not mean the same place
across delimitations.

## Crosswalk

To relate older wards (2011, 2016, 2021) to 2026 wards we overlay each older boundary set with
the 2026 one and record, for each pair that overlaps, the share of each ward's area in the
overlap. The crosswalk is used to:

- list the budget projects of the older wards that overlap a current ward (projects are never
  split or reassigned);
- infer subcouncils (see below).

The older and 2026 boundaries come from different publishers and differ slightly at the edge of
the metro. Where more than 2% of a 2026 ward lies outside every older ward, this is recorded as
a gap.

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

## Elections

Results come from the Electoral Commission of South Africa (IEC). For each local government
election we download the IEC's published files: votes for every party at every voting district,
and each council's seat calculation. Votes are added up to ward level when the files are pinned;
nothing is estimated.

- **Council seats** are as allocated after the election. By-elections, floor crossings and
  coalitions formed later are not shown. Where no party won more than half the seats, the site
  says so instead of naming a governing party.
- **Markers on the IEC's seat calculation** are stated as notes: a party that won more ward
  seats than its share of the vote ("excess seats"), and a party with fewer candidates than
  seats won ("potential forfeiture"). Seats won by independent ward candidates are shown
  separately.
- **Ward results** are the ward ballot: votes for ward candidates, by party or independent.
  Residents also vote on a party list (PR ballot), which tops up the council so seats match
  overall support. The council table uses the PR ballot's votes.
- **Ward councillors** are the winning ward candidates, from the IEC results dashboard's data for
  the council. The IEC's list of current councillors (which includes by-elections) can't be
  downloaded automatically, so by-elections aren't reflected yet. Names are converted from the
  IEC's capitals, so a few spellings may be off.
- **Change since the last election** compares party-list (PR) shares, which measure support for
  parties rather than for individual ward candidates. Ward boundaries change between elections,
  but voting districts mostly keep their numbers, so we add up the previous election's votes in
  the voting districts that make up today's ward. Where those districts hold less than 95% of
  today's voters the site says so, and below 80% it shows no comparison.
- **Turnout** is ballots cast, including spoilt ones, as a share of registered voters.
- **Earlier ward boundaries.** An election is fought on the wards of its time. When the map shows
  newer wards, a ward's result is that of the old ward covering most of it, and the site says so.
- **Party maps** show one party's share of each ward's party-list (PR) vote, or its change since
  the last election. Each ward lists every party with at least 0.5% of its vote (and at least the
  top eight); a party below that in a ward is counted as 0 there.
- **Older elections (2011 and 2016)** come from the same IEC files. The 2011 files are in a
  different text encoding, a few older seat sheets write numbers as text ("28,115"), and the
  Democratic Alliance was registered as "Democratic Alliance/Demokratiese Alliansie" in 2011;
  all three are handled when the files are read. The 2011 and 2016 ward boundaries are the
  Municipal Demarcation Board's. Its 2011 layer lists every Cape Town ward twice with identical
  shapes, and the copies are dropped.
- **The national table** covers all metro and local councils. District councils are left out
  because they overlap the local councils.

The IEC's copyright notice allows reproduction for non-commercial use. This project is
non-commercial and credits the IEC on every figure.

## Council terms

A term runs from one local election to the next. Choosing a term on the timeline shows that
term's ward boundaries and only the figures that exist for them: the election that started the
term, its ward councillors, and ward budgets published on those wards. Service request, outage,
land-use and place figures are only produced for today's wards, so they appear in the current
term only. A past ward's panel lists the current wards covering it, with how much of it each
covers. Seat changes compare a party with itself across elections; a party that changed its
registered name is shown under one name.

## Donations

Since April 2021 the Political Party Funding Act has required parties to declare donations above
a threshold to the IEC, which publishes the declarations every quarter. We parse each quarterly
spreadsheet and check that the rows add up to the totals the IEC prints for every party, in both
the quarter's section and the late-submissions section.

What the declarations don't cover: donations below the threshold (the IEC lists only a running
total for these, without donors), and money given to companies or foundations linked to a party.
Donors are shown as declared; the same donor can appear under more than one spelling and we don't
merge them.

## Party profiles

Profiles cover the parties with seats in Cape Town's council and the largest parties nationally.
For each we record the party's stated local-election priorities (from its manifesto) and its
position on six topics: LGBTQ+ rights; human rights and civil liberties; Israel and Palestine;
policing and crime; housing and land; and immigration.

- **Only the party's own words.** Manifestos, policy documents, official statements, leaders'
  statements and Parliament. A news article is used only where it quotes the party directly.
  No ratings by others, and no positions inferred from votes or alliances.
- **Every party, every topic.** Each topic is either a short neutral summary, a verbatim quote of
  at most 30 words, the date and a link, or "No stated position found" with a note of where we
  looked. The build fails if any party is missing a topic.
- **Dates matter.** Some statements are years old; the date is shown beside every quote.
- **How it was compiled.** The research was done in November 2026 with an AI research agent,
  every quote was checked against the source text, and the file
  (`sources/parties/profiles-2026.yaml`) is open for corrections.
- Foreign policy, constitutional rights and immigration are national matters, not decided by
  city councils; they're included because they matter to voters.
- The Cape Coloured Congress renamed itself the National Coloured Congress in 2023; both
  elections show it under the new name.

## Crime

Crime figures are the police's own: SAPS publishes reported crimes per police station every
quarter. We add the four quarters of each financial year (April to March) together, giving five
years per station, and show a headline set of categories.

A ward is linked to the police precinct(s) covering it. SAPS's precinct boundaries can't be
republished (its download terms forbid passing them on), so they're kept out of this repository.
We use them once to work out what share of each ward's residents lives in each precinct, using the
same population grid as the population estimates, and publish only that table.

- **Precinct figures, not ward figures.** A precinct's crimes are never split between wards; that
  would assume crime is spread like population. The ward panel shows each covering precinct's
  figures.
- **Rates per 100,000 residents** use each precinct's estimated residents. Precincts with many
  visitors or workers (the city centre, beachfronts) look worse than their residents experience.
  No rate is given for precincts with under 5,000 residents or that reach past the population data.
  The map colour for a ward is the covering precincts' rate, weighted by where the ward's residents
  live.
- **Reported crime only.** Many crimes go unreported, and reporting differs between communities.
  Drug-related crime mostly measures police activity. SAPS revises figures in later releases.
- Year-on-year percentage changes are left out where the earlier year had fewer than 10 crimes.

## Trends

The trends view draws each figure over every election (2011 to 2026) or financial year. Charts
show one measure each, on one scale; crime categories get a chart each because their sizes
differ so much. Every chart can be switched to a table of the same numbers.

For a ward, each election is shown for the ward of the time that covered most of today's ward,
and the share it covered is stated. Where that share is small, the earlier figures describe a
partly different area.

## Comparing terms

"Compare terms" puts council terms side by side. Each column only uses figures that exist for
that term: the election that started it, crime for the financial years ending during it
(April to March, counted in the term in which they end), and ward budgets published on its
wards. A ward is traced back through boundary changes to the old ward covering most of it, and
crime uses its main police precinct, whose figures don't depend on ward boundaries. Averages
are per year, so terms of different lengths compare fairly.

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

No colour on the map means "good" or "bad". There are three kinds of map colouring:

- **Amounts** (most figures) use a single colour in five classes, each holding about a fifth of
  the wards. A stronger colour means a higher value. In the light theme that's darker; in the
  dark theme it's brighter, so low values fade into the background in both.
- **Changes** (such as a party's change in support since the last election) use two colours
  around a grey middle. The grey covers the smallest third of changes either way, so "little
  change" is never coloured as a gain or a loss. The two strongest steps hold the largest third.
- **Parties** (the winning party) get one fixed colour each, in every map and chart. Where
  possible it's close to the party's own colour (DA blue, ANC gold, EFF red, PA green); other
  parties share one grey. The party's name is always shown beside its colour.

Wards with no figure are left almost clear, with a hatched key in the legend.

You can pick the map colour (blue, green, purple, orange or grey) and a light or dark theme;
the choice is kept in your browser and isn't part of shared links. Every colour set was checked
with a colour-vision-deficiency simulation and against the map background in each theme.

## Provenance

Every published file records its sources, the date each was retrieved, and the period the
figures describe. Every pinned input file in `sources/` has a sidecar with its original URL,
retrieval date and SHA-256. Where a City document server was unreachable, the file came from the
Internet Archive's copy of the same URL, and the sidecar says so.
