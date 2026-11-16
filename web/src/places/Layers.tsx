// "Places on the map": grouped toggles for the place layers, like a game map's legend.
// Everything starts off so the ward colours stay readable; choices live in the URL.
import type { LandmarksEnvelope } from "../generated/landmarks";
import { fmtInt } from "../format";
import { iconUrl } from "./icons";
import { catalogue } from "./places";

interface Props {
  env: LandmarksEnvelope;
  on: string[];
  onChange: (layers: string[]) => void;
}

export function Layers({ env, on, onChange }: Props) {
  const groups = catalogue(env);
  const set = new Set(on);
  const toggle = (keys: string[], value: boolean) => {
    const next = new Set(set);
    for (const k of keys) value ? next.add(k) : next.delete(k);
    // Keep display order so the URL is stable.
    onChange(groups.flatMap((g) => g.categories.map((c) => c.key)).filter((k) => next.has(k)));
  };

  return (
    <details class="layers" open={on.length > 0}>
      <summary>
        Places on the map
        <span class="layers-count">{on.length ? `${on.length} shown` : "none shown"}</span>
      </summary>
      {groups.map((g) => {
        const keys = g.categories.map((c) => c.key);
        const n = keys.filter((k) => set.has(k)).length;
        return (
          <fieldset key={g.key} class="layer-group">
            <legend>
              <label>
                <input
                  type="checkbox"
                  checked={n === keys.length}
                  ref={(el) => el && (el.indeterminate = n > 0 && n < keys.length)}
                  onChange={(e) => toggle(keys, e.currentTarget.checked)}
                />
                {g.label}
              </label>
            </legend>
            {g.categories.map((c) => (
              <label key={c.key} class="layer-row">
                <input type="checkbox" checked={set.has(c.key)} onChange={(e) => toggle([c.key], e.currentTarget.checked)} />
                <img src={iconUrl(c.key, c.group)} alt="" width={18} height={18} />
                <span>{c.label}</span>
                <span class="layer-n">{fmtInt(c.count)}</span>
              </label>
            ))}
          </fieldset>
        );
      })}
      <p class="source">
        {on.length > 0 && (
          <button type="button" class="link-btn" onClick={() => onChange([])}>
            Hide all
          </button>
        )}{" "}
        City of Cape Town facility registers; shopping centres © OpenStreetMap contributors (ODbL).
      </p>
    </details>
  );
}
