import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { type AppData, loadAll } from "./data";
import { fmtDate, fmtUnit } from "./format";
import { WardMap } from "./map/map";
import { legendEntries, NO_DATA, quantileScale } from "./map/scales";
import { METRIC_ORDER, METRICS } from "./metrics";
import { METHODOLOGY_URL, SourceLine } from "./panel/Figure";
import { WardPanel } from "./panel/WardPanel";
import { useHashState } from "./state";

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadAll().then(setData, (e: Error) => setError(e.message));
  }, []);
  if (error) return <p class="fatal">Could not load the data: {error}</p>;
  if (!data) return <p class="loading">Loading ward data…</p>;
  return <Main data={data} />;
}

function Main({ data }: { data: AppData }) {
  const [state, update] = useHashState();
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<WardMap | null>(null);
  const [hover, setHover] = useState<{ ward: number; x: number; y: number } | null>(null);

  const sr = data.serviceRequests;
  const metric = METRICS[state.metric];
  const field = sr.fields[state.metric]!;
  const values = useMemo(() => new Map(sr.rows.map((r) => [r.ward_no, metric.value(r)])), [sr, metric]);
  const scale = useMemo(() => quantileScale([...values.values()]), [values]);

  useEffect(() => {
    if (!mapEl.current || map.current) return;
    map.current = new WardMap(mapEl.current, data.boundaries, {
      onClick: (ward) => update({ ward }),
      onHover: (ward, p) => setHover(ward && p ? { ward, ...p } : null),
    });
  }, []);

  useEffect(() => {
    map.current?.setClasses(new Map([...values].map(([w, v]) => [w, scale.classOf(v)])));
  }, [values, scale]);

  useEffect(() => {
    map.current?.setSelected(state.ward, true);
    // The panel opening changes the map's size on wide screens.
    requestAnimationFrame(() => map.current?.resize());
  }, [state.ward]);

  const fmt = (v: number) => fmtUnit(v, field.unit);
  const cityValue = metric.value(sr.citywide);

  return (
    <div class={`layout ${state.ward ? "has-panel" : ""}`}>
      <header class="site-head">
        <h1>Cape Town Ward Map</h1>
        <p>
          How the City of Cape Town serves and spends, ward by ward. Figures are shown as published
          by the City and other public sources, with the source beside each one.{" "}
          <a href={METHODOLOGY_URL} target="_blank" rel="noopener">How the figures are made</a>
        </p>
      </header>

      <div class="map-wrap">
        <div ref={mapEl} class="map" role="application" aria-label="Map of Cape Town's wards. Select a ward for details." />
        <div class="controls">
          <label for="metric">Colour wards by</label>
          <select id="metric" value={state.metric} onChange={(e) => update({ metric: e.currentTarget.value as typeof state.metric })}>
            {METRIC_ORDER.map((k) => (
              <option key={k} value={k}>
                {sr.fields[k]?.label ?? k}
              </option>
            ))}
          </select>
          <p class="reading">{metric.reading}</p>
          <ul class="legend" aria-label={`Legend: ${field.label}`}>
            {legendEntries(scale, fmt).map(([color, label]) => (
              <li key={label}>
                <span class="swatch" style={{ background: color }} />
                {label}
              </li>
            ))}
            <li>
              <span class="swatch" style={{ background: NO_DATA }} />
              Not enough data
            </li>
          </ul>
          {cityValue != null && <p class="reading">City-wide: {fmt(cityValue)}</p>}
          <p class="reading">
            Requests logged {fmtDate(sr.period!.from)} – {fmtDate(sr.period!.to)}.{" "}
            <SourceLine env={sr} sourceKey="sr" method="service-requests" />
          </p>
          <WardSearch max={data.wards.rows.length} onGo={(ward) => update({ ward })} />
        </div>
        {hover && (
          <div class="tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }} role="status">
            <strong>Ward {hover.ward}</strong>
            <span>
              {field.label}: {values.get(hover.ward) != null ? fmt(values.get(hover.ward)!) : "not enough data"}
            </span>
          </div>
        )}
      </div>

      {state.ward && (
        <aside class="panel" aria-live="polite">
          <WardPanel data={data} ward={state.ward} onClose={() => update({ ward: null })} />
        </aside>
      )}
    </div>
  );
}

function WardSearch({ max, onGo }: { max: number; onGo: (ward: number) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      class="ward-search"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(v);
        if (Number.isInteger(n) && n >= 1 && n <= max) onGo(n);
      }}
    >
      <label for="ward-no">Go to ward</label>
      <input id="ward-no" type="number" min={1} max={max} inputMode="numeric" value={v} onInput={(e) => setV(e.currentTarget.value)} placeholder={`1–${max}`} />
      <button type="submit">Go</button>
    </form>
  );
}
