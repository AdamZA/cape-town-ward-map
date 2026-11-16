// Side panel for one ward: facts, service requests, ward allocation projects.
import type { AppData } from "../data";
import { fmtDate, fmtInt, fmtPct } from "../format";
import { Allocations } from "./Allocations";
import { Figure } from "./Figure";
import { Gaps, gapsFor } from "./Gaps";

export function WardPanel({ data, ward, onClose }: { data: AppData; ward: number; onClose: () => void }) {
  const w = data.wards.rows.find((r) => r.ward_no === ward);
  const sr = data.serviceRequests;
  const s = sr.rows.find((r) => r.ward_no === ward);
  const city = sr.citywide;
  if (!w || !s) return <p>Ward {ward} not found.</p>;
  const suppressed = s.flags.includes("insufficient_data");
  const reason = suppressed ? "Too few requests to report" : undefined;
  const cityNote = (v: number | null | undefined, fmt: (n: number) => string) =>
    v == null ? undefined : `City-wide: ${fmt(v)}`;

  return (
    <article class="panel-body" aria-labelledby="ward-title">
      <header class="panel-head">
        <h2 id="ward-title">Ward {ward}</h2>
        <button type="button" class="close" onClick={onClose} aria-label="Close ward details">
          ×
        </button>
      </header>

      <section class="section">
        <dl class="figures">
          <Figure
            env={data.wards}
            field="subcouncil"
            value={w.subcouncil}
            display={`Subcouncil ${w.subcouncil}`}
            note={w.flags.includes("subcouncil_split") ? "This ward was formed from parts of several older wards; its subcouncil may differ." : undefined}
          />
          {data.wards.fields.councillor ? (
            <Figure env={data.wards} field="councillor"
              value={w.councillor ? `${w.councillor.name}${w.councillor.party ? ` (${w.councillor.party})` : ""}` : null}
              emptyReason="Not yet recorded" />
          ) : (
            <div class="figure">
              <dt>Ward councillor</dt>
              <dd><span class="no-data">Not yet recorded (see below)</span></dd>
            </div>
          )}
          <Figure env={data.wards} field="population" value={w.population} display={w.population != null ? `about ${fmtInt(w.population)}` : undefined} />
          <Figure env={data.wards} field="area_km2" value={w.area_km2} />
        </dl>
        <Gaps gaps={gapsFor(data.wards.gaps, ward)} />
      </section>

      <section class="section">
        <h3>Service requests</h3>
        {sr.period && (
          <p class="lede">
            Requests logged {fmtDate(sr.period.from)} – {fmtDate(sr.period.to)}, with their status as
            at {fmtDate(sr.as_of)}. Every request has had at least 90 days to be resolved.
          </p>
        )}
        <dl class="figures">
          <Figure env={sr} field="pct_closed_30d" value={s.pct_closed_30d} emptyReason={reason} note={cityNote(city.pct_closed_30d, fmtPct)} />
          <Figure
            env={sr}
            field="median_days"
            value={s.median_days}
            emptyReason={reason}
            display={s.median_days != null ? `${s.median_censored ? "more than " : ""}${fmtInt(s.median_days)} ${s.median_days === 1 ? "day" : "days"}` : undefined}
            note={cityNote(city.median_days, (n) => `${n} days`)}
          />
          <Figure
            env={sr}
            field="p80_days"
            value={s.p80_days}
            emptyReason={reason}
            display={s.p80_days != null ? `${s.p80_censored ? "more than " : ""}${fmtInt(s.p80_days)} days` : undefined}
          />
          <Figure env={sr} field="pct_no_completion" value={s.pct_no_completion} emptyReason={reason} note={cityNote(city.pct_no_completion, fmtPct)} />
          <Figure env={sr} field="requests" value={s.requests} />
          <Figure env={sr} field="per_1000" value={s.per_1000} emptyReason={reason} note={cityNote(city.per_1000, (n) => n.toFixed(1))} />
          <Figure env={sr} field="pct_located" value={s.pct_located} note={cityNote(city.pct_located, fmtPct)} />
        </dl>
        <Gaps gaps={gapsFor(sr.gaps, ward)} />
      </section>

      {data.allocations.map((budget) => (
        <Allocations key={budget.budget_year} ward={ward} wardVintage={data.wards.ward_vintage} budget={budget} crosswalk={data.crosswalk} />
      ))}
    </article>
  );
}
