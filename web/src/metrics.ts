// Everything the map can be coloured by, grouped by topic. Each metric reads one field of one
// published envelope, so labels, units and sources always come from the data. Colour is a
// neutral single-hue ramp: darker = higher value, never "good" or "bad" (METHODOLOGY.md#colour).
//
// To add a topic (elections, crime, ...): load its envelope in data.ts and add entries here.
import type { AppData } from "./data";
import type { Provenance } from "./panel/Figure";

export type MetricKey =
  | "pct_closed_30d"
  | "median_days"
  | "pct_no_completion"
  | "per_1000"
  | "pct_located"
  | "water_days"
  | "power_days"
  | "turnout"
  | "winner_share"
  | "allocation_total"
  | "murder_rate"
  | "contact_rate"
  | "burglary_rate";

/** A council term, named by the election that started it. */
export interface Term {
  year: number;
  /** Ward boundaries the term's election was fought on. */
  vintage: number;
  /** Year of the next election, or null for the current term. */
  next: number | null;
  current: boolean;
  label: string;
}

/** Terms from the published elections, oldest first. */
export function terms(d: { elections: { year: number; ward_vintage: number }[] }): Term[] {
  const es = [...d.elections].sort((a, b) => a.year - b.year);
  return es.map((e, i) => {
    const next = es[i + 1]?.year ?? null;
    return { year: e.year, vintage: e.ward_vintage, next, current: next == null, label: `${e.year} to ${next ?? "now"}` };
  });
}

export interface Metric {
  key: MetricKey;
  topic: string;
  label: string;
  unit: string | null;
  env: Provenance & { period?: { from: string; to: string } | null };
  field: string;
  /** Short hint shown under the legend so the ramp is read correctly. */
  reading: string;
  /** Value per ward (null = not enough data). */
  values: Map<number, number | null>;
  /** City-wide value, when one is meaningful. */
  city: number | null;
  /** What a missing value means, for the legend and summary. */
  nullLabel: string;
}

interface Def {
  topic: string;
  reading: string;
  nullLabel?: string;
  /** Label and unit, when not the field's own. */
  label?: string;
  unit?: string;
  /** Null when the metric doesn't exist for this term. */
  build: (d: AppData, t: Term) => Pick<Metric, "env" | "field" | "values" | "city"> | null;
}

const sr = (field: "pct_closed_30d" | "median_days" | "pct_no_completion" | "per_1000" | "pct_located") =>
  (d: AppData, t: Term) => !t.current ? null : ({
    env: d.serviceRequests,
    field,
    values: new Map(d.serviceRequests.rows.map((r) => [r.ward_no, r[field] ?? null])),
    city: d.serviceRequests.citywide[field] ?? null,
  });

const outage = (field: "water_days" | "power_days") => (d: AppData, t: Term) => !t.current ? null : ({
  env: d.outages,
  field,
  values: new Map(d.outages.rows.map((r) => [r.ward_no, r[field]])),
  city: null,
});

/** Ward-ballot results of the election that started this term. */
export function termElectionWards(d: AppData, t: Term) {
  return d.electionWards.find((e) => e.year === t.year) ?? null;
}

/** A crime rate for the ward's covering precinct(s); current wards only. */
const crime = (key: string) => (d: AppData, t: Term) => {
  const c = d.crime;
  if (!c || !t.current) return null;
  return { env: c, field: "rates", values: new Map(c.rows.map((r) => [r.ward_no, r.rates[key] ?? null])), city: null };
};

const SERVICE = "Service requests";
const SUPPLY = "Water and electricity";

