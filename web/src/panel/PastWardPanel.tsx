// A ward of an earlier council term, on that term's boundaries: who represented it, how it voted,
// its ward budget if one was published on those wards, and which of today's wards cover it.
import type { AppData } from "../data";
import { WardElection } from "../elections/Elections";
import type { Term } from "../metrics";
import { Allocations } from "./Allocations";

interface Props {
  data: AppData;
  term: Term;
  ward: number;
  onCurrentWard: (ward: number) => void;
  onClose: () => void;
}

export function PastWardPanel({ data, term, ward, onCurrentWard, onClose }: Props) {
  const row = data.electionWards.find((e) => e.year === term.year)?.rows.find((r) => r.ward_no === ward);
  const budgets = data.allocations.filter((b) => b.ward_vintage === term.vintage);
  const cw = data.crosswalks.find((c) => c.from_vintage === term.vintage);
  const today =
    cw
      ? cw.rows.filter((r) => r.from_ward === ward && r.share_of_from >= 0.02).sort((a, b) => b.share_of_from - a.share_of_from)
      : [];

  return (
    <article class="panel-body" aria-labelledby="ward-title">
      <header class="panel-head">
        <div>
          <h2 id="ward-title">Ward {ward}</h2>
          <p class="panel-sub">
            {term.label} term, on the {term.vintage} ward boundaries
            {row?.councillor && (
              <>
                {" · "}Councillor {row.councillor} ({row.winner}), elected {term.year}
              </>
            )}
          </p>
        </div>
        <button type="button" class="icon-btn" onClick={onClose} aria-label="Close ward details">
          ×
        </button>
      </header>

      <section class="glance">
        <p class="glance-lede">
          Ward boundaries change between terms, so this ward isn't the same area as today's ward {ward}. Service
          request, outage, land-use and place figures are only published for today's wards.
        </p>
        {today.length > 0 && (
          <>
            <p class="glance-lede">Today this area is part of:</p>
            <ul class="place-wards">
              {today.map((r) => (
                <li key={r.to_ward}>
                  <button type="button" onClick={() => onCurrentWard(r.to_ward)}>
                    Ward {r.to_ward}
                    <span class="share-bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(r.share_of_from * 100, 2)}%` }} />
                    </span>
                    <span class="search-meta">{Math.round(r.share_of_from * 100)}% of this ward</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <WardElection data={data} ward={ward} year={term.year} />

      {budgets.map((budget) => (
        <Allocations key={budget.budget_year} ward={ward} wardVintage={term.vintage} budget={budget} crosswalk={data.crosswalks} />
      ))}
    </article>
  );
}
