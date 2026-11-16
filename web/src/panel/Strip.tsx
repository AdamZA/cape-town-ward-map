// A one-line dot strip: every ward as a faint dot, this ward as a large dark dot, and the
// city-wide value as a tick. Shows where a ward sits at a glance without implying good or bad.
import { median } from "../metrics";

interface Props {
  values: (number | null)[];
  value: number;
  city?: number | null;
  label: string;
}

export function Strip({ values, value, city, label }: Props) {
  const xs = values.filter((v): v is number => v != null);
  const lo = Math.min(...xs, value);
  const hi = Math.max(...xs, value);
  const pos = (v: number) => (hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100);
  const ref = city ?? median(xs);
  return (
    <div class="strip" role="img" aria-label={label}>
      <span class="strip-axis" />
      {xs.map((v, i) => (
        <span key={i} class="strip-dot" style={{ left: `${pos(v)}%` }} />
      ))}
      <span class="strip-ref" style={{ left: `${pos(ref)}%` }} title={city != null ? "City-wide" : "Median ward"} />
      <span class="strip-this" style={{ left: `${pos(value)}%` }} />
    </div>
  );
}
