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
  | "winner_party"
  | "winner_share"
  | "margin"
  | "party_share"
  | "party_change"
  | "allocation_total"
  | "unemployment"
  | "expanded_unemployment"
  | "employment_ratio"
  | "water_in_dwelling"
  | "flush_toilet"
  | "refuse_weekly"
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

/** How a metric is coloured: magnitude, change either way, or one colour per category. */
export type MetricKind = "sequential" | "diverging" | "categorical";

export interface Metric {
  key: MetricKey;
  kind: MetricKind;
  /** Categorical metrics: each ward's category (e.g. the winning party). */
  category?: Map<number, string | null>;
  /** Listed in the city overview's ward table. */
  inTable: boolean;
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
  kind?: MetricKind;
  /** Left out of the city overview's ward table (categories, or one party's figures). */
  noTable?: boolean;
  reading: string;
  nullLabel?: string;
  /** Label and unit, when not the field's own. */
  label?: string;
  unit?: string;
  /** Null when the metric doesn't exist for this term. */
  build: (d: AppData, t: Term, o: Options) => (Pick<Metric, "env" | "field" | "values" | "city"> & Partial<Pick<Metric, "category" | "label" | "reading">>) | null;
}

/** Choices that change what a metric shows (the party for party maps). */
export interface Options {
  party: string | null;
}

/** Parties worth a party map in a term: at least 1% of the city's votes, largest first. */
export function mapParties(d: AppData, t: Term): string[] {
  const m = d.elections.find((e) => e.year === t.year)?.municipalities.find((x) => x.code === "CPT");
  return (m?.parties ?? []).filter((p) => p.share >= 0.01).map((p) => p.party);
}

/** The party a party map shows: the chosen one if it stood, else the largest. */
export function mapParty(d: AppData, t: Term, chosen: string | null): string | null {
  const ps = mapParties(d, t);
  return chosen && ps.includes(chosen) ? chosen : (ps[0] ?? null);
}

/** A party's share of a ward's party-ballot votes. Parties under 0.5% in a ward aren't listed: 0. */
export function prShare(parties: { party: string; share: number }[], party: string): number {
  return parties.find((p) => p.party === party)?.share ?? 0;
}

/** Previous-election figures are left out where under 80% of the ward's voters can be traced. */
export const MIN_PREVIOUS_COVERAGE = 0.8;

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

/** A Census 2011 figure, on whichever ward set the term uses (when it's published for it). */
const census = (field: "unemployment" | "expanded_unemployment" | "employment_ratio" | "water_in_dwelling" | "flush_toilet" | "refuse_weekly") =>
  (d: AppData, t: Term) => {
    const c = d.census.find((e) => e.ward_vintage === t.vintage);
    return c ? { env: c, field, values: new Map(c.rows.map((r) => [r.ward_no, r[field] ?? null])), city: c.citywide[field] ?? null } : null;
  };
