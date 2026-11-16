// The only way the UI renders a number: always with its source, retrieval date and method.
import type { ComponentChildren } from "preact";
import { fmtDate, fmtUnit } from "../format";

export const METHODOLOGY_URL = "https://github.com/AdamZA/cape-town-ward-map/blob/main/METHODOLOGY.md";

/** The provenance-bearing parts every envelope shares. */
export interface Provenance {
  fields: Record<string, { label: string; unit?: string | null; source: string; method?: string | null; description?: string | null }>;
  sources: Record<string, { title: string; publisher: string; url: string; retrieved_at: string }>;
}

interface FigureProps {
  env: Provenance;
  field: string;
  /** A number (formatted by the field's unit) or text shown as-is. */
  value: number | string | null | undefined;
  /** Override the formatted value (e.g. "more than 90 days"). */
  display?: string;
  /** Shown when value is null. */
  emptyReason?: string;
  /** Extra context under the value, e.g. a citywide comparison. */
  note?: ComponentChildren;
}

export function Figure({ env, field, value, display, emptyReason, note }: FigureProps) {
  const meta = env.fields[field];
  if (!meta) throw new Error(`no field metadata for ${field}`);
  return (
    <div class="figure">
      <dt>{meta.label}</dt>
      <dd>
        <span class="figure-value">
          {value === null || value === undefined ? (
            <span class="no-data">{emptyReason ?? "No data"}</span>
          ) : (
            display ?? (typeof value === "string" ? value : fmtUnit(value, meta.unit))
          )}
        </span>
        {note && <span class="figure-note">{note}</span>}
        {meta.description && <span class="figure-desc">{meta.description}</span>}
        <SourceLine env={env} sourceKey={meta.source} method={meta.method} />
      </dd>
    </div>
  );
}

export function SourceLine({ env, sourceKey, method }: { env: Provenance; sourceKey: string; method?: string | null }) {
  const s = env.sources[sourceKey];
  if (!s) return null;
  return (
    <span class="source">
      Source:{" "}
      <a href={s.url} target="_blank" rel="noopener" title={s.title}>
        {s.publisher}
      </a>
      , retrieved {fmtDate(s.retrieved_at)}
      {method && (
        <>
          {" · "}
          <a href={`${METHODOLOGY_URL}#${method}`} target="_blank" rel="noopener">
            method
          </a>
        </>
      )}
    </span>
  );
}
