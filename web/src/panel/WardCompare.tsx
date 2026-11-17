// Two of today's wards side by side, with the median ward for reference: people and place,
// every ward figure on the map, the election and land use. Figures only; no colour says which
// ward is "better".
import type { ComponentChildren } from "preact";
import type { AppData } from "../data";
import { partyColour, partyShort } from "../elections/partyColours";
import { fmtInt, fmtPct, fmtUnit } from "../format";
import { METHODOLOGY_URL } from "./Figure";
import { median, type Metrics, METRIC_KEYS, prShare, standing, termElectionWards, type Term } from "../metrics";

interface Props {
  data: AppData;
  metrics: Metrics;
  term: Term;
  ward: number;
  /** The ward to compare with; 0 while one is being chosen. */
  other: number;
  dark: boolean;
  onOther: (ward: number) => void;
  onSwap: () => void;
  onClose: () => void;
}

interface Row {
  label: ComponentChildren;
  a: string | null;
  b: string | null;
  mid?: string | null;
  /** Small print under each value (rank among wards). */
  aNote?: string;
  bNote?: string;
}

function Rows({ title, rows, wards, midLabel = "Median ward" }: { title: string; rows: Row[]; wards: [number, number]; midLabel?: string | null }) {
  if (!rows.length) return null;
  return (
    <section class="section">
      <h3>{title}</h3>
      <div class="table-scroll">
        <table class="compare-table vs-table">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col" class="num">
                Ward {wards[0]}
              </th>
              <th scope="col" class="num">
                {wards[1] ? `Ward ${wards[1]}` : "–"}
              </th>
              {midLabel && (
                <th scope="col" class="num mid-col">
                  {midLabel}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <th scope="row">{r.label}</th>
                <td class="num">
                  {r.a ?? <span class="no-data">–</span>}
                  {r.aNote && <small>{r.aNote}</small>}
                </td>
                <td class="num">
                  {r.b ?? <span class="no-data">–</span>}
                  {r.bNote && <small>{r.bNote}</small>}
                </td>
                {midLabel && <td class="num mid-col">{r.mid ?? ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function WardCompare({ data, metrics, term, ward, other, dark, onOther, onSwap, onClose }: Props) {
  const wards = data.wards.rows;
  const wa = wards.find((w) => w.ward_no === ward);
  const wb = wards.find((w) => w.ward_no === other);
  const both: [number, number] = [ward, wb ? other : 0];
  const pop = (w: typeof wa) => w?.population ?? null;
  const dens = (w: typeof wa) => (w?.population && w.area_km2 ? w.population / w.area_km2 : null);
  const med = (f: (w: (typeof wards)[number]) => number | null) => {
    const xs = wards.map(f).filter((v): v is number => v != null);
    return xs.length ? median(xs) : null;
  };
  const rank = (values: Map<number, number | null>, w: number) => {
    const s = standing(values, w);
    return s ? `above ${s.lower} of ${s.n - 1}` : undefined;
  };

  const place: Row[] = [
    { label: "People (estimate)", a: pop(wa) != null ? fmtInt(pop(wa)!) : null, b: pop(wb) != null ? fmtInt(pop(wb)!) : null, mid: fmtInt(med((w) => w.population ?? null) ?? 0) },
    { label: "Area", a: wa ? fmtUnit(wa.area_km2, "km²") : null, b: wb ? fmtUnit(wb.area_km2, "km²") : null, mid: fmtUnit(med((w) => w.area_km2) ?? 0, "km²") },
    { label: "People per km²", a: dens(wa) != null ? fmtInt(dens(wa)!) : null, b: dens(wb) != null ? fmtInt(dens(wb)!) : null, mid: fmtInt(med(dens) ?? 0) },
  ];
  const councillor = (w: typeof wa) =>
    w?.councillor ? `${w.councillor.name}${w.councillor.party ? ` (${partyShort(w.councillor.party)})` : ""}` : "not recorded";

  // Every sequential ward figure the map can show, grouped by topic.
  const byTopic = new Map<string, Row[]>();
  for (const k of METRIC_KEYS) {
    const m = metrics[k];
    if (!m || !m.inTable || m.kind !== "sequential") continue;
    const all = [...m.values.values()].filter((v): v is number => v != null);
    const va = m.values.get(ward) ?? null;
    const vb = wb ? (m.values.get(other) ?? null) : null;
    const rows = byTopic.get(m.topic) ?? [];
    rows.push({
      label: m.label,
      a: va != null ? fmtUnit(va, m.unit) : null,
      b: vb != null ? fmtUnit(vb, m.unit) : null,
      mid: all.length ? fmtUnit(median(all), m.unit) : null,
      aNote: rank(m.values, ward),
      bNote: wb ? rank(m.values, other) : undefined,
    });
    byTopic.set(m.topic, rows);
  }

  // Party-list vote: the parties that matter in either ward.
  const env = termElectionWards(data, term);
  const ra = env?.rows.find((r) => r.ward_no === ward);
  const rb = env?.rows.find((r) => r.ward_no === other);
  const parties = [...new Set([...(ra?.pr_parties ?? []).slice(0, 4), ...(rb?.pr_parties ?? []).slice(0, 4)].filter((p) => p.share >= 0.03).map((p) => p.party))];
  const city = data.elections.find((e) => e.year === term.year)?.municipalities.find((m) => m.code === "CPT");
  const voteRows: Row[] = parties.map((p) => ({
    label: (
      <span class="party-key">
        <span class="chart-key" style={{ background: partyColour(p, dark) }} />
        {p}
      </span>
    ),
    a: ra ? fmtPct(prShare(ra.pr_parties, p) * 100) : null,
    b: rb ? fmtPct(prShare(rb.pr_parties, p) * 100) : null,
    mid: city?.parties.find((x) => x.party === p) ? fmtPct(city.parties.find((x) => x.party === p)!.share * 100) : null,
  }));

  // Land use: the largest uses in either ward.
  const lu = data.landUse;
  const la = lu.rows.find((r) => r.ward_no === ward);
  const lb = lu.rows.find((r) => r.ward_no === other);
  const groups = lu.groups
    .map((g) => ({ g, peak: Math.max(la?.shares[g.key] ?? 0, lb?.shares[g.key] ?? 0) }))
    .filter((x) => x.peak >= 0.05)
    .sort((a, b) => b.peak - a.peak)
    .slice(0, 6);
  const landRows: Row[] = groups.map(({ g }) => ({
    label: g.label,
    a: la ? fmtPct((la.shares[g.key] ?? 0) * 100) : null,
    b: lb ? fmtPct((lb.shares[g.key] ?? 0) * 100) : null,
  }));

  return (
    <article class="panel-body" aria-labelledby="vs-title">
      <header class="panel-head">
        <div>
          <h2 id="vs-title">{wb ? `Ward ${ward} and ward ${other}` : `Compare ward ${ward}`}</h2>
          <p class="panel-sub">Side by side, with the median ward for reference</p>
        </div>
        <button type="button" class="icon-btn" onClick={onClose} aria-label="Close ward comparison">
          ×
        </button>
      </header>

      <div class="vs-pick">
        <label for="vs-ward">Compare with</label>
        <select id="vs-ward" value={wb ? String(other) : ""} onChange={(e) => onOther(Number(e.currentTarget.value))}>
          <option value="" disabled>
            Choose a ward
          </option>
          {wards
            .filter((w) => w.ward_no !== ward)
            .map((w) => (
              <option key={w.ward_no} value={w.ward_no}>
                Ward {w.ward_no}
                {w.councillor ? `: ${w.councillor.name}` : ""}
              </option>
            ))}
        </select>
        {wb && (
          <button type="button" class="btn" onClick={onSwap}>
            Swap
          </button>
        )}
      </div>
      {wb ? (
        <ul class="vs-who">
          <li>
            <strong>Ward {ward}</strong>: councillor {councillor(wa)}
          </li>
          <li>
            <strong>Ward {other}</strong> (dashed outline on the map): councillor {councillor(wb)}
          </li>
        </ul>
      ) : (
        <p class="lede">Choose a ward here, or click one on the map.</p>
      )}

      <Rows title="People and place" rows={place} wards={both} />
      {[...byTopic].map(([topic, rows]) => (
        <Rows key={topic} title={topic} rows={rows} wards={both} />
      ))}
      {voteRows.length > 0 && <Rows title={`Party-list vote, ${term.year}`} rows={voteRows} wards={both} midLabel="Cape Town" />}
      {landRows.length > 0 && <Rows title="Land use (share of zoned land)" rows={landRows} wards={both} midLabel={null} />}
      <p class="source">
        Each figure comes from the same source as in the ward panel (
        <a href={METHODOLOGY_URL} target="_blank" rel="noopener">
          how the figures are made
        </a>
        ). "Above 80 of 117" means the ward's figure is higher than 80 of the other wards with a figure.
      </p>
    </article>
  );
}