const DEFS: Record<MetricKey, Def> = {
  pct_closed_30d: {
    topic: SERVICE,
    reading: "Share of requests resolved within 30 days of being logged.",
    build: sr("pct_closed_30d"),
  },
  median_days: {
    topic: SERVICE,
    reading: "Half of requests were resolved within this many days.",
    build: sr("median_days"),
  },
  pct_no_completion: {
    topic: SERVICE,
    reading: "Share of requests with no completion date recorded after at least 90 days.",
    build: sr("pct_no_completion"),
  },
  per_1000: {
    topic: SERVICE,
    reading: "Requests per 1 000 residents a year. Reflects reporting as well as problems.",
    build: sr("per_1000"),
  },
  pct_located: {
    topic: SERVICE,
    reading: "Share of requests that could be placed on the map. Where low, other figures cover only part of the ward.",
    build: sr("pct_located"),
  },
  water_days: {
    topic: SUPPLY,
    reading: "Days in the past year when several residents reported having no water.",
    build: outage("water_days"),
  },
  power_days: {
    topic: SUPPLY,
    reading: "Days in the past year when several residents reported no power to the City. Not shown where Eskom supplies most residents.",
    nullLabel: "Mostly supplied by Eskom (not covered)",
    build: outage("power_days"),
  },
  turnout: {
    topic: "Elections",
    reading: "Share of registered voters who cast a ward ballot in the election that started this term.",
    build: (d, t) => {
      const e = termElectionWards(d, t);
      return e && { env: e, field: "turnout", values: new Map(e.rows.map((r) => [r.ward_no, r.turnout])), city: null };
    },
  },
  winner_share: {
    topic: "Elections",
    label: "Winner's share of the ward vote",
    unit: "share",
    reading: "The winning candidate's share of valid ward-ballot votes. Darker means a less contested ward, not a better one.",
    build: (d, t) => {
      const e = termElectionWards(d, t);
      return e && { env: e, field: "parties", values: new Map(e.rows.map((r) => [r.ward_no, r.parties[0]?.share ?? null])), city: null };
    },
  },
  murder_rate: {
    topic: "Crime",
    label: "Murder per 100,000 (police precinct)",
    unit: "per 100,000",
    reading: "Murders reported at the police station(s) covering the ward, per 100,000 residents of those precincts, latest financial year. Not crimes inside the ward itself.",
    build: crime("murder"),
  },
  contact_rate: {
    topic: "Crime",
    label: "Violent crime per 100,000 (police precinct)",
    unit: "per 100,000",
    reading: "Contact crime (murder, assault, sexual offences, robbery) reported in the covering precinct(s), per 100,000 residents. Busy centres show high rates because visitors aren't counted as residents.",
    build: crime("contact"),
  },
  burglary_rate: {
    topic: "Crime",
    label: "Home burglary per 100,000 (police precinct)",
    unit: "per 100,000",
    reading: "Residential burglaries reported in the covering precinct(s), per 100,000 residents, latest financial year.",
    build: crime("burglary_home"),
  },
  allocation_total: {
    topic: "Ward budgets",
    label: "Ward allocation budget",
    unit: "R",
    reading: "Rand budgeted for projects listed under the ward in that year's budget annexure. Projects shared by several wards are not included.",
    build: (d, t) => {
      const b = d.allocations.find((a) => a.ward_vintage === t.vintage);
      if (!b) return null;
      const values = new Map<number, number | null>();
      for (const r of b.rows) if (r.ward_no != null) values.set(r.ward_no, (values.get(r.ward_no) ?? 0) + (r.amounts[b.budget_year] ?? 0));
      return { env: b, field: "amounts", values, city: null };
    },
  },
};

export const METRIC_KEYS = Object.keys(DEFS) as MetricKey[];
export const DEFAULT_METRIC: MetricKey = "pct_closed_30d";
export const isMetric = (k: string): k is MetricKey => k in DEFS;

export type Metrics = Partial<Record<MetricKey, Metric>>;

/** The metrics that exist for a term (service figures only on the current term's wards). */
export function buildMetrics(d: AppData, t: Term): Metrics {
  const out: Metrics = {};
  for (const key of METRIC_KEYS) {
    const def = DEFS[key];
    const built = def.build(d, t);
    if (!built) continue;
    const meta = built.env.fields[built.field];
    out[key] = {
      key,
      topic: def.topic,
      label: def.label ?? meta?.label ?? key,
      unit: def.unit ?? meta?.unit ?? null,
      reading: def.reading,
      nullLabel: def.nullLabel ?? "Not enough data",
      ...built,
    };
  }
  return out;
}

/** Available metric keys grouped by topic, in display order. */
export function topics(m: Metrics): [string, MetricKey[]][] {
  const out = new Map<string, MetricKey[]>();
  for (const k of METRIC_KEYS) if (m[k]) out.set(DEFS[k].topic, [...(out.get(DEFS[k].topic) ?? []), k]);
  return [...out];
}

/** Where a ward's value sits among all wards with data: how many are lower and higher. */
export function standing(values: Map<number, number | null>, ward: number) {
  const v = values.get(ward);
  const all = [...values.values()].filter((x): x is number => x != null);
  if (v == null) return null;
  return {
    lower: all.filter((x) => x < v).length,
    higher: all.filter((x) => x > v).length,
    n: all.length,
    median: median(all),
  };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
