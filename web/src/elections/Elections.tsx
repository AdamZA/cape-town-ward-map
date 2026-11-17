// Election results: the ward ballot for one ward, and council seats for the city and country.
// Bars are one neutral colour: party identity is carried by the name, never by colour.
import type { AppData } from "../data";
import { useState } from "preact/hooks";
import type { ElectionsEnvelope, PartyResult } from "../generated/elections";
import type { ElectionWardsEnvelope, WardElectionRow } from "../generated/election_wards";
import { fmtInt, fmtPct } from "../format";
import { predecessors } from "../panel/Allocations";
import { SourceLine } from "../panel/Figure";
import { partyHref } from "../state";

const pct = (s: number) => fmtPct(s * 100);

/** The newest ward-ballot results that can be tied to this ward (directly or via an old ward). */
export function wardResult(data: AppData, ward: number) {
  for (const env of data.electionWards) {
    const [main] = predecessors(ward, data.wards.ward_vintage, env, data.crosswalks);
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
          <a class="share-label party-link" href={partyHref(p.party)}>
            {p.party}
          </a>
          <span class="share-track" aria-hidden="true">
            <span style={{ width: `${Math.max(value(p) * 100, 0.5)}%` }} />
          </span>
          <span class="share-value">{label(p)}</span>
        </li>
      ))}
    </ul>
  );
}

export function WardElection({ data, ward, year }: { data: AppData; ward: number; year?: number }) {
  // A given election on its own wards (past terms), or the newest result tied to a current ward.
  const chosen = year != null ? data.electionWards.find((e) => e.year === year) : undefined;
  const direct = chosen?.rows.find((r) => r.ward_no === ward);
  const res = chosen ? (direct ? { env: chosen, row: direct, oldWard: null } : null) : wardResult(data, ward);
  if (!res) return null;
  return <WardElectionBody env={res.env} row={res.row} oldWard={res.oldWard} />;
}

/** Change in percentage points, e.g. "+1.2" / "−0.4" / "new". */
export function pointsChange(now: number, then: number | undefined): string {
  if (then == null) return "new";
  const d = Math.round((now - then) * 1000) / 10;
  return d === 0 ? "±0" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
}

const MIN_COVERAGE = 0.8;

function WardElectionBody({ env, row, oldWard }: { env: ElectionWardsEnvelope; row: WardElectionRow; oldWard: { ward: number; share: number } | null }) {
  const [ballot, setBallot] = useState<"ward" | "pr">("ward");
  const winner = row.parties[0];
  const prev = row.previous && row.previous.coverage >= MIN_COVERAGE ? row.previous : null;
  const prevShare = new Map(prev?.parties.map((p) => [p.party, p.share]));
  const parties = ballot === "ward" ? row.parties : row.pr_parties;
  return (
    <section class="section" aria-labelledby="election-title">
      <h3 id="election-title">Elections</h3>
      <p class="lede">
        {env.year} local election
        {oldWard && (
          <>
            , in old ward {oldWard.ward}, which covers {Math.round(oldWard.share * 100)}% of this ward
          </>
        )}
        . Won by {row.councillor ? <><strong>{row.councillor}</strong> ({row.winner})</> : <strong>{row.winner}</strong>}
        {winner && <> with {pct(winner.share)} of ward-ballot votes</>}. Turnout was {pct(row.turnout)} of{" "}
        {fmtInt(row.registered)} registered voters.
      </p>
      {row.pr_parties.length > 0 && (
        <div class="seg" role="group" aria-label="Ballot">
          <button type="button" aria-pressed={ballot === "ward"} onClick={() => setBallot("ward")}>
            Ward ballot
          </button>
          <button type="button" aria-pressed={ballot === "pr"} onClick={() => setBallot("pr")}>
            Party list ballot
          </button>
        </div>
      )}
      <Bars
        parties={parties}
        value={(p) => p.share}
        label={(p) => (ballot === "pr" && prev ? `${pct(p.share)} (${pointsChange(p.share, prevShare.get(p.party))})` : pct(p.share))}
      />
      <p class="source">
        {ballot === "ward"
          ? "Votes for the ward's candidates, by party. "
          : "Votes for parties' lists, which decide the rest of the council's seats. "}
        {ballot === "pr" && prev && (
          <>
            In brackets: change in percentage points since {prev.year}, adding up the {prev.year} votes in the same
            voting districts
            {prev.coverage < 0.95 && <> (these cover {Math.round(prev.coverage * 100)}% of today's voters here)</>}.{" "}
          </>
        )}
        {ballot === "pr" && !prev && row.previous && (
          <>No comparison with {row.previous.year}: too few of this ward's voting districts existed then. </>
        )}
        <SourceLine env={env} sourceKey={env.fields.parties!.source} method={env.fields.parties!.method} />
      </p>
    </section>
  );
}

function council(env: ElectionsEnvelope, code: string) {
  return env.municipalities.find((m) => m.code === code) ?? null;
}

/** City overview: the council's make-up after the latest election, then the national picture. */
export function CouncilResults({ data, code, year }: { data: AppData; code: string; year: number }) {
  const env = data.elections.find((e) => e.year === year);
  if (!env) return null;
  const m = council(env, code);
  const prevEnv = data.elections.filter((e) => e.year < year).sort((a, b) => b.year - a.year)[0];
  const prev = prevEnv ? council(prevEnv, code) : null;
  const prevSeats = new Map(prev?.parties.map((p) => [p.party, p.seats ?? 0]));
  const change = (p: PartyResult) => {
    if (!prev) return "";
    const d = (p.seats ?? 0) - (prevSeats.get(p.party) ?? 0);
    return d === 0 ? " (no change)" : ` (${d > 0 ? "+" : "−"}${Math.abs(d)})`;
  };
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
            label={(p) => `${p.seats} seat${p.seats === 1 ? "" : "s"}${change(p)}`}
          />
          {prev && prevEnv && (
            <p class="source">
              In brackets: change since the {prevEnv.year} election, when the council had {prev.seats_total} seats.
            </p>
          )}
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
                <td class="party-cell">
                  <a class="party-link" href={partyHref(p.party)}>
                    {p.party}
                  </a>
                </td>
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

