// One party: its seats in Cape Town and nationally, and the donations it declared to the IEC.
// Profiled parties also show their stated priorities and positions (sources/parties).
import type { AppData } from "../data";
import { fmtDate, fmtInt, fmtRandShort } from "../format";
import { SourceLine } from "../panel/Figure";
import { PartyProfileView, profileFor } from "./Positions";
import { LineChart } from "../charts/LineChart";
import { fmtPct } from "../format";
import { parseHash, toHash } from "../state";
import { partyColour } from "./partyColours";

interface Props {
  data: AppData;
  party: string;
  dark: boolean;
  onClose: () => void;
}

export function PartyPanel({ data, party, dark, onClose }: Props) {
  const elections = [...data.elections].sort((a, b) => b.year - a.year);
  const latest = elections[0];
  const nat = latest?.national.find((p) => p.party === party);
  const don = data.donations?.parties.find((p) => p.party === party);
  const years = don ? Object.entries(don.by_financial_year).sort(([a], [b]) => a.localeCompare(b)) : [];
  const maxYear = Math.max(1, ...years.map(([, v]) => v));
  const maxDonor = Math.max(1, ...(don?.top_donors.map((d) => d.amount) ?? []));

  return (
    <article class="panel-body" aria-labelledby="party-title">
      <header class="panel-head">
        <div>
          <h2 id="party-title">{party}</h2>
          <p class="panel-sub">Political party</p>
        </div>
        <button type="button" class="icon-btn" onClick={onClose} aria-label="Close party details">
          ×
        </button>
      </header>

      <section class="section" aria-labelledby="party-seats">
        <h3 id="party-seats">Seats won</h3>
        <dl class="figures two-col">
          {elections.map((e) => {
            const m = e.municipalities.find((x) => x.code === "CPT");
            const p = m?.parties.find((x) => x.party === party);
            return (
              <div class="figure" key={e.year}>
                <dt>Cape Town council, {e.year}</dt>
                <dd>
                  <span class="figure-value">{p?.seats ? `${p.seats} of ${m!.seats_total}` : "None"}</span>
                  {p && <span class="figure-note">{(p.share * 100).toFixed(1)}% of party-list votes</span>}
                </dd>
              </div>
            );
          })}
          {nat && latest && (
            <div class="figure">
              <dt>All councils in South Africa, {latest.year}</dt>
              <dd>
                <span class="figure-value">{fmtInt(nat.seats)} seats</span>
                <span class="figure-note">
                  Majority in {nat.councils_majority} of {latest.municipalities.length} councils, largest party in{" "}
                  {nat.councils_largest}
                </span>
              </dd>
            </div>
          )}
        </dl>
        {latest && (
          <p class="source">
            <SourceLine env={latest} sourceKey="seats" method="elections" />
          </p>
        )}
        <LineChart
          title="Share of Cape Town's votes"
          desc={`${party}'s share of all Cape Town council votes at each local election.`}
          x={[...elections].reverse().map((e) => String(e.year))}
          series={[
            {
              key: party,
              label: party,
              colour: partyColour(party, dark),
              values: [...elections].reverse().map((e) => e.municipalities.find((x) => x.code === "CPT")?.parties.find((x) => x.party === party)?.share ?? null),
            },
          ]}
          fmt={(v) => fmtPct(v * 100)}
          tick={(v) => `${Math.round(v * 100)}%`}
          short
        />
        <p>
          <a href={toHash({ ...parseHash(location.hash), party: null, ward: null, vs: null, metric: "party_share", vote: party })}>
            Show this party's support on the map, ward by ward
          </a>
        </p>
      </section>

      {data.parties && profileFor(data.parties, party) && (
        <PartyProfileView env={data.parties} profile={profileFor(data.parties, party)!} />
      )}

      {data.donations && (
        <section class="section" aria-labelledby="party-money">
          <h3 id="party-money">Declared donations</h3>
          {!don ? (
            <p class="lede">No donations declared to the IEC since April 2021.</p>
          ) : (
            <>
              <p class="lede">
                <strong>{fmtRandShort(don.total)}</strong> declared from April 2021 to {fmtDate(data.donations.period.to.slice(0, 7))}.
              </p>
              <ul class="share-list party-list" aria-label="By financial year">
                {years.map(([fy, v]) => (
                  <li key={fy}>
                    <span class="share-label">{fy}</span>
                    <span class="share-track" aria-hidden="true">
                      <span style={{ width: `${Math.max((v / maxYear) * 100, 0.5)}%` }} />
                    </span>
                    <span class="share-value">{fmtRandShort(v)}</span>
                  </li>
                ))}
              </ul>
              <h4 class="sub-head">Largest donors</h4>
              <ul class="share-list party-list" aria-label="Largest donors">
                {don.top_donors.map((d) => (
                  <li key={d.donor}>
                    <span class="share-label">{d.donor}</span>
                    <span class="share-track" aria-hidden="true">
                      <span style={{ width: `${Math.max((d.amount / maxDonor) * 100, 0.5)}%` }} />
                    </span>
                    <span class="share-value">{fmtRandShort(d.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p class="source">
            {data.donations.gaps.map((g) => g.message).join(" ")}{" "}
            <SourceLine env={{ sources: data.donations.sources, fields: {} }} sourceKey="declarations" method="donations" />
          </p>
        </section>
      )}
    </article>
  );
}
