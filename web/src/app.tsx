import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { type AppData, loadAll, loadBoundaries, type WardFeatures } from "./data";
import type { PlaceRow } from "./generated/places";
import { fmtDate, fmtUnit } from "./format";
import { wardAt } from "./geo";
import { basemapStyle, WardMap } from "./map/map";
import { legendEntries, NO_DATA, quantileScale } from "./map/scales";
import { buildMetrics, METRIC_KEYS, type MetricKey, type Term, terms, topics } from "./metrics";
import type { LandmarkRow } from "./generated/landmarks";
import { Layers } from "./places/Layers";
import { categoryMap } from "./places/places";
import { Timeline } from "./elections/Timeline";
import { CityOverview } from "./panel/CityOverview";
import { PastWardPanel } from "./panel/PastWardPanel";
import { SourceLine } from "./panel/Figure";
import { WardPanel } from "./panel/WardPanel";
import { PlaceResult, Search } from "./search/Search";
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
  const [place, setPlace] = useState<PlaceRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const allTerms = useMemo(() => terms(data), [data]);
  const fallback: Term = { year: 0, vintage: data.wards.ward_vintage, next: null, current: true, label: "current" };
  const term = allTerms.find((t) => t.year === state.term) ?? allTerms.at(-1) ?? fallback;
  const [wardShapes, setWardShapes] = useState<WardFeatures>(data.boundaries);
  useEffect(() => {
    let live = true;
    loadBoundaries(data, term.vintage).then((fc) => live && setWardShapes(fc), () => live && setNotice("Could not load that term's wards."));
    return () => {
      live = false;
    };
  }, [term.vintage]);

  const metrics = useMemo(() => buildMetrics(data, term), [data, term.year]);
  // A metric that doesn't exist in this term falls back to the term's first one.
  const metricKey = metrics[state.metric] ? state.metric : METRIC_KEYS.find((k) => metrics[k])!;
  const metric = metrics[metricKey]!;
  const field = metric.env.fields[metric.field]!;
  const scale = useMemo(() => quantileScale([...metric.values.values()]), [metric]);
  const fmt = (v: number) => fmtUnit(v, metric.unit);
  const panel = state.ward ? "ward" : state.city ? "city" : null;

  useEffect(() => {
    let cancelled = false;
    basemapStyle().then((style) => {
      if (cancelled || !mapEl.current || map.current) return;
      map.current = new WardMap(mapEl.current, data.boundaries, style, {
        onClick: (ward) => update({ ward, city: false }),
        onHover: (ward, p) => setHover(ward && p ? { ward, ...p } : null),
      });
      // Effects that ran before the map existed: apply their state now.
      setMapReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    map.current?.setWards(wardShapes);
  }, [wardShapes, mapReady]);

  useEffect(() => {
    map.current?.setClasses(new Map([...metric.values].map(([w, v]) => [w, scale.classOf(v)])));
  }, [metric, scale, mapReady]);

  useEffect(() => {
    if (!map.current) return;
    const lm = data.landmarks;
    map.current.setPlaces({
      rows: lm.rows,
      groupOf: Object.fromEntries(lm.categories.map((c) => [c.key, c.group])),
      popup: (row) => placePopup(data, row, (w) => openCurrentWard(w)),
    });
  }, [mapReady]);

  const layerKey = state.layers.join(",");
  useEffect(() => {
    map.current?.setVisiblePlaces(state.layers.filter((l) => data.landmarks.categories.some((c) => c.key === l)));
  }, [layerKey, mapReady]);

  useEffect(() => {
    map.current?.setSelected(state.ward, true);
  }, [state.ward, mapReady]);

  useEffect(() => {
    map.current?.setCandidates(place && place.wards.length > 1 ? place.wards.map((w) => w.ward_no) : []);
  }, [place, mapReady]);

  useEffect(() => {
    // Opening or closing the panel changes the map's size on wide screens.
    requestAnimationFrame(() => map.current?.resize());
  }, [panel]);

  const openWard = (ward: number) => update({ ward, city: false });
  /** Search, location and place pins work on today's wards: switch to the current term. */
  const openCurrentWard = (ward: number) => update({ ward, city: false, term: null });
  const chooseTerm = (t: Term) => {
    setPlace(null);
    update({ term: t.current ? null : t.year, ward: null });
  };
  const choosePlace = (p: PlaceRow) => {
    setNotice(null);
    if (p.wards.length === 1) {
      setPlace(null);
      openCurrentWard(p.wards[0]!.ward_no);
    } else {
      setPlace(p);
      update({ ward: null, term: null });
      const [w, s, e, n] = p.bbox;
      map.current?.fit([w!, s!, e!, n!]);
    }
  };
  const locate = () => {
    if (!("geolocation" in navigator)) return setNotice("Your browser can't share its location.");
    setNotice("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ward = wardAt(data.boundaries, pos.coords.longitude, pos.coords.latitude);
        setPlace(null);
        if (ward) {
          setNotice(null);
          openCurrentWard(ward);
        } else setNotice("Your location is outside the City of Cape Town's wards.");
      },
      () => setNotice("Location unavailable. Check your browser's permission, or search for your suburb."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div class={`layout ${panel ? "has-panel" : ""}`}>
      <header class="site-head">
        <div class="brand">
          <h1>Cape Town Ward Map</h1>
          <p>City services and ward budgets for each of Cape Town's wards. Each figure links to its source.</p>
        </div>
        <div class="head-tools">
          <Search places={data.places.rows} wardCount={data.wards.rows.length} onWard={(w) => (setPlace(null), openCurrentWard(w))} onPlace={choosePlace} />
          <button type="button" class="btn" onClick={locate}>
            <span aria-hidden="true">◎</span> My location
          </button>
          <button
            type="button"
            class={`btn ${panel === "city" ? "btn-on" : ""}`}
            aria-pressed={panel === "city"}
            onClick={() => {
              setPlace(null);
              update({ ward: null, city: panel !== "city" });
              if (panel !== "city") map.current?.showCity();
            }}
          >
            City overview
          </button>
        </div>
        <Timeline data={data} terms={allTerms} term={term} onTerm={chooseTerm} />
      </header>

      <div class="map-wrap">
        <div ref={mapEl} class="map" role="application" aria-label="Map of Cape Town's wards. Select a ward for details." />
        <div class="controls">
          <label for="metric">Colour wards by</label>
          <select id="metric" value={metricKey} onChange={(e) => update({ metric: e.currentTarget.value as MetricKey })}>
            {topics(metrics).map(([topic, keys]) => (
              <optgroup key={topic} label={topic}>
                {keys.map((k) => (
                  <option key={k} value={k}>
                    {metrics[k]!.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p class="reading">{metric.reading}</p>
          {!term.current && <p class="reading term-note">Showing the {term.label} term on its own ward boundaries.</p>}
          <ul class="legend" aria-label={`Legend: ${metric.label}`}>
            {legendEntries(scale, fmt).map(([color, label]) => (
              <li key={label}>
                <span class="swatch" style={{ background: color }} />
                {label}
              </li>
            ))}
            <li>
              <span class="swatch" style={{ background: NO_DATA }} />
              {metric.nullLabel}
            </li>
          </ul>
          <p class="reading">
            {metric.city != null && (
              <>
                City-wide: <strong>{fmt(metric.city)}</strong>.{" "}
              </>
            )}
            {metric.env.period && (
              <>
                {fmtDate(metric.env.period.from)} to {fmtDate(metric.env.period.to)}.{" "}
              </>
            )}
            <SourceLine env={metric.env} sourceKey={field.source} method={field.method} />
          </p>
          <Layers env={data.landmarks} on={state.layers} onChange={(layers) => update({ layers })} />
        </div>
        {(place || notice) && (
          <div class="map-notice">
            {notice && <p role="status">{notice}</p>}
            {place && <PlaceResult place={place} onWard={openWard} onClose={() => setPlace(null)} />}
          </div>
        )}
        {hover && (
          <div class="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="status">
            <strong>Ward {hover.ward}</strong>
            <span>
              {metric.label}: {metric.values.get(hover.ward) != null ? fmt(metric.values.get(hover.ward)!) : metric.nullLabel}
            </span>
          </div>
        )}
      </div>

      {panel && (
        <aside class="panel" aria-live="polite">
          {panel === "ward" && !term.current ? (
            <PastWardPanel data={data} term={term} ward={state.ward!} onCurrentWard={openCurrentWard} onClose={() => update({ ward: null })} />
          ) : panel === "ward" ? (
            <WardPanel
              data={data}
              metrics={metrics}
              ward={state.ward!}
              layers={state.layers}
              onShowLayer={(c) => update({ layers: [...state.layers, c] })}
              onClose={() => update({ ward: null })}
            />
          ) : (
            <CityOverview data={data} metrics={metrics} metric={metricKey} term={term} onWard={openWard} onClose={() => update({ city: false })} />
          )}
        </aside>
      )}
    </div>
  );
}

/** Popup for a place pin. Built as DOM (names come from data, never parsed as HTML). */
function placePopup(data: AppData, row: LandmarkRow, onWard: (w: number) => void): HTMLElement {
  const lm = data.landmarks;
  const cat = categoryMap(lm).get(row.category);
  const src = cat ? lm.sources[cat.source] : undefined;
  const el = (tag: string, cls: string, text?: string) => {
    const e = document.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const box = el("div", "place-popup");
  box.append(el("strong", "", row.name), el("span", "place-popup-cat", cat?.label ?? row.category));
  if (row.detail) box.append(el("p", "place-popup-detail", row.detail));
  if (row.ward_no != null) {
    const b = el("button", "link-btn", `Ward ${row.ward_no}`) as HTMLButtonElement;
    b.type = "button";
    b.onclick = () => onWard(row.ward_no!);
    box.append(b);
  }
  if (src) box.append(el("p", "source", `Source: ${src.publisher}, ${src.title}`));
  return box;
}
