// "What's here": what the ward's land is zoned for, and the public places inside it.
import type { AppData } from "../data";
import type { LandmarkRow } from "../generated/landmarks";
import { fmtPct, fmtUnit } from "../format";
import { SourceLine } from "../panel/Figure";
import { iconUrl } from "./icons";
import { categoryMap, characterLine, labelsOf, wardPlaces } from "./places";

const SHOW = 5;
/** Below this share of the ward in recorded parcels, warn that the zoning mix is partial. */
const LOW_COVERAGE = 0.6;

interface Props {
  data: AppData;
  ward: number;
  layers: string[];
  onShow: (category: string) => void;
}

export function WhatsHere({ data, ward, layers, onShow }: Props) {
  const lu = data.landUse;
  const row = lu.rows.find((r) => r.ward_no === ward);
  const lm = data.landmarks;
  const cats = categoryMap(lm);
  const groupLabels = labelsOf(lu.groups);
  const places = wardPlaces(lm, ward);
  const shares = row ? Object.entries(row.shares).filter(([, s]) => s >= 0.005).sort((a, b) => b[1] - a[1]) : [];
  const meta = lu.fields.shares!;

  return (
    <section class="section" aria-labelledby="here-title">
      <h3 id="here-title">What's here</h3>
      {row && shares.length > 0 && (
        <>
          <p class="lede">{characterLine(row, groupLabels)}</p>
          {row.parcel_coverage < LOW_COVERAGE && (
            <p class="glance-warn" role="note">
              Only about {Math.round(row.parcel_coverage * 100)}% of this ward's area is in recorded land parcels (for example
              where land is unsurveyed or informally settled), so these shares describe only that part.
            </p>
          )}
          <ul class="share-list" aria-label="Zoned land by use">
            {shares.map(([k, s]) => (
              <li key={k}>
                <span class="share-label">{groupLabels[k] ?? k}</span>
                <span class="share-track" aria-hidden="true">
                  <span style={{ width: `${Math.max(s * 100, 1)}%` }} />
                </span>
                <span class="share-value">{fmtPct(s * 100)}</span>
              </li>
            ))}
          </ul>
          <p class="source">
            Zoning is what land may be used for, not what is on it now. {fmtUnit(row.zoned_km2, "km²")} counted; roads and
            unzoned land ({fmtUnit(row.excluded_km2, "km²")}) left out.{" "}
            <SourceLine env={lu} sourceKey={meta.source} method={meta.method} />
          </p>
        </>
      )}

      {places.length === 0 ? (
        <p class="lede">None of the mapped kinds of public place are recorded in this ward.</p>
      ) : (
        <ul class="here-list">
          {places.map(([cat, rows]) => (
            <HereCategory
              key={cat}
              label={cats.get(cat)!.label}
              icon={iconUrl(cat, cats.get(cat)!.group)}
              rows={rows}
              shown={layers.includes(cat)}
              onShow={() => onShow(cat)}
            />
          ))}
        </ul>
      )}
      <p class="source">
        Public places from the City's facility registers (shopping centres: © OpenStreetMap contributors, ODbL). They can
        be incomplete.
      </p>
    </section>
  );
}

function HereCategory(p: { label: string; icon: string; rows: LandmarkRow[]; shown: boolean; onShow: () => void }) {
  const names = (rows: LandmarkRow[]) =>
    rows.map((r) => (
      <li key={`${r.name}${r.lon}`} title={r.detail ?? undefined}>
        {r.name}
      </li>
    ));
  return (
    <li class="here-cat">
      <div class="here-head">
        <img src={p.icon} alt="" width={18} height={18} />
        <strong>{p.label}</strong>
        <span class="layer-n">{p.rows.length}</span>
        {!p.shown && (
          <button type="button" class="link-btn" onClick={p.onShow}>
            Show on map
          </button>
        )}
      </div>
      <ul class="here-names">{names(p.rows.slice(0, SHOW))}</ul>
      {p.rows.length > SHOW && (
        <details>
          <summary>{p.rows.length - SHOW} more</summary>
          <ul class="here-names">{names(p.rows.slice(SHOW))}</ul>
        </details>
      )}
    </li>
  );
}
