// Election results: the ward ballot for one ward, and council seats for the city and country.
// Bars are one neutral colour: party identity is carried by the name, never by colour.
import type { AppData } from "../data";
import type { ElectionsEnvelope, PartyResult } from "../generated/elections";
import { fmtInt, fmtPct } from "../format";
import { predecessors } from "../panel/Allocations";
import { SourceLine } from "../panel/Figure";

const pct = (s: number) => fmtPct(s * 100);

/** The newest ward-ballot results that can be tied to this ward (directly or via an old ward). */
export function wardResult(data: AppData, ward: number) {
  for (const env of data.electionWards) {
    const [main] = predecessors(ward, data.wards.ward_vintage, env, data.crosswalk);
    const row = main && env.rows.find((r) => r.ward_no === main.ward);
    if (row && main) return { env, row, oldWard: env.ward_vintage === data.wards.ward_vintage ? null : main };
  }
  return null;
}

function Bars({ parties, value, label }: { parties: PartyResult[]; value: (p: PartyResult) => number; label: (p: PartyResult) => string }) {
  return (
    <ul class="share-list party-list">
      {parties.map((p) => (
        <li key={p.party}>
          <span class="share-label">{p.party}</span>
          <span class="share-track" aria-hidden="true">
            <span style={{ width: `${Math.max(value(p) * 100, 0.5)}%` }} />
          </span>
          <span class="share-value">{label(p)}</span>
        </li>
      ))}
    </ul>
  );
}

export function WardElection({ data, ward }: { data: AppData; ward: number }) {
  const res = wardResult(data, ward);
  if (!res) return null;
  const { env, row, oldWard } = res;
  const winner = row.parties[0];
  return (
    <section class="section" aria-labelledby="election-title">
      <h3 id="election-title">Elections</h3>
      <p class="lede">
        {env.year} local election, ward ballot
        {oldWard && (
          <>
            {" "}
            in old ward {oldWard.ward}, which covers {Math.round(oldWard.share * 100)}% of this ward
          </>
        )}
        . Won by <strong>{row.winner}</strong>
        {winner && <> with {pct(winner.share)} of valid votes</>}. Turnout was {pct(row.turnout)} of {fmtInt(row.registered)}{" "}
        registered voters.
      </p>
      <Bars parties={row.parties} value={(p) => p.share} label={(p) => pct(p.share)} />
      <p class="source">
        Votes for ward candidates by party. Residents also vote on a party list for the rest of the council.{" "}
        <SourceLine env={env} sourceKey={env.fields.parties!.source} method={env.fields.parties!.method} />
      </p>
    </section>
  );
}

function council(env: ElectionsEnvelope, code: string) {
  return env.municipalities.find((m) => m.code === code) ?? null;
}

/** City overview: the council's make-up after the latest election, then the national picture. */
export function CouncilResults({ data, code }: { data: AppData; code: string }) {
  const env = data.elections[0];
  if (!env) return null;
  const m = council(env, code);
  return (
    <>
      {m && (
        <section class="section" aria-labelledby="council-title">
          <h3 id="council-title">City council after the {env.year} election</h3>
          <p class="lede">
            {m.largest_party} won <strong>{m.parties[0]?.seats}</strong> of {m.seats_total} seats
            {m.majority ? ", a majority." : ", short of a majority."}
            {m.independent_seats > 0 && <> Independent ward candidates won {m.independent_seats}.</>} Turnout was {pct(m.turnout)} of{" "}
            {fmtInt(m.registered)} registered voters.
          </p>
          <Bars
            parties={m.parties.filter((p) => (p.seats ?? 0) > 0)}
            value={(p) => (p.seats ?? 0) / m.seats_total}
            label={(p) => `${p.seats} seat${p.seats === 1 ? "" : "s"}`}
          />
          <p class="source">
            <SourceLine env={env} sourceKey="seats" method="elections" />
          </p>
        </section>
      )}
      <NationalResults env={env} />
    </>
  );
}

export function NationalResults({ env }: { env: ElectionsEnvelope }) {
  const n = env.municipalities.length;
  const hung = env.municipalities.filter((m) => !m.majority).length;
  const top = env.national.slice(0, 8);
  return (
    <section class="section" aria-labelledby="national-title">
      <h3 id="national-title">All of South Africa, {env.year}</h3>
      <p class="lede">
        {n} metro and local councils. In {hung} of them no party won a majority of seats, so control depends on
        coalitions formed after the election, which this table doesn't show. "Majority in" counts the councils where
        a party won more than half the seats; "voters there" is the number of registered voters in those councils.
      </p>
      <div class="table-scroll">
        <table class="ward-table">
          <thead>
            <tr>
              <th scope="col">Party</th>
              <th scope="col" class="num">Seats</th>
              <th scope="col" class="num">Majority in</th>
              <th scope="col" class="num">Voters there</th>
            </tr>
          </thead>
          <tbody>
            {top.map((p) => (
              <tr key={p.party}>
                <td class="party-cell">{p.party}</td>
                <td class="num">{fmtInt(p.seats)}</td>
                <td class="num">{p.councils_majority}</td>
                <td class="num">{fmtInt(p.registered_in_majority)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="source">
        {env.gaps.filter((g) => !g.message.includes(":")).map((g) => g.message).join(" ")} <SourceLine env={env} sourceKey="seats" method="elections" />
      </p>
    </section>
  );
}

