"""Donations declared by political parties under the Political Party Funding Act (2018).

Parties must declare every donation above the disclosure threshold to the IEC, which publishes
the declarations quarterly. Source: one spreadsheet per financial-year quarter on the IEC's
results portal. We pin the parsed rows (sources/donations/declared.csv) and publish per-party
totals and largest donors (data/donations.json).

Declarations only cover what parties declare: amounts under the threshold, and money given to
party-linked companies or foundations, are not included. The site says so.
"""

from __future__ import annotations

import io

import pandas as pd

from wardmap.config import (
    CACHE,
    IEC_FUNDING_PAGE,
    IEC_FUNDING_REPORTS,
    IEC_FUNDING_YEARS,
    IEC_LICENCE,
    SOURCES,
)
from wardmap.fetch import download
from wardmap.provenance import SourceRecord, today, write_sidecar

DIR = SOURCES / "donations"
FILE = DIR / "declared.csv"


def _report(fy: int, q: int):
    dest = CACHE / "iec" / "funding" / f"{fy}_{q}.xls"
    if not dest.exists():
        url = f"{IEC_FUNDING_REPORTS}/{fy}/{q}/{fy}_{q}_Published_Declarations_Report.xls"
        try:
            download(url, dest)
        except RuntimeError:
            return None  # quarter not published yet
    return dest


def _cell(cells: dict[int, str], cols: dict[str, int], name: str) -> str | None:
    """The cell under the header starting with `name` (headers sit above, cells may be offset)."""
    return next((cells.get(i) for k, i in cols.items() if k.startswith(name)), None)


def _parse(path, fy: int, q: int) -> tuple[list[dict], int]:
    """Declarations in one quarterly report, and the number of rows naming no donor (skipped).

    Each report has a section for the quarter and one for late submissions; each section prints
    "Total Amount Declared by <party>" lines, which the parsed rows must add up to.
    """
    raw = pd.read_excel(path, header=None, engine="calamine")
    rows: list[dict] = []
    cols: dict[str, int] | None = None
    party = None
    section = "quarter"
    no_donor = 0
    sums: dict[tuple[str, str], float] = {}
    for _, r in raw.iterrows():
        cells = {i: str(v).strip() for i, v in r.items() if pd.notna(v) and str(v).strip()}
        first = next(iter(cells.values()), "")
        if first.upper().startswith("LATE SUBMISSIONS"):
            section, cols, party = "late", None, None
            continue
        if "Party Name" in cells.values():
            cols = {v: i for i, v in cells.items()}
            continue
        if not cols:
            continue
        if first.startswith("Total Amount Declared by"):
            name = " ".join(first.removeprefix("Total Amount Declared by").split())
            printed = float(next(v for v in list(cells.values())[1:]).replace(",", ""))
            if abs(sums.get((section, name), 0.0) - printed) > 1:
                raise ValueError(
                    f"{path.name} {section} {name}: rows {sums.get((section, name))} != {printed}"
                )
            party = None
            continue
        if first.upper().startswith("TOTAL"):
            continue
        if _cell(cells, cols, "Party Name"):
            party = " ".join(_cell(cells, cols, "Party Name").split())
        date, donor = _cell(cells, cols, "Date"), _cell(cells, cols, "Donor Name")
        amount = _cell(cells, cols, "Amount")
        if party and amount and not (date and donor):
            no_donor += 1
            continue
        if not (party and date and donor and amount):
            continue
        value = float(amount.replace(",", ""))
        sums[(section, party)] = sums.get((section, party), 0.0) + value
        rows.append(
            {
                "financial_year": IEC_FUNDING_YEARS[fy],
                "quarter": q,
                "section": section,
                "party": party,
                "date": pd.to_datetime(date, dayfirst=True).date().isoformat(),
                "donor": " ".join(donor.split()),
                "type": (_cell(cells, cols, "Donation Type") or "").title(),
                "amount": round(value, 2),
            }
        )
    return rows, no_donor


def pin() -> None:
    rows: list[dict] = []
    for fy in IEC_FUNDING_YEARS:
        for q in (1, 2, 3, 4):
            path = _report(fy, q)
            if path:
                got, skipped = _parse(path, fy, q)
                print(
                    f"  {IEC_FUNDING_YEARS[fy]} Q{q}: {len(got)} declarations, {skipped} without donor"
                )
                rows += got
    df = pd.DataFrame(rows).sort_values(["date", "party", "donor", "amount"])
    DIR.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    df.to_csv(buf, index=False, lineterminator="\n")
    FILE.write_text(buf.getvalue(), encoding="utf-8", newline="\n")
    write_sidecar(
        FILE,
        SourceRecord(
            title="Party funding: published declarations reports",
            publisher="Electoral Commission of South Africa (IEC)",
            url=IEC_FUNDING_PAGE,
            retrieved_at=today(),
            licence=IEC_LICENCE,
            method="aggregated",
            notes=f"Rows parsed from the quarterly spreadsheets at {IEC_FUNDING_REPORTS}/<year>/<q>/"
            "<year>_<q>_Published_Declarations_Report.xls, financial years 2021/22 onwards "
            "(Political Party Funding Act 6 of 2018, section 9(1)).",
        ),
    )


def build() -> None:
    from wardmap.datasets.boundaries import source
    from wardmap.datasets.elections import _tidy_party
    from wardmap.datasets.landmarks import tidy
    from wardmap.models import (
        DonationRow,
        DonationsEnvelope,
        DonorTotal,
        Gap,
        PartyDonations,
        Period,
    )
    from wardmap.provenance import read_sidecar
    from wardmap.publish import write_model

    df = pd.read_csv(FILE)
    df["party"] = df["party"].map(_tidy_party)
    parties = []
    for party, g in df.groupby("party"):
        donors = (
            g.groupby("donor")
            .agg(amount=("amount", "sum"), declarations=("amount", "size"))
            .sort_values(["amount"], ascending=False, kind="stable")
            .head(10)
        )
        parties.append(
            PartyDonations(
                party=party,
                total=round(float(g["amount"].sum()), 2),
                by_financial_year={
                    fy: round(float(v), 2)
                    for fy, v in g.groupby("financial_year")["amount"].sum().items()
                },
                top_donors=[
                    DonorTotal(
                        donor=tidy(d),
                        amount=round(float(r.amount), 2),
                        declarations=int(r.declarations),
                    )
                    for d, r in donors.iterrows()
                ],
            )
        )
    parties.sort(key=lambda p: (-p.total, p.party))
    write_model(
        "donations.json",
        DonationsEnvelope(
            as_of=read_sidecar(FILE).retrieved_at,
            period=Period(start=df["date"].min(), end=df["date"].max()),
            sources={"declarations": source(FILE)},
            gaps=[
                Gap(
                    code="declared_only",
                    message="Only donations parties declared to the IEC: those above the "
                    "disclosure threshold, from April 2021. Smaller donations (reported only as "
                    "a running total without donors) and money given to party-linked companies "
                    "or foundations are not included.",
                ),
                Gap(
                    code="donor_spelling",
                    message="Donors are listed as declared. The same donor can appear under "
                    "different spellings; we don't merge them.",
                ),
            ],
            parties=parties,
            rows=[DonationRow(**r) for r in df.to_dict("records")],
        ),
    )
