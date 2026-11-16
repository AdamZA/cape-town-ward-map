// Data gaps, stated plainly next to the figures they affect.
import type { Gap } from "../generated/wards";

export function Gaps({ gaps, title = "About these figures" }: { gaps: Gap[]; title?: string }) {
  if (!gaps.length) return null;
  return (
    <aside class="gaps" aria-label={title}>
      <h4>{title}</h4>
      <ul>
        {gaps.map((g) => (
          <li key={`${g.code}-${g.ward_no ?? ""}`}>{g.message}</li>
        ))}
      </ul>
    </aside>
  );
}

/** Gaps for one ward: its own, plus those that apply to the whole dataset. */
export function gapsFor(gaps: Gap[], ward: number, opts: { datasetWide?: boolean } = {}): Gap[] {
  return gaps.filter((g) => g.ward_no === ward || (opts.datasetWide !== false && g.ward_no == null));
}
