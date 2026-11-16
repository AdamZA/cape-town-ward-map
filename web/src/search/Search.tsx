// Find your ward: by suburb name, ward number, or the device's location. A suburb can span
// several wards, so a suburb result lists every candidate and outlines them on the map.
import { useMemo, useState } from "preact/hooks";
import type { PlaceRow } from "../generated/places";

export type Suggestion = { kind: "ward"; ward: number } | { kind: "place"; place: PlaceRow };

const MAX = 8;

/** Ward numbers first (exact), then suburbs whose name starts with the query, then contains it. */
export function suggest(query: string, places: PlaceRow[], wardCount: number): Suggestion[] {
  const q = query.trim().toLowerCase().replace(/^ward\s*/, "");
  if (!q) return [];
  const out: Suggestion[] = [];
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && n <= wardCount) out.push({ kind: "ward", ward: n });
  const starts = places.filter((p) => p.name.toLowerCase().startsWith(q));
  const contains = places.filter((p) => !p.name.toLowerCase().startsWith(q) && p.name.toLowerCase().includes(q));
  for (const p of [...starts, ...contains].slice(0, MAX - out.length)) out.push({ kind: "place", place: p });
  return out;
}

interface Props {
  places: PlaceRow[];
  wardCount: number;
  onWard: (ward: number) => void;
  onPlace: (place: PlaceRow) => void;
}

export function Search({ places, wardCount, onWard, onPlace }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => suggest(q, places, wardCount), [q, places, wardCount]);

  const choose = (s: Suggestion | undefined) => {
    if (!s) return;
    if (s.kind === "ward") onWard(s.ward);
    else onPlace(s.place);
    setQ(s.kind === "ward" ? `Ward ${s.ward}` : s.place.name);
    setOpen(false);
  };

  return (
    <div class="search" role="search">
      <label for="search-input" class="visually-hidden">
        Find a suburb or ward
      </label>
      <input
        id="search-input"
        type="search"
        autocomplete="off"
        placeholder="Find your suburb or ward"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="search-list"
        aria-activedescendant={open && results.length ? `search-opt-${active}` : undefined}
        value={q}
        onInput={(e) => {
          setQ(e.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && q.trim() && (
        <ul id="search-list" class="search-list" role="listbox">
          {results.length === 0 && <li class="search-empty">No suburb or ward matches “{q}”</li>}
          {results.map((s, i) => (
            <li
              key={s.kind === "ward" ? `w${s.ward}` : `p${s.place.name}`}
              id={`search-opt-${i}`}
              role="option"
              aria-selected={i === active}
              class={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {s.kind === "ward" ? (
                <strong>Ward {s.ward}</strong>
              ) : (
                <>
                  <span>{s.place.name}</span>
                  <span class="search-meta">
                    {s.place.wards.length === 1 ? `Ward ${s.place.wards[0]!.ward_no}` : `${s.place.wards.length} wards`}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Result card for a suburb that spans several wards. */
export function PlaceResult({ place, onWard, onClose }: { place: PlaceRow; onWard: (w: number) => void; onClose: () => void }) {
  return (
    <div class="place-result" role="status">
      <div class="place-result-head">
        <strong>{place.name}</strong>
        <button type="button" class="icon-btn" onClick={onClose} aria-label="Clear search result">
          ×
        </button>
      </div>
      <p>
        {place.wards.length === 1
          ? "Lies in one ward:"
          : `Spans ${place.wards.length} wards (outlined on the map). Which one you're in depends on your street:`}
      </p>
      <ul class="place-wards">
        {place.wards.map((w) => (
          <li key={w.ward_no}>
            <button type="button" onClick={() => onWard(w.ward_no)}>
              Ward {w.ward_no}
              <span class="share-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(w.share * 100, 2)}%` }} />
              </span>
              <span class="search-meta">{Math.round(w.share * 100)}% of the suburb</span>
            </button>
          </li>
        ))}
      </ul>
      <p class="source">Suburbs: City of Cape Town official suburbs. Use “My location” for an exact answer.</p>
    </div>
  );
}
