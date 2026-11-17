// Turns a metric into ward colours and a legend, in the viewer's chosen colour scheme.
import { partyColour } from "../elections/partyColours";
import { fmtUnit } from "../format";
import type { Metric } from "../metrics";
import { categoricalPaint, divergingLegend, divergingScale, legendEntries, type Paint, quantileScale, type SchemeKey, schemeColours } from "./scales";

export function paintMetric(m: Metric, scheme: SchemeKey, dark = false): Paint {
  const { ramp, diverging } = schemeColours(scheme, dark);
  if (m.kind === "categorical" && m.category) return categoricalPaint(m.category, (p) => partyColour(p, dark));
  const values = [...m.values.values()];
  if (m.kind === "diverging") {
    const s = divergingScale(values);
    const colours = new Map<number, string>();
    for (const [w, v] of m.values) if (s.classOf(v) >= 0) colours.set(w, diverging[s.classOf(v)]!);
    // Legend sizes are unsigned ("Up 3.0 pts"): the words carry the direction.
    const size = (v: number) => (m.unit === "points" ? fmtUnit(v, "pts") : fmtUnit(v, m.unit));
    return { colours, legend: divergingLegend(s, size, diverging) };
  }
  const s = quantileScale(values);
  const colours = new Map<number, string>();
  for (const [w, v] of m.values) if (s.classOf(v) >= 0) colours.set(w, ramp[s.classOf(v)]!);
  return { colours, legend: legendEntries(s, (v) => fmtUnit(v, m.unit), ramp) };
}
