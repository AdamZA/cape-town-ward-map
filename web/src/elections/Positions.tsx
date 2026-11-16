// Party positions in their own words: one party's full profile, and one topic across parties.
import { useState } from "preact/hooks";
import type { AppData } from "../data";
import type { PartiesEnvelope, PartyProfile, Position } from "../generated/parties";
import { fmtDate } from "../format";
import { partyHref } from "../state";

const SOURCE_TYPE: Record<string, string> = {
  manifesto: "Manifesto",
  policy_document: "Policy document",
  party_statement: "Party statement",
  leader_statement: "Leader's statement",
  parliament: "In Parliament",
};

function Cite({ url, date, type }: { url: string | null | undefined; date: string | null | undefined; type?: string | null }) {
  if (!url) return null;
  return (
    <span class="source">
      {type ? `${SOURCE_TYPE[type] ?? type}, ` : ""}
      {date ? fmtDate(date) : "undated"} ·{" "}
      <a href={url} target="_blank" rel="noopener">
        source
      </a>
    </span>
  );
}

export function PositionView({ pos }: { pos: Position }) {
  if (!pos.found)
    return (
      <p class="position-none">
        No stated position found. <span class="source">Looked in: {pos.searched}</span>
      </p>
    );
  return (
    <div class="position">
      <p>{pos.summary}</p>
      {pos.quote && <blockquote>“{pos.quote}”</blockquote>}
      <Cite url={pos.url} date={pos.date} type={pos.source_type} />
    </div>
  );
}

export function profileFor(env: PartiesEnvelope | null, party: string): PartyProfile | null {
  return env?.parties.find((p) => p.name === party) ?? null;
}

/** Party panel sections: manifesto, priorities, economic approach, then positions by topic. */
export function PartyProfileView({ env, profile }: { env: PartiesEnvelope; profile: PartyProfile }) {
  return (
    <>
      <section class="section" aria-labelledby="party-plans">
        <h3 id="party-plans">What it says it will do</h3>
        {profile.manifesto ? (
          <p class="lede">
            From{" "}
            <a href={profile.manifesto.url} target="_blank" rel="noopener">
              {profile.manifesto.title}
            </a>{" "}
            ({profile.manifesto.election}
            {profile.manifesto.date ? `, ${fmtDate(profile.manifesto.date)}` : ""}).
          </p>
        ) : (
          <p class="lede">No manifesto found online.</p>
        )}
        {profile.priorities.length > 0 && (
          <ul class="priorities">
            {profile.priorities.map((p) => (
              <li key={p.text}>{p.text}</li>
            ))}
          </ul>
        )}
        {profile.economy && (
          <>
            <h4 class="sub-head">Money and the economy</h4>
            <p class="lede">{profile.economy.summary}</p>
          </>
        )}
        {profile.website && (
          <p class="source">
            Party website:{" "}
            <a href={profile.website} target="_blank" rel="noopener">
              {profile.website.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
          </p>
        )}
      </section>
      <section class="section" aria-labelledby="party-positions">
        <h3 id="party-positions">Where it stands</h3>
        {env.topics.map((t) => (
          <div key={t.key} class="position-block">
            <h4 class="sub-head">{t.label}</h4>
            <PositionView pos={profile.positions[t.key]!} />
          </div>
        ))}
        <p class="source">{env.gaps.map((g) => g.message).join(" ")}</p>
      </section>
    </>
  );
}

/** City overview: pick a topic, see every profiled party's position side by side. */
export function CompareParties({ data }: { data: AppData }) {
  const env = data.parties;
  const [topic, setTopic] = useState(env?.topics[0]?.key ?? "");
  if (!env) return null;
  return (
    <section class="section" aria-labelledby="compare-title">
      <h3 id="compare-title">Where parties stand</h3>
      <p class="lede">
        Each party's position in its own words, with the date it was said. Select a party for its full profile.
      </p>
      <div class="seg seg-wrap" role="group" aria-label="Topic">
        {env.topics.map((t) => (
          <button key={t.key} type="button" aria-pressed={topic === t.key} onClick={() => setTopic(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <ul class="compare-list">
        {env.parties.map((p) => (
          <li key={p.name}>
            <a class="party-link compare-party" href={partyHref(p.name)}>
              {p.name}
            </a>
            <PositionView pos={p.positions[topic]!} />
          </li>
        ))}
      </ul>
      <p class="source">{env.gaps.map((g) => g.message).join(" ")}</p>
    </section>
  );
}
