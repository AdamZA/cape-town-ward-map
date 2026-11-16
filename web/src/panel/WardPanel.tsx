// Side panel for one ward: summary first, then the detail behind it, each figure with its source.
import type { AppData } from "../data";
import type { Metric, MetricKey } from "../metrics";
import { fmtDate, fmtInt, fmtPct } from "../format";
import { Allocations } from "./Allocations";
import { Figure } from "./Figure";
import { Gaps, gapsFor } from "./Gaps";
import { WhatsHere } from "../places/WhatsHere";
import { Summary } from "./Summary";

interface Props {
  data: AppData;
  metrics: Record<MetricKey, Metric>;
  ward: number;
  layers: string[];
  onShowLayer: (category: string) => void;
  onClose: () => void;
}

export function WardPanel({ data, metrics, ward, layers, onShowLayer, onClose }: Props) {
  const w = data.wards.rows.find((r) => r.ward_no === ward);
  const sr = data.serviceRequests;
  const s = sr.rows.find((r) => r.ward_no === ward);
  const city = sr.citywide;
  const out = data.outages;
  const o = out.rows.find((r) => r.ward_no === ward);
  if (!w || !s) return <p>Ward {ward} not found.</p>;
  const suppressed = s.flags.includes("insufficient_data");
  const reason = suppressed ? "Too few requests to report" : undefined;
  const cityNote = (v: number | null | undefined, fmt: (n: number) => string) =>
    v == null ? undefined : `City-wide: ${fmt(v)}`;

  return (
    <article class="panel-body" aria-labelledby="ward-title">
      <header class="panel-head">
        <div>
          <h2 id="ward-title">Ward {ward}</h2>
          {w.subcouncil != null && <p class="panel-sub">Subcouncil {w.subcouncil}</p>}
        </div>
        <button type="button" class="icon-btn" onClick={onClose} aria-label="Close ward details">
          ×
        </button>
      </header>

      <Summary data={data} metrics={metrics} ward={ward} />

      <section class="section">
        <h3>The ward</h3>
        <dl class="figures">
          <Figure
            env={data.wards}
            field="subcouncil"
            value={w.subcouncil}
            display={`Subcouncil ${w.subcouncil}`}
            note={
              w.flags.includes("subcouncil_split") && w.subcouncil_share != null
                ? `${Math.round(w.subcouncil_share * 100)}% of the ward lies in this subcouncil; the rest in a neighbouring one.`
                : undefined
            }
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
          <Figure
            env={data.wards}
            field="electricity_city_share"
            value={w.electricity_city_share}
            display={w.electricity_city_share != null ? supplyText(w.electricity_city_share) : undefined}
          />
        </dl>
        <Gaps gaps={gapsFor(data.wards.gaps, ward)} />
      </section>

      <WhatsHere data={data} ward={ward} layers={layers} onShow={onShowLayer} />

      <section class="section">
        <h3>Service requests</h3>
        {sr.period && (
          <p class="lede">
            Requests logged {fmtDate(sr.period.from)} to {fmtDate(sr.period.to)}, with their status as
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

      {o && (
        <section class="section">
          <h3>Water and electricity</h3>
          {out.period && (
            <p class="lede">
              Days between {fmtDate(out.period.from)} and {fmtDate(out.period.to)} on which {out.min_reports} or more residents
              of this ward reported having no water, or no power, to the City.
            </p>
          )}
          <dl class="figures two-col">
            <Figure env={out} field="water_days" value={o.water_days} />
            <Figure env={out} field="power_days" value={o.power_days} emptyReason="Not shown: mostly supplied by Eskom" />
            <Figure env={out} field="water_reports" value={o.water_reports} />
            <Figure env={out} field="power_reports" value={o.power_reports} emptyReason="Not shown: mostly supplied by Eskom" />
          </dl>
          <Gaps gaps={gapsFor(out.gaps, ward)} />
        </section>
      )}

      {data.allocations.map((budget) => (
        <Allocations key={budget.budget_year} ward={ward} wardVintage={data.wards.ward_vintage} budget={budget} crosswalk={data.crosswalk} />
      ))}
    </article>
  );
}

function supplyText(cityShare: number): string {
  if (cityShare >= 0.95) return "The City";
  if (cityShare <= 0.05) return "Eskom (directly)";
  return `Mixed: the City ${Math.round(cityShare * 100)}%, Eskom ${Math.round((1 - cityShare) * 100)}%`;
}
