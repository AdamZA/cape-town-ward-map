// Trends over time for the city and, when one is open, a ward's area: council seats and vote
// shares at each election, wards won, turnout, and reported crime by financial year. Older ward
// results are traced to today's ward through the ward that covered most of it at the time.
import type { AppData } from "../data";
import { LineChart, type Series, SmallMultiples } from "../charts/LineChart";
import { fmtInt, fmtPct } from "../format";
import type { Term } from "../metrics";
import { predecessors } from "../panel/Allocations";
import { OTHER_PARTY, partyColour, partyShort } from "./partyColours";
import { councilAfter } from "./Timeline";
import { useState } from "preact/hooks";

const pct = (v: number) => fmtPct(v * 100);
const pctTick = (v: number) => `${Math.round(v * 100)}%`;
/** Most parties drawn as their own line; the rest are added up as "Other parties". */
const MAX_PARTIES = 6;

/** The parties worth a line: largest peak value first, up to `max`. */
export function topParties(rows: Map<string, (number | null)[]>, max: number, min = 0): string[] {
  return [...rows]
    .map(([p, vs]) => [p, Math.max(...vs.map((v) => v ?? 0))] as const)
    .filter(([, peak]) => peak > min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([p]) => p);
}

function partySeries(rows: Map<string, (number | null)[]>, keep: string[], dark: boolean, other = true): Series[] {
  const out: Series[] = keep.map((p) => ({ key: p, label: p, short: partyShort(p), colour: partyColour(p, dark), values: rows.get(p)! }));
  const rest = [...rows].filter(([p]) => !keep.includes(p));
  if (other && rest.length) {
    const n = rest[0]![1].length;
    out.push({
      key: "other",
      label: "Other parties",
      short: "Others",
      colour: OTHER_PARTY,
      values: Array.from({ length: n }, (_, i) => rest.reduce((s, [, vs]) => s + (vs[i] ?? 0), 0)),
    });
  }
  return out;
}

interface Props {
  data: AppData;
  terms: Term[];
  ward: number | null;
  dark: boolean;
  onClose: () => void;
}

