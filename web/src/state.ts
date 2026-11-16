// App state lives in the URL hash (#ward=57&metric=median_days, #view=city, #layers=police, #term=2021): shareable links, working back
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
  /** Council term, by the election that started it (#term=2021). Null = the current term. */
  term: number | null;
  /** Party profile open (#party=Democratic Alliance). */
  party: string | null;
  /** Terms being compared, by election year (#compare=2021,2026); empty = not comparing. */
  compare: number[];
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
    term: /^\d{4}$/.test(p.get("term") ?? "") ? Number(p.get("term")) : null,
    party: p.get("party")?.slice(0, 120) || null,
    compare: (p.get("compare") ?? "").split(",").filter((x) => /^\d{4}$/.test(x)).map(Number),
  };
}

export function toHash(s: AppState): string {
  const p = new URLSearchParams();
  if (s.ward) p.set("ward", String(s.ward));
  if (s.metric !== DEFAULT_METRIC) p.set("metric", s.metric);
  if (s.city && !s.ward) p.set("view", "city");
  if (s.layers.length) p.set("layers", [...new Set(s.layers)].join(","));
  if (s.term) p.set("term", String(s.term));
  if (s.party) p.set("party", s.party);
  if (s.compare.length) p.set("compare", s.compare.join(","));
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

/** Link that opens a party's panel, keeping the rest of the current view. */
export function partyHref(party: string): string {
  return toHash({ ...parseHash(location.hash), party });
}
