// Colour scales for the choropleth. Pure functions; unit-tested.
//
// Three kinds, each with one rule (METHODOLOGY.md#colour):
// - sequential: one hue, light -> dark, quantile classes (magnitude);
// - diverging: two hues around a neutral grey, symmetric about zero (change up or down);
// - categorical: one fixed colour per category (a ward's winning party).
// Every ramp was checked with the dataviz palette validator: lightness steps, light end
// against the map, and the diverging arms under colour-vision deficiency. The dark theme has
// its own steps, checked against the dark map: there, low values sit close to the dark ground
// and high values are brightest, so the "faint = low" reading holds in both themes.

export type SchemeKey = "blue" | "green" | "purple" | "orange" | "grey";

const ORANGE_BLUE = ["#873d02", "#d38151", "#cdcbc3", "#639be1", "#0053a4"] as const;
const PURPLE_GREEN = ["#783288", "#b97fc6", "#cdcbc3", "#67aa76", "#00672d"] as const;
const ORANGE_BLUE_DARK = ["#ffa571", "#b56b3e", "#4a4945", "#5082c2", "#91c1ff"] as const;
const PURPLE_GREEN_DARK = ["#e59ff6", "#9e69aa", "#4a4945", "#4e925e", "#7cd591"] as const;

export interface Colours {
  /** Sequential, low -> high. */
  ramp: readonly string[];
  /** Diverging, most negative -> neutral -> most positive. */
  diverging: readonly string[];
}

export const SCHEMES: Record<SchemeKey, { label: string; light: Colours; dark: Colours }> = {
  blue: {
    label: "Blue",
    light: { ramp: ["#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"], diverging: ORANGE_BLUE },
    dark: { ramp: ["#0053a4", "#266ec3", "#438ae1", "#60a7ff", "#9dc7fe"], diverging: ORANGE_BLUE_DARK },
  },
  green: {
    label: "Green",
    light: { ramp: ["#43b474", "#1c985a", "#007742", "#005a31", "#003b1e"], diverging: PURPLE_GREEN },
    dark: { ramp: ["#036639", "#05844b", "#2ba162", "#4ebe7d", "#71df9c"], diverging: PURPLE_GREEN_DARK },
  },
  purple: {
    label: "Purple",
    light: { ramp: ["#a484f3", "#8968d4", "#6c4ab3", "#542e96", "#3b0976"], diverging: PURPLE_GREEN },
    dark: { ramp: ["#5e3d9e", "#7758bb", "#9174d9", "#ac8ff8", "#c8b7ff"], diverging: PURPLE_GREEN_DARK },
  },
  orange: {
    label: "Orange",
    light: { ramp: ["#e37c3a", "#c46016", "#9c4700", "#773501", "#502100"], diverging: ORANGE_BLUE },
    dark: { ramp: ["#873d02", "#ad5002", "#cf6924", "#ee8545", "#ffae81"], diverging: ORANGE_BLUE_DARK },
  },
  grey: {
    label: "Grey",
    light: { ramp: ["#9b9b9b", "#808080", "#636363", "#4a4a4a", "#303030"], diverging: ORANGE_BLUE },
    dark: { ramp: ["#555555", "#6f6f6f", "#898989", "#a4a4a4", "#c4c4c4"], diverging: ORANGE_BLUE_DARK },
  },
};
export const schemeColours = (k: SchemeKey, dark: boolean): Colours => SCHEMES[k][dark ? "dark" : "light"];
export const SCHEME_KEYS = Object.keys(SCHEMES) as SchemeKey[];
export const isScheme = (k: string): k is SchemeKey => k in SCHEMES;

/** The default ramp (blue), kept as the reference for tests and charts. */
export const RAMP = SCHEMES.blue.light.ramp;
export const NO_DATA = "#d6d5d0";

