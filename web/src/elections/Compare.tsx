// Compare council terms side by side: the council each election produced, city-wide reported
// crime averaged over each term's financial years, ward budgets, and (when a ward is open) that
// area's own results. Only figures that exist for a term are shown; gaps say why.
import type { ComponentChildren } from "preact";
import type { AppData } from "../data";
import { fmtInt, fmtPct, fmtRandShort } from "../format";
import type { Term } from "../metrics";
import { predecessors } from "../panel/Allocations";
import { partyHref } from "../state";
import { councilAfter } from "./Timeline";

/** Financial years (April to March) are counted in the term during which they end. */
export function yearsInTerm(years: string[], t: Term): string[] {
  return years.filter((fy) => {
    const end = Number(fy.slice(0, 4)) + 1;
    return t.year < end && (t.next == null || end <= t.next);
  });
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

interface Row {
  label: ComponentChildren;
  values: (number | null)[];
  fmt: (v: number) => string;
  /** Show a change column (difference of the last two selected terms). */
  diff?: "points" | "count" | "pct";
  note?: string;
}

function Table({ title, terms, rows, foot }: { title: string; terms: Term[]; rows: Row[]; foot?: ComponentChildren }) {
  const showDiff = terms.length === 2;
  const change = (r: Row) => {
    const [a, b] = r.values;
    if (!showDiff || a == null || b == null || !r.diff) return "";
    if (r.diff === "points") {
      const d = Math.round((b - a) * 1000) / 10;
      return d === 0 ? "±0" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} pts`;
    }
    if (r.diff === "pct") {
      if (!a) return "";
      const d = Math.round(((b - a) / a) * 100);
      return d === 0 ? "±0%" : `${d > 0 ? "+" : "−"}${Math.abs(d)}%`;
    }
    const d = b - a;
    return d === 0 ? "±0" : `${d > 0 ? "+" : "−"}${fmtInt(Math.abs(d))}`;
  };
  return (
    <section class="section">
      <h3>{title}</h3>
      <div class="table-scroll">
        <table class="compare-table">
          <thead>
            <tr>
              <th scope="col" />
              {terms.map((t) => (
                <th key={t.year} scope="col" class="num">
                  {t.label}
                </th>
              ))}
              {showDiff && (
                <th scope="col" class="num">
                  Change
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <th scope="row">{r.label}</th>
                {r.values.map((v, j) => (
                  <td key={j} class="num">
                    {v == null ? <span class="no-data">–</span> : r.fmt(v)}
                  </td>
                ))}
                {showDiff && <td class="num">{change(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {foot && <p class="source">{foot}</p>}
    </section>
  );
}

interface Props {
  data: AppData;
  terms: Term[];
  selected: number[];
  ward: number | null;
  onSelect: (years: number[]) => void;
  onClose: () => void;
}

export function ComparePanel({ data, terms, selected, ward, onSelect, onClose }: Props) {
  const chosen = terms.filter((t) => selected.includes(t.year));
  const toggle = (y: number) =>
    onSelect(selected.includes(y) ? selected.filter((x) => x !== y) : [...selected, y].sort((a, b) => a - b));

  const councils = chosen.map((t) => councilAfter(data, t.year));
  const parties = [
    ...new Set(councils.flatMap((m) => m?.parties.filter((p) => (p.seats ?? 0) > 0).map((p) => p.party) ?? [])),
  ];
  parties.sort((a, b) => Math.max(...seatsOf(b)) - Math.max(...seatsOf(a)));
  function seatsOf(party: string) {
    return councils.map((m) => m?.parties.find((p) => p.party === party)?.seats ?? 0);
  }

  const crime = data.crime;
  const crimeRows: Row[] = crime
    ? crime.categories
        .filter((c) => ["murder", "contact", "sexual_offences", "burglary_home", "property"].includes(c.key))
        .map((c) => ({
          label: c.label,
          values: chosen.map((t) => {
            const v = avg(yearsInTerm(crime.years, t).map((fy) => crime.city_totals[c.key]?.[fy] ?? 0));
            return v == null ? null : Math.round(v);
          }),
          fmt: fmtInt,
          diff: "pct" as const,
        }))
    : [];
  const crimeYears = crime ? chosen.map((t) => `${t.label}: ${yearsInTerm(crime.years, t).join(", ") || "none yet"}`) : [];

  const budgetRows: Row[] = [
    {
      label: "Ward allocation budget, per year",
      values: chosen.map((t) => {
        const bs = data.allocations.filter((b) => b.ward_vintage === t.vintage);
        return avg(bs.map((b) => b.rows.reduce((s, r) => s + (r.amounts[b.budget_year] ?? 0), 0)));
      }),
      fmt: fmtRandShort,
      diff: "pct",
    },
  ];

  // The open ward, traced to each term's ward covering most of it.
  const wardCells = ward
    ? chosen.map((t) => {
        const env = data.electionWards.find((e) => e.year === t.year);
        if (!env) return null;
        const [main] = predecessors(ward, data.wards.ward_vintage, env, data.crosswalks);
        const row = main && env.rows.find((r) => r.ward_no === main.ward);
        return row ? { row, main } : null;
      })
    : [];
  const mainStation = ward ? crime?.rows.find((r) => r.ward_no === ward)?.precincts[0]?.station : undefined;
  const station = mainStation ? crime?.stations.find((s) => s.station === mainStation) : undefined;

  return (
    <article class="panel-body" aria-labelledby="compare-terms-title">
      <header class="panel-head">
        <div>
          <h2 id="compare-terms-title">Compare terms</h2>
          <p class="panel-sub">{ward ? `Cape Town and ward ${ward}` : "Cape Town"}</p>
        </div>
        <button type="button" class="icon-btn" onClick={onClose} aria-label="Close comparison">
          ×
        </button>
      </header>

      <fieldset class="compare-pick">
        <legend>Terms to compare</legend>
        {terms.map((t) => (
          <label key={t.year}>
            <input type="checkbox" checked={selected.includes(t.year)} onChange={() => toggle(t.year)} /> {t.label}
          </label>
        ))}
      </fieldset>

      {chosen.length === 0 ? (
        <p class="lede">Select at least one term.</p>
      ) : (
        <>
          <Table
            title="City council"
            terms={chosen}
            rows={[
              {
                label: "Council seats",
                values: councils.map((m) => m?.seats_total ?? null),
                fmt: fmtInt,
                diff: "count",
              },
              {
                label: "Turnout",
                values: councils.map((m) => m?.turnout ?? null),
                fmt: (v) => fmtPct(v * 100),
                diff: "points",
              },
              ...parties.slice(0, 10).map((p) => ({
                label: (
                  <a class="party-link" href={partyHref(p)}>
                    {p}
                  </a>
                ),
                values: councils.map((m) => (m ? (m.parties.find((x) => x.party === p)?.seats ?? 0) : null)),
                fmt: fmtInt,
                diff: "count" as const,
              })),
            ]}
            foot="Seats as allocated after each election, which starts the term."
          />

          {crime && (
            <Table
              title="Reported crime, city-wide (yearly average)"
              terms={chosen}
              rows={crimeRows}
              foot={`Financial years counted in the term in which they end: ${crimeYears.join("; ")}. SAPS figures for all City of Cape Town stations.`}
            />
          )}

          <Table
            title="Ward budgets"
            terms={chosen}
            rows={budgetRows}
            foot="Only budget years whose annexure has been parsed are included."
          />

          {ward && (
            <Table
              title={station ? `Ward ${ward}'s area (crime: ${station.station} precinct)` : `Ward ${ward}'s area`}
              terms={chosen}
              rows={[
                {
                  label: "Winner's share of the ward vote",
                  values: wardCells.map((c) => c?.row.parties[0]?.share ?? null),
                  fmt: (v) => fmtPct(v * 100),
                  diff: "points",
                },
                {
                  label: "Turnout",
                  values: wardCells.map((c) => c?.row.turnout ?? null),
                  fmt: (v) => fmtPct(v * 100),
                  diff: "points",
                },
                ...(station
                  ? ["murder", "contact", "burglary_home"].map((k) => ({
                      label: `${crime!.categories.find((c) => c.key === k)?.label} per year`,
                      values: chosen.map((t) => {
                        const v = avg(yearsInTerm(crime!.years, t).map((fy) => station.counts[k]?.[fy] ?? 0));
                        return v == null ? null : Math.round(v);
                      }),
                      fmt: fmtInt,
                      diff: "pct" as const,
                    }))
                  : []),
              ]}
              foot={
                <>
                  {wardCells.map((c, i) =>
                    c ? (
                      <span key={i}>
                        {chosen[i]!.label}: won by {c.row.councillor ? `${c.row.councillor} (${c.row.winner})` : c.row.winner}
                        {c.main.ward !== ward || chosen[i]!.vintage !== data.wards.ward_vintage
                          ? `, in ward ${c.main.ward} of the ${chosen[i]!.vintage} boundaries (${Math.round(c.main.share * 100)}% of today's ward)`
                          : ""}
                        .{" "}
                      </span>
                    ) : null,
                  )}
                </>
              }
            />
          )}
        </>
      )}
    </article>
  );
}
