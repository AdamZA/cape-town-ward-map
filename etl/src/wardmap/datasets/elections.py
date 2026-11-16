"""Local government election results, for the whole country.

Source: the IEC's results portal publishes static report files per election:

- "Downloadable Party Results/<PROVINCE>.csv": votes for every party at every voting district,
  per ballot (Ward, PR, DC 40%). About 15 MB per province, so we don't commit them. At pin time
  we add them up to ward level and pin that (votes.csv.gz, turnout.csv.gz).
- "Seat Calculation Detail/<PROVINCE>/<CODE>.xls": seats won per party in each council. We pin
  the parsed table (seats.csv).

District councils (DC 40% ballot) are left out for now: they overlap the local councils.
The national file covers every metro and local council; ward-level results are published for
Cape Town (other municipalities follow when their areas are added to the site).
"""

from __future__ import annotations

import gzip
import io
import json
import re
from pathlib import Path

import pandas as pd

from wardmap.config import (
    CACHE,
    IEC_LICENCE,
    IEC_PROVINCES,
    IEC_REPORTS,
    IEC_RESULTS_PAGE,
    LGE,
    METROS,
    SOURCES,
)
from wardmap.fetch import download
from wardmap.models import (
    ElectionsEnvelope,
    ElectionWardsEnvelope,
    FieldMeta,
    Gap,
    MunicipalityResult,
    NationalParty,
    PartyResult,
    Source,
    WardElectionRow,
)
from wardmap.provenance import SourceRecord, read_sidecar, sha256_file, today, write_sidecar
from wardmap.publish import write_model

MAX_PARTIES = 12
MAX_WARD_PARTIES = 8
WARD_MUNICIPALITIES = ("CPT",)


def _dir(year: int) -> Path:
    return SOURCES / "elections" / f"lge-{year}"


def _url(year: int, *parts: str) -> str:
    return "/".join([IEC_REPORTS, str(LGE[year][0]), *parts]).replace(" ", "%20")