const CENSUS = "Census 2011: jobs and services";

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
  winner_party: {
    topic: "Elections",
    kind: "categorical",
    noTable: true,
    label: "Winning party (ward councillor)",
    unit: "share",
    reading: "The party whose candidate won the ward seat in the election that started this term.",
    build: (d, t) => {
      const e = termElectionWards(d, t);
      return (
        e && {
          env: e,
          field: "parties",
          values: new Map(e.rows.map((r) => [r.ward_no, r.parties[0]?.share ?? null])),
          category: new Map(e.rows.map((r) => [r.ward_no, r.winner])),
          city: null,
        }
      );
    },
  },
  party_share: {
    topic: "Elections",
    noTable: true,
    unit: "share",
    reading: "",
    build: (d, t, o) => {
      const e = termElectionWards(d, t);
      const party = mapParty(d, t, o.party);
      if (!e || !party) return null;
      return {
        env: e,
        field: "parties",
        label: `Vote share: ${party}`,
        reading: `${party}'s share of each ward's party-ballot (PR) votes in ${t.year}. Wards where it got under 0.5% count as 0.`,
        values: new Map(e.rows.map((r) => [r.ward_no, prShare(r.pr_parties, party)])),
        city: d.elections.find((x) => x.year === t.year)?.municipalities.find((m) => m.code === "CPT")?.parties.find((p) => p.party === party)?.share ?? null,
      };
    },
  },
  party_change: {
    topic: "Elections",
    kind: "diverging",
    noTable: true,
    unit: "points",
    reading: "",
    build: (d, t, o) => {
      const e = termElectionWards(d, t);
      const party = mapParty(d, t, o.party);
      const prevYear = e?.rows.find((r) => r.previous)?.previous?.year;
      if (!e || !party || !prevYear) return null;
      return {
        env: e,
        field: "parties",
        label: `Change since ${prevYear}: ${party}`,
        reading: `Change in ${party}'s share of the party-ballot vote between ${prevYear} and ${t.year}, in percentage points. The ${prevYear} votes are added up over the same voting districts, so the area is the same. Left out where under 80% of the ward's voters can be traced back.`,
        values: new Map(
          e.rows.map((r) => [
            r.ward_no,
            r.previous && r.previous.coverage >= MIN_PREVIOUS_COVERAGE
              ? Math.round((prShare(r.pr_parties, party) - prShare(r.previous.parties, party)) * 1000) / 10
              : null,
          ]),
        ),
        city: null,
      };
    },
  },
  margin: {
    topic: "Elections",
    label: "Winning margin",
    unit: "pts",
    reading: "How far the winning candidate finished ahead of the runner-up, in percentage points of the ward vote. A stronger colour means a safer seat.",
    build: (d, t) => {
      const e = termElectionWards(d, t);
      return (
        e && {
          env: e,
          field: "parties",
          values: new Map(e.rows.map((r) => [r.ward_no, r.parties.length ? Math.round(((r.parties[0]?.share ?? 0) - (r.parties[1]?.share ?? 0)) * 1000) / 10 : null])),
          city: null,
        }
      );
    },
  },
  winner_share: {
    topic: "Elections",
    label: "Winner's share of the ward vote",
    unit: "share",
    reading: "The winning candidate's share of valid ward-ballot votes. A stronger colour means a less contested ward, not a better one.",
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
  unemployment: {
    topic: CENSUS,
    reading: "Unemployed as a share of people aged 15 to 64 who were working or looking for work, at the 2011 census. Fifteen years old: the most local figure published.",
    build: census("unemployment"),
  },
  expanded_unemployment: {
    topic: CENSUS,
    reading: "As unemployment, but also counting people who wanted work and had given up looking (2011 census).",
    build: census("expanded_unemployment"),
  },
  employment_ratio: {
    topic: CENSUS,
    reading: "Share of all people aged 15 to 64 with a job, including students, carers and retired people (2011 census).",
    build: census("employment_ratio"),
  },
  water_in_dwelling: {
    topic: CENSUS,
    reading: "Share of people in households with a tap inside the home, at the 2011 census. Much may have changed since.",
    build: census("water_in_dwelling"),
  },
  flush_toilet: {
    topic: CENSUS,
    reading: "Share of people in households with a flush toilet, at the 2011 census.",
    build: census("flush_toilet"),
  },
  refuse_weekly: {
    topic: CENSUS,
    reading: "Share of people in households whose refuse was removed at least weekly by the municipality, at the 2011 census.",
    build: census("refuse_weekly"),
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
export function buildMetrics(d: AppData, t: Term, o: Options = { party: null }): Metrics {
  const out: Metrics = {};
  for (const key of METRIC_KEYS) {
    const def = DEFS[key];
    const built = def.build(d, t, o);
    if (!built) continue;
    const meta = built.env.fields[built.field];
    out[key] = {
      key,
      kind: def.kind ?? "sequential",
      inTable: !def.noTable,
      topic: def.topic,
      unit: def.unit ?? meta?.unit ?? null,
      nullLabel: def.nullLabel ?? "Not enough data",
      ...built,
      label: built.label ?? def.label ?? meta?.label ?? key,
      reading: built.reading ?? def.reading,
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
