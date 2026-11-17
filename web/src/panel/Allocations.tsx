// Ward allocation projects. Budgets are published against the ward boundaries they were made
// under; for a current ward we list the projects of each older ward that overlaps it, with the
// overlap, and never split project amounts between wards.
import type { AllocationRow, AllocationsEnvelope } from "../generated/allocations";
import type { CrosswalkEnvelope } from "../generated/crosswalk";
import { fmtPct, fmtRand } from "../format";
import { Gaps } from "./Gaps";
import { SourceLine } from "./Figure";

const MIN_OVERLAP = 0.05; // ignore slivers: predecessors covering under 5% of the ward

export function predecessors(
  ward: number,
  wardVintage: number,
  budget: { ward_vintage: number },
  crosswalks: CrosswalkEnvelope | CrosswalkEnvelope[] | null,
): { ward: number; share: number }[] {
  if (budget.ward_vintage === wardVintage) return [{ ward, share: 1 }];
  const crosswalk = [crosswalks ?? []].flat().find((c) => c.from_vintage === budget.ward_vintage);
  if (!crosswalk) return [];
  return crosswalk.rows
    .filter((r) => r.to_ward === ward && r.share_of_to >= MIN_OVERLAP)
    .sort((a, b) => b.share_of_to - a.share_of_to)
    .map((r) => ({ ward: r.from_ward, share: r.share_of_to }));
}

/** Total allocated to the old ward covering most of this ward, for the summary. */
export function mainAllocation(ward: number, wardVintage: number, budget: AllocationsEnvelope, crosswalk: CrosswalkEnvelope[] | null) {
  const main = predecessors(ward, wardVintage, budget, crosswalk)[0];
  if (!main) return null;
  const rows = budget.rows.filter((r) => r.ward_no === main.ward);
  return {
    ward: main.ward,
    share: main.share,
    sameVintage: budget.ward_vintage === wardVintage,
    projects: rows.length,
    total: rows.reduce((s, r) => s + (r.amounts[budget.budget_year] ?? 0), 0),
  };
}

interface Props {
  ward: number;
  wardVintage: number;
  budget: AllocationsEnvelope;
  crosswalk: CrosswalkEnvelope[] | null;
}

export function Allocations({ ward, wardVintage, budget, crosswalk }: Props) {
  const year = budget.budget_year;
  const preds = predecessors(ward, wardVintage, budget, crosswalk);
  const byWard = new Map<number, AllocationRow[]>();
  for (const r of budget.rows) {
    if (r.ward_no == null) continue;
    byWard.set(r.ward_no, [...(byWard.get(r.ward_no) ?? []), r]);
  }
  const subcouncils = new Set(preds.flatMap((p) => byWard.get(p.ward)?.map((r) => r.subcouncil) ?? []));
  const multi = budget.rows.filter(
    (r) => r.ward_no == null && subcouncils.has(r.subcouncil) && (r.amounts[year] ?? 0) !== 0,
  );
  const differentVintage = budget.ward_vintage !== wardVintage;

  return (
    <section class="section">
      <h3>Ward allocation projects, {year} budget</h3>
      <p class="lede">
        Each ward's councillor and subcouncil propose projects for a fixed ward allocation.
        {differentVintage &&
          ` This budget used the ${budget.ward_vintage} ward boundaries, so the projects below are for the older wards that overlap this one.`}
      </p>
      {preds.length === 0 && <p class="no-data">No overlapping wards found in this budget.</p>}
      {preds.map((p) => {
        const rows = (byWard.get(p.ward) ?? []).slice().sort((a, b) => (b.amounts[year] ?? 0) - (a.amounts[year] ?? 0));
        const total = rows.reduce((s, r) => s + (r.amounts[year] ?? 0), 0);
        return (
          <div class="alloc-group" key={p.ward}>
            <h4>
              {differentVintage ? `${budget.ward_vintage} ward ${p.ward}` : `Ward ${p.ward}`}
              <span class="alloc-total">{fmtRand(total)}</span>
            </h4>
            {differentVintage && (
              <p class="overlap">Covers {fmtPct(p.share * 100)} of this ward's area.</p>
            )}
            <table class="alloc">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col" class="num">{year}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.wbs}-${r.description}`}>
                    <td>
                      <span class="alloc-desc">{r.description}</span>
                      <span class="alloc-meta">
                        {r.department ?? "Department not stated"} · {r.kind}
                        {r.wbs ? ` · ${r.wbs}` : ""}
                      </span>
                    </td>
                    <td class="num">{fmtRand(r.amounts[year] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {multi.length > 0 && (
        <p class="multi">
          Plus {multi.length} multi-ward item{multi.length > 1 ? "s" : ""} in subcouncil{" "}
          {[...subcouncils].join(", ")} totalling{" "}
          {fmtRand(multi.reduce((s, r) => s + (r.amounts[year] ?? 0), 0))} in {year}, not
          attributable to one ward.
        </p>
      )}
      <p class="figure-note">
        <SourceLine env={budget} sourceKey="annexure" method="ward-allocations" />
      </p>
      <Gaps gaps={budget.gaps} title="About this budget" />
    </section>
  );
}
