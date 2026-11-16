// Pure helpers for the place layers and the "what kind of place" line. Unit-tested.
import type { LandUseRow } from "../generated/land_use";
import type { LandmarkCategory, LandmarkGroup, LandmarkRow, LandmarksEnvelope } from "../generated/landmarks";

/** Category key -> category (label, group, source). */
export function categoryMap(env: LandmarksEnvelope): Map<string, LandmarkCategory> {
  return new Map(env.categories.map((c) => [c.key, c]));
}

/** Group key -> label. */
export function labelsOf(groups: LandmarkGroup[]): Record<string, string> {
  return Object.fromEntries(groups.map((g) => [g.key, g.label]));
}

export interface CategoryInfo {
  key: string;
  label: string;
  group: string;
  count: number;
}

/** Groups in display order, each with its categories (in display order) and city-wide counts. */
export function catalogue(env: LandmarksEnvelope): { key: string; label: string; categories: CategoryInfo[] }[] {
  const counts = new Map<string, number>();
  for (const r of env.rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  return env.groups
    .map(({ key, label }) => ({
      key,
      label,
      categories: env.categories
        .filter((c) => c.group === key)
        .map((c) => ({ key: c.key, label: c.label, group: key, count: counts.get(c.key) ?? 0 })),
    }))
    .filter((g) => g.categories.length);
}

/** A ward's places, grouped by category in display order. */
export function wardPlaces(env: LandmarksEnvelope, ward: number): [string, LandmarkRow[]][] {
  const by = new Map<string, LandmarkRow[]>(env.categories.map((c) => [c.key, []]));
  for (const r of env.rows) if (r.ward_no === ward) by.get(r.category)?.push(r);
  return [...by].filter(([, rows]) => rows.length);
}

const RESIDENTIAL = ["houses", "incremental_housing", "flats_group_housing"];

/**
 * One neutral line on what the land is zoned for, e.g. "Zoned mostly for houses (64%), with
 * parks and conservation (18%)". Says "zoned" because zoning is permission, not current use.
 */
export function characterLine(row: LandUseRow, labels: Record<string, string>): string | null {
  const shares = Object.entries(row.shares).filter(([, s]) => s > 0);
  if (!shares.length || row.zoned_km2 <= 0) return null;
  const residential = RESIDENTIAL.reduce((t, k) => t + (row.shares[k] ?? 0), 0);
  const ranked = shares.sort((a, b) => b[1] - a[1]);
  const name = (k: string) => lower(labels[k] ?? k);
  const pct = (s: number) => `${Math.round(s * 100)}%`;
  const [top, topShare] = ranked[0]!;
  const rest = ranked.slice(1).filter(([, s]) => s >= 0.12).slice(0, 2);
  const tail = rest.length ? `, with ${join(rest.map(([k, s]) => `${name(k)} (${pct(s)})`))}` : "";
  if (topShare >= 0.5) return `Zoned mostly for ${name(top)} (${pct(topShare)})${tail}.`;
  if (residential >= 0.5) {
    const kinds = ranked.filter(([k, s]) => RESIDENTIAL.includes(k) && s >= 0.05).map(([k, s]) => `${name(k)} ${pct(s)}`);
    const other = ranked.filter(([k, s]) => !RESIDENTIAL.includes(k) && s >= 0.12).slice(0, 2);
    const otherText = other.length ? `, with ${join(other.map(([k, s]) => `${name(k)} (${pct(s)})`))}` : "";
    return `Mostly residential (${pct(residential)}: ${join(kinds)})${otherText}.`;
  }
  return `A mix: ${join(ranked.filter(([, s]) => s >= 0.12).slice(0, 3).map(([k, s]) => `${name(k)} (${pct(s)})`))}.`;
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function join(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
