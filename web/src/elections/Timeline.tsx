// The council-term timeline: one segment per term, from each local election to the next.
// Choosing a term switches the map to that term's wards and to the figures that exist for it.
import type { AppData } from "../data";
import type { Term } from "../metrics";

export function councilAfter(data: AppData, year: number, code = "CPT") {
  return data.elections.find((e) => e.year === year)?.municipalities.find((m) => m.code === code) ?? null;
}

export function termSummary(data: AppData, t: Term): string {
  const m = councilAfter(data, t.year);
  if (!m) return "";
  const seats = m.parties[0]?.seats ?? 0;
  return `${m.largest_party}: ${seats} of ${m.seats_total} seats${m.majority ? "" : ", no majority"}`;
}

interface Props {
  data: AppData;
  terms: Term[];
  term: Term;
  onTerm: (t: Term) => void;
}

export function Timeline({ data, terms, term, onTerm }: Props) {
  if (terms.length < 2) return null;
  return (
    <nav class="timeline" aria-label="Council terms">
      <span class="timeline-label">Council term</span>
      <ol class="timeline-track">
        {terms.map((t) => (
          <li key={t.year}>
            <button type="button" class={`term ${t.year === term.year ? "on" : ""}`} aria-pressed={t.year === term.year} onClick={() => onTerm(t)}>
              <strong>{t.label}</strong>
              <span>{termSummary(data, t)}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