def _write_gz_csv(df: pd.DataFrame, path: Path) -> None:
    """Deterministic gzip (no timestamp), so re-pinning identical data gives identical bytes."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, filename="") as gz:
        gz.write(df.to_csv(index=False, lineterminator="\n").encode("utf-8"))
    path.write_bytes(buf.getvalue())


# ---- pin ----------------------------------------------------------------------------------------


def _province_csv(year: int, prov: str) -> Path:
    dest = CACHE / "iec" / str(year) / f"{prov}.csv"
    if not dest.exists():
        download(_url(year, "Downloadable Party Results", f"{prov}.csv"), dest)
    return dest


def _aggregate(path: Path, prov: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    d = pd.read_csv(path, encoding="utf-8-sig", dtype={"Ward": str})
    d = d[d["BallotType"].isin(["Ward", "PR"])]
    muni = d["Municipality"].str.split(" - ", n=1, expand=True)
    d = d.assign(
        province=prov,
        muni=muni[0].str.strip(),
        muni_name=muni[1].str.strip(),
        ward=d["Ward"].str.extract(r"(\d+)", expand=False),
        ballot=d["BallotType"],
    )
    votes = (
        d.groupby(["province", "muni", "muni_name", "ward", "ballot", "PartyName"], as_index=False)[
            "TotalValidVotes"
        ]
        .sum()
        .rename(columns={"PartyName": "party", "TotalValidVotes": "votes"})
    )
    # Registered voters and spoilt ballots repeat on every party row of a voting district.
    vd = d.drop_duplicates(["muni", "ward", "VotingDistrict", "ballot"])
    turnout = vd.groupby(["province", "muni", "ward", "ballot"], as_index=False)[
        ["RegisteredVoters", "SpoiltVotes"]
    ].sum()
    turnout = turnout.rename(columns={"RegisteredVoters": "registered", "SpoiltVotes": "spoilt"})
    return votes, turnout


def _seats(year: int, prov: str, code: str) -> pd.DataFrame:
    dest = CACHE / "iec" / str(year) / "seats" / f"{code}.xls"
    if not dest.exists():
        download(_url(year, "Seat Calculation Detail", prov, f"{code}.xls"), dest)
    raw = pd.read_excel(dest, header=None, engine="calamine")
    head = raw.index[raw[0].astype(str).str.strip() == "Party Name"][0]
    cols = {str(v).strip(): i for i, v in raw.loc[head].items() if pd.notna(v)}
    seat_col = cols["Total Party Seats"]
    # Council size (B) includes independent ward councillors, who aren't in the party table.
    label = raw[0].astype(str).str.strip()
    b_row = raw.loc[label.str.startswith("Total Seats Available")].iloc[0]
    council_seats = int(next(v for v in b_row.iloc[1:] if pd.notna(v)))
    vote_col = cols["Total Valid Votes"]
    rows = []
    # The party table can run over several printed pages: skip blank and repeated header rows,
    # and read until the "Total" row, which must match the parties' seats.
    total = None
    for _, r in raw.loc[head + 1 :].iterrows():
        name = r[0]
        if pd.isna(name) or not str(name).strip() or str(name).strip() == "Party Name":
            continue
        if pd.isna(r[seat_col]) or pd.isna(r[vote_col]):
            continue  # page furniture (titles, printed-on lines)
        if str(name).strip().lower() == "total":
            total = int(r[seat_col])
            break
        rows.append(
            {
                "muni": code,
                "party": " ".join(str(name).split()),
                "votes": int(r[vote_col]),
                "seats": int(r[seat_col]),
                "council_seats": council_seats,
            }
        )
    if total is None or total != sum(x["seats"] for x in rows):
        raise ValueError(f"{code}: party seats don't add up to the printed total {total}")
    return pd.DataFrame(rows)


def pin(year: int) -> None:
    out = _dir(year)
    out.mkdir(parents=True, exist_ok=True)
    votes, turnout, seats, upstream = [], [], [], {}
    for prov in IEC_PROVINCES:
        path = _province_csv(year, prov)
        upstream[f"{prov}.csv"] = sha256_file(path)
        v, t = _aggregate(path, prov)
        votes.append(v)
        turnout.append(t)
        for code in sorted(v["muni"].unique()):
            seats.append(_seats(year, prov, code))
        print(f"  {prov}: {v['muni'].nunique()} councils")
    votes_df = pd.concat(votes).sort_values(["muni", "ward", "ballot", "party"])
    turnout_df = pd.concat(turnout).sort_values(["muni", "ward", "ballot"])
    seats_df = pd.concat(seats).sort_values(["muni", "party"])
    _write_gz_csv(votes_df, out / "votes.csv.gz")
    _write_gz_csv(turnout_df, out / "turnout.csv.gz")
    (out / "seats.csv").write_text(
        seats_df.to_csv(index=False, lineterminator="\n"), encoding="utf-8", newline="\n"
    )
    files = {
        "votes.csv.gz": "Valid votes per party per ward and ballot (Ward, PR), summed from "
        "voting districts",
        "turnout.csv.gz": "Registered voters and spoilt ballots per ward and ballot, summed from "
        "voting districts",
        "seats.csv": "Seats won per party per council, from each council's seat calculation",
    }
    for name, what in files.items():
        write_sidecar(
            out / name,
            SourceRecord(
                title=f"Local Government Elections {year}: results",
                publisher="Electoral Commission of South Africa (IEC)",
                url=IEC_RESULTS_PAGE,
                retrieved_at=today(),
                licence=IEC_LICENCE,
                method="aggregated",
                notes=f"{what}. Built from {_url(year, '...')}; upstream sha256: "
                + json.dumps(upstream, sort_keys=True),
            ),
        )


# ---- build --------------------------------------------------------------------------------------


# Parties whose own spelling title-casing gets wrong (as written on their IEC registration).
PARTY_SPELLING = {
    "ACTIONSA": "ActionSA",
    "GOOD": "GOOD",
    "AL JAMA-AH": "Al Jama-ah",
    "UMKHONTO WESIZWE PARTY": "uMkhonto weSizwe Party",
}


def _tidy_party(name: str) -> str:
    from wardmap.datasets.landmarks import tidy

    return PARTY_SPELLING.get(name.strip().upper(), tidy(name))


def _source(year: int, name: str) -> Source:
    rec = read_sidecar(_dir(year) / name)
    return Source(
        title=rec.title,
        publisher=rec.publisher,
        url=rec.url,
        retrieved_at=rec.retrieved_at,
        licence=rec.licence,
        notes=rec.notes,
    )


def build(year: int) -> None:
    d = _dir(year)
    vintage = LGE[year][1]
    votes = pd.read_csv(d / "votes.csv.gz", dtype={"ward": str})
    turnout = pd.read_csv(d / "turnout.csv.gz", dtype={"ward": str})
    seats = pd.read_csv(d / "seats.csv")
    # Markers on the seat calculation, stripped from names and stated as gaps instead:
    #   "*"    the party won more ward seats than its proportional share (votes left out of quota)
    #   "(PF)" potential forfeiture: fewer candidates on its list than seats won
    excess = seats[seats["party"].str.rstrip().str.endswith("*")]
    forfeit = seats[seats["party"].str.contains(r"\(PF\)\s*$", regex=True)]
    seats["party"] = seats["party"].str.replace(r"\s*(\*|\(PF\))\s*$", "", regex=True)
    votes["party"] = votes["party"].map(_tidy_party)
    seats["party"] = seats["party"].map(_tidy_party)

    def clean(name: str) -> str:
        return _tidy_party(re.sub(r"\s*(\*|\(PF\))\s*$", "", name))

    excess_gaps = [
        Gap(
            code="excess_seats",
            message=f"{r.muni}: {clean(r.party)} won more ward seats than its share of the vote "
            "gives it, so its votes were left out of the quota used to share out the other "
            "seats (IEC seat calculation).",
        )
        for r in excess.itertuples()
    ] + [
        Gap(
            code="potential_forfeiture",
            message=f"{r.muni}: {clean(r.party)} won {r.seats} seats but listed fewer candidates; "
            "it must name more or may lose a seat (IEC seat calculation, 'potential forfeiture').",
        )
        for r in forfeit.itertuples()
    ]

    munis: list[MunicipalityResult] = []
    for code, mv in votes[votes["ballot"] == "PR"].groupby("muni"):
        name = mv["muni_name"].iloc[0]
        prov = IEC_PROVINCES[mv["province"].iloc[0]]
        pr = mv.groupby("party")["votes"].sum()
        valid = int(pr.sum())
        t = turnout[(turnout["muni"] == code) & (turnout["ballot"] == "PR")]
        registered = int(t["registered"].sum())
        cast = valid + int(t["spoilt"].sum())
        ms = seats[seats["muni"] == code]
        s = ms.set_index("party")["seats"]
        total = int(ms["council_seats"].iloc[0])
        ranked = sorted(pr.index, key=lambda p: (-int(s.get(p, 0)), -int(pr[p]), p))
        keep = [p for p in ranked if s.get(p, 0) > 0]
        keep += [p for p in ranked if p not in keep][: max(0, MAX_PARTIES - len(keep))]
        largest = ranked[0]
        munis.append(
            MunicipalityResult(
                code=code,
                name=name,
                province=prov,
                kind="metro" if code in METROS else "local",
                seats_total=total,
                independent_seats=total - int(s.sum()),
                registered=registered,
                turnout=round(cast / registered, 4) if registered else 0.0,
                largest_party=largest,
                majority=int(s.get(largest, 0)) * 2 > total,
                parties=[
                    PartyResult(
                        party=p,
                        votes=int(pr[p]),
                        share=round(int(pr[p]) / valid, 4) if valid else 0.0,
                        seats=int(s.get(p, 0)),
                    )
                    for p in keep
                ],
            )
        )
    munis.sort(key=lambda m: m.code)

    national: dict[str, dict[str, int]] = {}
    for m in munis:
        for p in m.parties:
            if p.seats:
                n = national.setdefault(
                    p.party, {"seats": 0, "largest": 0, "majority": 0, "reg": 0}
                )
                n["seats"] += p.seats
        n = national[m.largest_party]
        n["largest"] += 1
        if m.majority:
            n["majority"] += 1
            n["reg"] += m.registered
    nat = sorted(
        (
            NationalParty(
                party=p,
                seats=v["seats"],
                councils_largest=v["largest"],
                councils_majority=v["majority"],
                registered_in_majority=v["reg"],
            )
            for p, v in national.items()
        ),
        key=lambda x: (-x.seats, x.party),
    )
    sources = {
        "votes": _source(year, "votes.csv.gz"),
        "turnout": _source(year, "turnout.csv.gz"),
        "seats": _source(year, "seats.csv"),
    }
    common = {
        "ward_vintage": vintage,
        "as_of": str(year),
        "sources": sources,
    }
    write_model(
        f"elections-{year}.json",
        ElectionsEnvelope(
            **common,
            year=year,
            fields={
                "seats": FieldMeta(label="Council seats", source="seats", method="elections"),
                "votes": FieldMeta(
                    label="Votes (PR ballot)",
                    source="votes",
                    method="elections",
                    description="Votes for the party list. Residents also vote for a ward "
                    "candidate on a separate ballot.",
                ),
                "turnout": FieldMeta(
                    label="Turnout",
                    unit="share",
                    source="turnout",
                    method="elections",
                    description="Ballots cast (including spoilt) as a share of registered voters.",
                ),
            },
            gaps=[
                Gap(
                    code="no_district_councils",
                    message="District councils are not included; they overlap the local "
                    "councils listed here.",
                ),
                Gap(
                    code="seats_at_election",
                    message="Seats as allocated after the election. By-elections, floor "
                    "crossings and coalition changes since then are not reflected.",
                ),
                *excess_gaps,
            ],
            municipalities=munis,
            national=nat,
        ),
    )

    for code in WARD_MUNICIPALITIES:
        wv = votes[(votes["muni"] == code) & (votes["ballot"] == "Ward")]
        wt = turnout[(turnout["muni"] == code) & (turnout["ballot"] == "Ward")]
        rows = []
        for ward, g in wv.groupby("ward"):
            by = g.groupby("party")["votes"].sum().sort_values(ascending=False, kind="stable")
            valid = int(by.sum())
            t = wt[wt["ward"] == ward]
            reg = int(t["registered"].sum())
            rows.append(
                WardElectionRow(
                    ward_no=int(str(ward)[-3:]),
                    registered=reg,
                    turnout=round((valid + int(t["spoilt"].sum())) / reg, 4) if reg else 0.0,
                    winner=str(by.index[0]),
                    parties=[
                        PartyResult(party=str(p), votes=int(v), share=round(int(v) / valid, 4))
                        for p, v in by.head(MAX_WARD_PARTIES).items()
                        if v > 0
                    ],
                )
            )
        rows.sort(key=lambda r: r.ward_no)
        write_model(
            f"election_wards-{code}-{year}.json",
            ElectionWardsEnvelope(
                **common,
                year=year,
                municipality=code,
                fields={
                    "parties": FieldMeta(
                        label="Ward ballot",
                        source="votes",
                        method="elections",
                        description="Votes for ward candidates, by party (or independent).",
                    ),
                    "turnout": FieldMeta(
                        label="Turnout",
                        unit="share",
                        source="turnout",
                        method="elections",
                        description="Ballots cast (including spoilt) as a share of registered "
                        "voters, ward ballot.",
                    ),
                },
                rows=rows,
            ),
        )


def years() -> list[int]:
    return sorted(y for y in LGE if (_dir(y) / "seats.csv").exists())
