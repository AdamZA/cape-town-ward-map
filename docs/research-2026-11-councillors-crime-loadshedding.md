# Data-source research: councillors, crime, load-shedding

Retrieved/tested 2026-11-16. Nothing in the repo was modified. "Tested" = fetched with curl today.

## 1. Ward councillors (Nov 2026 term)

**Best source for name + party: IEC "List of current ward councillors"** (tested, already shows the 2026 term)
- https://www.elections.org.za/pw/StatsData/List-Of-Current-Ward-Councillors
- ASP.NET form (province 9 -> municipality `9006` "CPT - City of Cape Town"). Returns 118 wards, IDs `19100001`-`19100118` (ward_no = last 3 digits), columns: Ward No, Name(s), Surname, Affiliation. HTML table only, 20 rows per page (6 postback pages); no CSV link found. No "as at" date on the page, so record our retrieval date.
- Terms (https://www.elections.org.za/pw/Copyright-Notice): reproduction "in unaltered form only for personal, non-commercial use or use within your organisation"; commercial use prohibited. Names/party of elected office-bearers are facts, but for clean provenance cite IEC and consider emailing them (address on that page). robots.txt allows `/` (Content-Signal: search=yes, ai-train=no).
- IEC results downloads (2026 LGE is listed, report chosen via postback): https://results.elections.org.za/home/Downloads/ME-Results/ ; dashboard https://results.elections.org.za/dashboards/lge/
- IEC API (https://api.elections.org.za/) needs a username/password requested from webmaster@elections.org.za. Not used.

**Contact details: City of Cape Town only, and not machine-readable without credentials**
- Lookup tool: https://web1.capetown.gov.za/web1/councilhubonline/findacouncillor (Angular app). Its backend `https://ctcs.capetown.gov.za/coapi/api/...` returns `401 The Api Key for accessing this endpoint is missing` without a key. The key sits in the app's public config; I did not use it and recommend we don't. I could therefore not confirm whether the hub already lists the new councillors.
- Precedent on the open data portal: "City of Cape Town Councillors Nov 2021" (.docx; name, email, phone per ward; City open-data terms), item `8bd356dfd8ab456eae962b0885880495`. Published July 2024, so a 2026 equivalent may take a long time; worth asking opendata/city.maps@capetown.gov.za for it.
- Subcouncil pages: https://web1.capetown.gov.za/web1/councilhubonline/subcouncilprofile?subcouncilid=N (1-20) and .../subcouncilmanagers (same keyed API behind them).
- Personal data: the City itself publishes councillors' official email and phone for constituency work, so republishing those official details with a citation is defensible under POPIA, but they change and are still personal information. Safer: publish name + party (IEC), and for contact show the subcouncil office details plus a deep link to the City lookup tool. Never include private addresses or non-City contact details.

**Role wording to paraphrase (tested, City pages)**
- https://www.capetown.gov.za/family-and-home/meet-the-city/city-council/wards/ : ward councillor is elected by ward voters, represents residents "regardless of your political affiliation", chairs the ward committee (up to 10 members, meets at least every second month), allocates funding for ward projects; residents can attend ward committee meetings and suggest ward projects via ward committee, councillor or subcouncil manager.
- https://www.capetown.gov.za/family-and-home/meet-the-city/city-council/subcouncils/ : subcouncils (20 since 30 Aug 2024) receive and respond to residents' complaints and enquiries, make recommendations to Council, comment on liquor licence applications, monitor service delivery, supervise ward allocation spending; meet monthly, open to the public; residents "may contact the subcouncil manager regarding any municipal service issue".
- Pitfall: https://www.capetown.gov.za/family-and-home/meet-the-city/city-council/the-city-council/ still says 231 members / 116 ward councillors (pre-2026).
- MDB and Wikipedia add nothing authoritative here; not recommended.

**Recommendation:** pin `sources/councillors/2026.csv` (`ward_no,name,party`) from the IEC list with sidecar; hand-check 118 rows, unique wards. Add subcouncil office contacts manually from the City hub once it reflects the new term. By-elections will change this; re-pin quarterly.

## 2. Crime (SAPS, per police station)

**Statistics** (tested): https://www.saps.gov.za/services/crimestats.php
- Latest verified workbook: Q4 2025/26 (Jan-Mar 2026), https://www.saps.gov.za/services/downloads/2025/2025-2026_-_4th_Quarter_WEB.xlsx (10.8 MB, Last-Modified 2026-05-10). Sheet `RAW Data`: one row per station x category, monthly counts and quarter totals for the same quarter in 5 years (2022-2026), plus District/Province. 64 stations have District = "City of Cape Town District".
- Newer: Q1 2026/27 (Apr-Jun 2026) exists as macro workbook https://www.saps.gov.za/services/downloads/2026/2026-2027_-_1st_Quarter_WEB.xlsm (HTTP 200, 11.3 MB, modified 2026-08-28; not opened, structure unverified). Q2 not yet posted. Quarterly cadence; releases are sometimes postponed.
- Categories present for every station: Murder; Attempted murder; Sexual offences (subtotal); Common assault; Assault GBH; Robbery with aggravating circumstances; Burglary at residential premises; Theft of motor vehicle; Drug-related crime; subtotals "Contact crime (Crimes against the person)", "Property-related Crime", "17 Community reported serious Crime". Suggested headline set: Murder, Contact crime, Property-related crime, and optionally Burglary at residential premises.
- Terms: "All material on this site is subject to copyright" (https://www.saps.gov.za/copyright.php); no open licence. Publish derived counts with attribution, pin the workbook with provenance.
- Pitfalls: each file compares one quarter across years, so a rolling 12 months needs four workbooks; figures are reported crimes, revised in later releases; drug-related crime reflects police activity; quarterly murder counts per station are small and noisy.

**Precinct boundaries**
- Official: https://www.saps.gov.za/services/boundary.php (shapefile, WGS84, "last updated 2026-01-22"). Download requires submitting name + email and agreeing that the data "shall not be made available to any other person or entity without the express permission of [SAPS]". I did not submit it. This blocks committing the polygons to `sources/` or drawing them on the map without written permission.
- Unofficial copies on ArcGIS Online (e.g. `services.arcgis.com/k7HsiFEIdlPzZNnP/.../South_African_police_boundaries`, 2023, no licence) have unknown vintage and the same underlying restriction. The City only publishes station points (Theme_Based/Safety_Security/MapServer/7).

**Presentation:** do not apportion counts to wards. Per ward, list the precinct(s) overlapping it (with share of ward area, and flag any covering <10%), each with its own station-wide figures, labelled "whole precinct, not this ward". No per-capita rates (no precinct populations; CBD/transport-hub precincts have large daytime populations). No ward colouring by crime.

**Recommendation:** feasible only as a ward -> precinct lookup. Ask SAPS for permission to redistribute boundaries; meanwhile, the owner can download the shapefile personally, compute the ward/precinct overlap table offline, and publish only that derived table (names and shares), with the limitation stated.

## 3. Load-shedding

**Key finding: the City publishes its own load-shedding history, per area, with minutes** (tested)
- Table: https://services6.arcgis.com/nyYfO9SxHU2ChQd9/arcgis/rest/services/LoadShed_gdb/FeatureServer/0 ("Loadshedding Schedule 2018 to 2025", item `803dc834b8ed4ff78d39f83d981fe806`), 19,480 rows: `Stage, Circuit, Minutes, DateNew, TimeNew`. Range 2018-06-14 to 2025-04-24. City open-data terms.
- Same as CSV: https://www.arcgis.com/sharing/rest/content/items/baa72a23f28d4a6e91d9b7f13874a7f3/data (`Loadshedding_schedule.csv`, Jan 2020 to Apr 2025).
- Covers "the City of Cape Town licensed distribution area" only, and reflects City stages (so Steenbras buy-downs are already in it). Minutes vary per event (e.g. 119, 130), which suggests implemented events, but the metadata calls it a "schedule"; label as "load-shedding recorded by the City".
- My totals per area: 2022 about 550-585 h, 2023 about 1,340-1,390 h, 2024 about 160-190 h (Jan-Mar), 2025 about 23-38 h (Jan-Apr). 2022-2025 is clean (exactly Areas 1-16). 2018-2021 is keyed by substation names with many spellings: exclude or state as unusable. Cleaning needed: a few negative/null `Minutes`, typos in `Circuit` ("Zrea 12", "Area 13.1"), `Stage` sometimes embeds area lists.
- "Last 12 months" (Nov 2025-Nov 2026): the dataset ends April 2025; eskom-calendar also has nothing after May 2025. Present as "none recorded in the published data (ends April 2025)", not as a measured zero.

**Block polygons** (tested)
- Use https://citymaps.capetown.gov.za/agsext/rest/services/Theme_Based/Basic_Services_Infrastructure/MapServer/5/query (19 polygons, `BlockID` 1-17, 21, 23). The open-data endpoint `Theme_Based/ODP_SPLIT_7/FeatureServer/13` returns attributes but errors (400) on geometry queries.
- Blocks cover 1,264 of 2,452 km2. Overlay with the 2026 wards: 62 wards >=95% inside City blocks, 27 wards >=95% Eskom, 24 mixed, 5 partly in neither (wards 15, 54, 84, 86, 100; mostly mountain/rural land). Of the 94 wards with City blocks, only 63 have one block covering >=90% of their City-supplied area, so many wards need "Areas 5 and 7: X-Y hours" rather than one number. Blocks 17, 21, 23 never appear in the history table.

**Electricity Supply Authority layer** (`ODP_SPLIT_1/FeatureServer/3`): fields `OBJECTID, SUPPLY_AUTHORITY` ("CCT" x11, "Eskom" x10), `Shape__Area`, `Shape__Length`. **It is unreliable as served:** `Shape__Area` values do not match the geometries (attributes appear shuffled between rows), the 942 km2 CCT polygon and a 229 km2 Eskom polygon are missing, and a point at City Hall matches no polygon. Served CCT geometry is only 310 km2. Do not label areas from it alone. Use "inside a City load-shedding block" as City-supplied; treat the rest as Eskom-supplied, cross-checked against the layer's two large Eskom polygons (763 and 192 km2, which do look right). Worth reporting to city.maps@capetown.gov.za.

**Eskom-supplied areas**
- https://github.com/beyarkay/eskom-calendar (archived; code GPL-3.0, data CC BY-NC-SA 4.0 with specific attribution-link rules) and its history dataset https://huggingface.co/datasets/beyarkay/south-africa-loadshedding (parquet: `outages`, `stage_timeline`, `areas`, `suburbs`; 7 Jul 2022 to 15 May 2025).
- Caveats from its own card: scheduled not observed; Cape Town's own stages only tracked from 23 Sep 2022 and absent in 2025; dataset was machine-rebuilt and not fully checked by the author. Eskom-direct areas are keyed by suburb name lists (`area_metadata.yaml`), with no polygons, so there is no defensible ward mapping. The Eskom source spreadsheet it cites now returns 404. ShareAlike/NonCommercial would also attach to anything derived.

**Recommendation:** build "hours of load-shedding recorded by the City, per load-shedding area" for 2022, 2023, 2024 from the City table, mapped to wards by block overlap (show the range where a ward spans blocks). For Eskom-supplied wards, show "Supplied by Eskom; the City's records do not cover this area" and at most the national stage timeline as context, with no per-ward hours. Avoid the eskom-calendar data in published figures unless the licence terms are acceptable.

## Local working copies (scratchpad, untrusted downloads)
- C:\Users\sunds\AppData\Local\Temp\claude\3afa9dfee89be7eb\455e3c9d-151b-47c4-92a2-941c7be67818\scratchpad\dl_saps\q4.xlsx
- C:\Users\sunds\AppData\Local\Temp\claude\3afa9dfee89be7eb\455e3c9d-151b-47c4-92a2-941c7be67818\scratchpad\dl_ls\ls.csv
- C:\Users\sunds\AppData\Local\Temp\claude\3afa9dfee89be7eb\455e3c9d-151b-47c4-92a2-941c7be67818\scratchpad\dl_geo\ (blocks, supply, wards GeoJSON)
- C:\Users\sunds\AppData\Local\Temp\claude\3afa9dfee89be7eb\455e3c9d-151b-47c4-92a2-941c7be67818\scratchpad\scripts\ (probe scripts)
