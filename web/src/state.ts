// App state lives in the URL hash (#ward=57&metric=median_days, #view=city, #layers=police): shareable links, working back
// button, and no state library.
import { useEffect, useState } from "preact/hooks";
import { DEFAULT_METRIC, isMetric, type MetricKey } from "./metrics";

export interface AppState {
  ward: number | null;
  metric: MetricKey;
  /** City overview open (when no ward is selected). */
  city: boolean;
  /** Place categories shown on the map (#layers=police,clinics). */
  layers: string[];
}

export function parseHash(hash: string): AppState {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const ward = Number(p.get("ward"));
  const metric = p.get("metric") ?? "";
  return {
    ward: Number.isInteger(ward) && ward > 0 ? ward : null,
    metric: isMetric(metric) ? metric : DEFAULT_METRIC,
    city: p.get("view") === "city",
    layers: (p.get("layers") ?? "").split(",").filter((l) => /^[a-z_]+$/.test(l)),
  };
}

export function toHash(s: AppState): string {
  const p = new URLSearchParams();
  if (s.ward) p.set("ward", String(s.ward));
  if (s.metric !== DEFAULT_METRIC) p.set("metric", s.metric);
  if (s.city && !s.ward) p.set("view", "city");
  if (s.layers.length) p.set("layers", [...new Set(s.layers)].join(","));
  const str = p.toString();
  return str ? `#${str}` : "#";
}

export function useHashState(): [AppState, (patch: Partial<AppState>) => void] {
  const [state, setState] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onHash = () => setState(parseHash(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const update = (patch: Partial<AppState>) => {
    const next = { ...parseHash(location.hash), ...patch };
    if (toHash(next) !== (location.hash || "#")) location.hash = toHash(next);
  };
  return [state, update];
}
