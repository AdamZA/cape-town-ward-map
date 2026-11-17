// The whole city: a short orientation, city-wide figures, and every ward in one sortable table
// (also the accessible, non-map way to read the data).
import { useState } from "preact/hooks";
import type { AppData } from "../data";
import { fmtDate, fmtInt, fmtUnit } from "../format";
import { type MetricKey, type Metrics, METRIC_KEYS, median, type Term } from "../metrics";
import { CouncilResults } from "../elections/Elections";
import { CompareParties } from "../elections/Positions";
import { Figure, METHODOLOGY_URL } from "./Figure";

interface Props {
  data: AppData;
  metrics: Metrics;
  metric: MetricKey;
  term: Term;
  onWard: (ward: number) => void;
  onClose: () => void;
}

type SortKey = "ward" | "population" | MetricKey;

export function CityOverview({ data, metrics, metric, term, onWard, onClose }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: metric, desc: true });
  const sr = data.serviceRequests;
  const wards = data.wards.rows;
  // Past terms list that term's wards (from its election), with only the figures that exist then.
  const termWards = term.current
    ? wards.map((w) => w.ward_no)
    : (data.electionWards.find((e) => e.year === term.year)?.rows.map((r) => r.ward_no) ?? []);
  const totalPop = wards.reduce((s, w) => s + (w.population ?? 0), 0);
  const subcouncils = new Set(wards.map((w) => w.subcouncil).filter((s) => s != null)).size;
  const value = (w: number, k: SortKey): number | null =>
    k === "ward" ? w : k === "population" ? (wards.find((r) => r.ward_no === w)?.population ?? null) : (metrics[k]?.values.get(w) ?? null);
  const rows = [...termWards]
    .sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      if (va == null) return 1;
      if (vb == null) return -1;
      return sort.desc ? vb - va : va - vb;
    });
  const columns: { key: SortKey; label: string; fmt: (v: number) => string }[] = [
    { key: "ward", label: "Ward", fmt: String },
    ...(term.current ? [{ key: "population" as SortKey, label: "People (est.)", fmt: fmtInt }] : []),
    ...METRIC_KEYS.filter((k) => k !== "pct_located" && metrics[k]?.inTable).map((k) => {
      const m = metrics[k]!;
      return { key: k as SortKey, label: m.label, fmt: (v: number) => fmtUnit(v, m.unit) };
    }),
  ];

  return (
    <article class="panel-body" aria-labelledby="city-title">
      <header class="panel-head">
        <div>
          <h2 id="city-title">Cape Town</h2>
          <p class="panel-sub">City overview{term.current ? "" : `, ${term.label} term`}</p>
        </div>
        <button type="button" class="icon-btn" onClick={onClose} aria-label="Close city overview">
          ×
        </button>
      </header>

      <section class="glance">
        <p class="glance-lede">
          The City of Cape Town is divided into <strong>{wards.length} wards</strong>. Each ward elects a ward councillor, who
          chairs a ward committee and proposes projects for the ward's share of the budget. Wards are grouped into{" "}
          <strong>subcouncils</strong>, where residents can raise service problems with the City.
        </p>
        <p class="glance-lede">
          Select any ward on the map, or search for your suburb, to see how the City's services there compare with the rest
          of the city. Colours show how a ward compares; they don't mean good or bad.{" "}
          <a href={METHODOLOGY_URL} target="_blank" rel="noopener">
            How the figures are made
          </a>
        </p>
      </section>

      {term.current && <section class="section">
        <h3>City-wide</h3>
        <dl class="figures two-col">
          <div class="figure">
            <dt>Residents (estimate)</dt>
            <dd>
              <span class="figure-value">{fmtInt(Math.round(totalPop / 1000) * 1000)}</span>
            </dd>
          </div>
          <div class="figure">
            <dt>Wards / subcouncils</dt>
            <dd>
              <span class="figure-value">
                {wards.length} / {subcouncils}
              </span>
            </dd>
          </div>
          <Figure env={sr} field="pct_closed_30d" value={sr.citywide.pct_closed_30d} />
          <Figure env={sr} field="median_days" value={sr.citywide.median_days} />
          <MedianFigure data={data} metrics={metrics} k="water_days" />
          <MedianFigure data={data} metrics={metrics} k="power_days" />
        </dl>
        {sr.period && (
          <p class="lede">
            Service requests logged {fmtDate(sr.period.from)} to {fmtDate(sr.period.to)}.
          </p>
        )}
      </section>}

      <CouncilResults data={data} code="CPT" year={term.year} />

      <CompareParties data={data} />

      <section class="section">
        <h3>All wards</h3>
        <p class="lede">Select a column heading to sort, and a row to open the ward.</p>
        <div class="table-scroll">
          <table class="ward-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                    <button
                      type="button"
                      onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : c.key !== "ward" }))}
                    >
                      {c.label}
                      {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w} onClick={() => onWard(w)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onWard(w)}>
                  {columns.map((c) => {
                    const v = value(w, c.key);
                    return (
                      <td key={c.key} class={c.key === "ward" ? "ward-cell" : "num"}>
                        {v == null ? <span class="no-data">No data</span> : c.fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}

function MedianFigure({ data, metrics, k }: { data: AppData; metrics: Metrics; k: "water_days" | "power_days" }) {
  const m = metrics[k];
  if (!m) return null;
  const med = median([...m.values.values()].filter((v): v is number => v != null));
  return <Figure env={data.outages} field={k} value={med} display={`${med} days in the median ward`} />;
}
