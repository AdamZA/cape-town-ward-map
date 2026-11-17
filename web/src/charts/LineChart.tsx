// A small line chart for change over time: one y axis, 2px lines, 8px markers, a recessive
// grid, a legend whenever there are two or more series, direct end labels for up to four, a
// crosshair tooltip on hover or keyboard focus, and the same numbers as a table on request.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

export interface Series {
  key: string;
  label: string;
  /** Short name for end labels (falls back to label). */
  short?: string;
  colour: string;
  values: (number | null)[];
}

interface Props {
  title: string;
  /** One-line description for screen readers. */
  desc: string;
  x: string[];
  series: Series[];
  fmt: (v: number) => string;
  /** Short tick format (defaults to fmt). */
  tick?: (v: number) => string;
  /** Start the y axis at zero (counts and shares). Default true. */
  zero?: boolean;
  compact?: boolean;
  /** Full width but low (a single, simple series). */
  short?: boolean;
  /** Leave out the chart's own table toggle (a group of charts shares one). */
  noTable?: boolean;
  foot?: ComponentChildren;
}

const DIRECT_LABELS_MAX = 4;

/** 3 to 5 round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1]! < hi) out.push(out[out.length - 1]! + step);
  return out;
}

/** Spread label positions apart (at least `gap` px), keeping their order. */
export function spreadLabels(ys: number[], gap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(ys.length);
  let prev = -Infinity;
  for (const [y, i] of order) {
    const v = Math.max(y, prev + gap, min);
    out[i] = v;
    prev = v;
  }
  // If pushed past the bottom, shift the stack back up.
  const over = Math.max(0, prev - max);
  return out.map((v) => v - over);
}

