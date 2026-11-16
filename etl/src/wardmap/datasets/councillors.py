"""Ward councillors: who won each ward at the last local election.

Source: the IEC results dashboard's public data file for the council, which lists every ward
candidate with the seat each won. The IEC's "current councillors" page would also reflect
by-elections, but it sits behind a bot check, so we use the election result and say so.

Pinned as sources/councillors/<vintage>.csv (ward_no, name, party), which wards.py reads.
"""

from __future__ import annotations

import csv
import io
import json

from wardmap.config import (
    CACHE,
    IEC_DASHBOARD,
    IEC_DASHBOARD_DATA,
    IEC_LICENCE,
    IEC_MUNIC_IDS,
    LGE,
    SOURCES,
)
from wardmap.datasets.elections import _tidy_party
from wardmap.datasets.landmarks import tidy
from wardmap.fetch import download
from wardmap.provenance import SourceRecord, sha256_file, today, write_sidecar

MUNICIPALITY = "CPT"


def pin(year: int) -> None:
    event, vintage = LGE[year]
    url = f"{IEC_DASHBOARD_DATA}/{year}/EEID{event}Munic{IEC_MUNIC_IDS[MUNICIPALITY]}.js"
    raw = CACHE / "iec" / str(year) / f"dashboard-{MUNICIPALITY}.json"
    download(url, raw)
    data = json.loads(raw.read_text(encoding="utf-8-sig"))
    rows = []
    for ward in data["WardResults"]:
        winners = [p for p in ward["PartyBallotResults"] if p.get("WardSeatsWon") == 1]
        if len(winners) != 1:
            raise ValueError(f"ward {ward['WardID']}: {len(winners)} ward winners in IEC data")
        w = winners[0]
        rows.append(
            {
                "ward_no": int(str(ward["WardID"])[-3:]),
                "name": tidy(" ".join(w["CandidateName"].split())),
                "party": _tidy_party(w["Name"]),
            }
        )
    rows.sort(key=lambda r: r["ward_no"])
    path = SOURCES / "councillors" / f"{vintage}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["ward_no", "name", "party"], lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    path.write_text(buf.getvalue(), encoding="utf-8", newline="\n")
    write_sidecar(
        path,
        SourceRecord(
            title=f"Local Government Elections {year}: elected ward councillors",
            publisher="Electoral Commission of South Africa (IEC)",
            url=IEC_DASHBOARD,
            retrieved_at=today(),
            licence=IEC_LICENCE,
            method="aggregated",
            notes=f"Winning ward candidate per ward, from the dashboard data file {url} "
            f"(sha256 {sha256_file(raw)}). Names title-cased from the IEC's capitals. As elected; "
            "by-elections since are not reflected.",
        ),
    )
