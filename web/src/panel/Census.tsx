// Census 2011 employment and household services for a ward. Old figures, clearly dated: the
// most local employment data published. Today's wards get them by where residents live.
import type { AppData } from "../data";
import { fmtInt, fmtPct } from "../format";
import { Figure } from "./Figure";

const FIELDS = ["unemployment", "expanded_unemployment", "employment_ratio", "water_in_dwelling", "flush_toilet", "refuse_weekly"] as const;

export function WardCensus({ data, ward }: { data: AppData; ward: number }) {
  const env = data.census.find((c) => c.ward_vintage === data.wards.ward_vintage);
  const row = env?.rows.find((r) => r.ward_no === ward);
  if (!env || !row) return null;
  const moved = env.ward_vintage !== env.source_vintage;
  return (
    <section class="section" aria-labelledby="census-title">
      <h3 id="census-title">Jobs and services at the 2011 census</h3>
      <p class="lede">
        From Census 2011, the latest count published by ward, so these describe the area {new Date().getFullYear() - env.census_year}{" "}
        years ago. About {fmtInt(Math.round(row.population / 100) * 100)} people lived in this ward's area then.
        {moved && " The census was counted on older wards; its figures are split onto today's wards by where people live now."}
      </p>
      <dl class="figures">
        {FIELDS.map((f) => (
          <Figure
            key={f}
            env={env}
            field={f}
            value={row[f] ?? null}
            note={env.citywide[f] != null ? `City-wide: ${fmtPct(env.citywide[f]! * 100)}` : undefined}
          />
        ))}
      </dl>
    </section>
  );
}
