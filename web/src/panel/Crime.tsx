// Reported crime for a ward: the police precinct(s) covering it, and each precinct's figures
// over five financial years. Precinct figures, never crimes inside the ward itself.
import type { AppData } from "../data";
import type { CrimeEnvelope, StationCrime } from "../generated/crime";
import { fmtInt } from "../format";
import { Gaps } from "./Gaps";
import { SourceLine } from "./Figure";

/** Tiny bar trend of counts per financial year (bars, so each year reads separately). */
function Trend({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const w = 6;
  const gap = 2;
  return (
    <svg class="trend" width={values.length * (w + gap)} height="18" role="img" aria-label={label}>
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * 16);
        return <rect key={i} x={i * (w + gap)} y={18 - h} width={w} height={h} rx="1" class={i === values.length - 1 ? "trend-last" : ""} />;
      })}
    </svg>
  );
}

function change(now: number, before: number | undefined): string {
  if (before == null || before < 10) return ""; // percentages of tiny counts are noise
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "no change" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

function StationTable({ env, st }: { env: CrimeEnvelope; st: StationCrime }) {
  const fy = env.financial_year;
  const prev = env.years[env.years.length - 2];
  return (
    <table class="crime-table">
      <thead>
        <tr>
          <th scope="col">Crime</th>
          <th scope="col" class="num">{fy}</th>
          <th scope="col" class="num">vs {prev}</th>
          <th scope="col" class="num">Per 100k</th>
          <th scope="col">5 years</th>
        </tr>
      </thead>
      <tbody>
        {env.categories.map((c) => {
          const byYear = st.counts[c.key] ?? {};
          const now = byYear[fy] ?? 0;
          const series = env.years.map((y) => byYear[y] ?? 0);
          return (
            <tr key={c.key}>
              <th scope="row" title={c.note ?? undefined}>
                {c.label}
              </th>
              <td class="num">{fmtInt(now)}</td>
              <td class="num">{change(now, prev ? byYear[prev] : undefined)}</td>
              <td class="num">{st.population ? fmtInt(Math.round((now / st.population) * 100_000)) : "–"}</td>
              <td>
                <Trend values={series} label={`${c.label}: ${series.join(", ")}`} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function WardCrime({ data, ward }: { data: AppData; ward: number }) {
  const env = data.crime;
  const row = env?.rows.find((r) => r.ward_no === ward);
  if (!env || !row) return null;
  const stations = new Map(env.stations.map((s) => [s.station, s]));
  const shown = row.precincts.filter((p) => p.share >= 0.1);
  return (
    <section class="section" aria-labelledby="crime-title">
      <h3 id="crime-title">Reported crime</h3>
      <p class="lede">
        {row.precincts.length === 1 ? (
          <>
            This ward is policed by <strong>{row.precincts[0]!.station}</strong> police station.
          </>
        ) : (
          <>
            This ward is split between police precincts:{" "}
            {row.precincts.map((p, i) => (
              <span key={p.station}>
                {i > 0 && ", "}
                <strong>{p.station}</strong> ({Math.round(p.share * 100)}% of residents)
              </span>
            ))}
            .
          </>
        )}{" "}
        Figures are for whole precincts, which don't follow ward boundaries.
      </p>
      {shown.map((p) => {
        const st = stations.get(p.station);
        if (!st) return null;
        return (
          <div key={p.station} class="crime-station">
            <h4 class="sub-head">
              {p.station}
              {st.population ? <span class="search-meta"> · about {fmtInt(st.population)} residents</span> : null}
            </h4>
            <div class="table-scroll">
              <StationTable env={env} st={st} />
            </div>
          </div>
        );
      })}
      <Gaps gaps={env.gaps} />
      <p class="source">
        Financial years run April to March. <SourceLine env={env} sourceKey="stats" method="crime" />
      </p>
    </section>
  );
}