export interface Scale {
  /** Lowest value of each class after the first (a value >= breaks[k] is in class k+1 or up). */
  breaks: number[];
  /** Class index (0..4) for a value, or -1 for no data. */
  classOf: (v: number | null) => number;
  min: number;
  max: number;
}

const CLASSES = 5;

/** Quantile breaks over the non-null values, de-duplicated (ties can merge classes). */
export function quantileScale(values: (number | null)[], classes = CLASSES): Scale {
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
  const toRamp = (k: number) => (n === 1 ? CLASSES - 1 : Math.round((k * (CLASSES - 1)) / (n - 1)));
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
export function legendEntries(s: Scale, fmt: (v: number) => string, ramp: readonly string[] = RAMP): [string, string][] {
  if (s.breaks.length === 0 && s.max === s.min) return [[ramp[ramp.length - 1]!, fmt(s.max)]];
  const edges = [s.min, ...s.breaks, s.max];
  const out: [string, string][] = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const lo = edges[k]!;
    const hi = edges[k + 1]!;
    const last = k === edges.length - 2;
    out.push([ramp[s.classOf(lo)]!, last ? `${fmt(lo)} to ${fmt(hi)}` : `${fmt(lo)} to under ${fmt(hi)}`]);
  }
  return out;
}

/**
 * Diverging classes, symmetric about zero: a "little change" band in the middle and two steps
 * each way. The thresholds are the thirds of the absolute changes, so the classes follow the
 * spread of the data while keeping zero in the neutral middle.
 */
export interface DivergingScale {
  /** Changes smaller than this (either way) are "little change". */
  small: number;
  /** Changes at least this large (either way) take the darkest step. */
  large: number;
  classOf: (v: number | null) => number;
}

export function divergingScale(values: (number | null)[]): DivergingScale {
  const abs = values.filter((x): x is number => x !== null && Number.isFinite(x)).map(Math.abs).sort((a, b) => a - b);
  const q = (p: number) => abs[Math.min(abs.length - 1, Math.floor(p * abs.length))] ?? 0;
  const small = q(1 / 3);
  const large = Math.max(q(2 / 3), small);
  return {
    small,
    large,
    classOf: (x) => {
      if (x === null || !Number.isFinite(x)) return -1;
      if (Math.abs(x) < small || x === 0) return 2;
      if (x > 0) return x >= large && large > small ? 4 : 3;
      return -x >= large && large > small ? 0 : 1;
    },
  };
}

export function divergingLegend(s: DivergingScale, fmt: (v: number) => string, ramp: readonly string[], words = { up: "Up", down: "Down" }): [string, string][] {
  const out: [string, string][] = [];
  const split = s.large > s.small;
  if (split) out.push([ramp[4]!, `${words.up} ${fmt(s.large)} or more`]);
  out.push([ramp[3]!, split ? `${words.up} ${fmt(s.small)} to under ${fmt(s.large)}` : `${words.up} ${fmt(s.small)} or more`]);
  out.push([ramp[2]!, s.small > 0 ? `Less than ${fmt(s.small)} either way` : "No change"]);
  out.push([ramp[1]!, split ? `${words.down} ${fmt(s.small)} to under ${fmt(s.large)}` : `${words.down} ${fmt(s.small)} or more`]);
  if (split) out.push([ramp[0]!, `${words.down} ${fmt(s.large)} or more`]);
  return out;
}

export interface Paint {
  colours: Map<number, string>;
  legend: [string, string][];
}

/** Categorical paint: a fixed colour per category, legend ordered by ward count. */
export function categoricalPaint(cats: Map<number, string | null>, colourOf: (c: string) => string, labelOf: (c: string) => string = (c) => c): Paint {
  const colours = new Map<number, string>();
  const counts = new Map<string, number>();
  for (const [w, c] of cats) {
    if (c == null) continue;
    colours.set(w, colourOf(c));
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const legend = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c, n]): [string, string] => [colourOf(c), `${labelOf(c)} (${n} ${n === 1 ? "ward" : "wards"})`]);
  return { colours, legend };
}
