"""Party profiles: stated priorities and positions, in each party's own words.

Hand-curated in sources/parties/profiles-<year>.yaml (researched from manifestos, policy
documents and official statements; every quote checked against its source text). This module
validates the file and publishes data/parties.json. Rules enforced here:

- every position is either found (summary, verbatim quote of at most 30 words, URL, date,
  source type) or not found (with a note of where we looked);
- every party has a position entry for every topic, so no party is silently skipped.
"""

from __future__ import annotations

import yaml

from wardmap.config import SOURCES
from wardmap.datasets.boundaries import source
from wardmap.models import Gap, PartiesEnvelope, PartyProfile, Position, Topic
from wardmap.provenance import SourceRecord, read_sidecar, today, write_sidecar
from wardmap.publish import write_model

YEAR = 2026
FILE = SOURCES / "parties" / f"profiles-{YEAR}.yaml"
MAX_QUOTE_WORDS = 30
SOURCE_TYPES = {"manifesto", "policy_document", "party_statement", "leader_statement", "parliament"}

# Display order. The first four were asked for first by the project's users.
TOPICS = {
    "lgbtq": "LGBTQ+ rights",
    "human_rights": "Human rights and civil liberties",
    "israel_palestine": "Israel and Palestine",
    "policing": "Policing and crime",
    "housing_land": "Housing and land",
    "immigration": "Immigration",
}


def pin_sidecar() -> None:
    """The YAML is written by hand; this records its provenance."""
    write_sidecar(
        FILE,
        SourceRecord(
            title=f"Party profiles for the {YEAR} local elections",
            publisher="Cape Town Ward Map (compiled from parties' own documents and statements)",
            url="https://github.com/AdamZA/cape-town-ward-map/blob/main/sources/parties/"
            f"profiles-{YEAR}.yaml",
            retrieved_at=today(),
            licence="Short quotations for comment and reporting; each links to its source",
            method="manual",
            notes="Researched November 2026 with an AI research agent; every quote checked "
            "against the downloaded source text. Each entry cites its own URL and date.",
        ),
    )


def _check(p: PartyProfile) -> list[str]:
    errs = []
    if set(p.positions) != set(TOPICS):
        errs.append(f"{p.name}: topics {sorted(p.positions)} != {sorted(TOPICS)}")
    for key, pos in p.positions.items():
        where = f"{p.name} / {key}"
        if pos.found:
            if not (pos.summary and pos.quote and pos.url and pos.source_type):
                errs.append(f"{where}: found but missing summary, quote, url or source_type")
            if pos.quote and len(pos.quote.split()) > MAX_QUOTE_WORDS:
                errs.append(f"{where}: quote longer than {MAX_QUOTE_WORDS} words")
            if pos.source_type and pos.source_type not in SOURCE_TYPES:
                errs.append(f"{where}: unknown source_type {pos.source_type}")
        elif not pos.searched:
            errs.append(f"{where}: not found, but no note of where we looked")
    return errs


def build() -> None:
    raw = yaml.safe_load(FILE.read_text(encoding="utf-8"))
    parties = []
    for entry in raw["parties"]:
        positions = {
            k: Position(
                found="found" not in v or v["found"], **{x: y for x, y in v.items() if x != "found"}
            )
            for k, v in entry.pop("positions").items()
        }
        for k in ("date",):
            if entry.get("manifesto") and entry["manifesto"].get(k) is not None:
                entry["manifesto"][k] = str(entry["manifesto"][k])
        parties.append(PartyProfile(**entry, positions=positions))
    errs = [e for p in parties for e in _check(p)]
    if errs:
        raise ValueError("party profiles:\n  " + "\n  ".join(errs))
    write_model(
        "parties.json",
        PartiesEnvelope(
            as_of=read_sidecar(FILE).retrieved_at,
            sources={"profiles": source(FILE)},
            gaps=[
                Gap(
                    code="own_words",
                    message="Positions are the parties' own words: manifestos, policy documents, "
                    "official statements and leaders' statements, each with its date. Some are "
                    "years old or reached through a news report quoting the party. 'No stated "
                    "position found' means we looked and found none, not that the party has no "
                    "view.",
                ),
                Gap(
                    code="national_issues",
                    message="Foreign policy, constitutional rights and immigration are national "
                    "matters, not decided by city councils. They're shown because they matter to "
                    "voters.",
                ),
            ],
            topics=[Topic(key=k, label=v) for k, v in TOPICS.items()],
            parties=parties,
        ),
    )
