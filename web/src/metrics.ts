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
  | "turnout";

export interface Metric {
  key: MetricKey;
  topic: string;
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
  build: (d: AppData) => Pick<Metric, "env" | "field" | "values" | "city">;
}

const sr = (field: "pct_closed_30d" | "median_days" | "pct_no_completion" | "per_1000" | "pct_located") =>
  (d: AppData) => ({
    env: d.serviceRequests,
    field,
    values: new Map(d.serviceRequests.rows.map((r) => [r.ward_no, r[field] ?? null])),
    city: d.serviceRequests.citywide[field] ?? null,
  });

const outage = (field: "water_days" | "power_days") => (d: AppData) => ({
  env: d.outages,
  field,
  values: new Map(d.outages.rows.map((r) => [r.ward_no, r[field]])),
  city: null,
});

/** Latest ward-ballot results fought on the wards the map shows (none until such an election). */
export function currentElectionWards(d: AppData) {
  return d.electionWards.find((e) => e.ward_vintage === d.wards.ward_vintage) ?? null;
}

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
    reading: "Share of registered voters who cast a ward ballot in the latest local election.",
    nullLabel: "No data",
    build: (d) => {
      const e = currentElectionWards(d);
      return {
        env: e ?? d.wards,
        field: e ? "turnout" : "population",
        values: new Map(e ? e.rows.map((r) => [r.ward_no, r.turnout]) : []),
        city: null,
      };
    },
  },
};

export const METRIC_KEYS = Object.keys(DEFS) as MetricKey[];
export const DEFAULT_METRIC: MetricKey = "pct_closed_30d";
export const isMetric = (k: string): k is MetricKey => k in DEFS;

export function buildMetrics(d: AppData): Record<MetricKey, Metric> {
  return Object.fromEntries(
    METRIC_KEYS.map((key) => [key, {
        key,
        topic: DEFS[key].topic,
        reading: DEFS[key].reading,
        nullLabel: DEFS[key].nullLabel ?? "Not enough data",
        ...DEFS[key].build(d),
      }]),
  ) as Record<MetricKey, Metric>;
}

/** Metric keys grouped by topic, in display order. */
export function topics(): [string, MetricKey[]][] {
  const out = new Map<string, MetricKey[]>();
  for (const k of METRIC_KEYS) out.set(DEFS[k].topic, [...(out.get(DEFS[k].topic) ?? []), k]);
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
