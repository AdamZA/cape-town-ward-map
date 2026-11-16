// App state lives in the URL hash (#ward=57&metric=median_days): shareable links, working back
// button, and no state library.
import { useEffect, useState } from "preact/hooks";
import { DEFAULT_METRIC, METRICS, type MetricKey } from "./metrics";

export interface AppState {
  ward: number | null;
  metric: MetricKey;
}

export function parseHash(hash: string): AppState {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const ward = Number(p.get("ward"));
  const metric = p.get("metric") as MetricKey | null;
  return {
    ward: Number.isInteger(ward) && ward > 0 ? ward : null,
    metric: metric && metric in METRICS ? metric : DEFAULT_METRIC,
  };
}

export function toHash(s: AppState): string {
  const p = new URLSearchParams();
  if (s.ward) p.set("ward", String(s.ward));
  if (s.metric !== DEFAULT_METRIC) p.set("metric", s.metric);
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
