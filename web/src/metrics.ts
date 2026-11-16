// The map metrics. Labels and units come from the data's `fields`; this only says which fields
// are mappable and how to read them. Colour is a neutral single-hue ramp: darker = higher value,
// never "good" or "bad" (see METHODOLOGY.md#colour).
import type { ServiceRequestRow } from "./generated/service_requests";

export type MetricKey =
  | "pct_closed_30d"
  | "median_days"
  | "per_1000"
  | "pct_no_completion"
  | "pct_located";

export interface MetricDef {
  key: MetricKey;
  /** Short hint shown under the legend so the ramp is read correctly. */
  reading: string;
  value: (r: ServiceRequestRow) => number | null;
}

export const METRICS: Record<MetricKey, MetricDef> = {
  pct_closed_30d: {
    key: "pct_closed_30d",
    reading: "Share of requests resolved within 30 days of being logged.",
    value: (r) => r.pct_closed_30d ?? null,
  },
  median_days: {
    key: "median_days",
    reading: "Half of requests were resolved within this many days.",
    value: (r) => r.median_days ?? null,
  },
  per_1000: {
    key: "per_1000",
    reading:
      "Requests logged per 1,000 residents in a year. Reflects reporting as well as problems; not a measure of performance.",
    value: (r) => r.per_1000 ?? null,
  },
  pct_no_completion: {
    key: "pct_no_completion",
    reading: "Share of requests with no completion date recorded after at least 90 days.",
    value: (r) => r.pct_no_completion ?? null,
  },
  pct_located: {
    key: "pct_located",
    reading: "Estimated share of requests that could be placed on the map. Low values mean the other figures cover only part of the ward.",
    value: (r) => r.pct_located ?? null,
  },
};

export const DEFAULT_METRIC: MetricKey = "pct_closed_30d";
export const METRIC_ORDER: MetricKey[] = [
  "pct_closed_30d",
  "median_days",
  "pct_no_completion",
  "per_1000",
  "pct_located",
];
