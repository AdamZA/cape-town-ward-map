// Quantile classes for the choropleth. Pure functions; unit-tested.

/** Five-step single-hue blue ramp (light -> dark); validated for CVD and contrast. */
export const RAMP = ["#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"] as const;
export const NO_DATA = "#d6d5d0";

export interface Scale {
  /** Lowest value of each class after the first (a value >= breaks[k] is in class k+1 or up). */
  breaks: number[];
  /** Class index (0..RAMP.length-1) for a value, or -1 for no data. */
  classOf: (v: number | null) => number;
  min: number;
  max: number;
}

/** Quantile breaks over the non-null values, de-duplicated (ties can merge classes). */
export function quantileScale(values: (number | null)[], classes = RAMP.length): Scale {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { breaks: [], classOf: () => -1, min: 0, max: 0 };
  const breaks: number[] = [];
  for (let i = 1; i < classes; i++) {
    const b = v[Math.min(v.length - 1, Math.floor((i * v.length) / classes))]!;
    // A break is the lowest value of the next class, so it must exceed the minimum and the
    // previous break (ties would otherwise create empty classes).
    if (b > v[0]! && (breaks.length === 0 || b > breaks[breaks.length - 1]!)) breaks.push(b);
  }
  // With fewer distinct breaks than classes, spread the classes we have across the ramp.
  const n = breaks.length + 1;
  const toRamp = (k: number) => (n === 1 ? RAMP.length - 1 : Math.round((k * (RAMP.length - 1)) / (n - 1)));
  return {
    breaks,
    min: v[0]!,
    max: v[v.length - 1]!,
    classOf: (x) => {
      if (x === null || !Number.isFinite(x)) return -1;
      let k = 0;
      while (k < breaks.length && x >= breaks[k]!) k++;
      return toRamp(k);
    },
  };
}

/** Legend entries: [colour, label] per class actually used. */
export function legendEntries(s: Scale, fmt: (v: number) => string): [string, string][] {
  if (s.breaks.length === 0 && s.max === s.min) return [[RAMP[RAMP.length - 1]!, fmt(s.max)]];
  const edges = [s.min, ...s.breaks, s.max];
  const out: [string, string][] = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const lo = edges[k]!;
    const hi = edges[k + 1]!;
    const last = k === edges.length - 2;
    out.push([RAMP[s.classOf(lo)]!, last ? `${fmt(lo)} to ${fmt(hi)}` : `${fmt(lo)} to under ${fmt(hi)}`]);
  }
  return out;
}