export function LineChart({ title, desc, x, series, fmt, tick = fmt, zero = true, compact = false, short = false, noTable = false, foot }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const labelled = series.length <= DIRECT_LABELS_MAX;
  // Drawn at about the size it's shown, so text stays readable.
  const W = compact ? 230 : 400;
  const H = compact ? 120 : short ? 120 : 190;
  const m = { top: 10, right: labelled ? (compact && series.length === 1 ? 40 : 74) : 12, bottom: 22, left: 40 };
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const lo = zero ? Math.min(0, ...all) : Math.min(...all);
  const hi = Math.max(...all, lo + 1e-9);
  const ticks = niceTicks(lo, hi, compact ? 2 : 4);
  const y0 = ticks[0]!;
  const y1 = ticks[ticks.length - 1]!;
  const px = (i: number) => m.left + (x.length === 1 ? (W - m.left - m.right) / 2 : (i * (W - m.left - m.right)) / (x.length - 1));
  const py = (v: number) => m.top + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.top - m.bottom);
  const lastIdx = (s: Series) => s.values.reduce<number>((k, v, i) => (v != null ? i : k), -1);
  const ends = labelled ? spreadLabels(series.map((s) => py(s.values[lastIdx(s)] ?? y0)), 12, m.top + 4, H - m.bottom) : [];
  const band = x.length > 1 ? (W - m.left - m.right) / (x.length - 1) : W - m.left - m.right;
  const tipLeft = hover == null ? 0 : (px(hover) / W) * 100;

  if (all.length === 0) return null;
  return (
    <figure class={`chart ${compact ? "chart-compact" : ""}`}>
      <figcaption class="chart-head">
        <span class="chart-title">{title}</span>
        {!noTable && (
          <button type="button" class="link-btn chart-toggle" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
            {asTable ? "Show chart" : "Show table"}
          </button>
        )}
      </figcaption>
      {series.length >= 2 && !asTable && (
        <ul class="chart-legend">
          {series.map((s) => (
            <li key={s.key}>
              <span class="chart-key" style={{ background: s.colour }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {asTable ? (
        <div class="table-scroll">
          <table class="compare-table">
            <thead>
              <tr>
                <th scope="col" />
                {x.map((l) => (
                  <th key={l} scope="col" class="num">
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.key}>
                  <th scope="row">{s.label}</th>
                  {s.values.map((v, i) => (
                    <td key={i} class="num">
                      {v == null ? "–" : fmt(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="chart-plot" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${desc}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line class={t === 0 ? "chart-base" : "chart-grid"} x1={m.left} x2={W - m.right} y1={py(t)} y2={py(t)} />
                <text class="chart-tick" x={m.left - 6} y={py(t)} dy="0.32em" text-anchor="end">
                  {tick(t)}
                </text>
              </g>
            ))}
            {x.map((l, i) => (compact && i > 0 && i < x.length - 1) ? null : (
              <text key={l} class="chart-tick" x={px(i)} y={H - 6} text-anchor={x.length > 1 && i === 0 ? "start" : x.length > 1 && i === x.length - 1 ? "end" : "middle"}>
                {l}
              </text>
            ))}
            {hover != null && <line class="chart-cross" x1={px(hover)} x2={px(hover)} y1={m.top} y2={H - m.bottom} />}
            {series.map((s) => {
              // Break the line at gaps rather than bridging them.
              const runs: [number, number][][] = [[]];
              s.values.forEach((v, i) => (v == null ? runs.push([]) : runs[runs.length - 1]!.push([px(i), py(v)])));
              return (
                <g key={s.key}>
                  {runs
                    .filter((r) => r.length > 1)
                    .map((r, k) => (
                      <polyline key={k} class="chart-line" points={r.map((p) => p.join(",")).join(" ")} style={{ stroke: s.colour }} />
                    ))}
                  {s.values.map((v, i) =>
                    v == null ? null : <circle key={i} class="chart-dot" cx={px(i)} cy={py(v)} r={hover === i ? 5 : 4} style={{ fill: s.colour }} />,
                  )}
                </g>
              );
            })}
            {labelled &&
              series.map((s, k) => {
                const i = lastIdx(s);
                if (i < 0) return null;
                return (
                  <text key={s.key} class="chart-end" x={px(i) + 8} y={ends[k]} dy="0.32em">
                    {series.length > 1 ? `${s.short ?? s.label} ` : ""}
                    <tspan class="chart-end-value">{fmt(s.values[i]!)}</tspan>
                  </text>
                );
              })}
            {x.map((l, i) => (
              <rect
                key={l}
                class="chart-hit"
                x={px(i) - band / 2}
                y={0}
                width={band}
                height={H}
                tabIndex={0}
                aria-label={`${l}: ${series.map((s) => `${s.label} ${s.values[i] == null ? "no data" : fmt(s.values[i]!)}`).join(", ")}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </svg>
          {hover != null && (
            <div class={`chart-tip ${tipLeft > 60 ? "chart-tip-left" : ""}`} style={{ left: `${tipLeft}%` }} role="status">
              <strong>{x[hover]}</strong>
              {[...series]
                .sort((a, b) => (b.values[hover] ?? -Infinity) - (a.values[hover] ?? -Infinity))
                .map((s) => (
                  <span key={s.key}>
                    <span class="chart-key" style={{ background: s.colour }} />
                    {s.label}: {s.values[hover] == null ? "no data" : fmt(s.values[hover]!)}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}
      {foot && <p class="source">{foot}</p>}
    </figure>
  );
}

interface MultiProps {
  /** One chart per entry, each a single series on its own scale. */
  charts: { key: string; title: string; values: (number | null)[] }[];
  x: string[];
  fmt: (v: number) => string;
  /** What each chart shows, for screen readers ("reported at Rondebosch per financial year"). */
  desc: string;
  colour?: string;
  foot?: ComponentChildren;
}

/** Small multiples: a grid of compact single-series charts with one shared table view. */
export function SmallMultiples({ charts, x, fmt, desc, colour = "var(--ink-2)", foot }: MultiProps) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div class="multiples">
      <button type="button" class="link-btn chart-toggle multiples-toggle" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
        {asTable ? "Show charts" : "Show table"}
      </button>
      {asTable ? (
        <div class="table-scroll">
          <table class="compare-table">
            <thead>
              <tr>
                <th scope="col" />
                {x.map((l) => (
                  <th key={l} scope="col" class="num">
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {charts.map((c) => (
                <tr key={c.key}>
                  <th scope="row">{c.title}</th>
                  {c.values.map((v, i) => (
                    <td key={i} class="num">
                      {v == null ? "–" : fmt(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="chart-multiples">
          {charts.map((c) => (
            <LineChart key={c.key} title={c.title} desc={`${c.title} ${desc}`} x={x} series={[{ key: c.key, label: c.title, colour, values: c.values }]} fmt={fmt} compact noTable />
          ))}
        </div>
      )}
      {foot && <p class="source">{foot}</p>}
    </div>
  );
}
