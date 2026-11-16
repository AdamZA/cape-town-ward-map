// "At a glance": the handful of figures most people want first, each with where the ward sits
// among all wards. Wording is factual ("higher than in N wards"), never "better" or "worse".
import type { AppData } from "../data";
import { fmtInt, fmtRandShort, fmtUnit } from "../format";
import { type Metric, type MetricKey, standing } from "../metrics";
import { mainAllocation } from "./Allocations";
import { Strip } from "./Strip";

const GLANCE: MetricKey[] = ["pct_closed_30d", "median_days", "water_days", "power_days"];

export function Summary({ data, metrics, ward }: { data: AppData; metrics: Record<MetricKey, Metric>; ward: number }) {
  const w = data.wards.rows.find((r) => r.ward_no === ward)!;
  const budget = data.allocations[0];
  const alloc = budget ? mainAllocation(ward, data.wards.ward_vintage, budget, data.crosswalk) : null;
  const density = w.population != null ? w.population / w.area_km2 : null;
  const densities = data.wards.rows.filter((r) => r.population != null).map((r) => r.population! / r.area_km2);
  const denser = density != null ? densities.filter((d) => d > density).length : 0;
  const sr = data.serviceRequests.rows.find((r) => r.ward_no === ward);
  const lowLocation = sr?.flags.includes("low_location_coverage") && sr.pct_located != null;

  return (
    <section class="glance" aria-labelledby="glance-title">
      <h3 id="glance-title" class="visually-hidden">
        At a glance
      </h3>
      <p class="glance-lede">
        {w.population != null && (
          <>
            About <strong>{fmtInt(w.population)}</strong> residents (estimate) on {fmtUnit(w.area_km2, "km²")}
            {density != null && <> — {densityWord(denser, densities.length)}</>}.{" "}
          </>
        )}
        {alloc && budget && (
          <>
            {alloc.sameVintage ? "This ward" : `Old ward ${alloc.ward}, which covers ${Math.round(alloc.share * 100)}% of it,`} had{" "}
            <strong>{fmtRandShort(alloc.total)}</strong> for {alloc.projects} ward allocation project{alloc.projects === 1 ? "" : "s"} in{" "}
            {budget.budget_year}.
          </>
        )}
      </p>
      <ul class="glance-rows">
        {GLANCE.map((k) => (
          <GlanceRow key={k} metric={metrics[k]} ward={ward} censored={k === "median_days" && !!data.serviceRequests.rows.find((r) => r.ward_no === ward)?.median_censored} />
        ))}
      </ul>
      {lowLocation && (
        <p class="glance-warn" role="note">
          Only about {Math.round(sr!.pct_located!)}% of requests from this ward have a usable location, so these counts
          are likely understated.
        </p>
      )}
      <p class="glance-key">
        <span class="key-this" /> this ward <span class="key-dot" /> other wards <span class="key-ref" /> city-wide (or median ward)
      </p>
    </section>
  );
}

function GlanceRow({ metric, ward, censored }: { metric: Metric; ward: number; censored: boolean }) {
  const meta = metric.env.fields[metric.field]!;
  const v = metric.values.get(ward) ?? null;
  const st = standing(metric.values, ward);
  return (
    <li class="glance-row">
      <span class="glance-label">{meta.label}</span>
      {v == null || !st ? (
        <span class="glance-value no-data">{metric.nullLabel}</span>
      ) : (
        <>
          <span class="glance-value">
            {censored ? "over " : ""}
            {fmtUnit(v, meta.unit)}
          </span>
          <Strip values={[...metric.values.values()]} value={v} city={metric.city} label={`${meta.label}: ${fmtUnit(v, meta.unit)}`} />
          <span class="glance-rank">{rankText(st)}</span>
        </>
      )}
    </li>
  );
}

function rankText(s: { lower: number; higher: number; n: number }): string {
  const others = s.n - 1;
  const tied = others - s.lower - s.higher;
  if (s.higher === 0) return tied ? `Highest, shared with ${tied} other ward${tied > 1 ? "s" : ""}` : `Highest of ${s.n} wards`;
  if (s.lower === 0) return tied ? `Lowest, shared with ${tied} other ward${tied > 1 ? "s" : ""}` : `Lowest of ${s.n} wards`;
  return s.lower >= s.higher ? `Higher than ${s.lower} of ${others} other wards` : `Lower than ${s.higher} of ${others} other wards`;
}

function densityWord(denser: number, n: number): string {
  const q = denser / n;
  if (q < 0.2) return "one of the most densely populated wards";
  if (q > 0.8) return "one of the least densely populated wards";
  return "mid-range population density";
}
