# Cape Town Ward Map

A map of City of Cape Town data for each ward: service requests, water and electricity
outages, population, land use, public places and the ward allocation projects in the City's
budget. Every figure shows its source and retrieval date, and gaps in the data are stated next to
the figures they affect. How each figure is produced: [METHODOLOGY.md](METHODOLOGY.md).

## How it fits together

```
upstream (City ArcGIS, MDB, budget PDFs, GHSL)
   │  wardmap pin <dataset>        (network; run locally; reviewed in a PR)
   ▼
sources/        committed, pinned inputs, each with a .source.json provenance sidecar
raw/            gitignored: download cache + SQLite mirror of service requests
   │  wardmap build                 (offline, deterministic)
   ▼
data/           committed, validated JSON/GeoJSON: the contract the site reads
   │  web/ (Vite + Preact + MapLibre), static, deployed to GitHub Pages
   ▼
site
```

- **`etl/`**: Python package `wardmap`. Every dataset module has `pin()` (fetch into `sources/`)
  and/or `build()` (write `data/`). `publish.py` is the only code that writes `data/`,
  `fetch.py` is the only code that does HTTP, and `models.py` defines every published contract.
- **`schemas/`**: JSON Schema exported from `models.py`. The frontend's types in
  `web/src/generated/` are generated from it, and CI fails if either drifts.
- **`web/`**: the map. `map/map.ts` is the only file that touches MapLibre. `panel/Figure.tsx` is
  the only way a number is rendered, so every figure carries its source.

Ward vintage is explicit everywhere: every file says which ward boundaries (2021 or 2026) its
ward numbers refer to.

## Development

Requires Python 3.12+ with [uv](https://docs.astral.sh/uv/), and Node 22+.

```sh
cd etl
uv sync
uv run wardmap build        # rebuild data/ from sources/ (+ the DB, if present)
uv run wardmap check        # validate data/ and cross-file invariants
uv run pytest

cd ../web
npm ci
npm run dev                 # http://localhost:5173/cape-town-ward-map/
```

After changing `etl/src/wardmap/models.py`: `uv run wardmap schemas` then `npm run gen:types`.

## Service requests

The service-request mirror (about 4.5 million rows, 800 MB) lives outside git:

```sh
uv run wardmap sr sync --full     # first time: bulk CSV + live layer (about 15 min)
uv run wardmap sr sync            # afterwards: only rows changed since the last sync
uv run wardmap build
```

In CI, the **Refresh service requests** workflow runs monthly. It restores the mirror from the
`sr-db` release asset, syncs, rebuilds, and opens a PR with a summary of what changed. If the
City changes the dataset's schema, or the mirror drifts in a way deltas can't fix, the workflow
fails loudly and opens an issue; the site keeps its last good data. Run it manually with
`full: true` to rebuild from scratch, for example after the City republishes the dataset under a
new item (update `SR_ITEM_ID`/`SR_LAYER` in `config.py` first).

## Budgets

Ward allocation annexures are pinned PDFs with a per-year config in `sources/annexures/`. Each
June a workflow opens a checklist issue for adding the new year. The parser checks itself against
every printed total in the PDF.

## Known gaps

- **Councillors** are the ward winners of the last local election (IEC results). By-elections
  since then are not reflected, and names are converted from the IEC's capitals, so a few
  spellings may be off.
- **Ward population** is modelled; Stats SA hasn't released Census 2022 by ward.
- **About a third of service requests** have no usable location and can't be placed in a ward.
- **No-water / no-power days** count days with 3+ resident reports, not hours without supply.
- **Electricity supplier** (City vs Eskom) comes from the City's load-shedding areas, because the
  City's supply-authority layer is incomplete. Power figures are hidden where Eskom supplies most
  residents.
- **Party donations** are those declared to the IEC since April 2021; smaller donations and money
  given to party-linked companies aren't covered.
- **"What kind of place"** comes from zoning: what land may be used for, not what is on it. Place
  layers come from the City's facility registers (and OpenStreetMap for shopping centres) and can
  be incomplete.

## Fetching politely

All network access goes through `etl/src/wardmap/fetch.py`, which limits each host to one request
at a time with a minimum gap and backs off on errors. Don't add parallel fetching around it, and
don't run two `pin` commands against the same server at once.

## Licence

Code: MIT (see [LICENSE](LICENSE)). Data in `sources/` and `data/` remains under its publishers'
terms, recorded in each file's provenance.

Shopping-centre locations (`sources/landmarks/malls.geojson`, and their rows in
`data/landmarks-*.json`) are © OpenStreetMap contributors, available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/).