export function TrendsPanel({ data, terms, ward, dark, onClose }: Props) {
  const [measure, setMeasure] = useState<"seats" | "share">("seats");
  const years = terms.map((t) => String(t.year));

  // Council seats and vote shares after each election.
  const councils = terms.map((t) => councilAfter(data, t.year));
  const byParty = new Map<string, (number | null)[]>();
  councils.forEach((m, i) => {
    for (const p of m?.parties ?? []) {
      if (!byParty.has(p.party)) byParty.set(p.party, terms.map(() => (m ? 0 : null)));
      byParty.get(p.party)![i] = measure === "seats" ? (p.seats ?? 0) : p.share;
    }
  });
  for (const vs of byParty.values()) councils.forEach((m, i) => m || (vs[i] = null));
  const councilParties = topParties(byParty, MAX_PARTIES, measure === "seats" ? 2 : 0.02);

  // Ward seats won by each party.
  const wins = new Map<string, number[]>();
  terms.forEach((t, i) => {
    for (const r of data.electionWards.find((e) => e.year === t.year)?.rows ?? []) {
      if (!wins.has(r.winner)) wins.set(r.winner, terms.map(() => 0));
      wins.get(r.winner)![i]! += 1;
    }
  });
  const winParties = topParties(wins, MAX_PARTIES);

  const crime = data.crime;
  const crimeCats = crime ? crime.categories.filter((c) => ["murder", "contact", "sexual_offences", "burglary_home", "property", "drugs"].includes(c.key)) : [];

  // The open ward, traced back through each term's ward covering most of it.
  const wardRows = ward
    ? terms.map((t) => {
        const env = data.electionWards.find((e) => e.year === t.year);
        if (!env) return null;
        const [main] = predecessors(ward, data.wards.ward_vintage, env, data.crosswalks);
        const row = main && env.rows.find((r) => r.ward_no === main.ward);
        return row && main ? { row, main, term: t } : null;
      })
    : [];
  const wardShares = new Map<string, (number | null)[]>();
  wardRows.forEach((c, i) => {
    for (const p of c?.row.pr_parties ?? []) {
      if (!wardShares.has(p.party)) wardShares.set(p.party, terms.map((_, k) => (wardRows[k] ? 0 : null)));
      wardShares.get(p.party)![i] = p.share;
    }
  });
  const wardParties = topParties(wardShares, 4, 0.05);
  const station = ward ? crime?.rows.find((r) => r.ward_no === ward)?.precincts[0]?.station : undefined;
  const st = station ? crime?.stations.find((s) => s.station === station) : undefined;
  const iec = "Source: Electoral Commission of South Africa (IEC), results per election.";
  const saps = "Source: South African Police Service, crime statistics by police station (financial years, April to March).";

  return (
    <article class="panel-body" aria-labelledby="trends-title">
      <header class="panel-head">
        <div>
          <h2 id="trends-title">Trends</h2>
          <p class="panel-sub">
            {ward ? `Cape Town and ward ${ward}'s area` : "Cape Town"}, {years[0]} to {years[years.length - 1]}
          </p>
        </div>
        <button type="button" class="icon-btn" onClick={onClose} aria-label="Close trends">
          ×
        </button>
      </header>

      <section class="section">
        <h3>City council after each election</h3>
        <div class="seg" role="group" aria-label="Measure">
          <button type="button" class={measure === "seats" ? "on" : ""} aria-pressed={measure === "seats"} onClick={() => setMeasure("seats")}>
            Seats
          </button>
          <button type="button" class={measure === "share" ? "on" : ""} aria-pressed={measure === "share"} onClick={() => setMeasure("share")}>
            Share of votes
          </button>
        </div>
        <LineChart
          title={measure === "seats" ? "Council seats by party" : "Share of all council votes by party"}
          desc={`Cape Town council ${measure === "seats" ? "seats" : "vote share"} for the largest parties at each local election.`}
          x={years}
          series={partySeries(byParty, councilParties, dark)}
          fmt={measure === "seats" ? fmtInt : pct}
          tick={measure === "seats" ? fmtInt : pctTick}
          foot={`${iec} Council size: ${councils.map((m, i) => `${years[i]} ${m?.seats_total ?? "–"}`).join(", ")}.`}
        />
        <LineChart
          title="Ward seats won"
          desc="Number of wards whose councillor came from each party."
          x={years}
          series={partySeries(wins, winParties, dark, false).filter((s) => s.values.some((v) => (v ?? 0) > 0))}
          fmt={fmtInt}
          foot={`${iec} Ward numbers changed between elections (${terms.map((t) => `${t.year}: ${data.electionWards.find((e) => e.year === t.year)?.rows.length ?? "–"} wards`).join(", ")}).`}
        />
        <LineChart
          title="Turnout"
          desc="Ballots cast as a share of registered voters in Cape Town."
          x={years}
          series={[{ key: "turnout", label: "Turnout", colour: "var(--ink-2)", values: councils.map((m) => m?.turnout ?? null) }]}
          fmt={pct}
          tick={pctTick}
          short
          foot={iec}
        />
      </section>

      {crime && (
        <section class="section">
          <h3>Reported crime, city-wide</h3>
          <p class="lede">Crimes reported at all City of Cape Town police stations each financial year. Each chart has its own scale.</p>
          <SmallMultiples
            charts={crimeCats.map((c) => ({ key: c.key, title: c.label, values: crime.years.map((y) => crime.city_totals[c.key]?.[y] ?? null) }))}
            x={crime.years}
            fmt={fmtInt}
            desc="reported in Cape Town per financial year."
            foot={saps}
          />
        </section>
      )}

      {ward && (
        <section class="section">
          <h3>Ward {ward}'s area</h3>
          <p class="lede">
            Each election is shown for the ward that covered most of today's ward {ward}:{" "}
            {wardRows
              .map((c) => (c ? `${c.term.year} ward ${c.main.ward}${c.main.share < 0.999 ? ` (${Math.round(c.main.share * 100)}% of today's ward)` : ""}` : null))
              .filter(Boolean)
              .join("; ")}
            .
          </p>
          {wardParties.length > 0 && (
            <LineChart
              title="Party-ballot vote share"
              desc={`Vote share of the main parties in ward ${ward}'s area at each election.`}
              x={years}
              series={partySeries(wardShares, wardParties, dark, false)}
              fmt={pct}
              tick={pctTick}
              foot={iec}
            />
          )}
          <LineChart
            title="Turnout"
            desc={`Turnout in ward ${ward}'s area at each election.`}
            x={years}
            series={[{ key: "t", label: "Turnout", colour: "var(--ink-2)", values: wardRows.map((c) => c?.row.turnout ?? null) }]}
            fmt={pct}
            tick={pctTick}
            short
          />
          {st && crime && (
            <>
              <p class="lede">Crime reported at {st.station} police station, which covers most of the ward's residents.</p>
              <SmallMultiples
                charts={crimeCats.slice(0, 4).map((c) => ({ key: c.key, title: c.label, values: crime.years.map((y) => st.counts[c.key]?.[y] ?? 0) }))}
                x={crime.years}
                fmt={fmtInt}
                desc={`reported at ${st.station} per financial year.`}
                foot={saps}
              />
            </>
          )}
        </section>
      )}
    </article>
  );
}
