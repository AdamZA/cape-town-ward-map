"""Parser for the ward-allocation annexure layout used in the 2024/25 budget (layout "v1").

Layout: landscape pages; header row with "WBS Element | Project Description | <year> Allocation
x3 | Department"; body grouped "Subcouncil N" > "Ward N" > project rows, with printed totals for
each ward, each subcouncil's multi-ward block, each subcouncil, and the whole annexure.

Approach: pdfplumber words -> lines (by y) -> columns (by x, from each page's own header) ->
a line classifier. Every line must classify; every printed total must match the parsed rows.
A different layout gets a new module (v2.py), not more heuristics here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber

WBS_RE = re.compile(r"^[A-Z]{2,4}\.\d{5,}(?:-[A-Z0-9]+)?$")
NUM_RE = re.compile(r"^-?\(?\d{1,3}\)?$")
FOOTER_RE = re.compile(r"Page \d+ of \d+$")
SUBCOUNCIL_RE = re.compile(r"^Subcouncil (\d+)$")
WARD_RE = re.compile(r"^Ward (\d+)$")
MULTI_RE = re.compile(r"^Multi-ward projects within Subcouncil (\d+)$")
TOTAL_WARD_RE = re.compile(r"^Total for Ward (\d+)$")
TOTAL_MULTI_RE = re.compile(r"^Total for Multi-ward projects within Subcouncil (\d+)$")
TOTAL_SC_RE = re.compile(r"^Total for Subcouncil (\d+)$")
GRAND_RE = re.compile(r"^(Grand Total|Total)$")


class ParseError(ValueError):
    pass


@dataclass
class Row:
    subcouncil: int
    ward_no: int | None
    wbs: str | None
    description: str
    department: str | None
    amounts: list[int]
    page: int


@dataclass
class Parsed:
    rows: list[Row] = field(default_factory=list)
    checks: list[str] = field(default_factory=list)  # human-readable record of totals verified


@dataclass
class Columns:
    amount_right: list[float]  # right edge of each amount column
    desc_left: float
    dept_left: float
    header_bottom: float

    def amount_col(self, x1: float) -> int | None:
        best = min(range(len(self.amount_right)), key=lambda i: abs(self.amount_right[i] - x1))
        return best if abs(self.amount_right[best] - x1) < 12 else None


def _lines(page) -> list[list[dict]]:
    words = sorted(page.extract_words(keep_blank_chars=False), key=lambda w: (w["top"], w["x0"]))
    lines: list[list[dict]] = []
    for w in words:
        if lines and abs(lines[-1][0]["top"] - w["top"]) < 2.5:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [sorted(line, key=lambda w: w["x0"]) for line in lines]


def _columns(lines: list[list[dict]]) -> Columns | None:
    alloc = desc = dept = None
    for line in lines:
        texts = [w["text"] for w in line]
        if texts.count("Allocation") >= 2:
            alloc = line
        if "Description" in texts and "Department" in texts:
            desc = next(w for w in line if w["text"] == "Project")
            dept = next(w for w in line if w["text"] == "Department")
    if not (alloc and desc and dept):
        return None
    allocs = [w for w in alloc if w["text"] == "Allocation"]
    return Columns(
        # Amounts are right-aligned a few points left of the header word's right edge.
        amount_right=[w["x1"] - 2 for w in allocs],
        desc_left=desc["x0"] - 10,
        dept_left=dept["x0"] - 5,
        header_bottom=max(w["bottom"] for w in alloc),
    )


def _amount_groups(line: list[dict], cols: Columns) -> dict[int, tuple[int, set[int]]]:
    """Find numbers in the amount columns. Thousands are separated by spaces ("1 000 000" is three
    words), so adjacent digit words are grouped and the group's right edge picks the column.
    Returns {column: (value, ids of the words used)}."""
    groups: list[list[dict]] = []
    for w in line:
        if not NUM_RE.match(w["text"]) or w["x0"] < cols.desc_left or w["x0"] >= cols.dept_left:
            groups.append([])  # a non-number breaks any group in progress
            continue
        if groups and groups[-1] and w["x0"] - groups[-1][-1]["x1"] < 5:
            groups[-1].append(w)
        else:
            groups.append([w])
    out: dict[int, tuple[int, set[int]]] = {}
    for g in filter(None, groups):
        col = cols.amount_col(g[-1]["x1"])
        if col is None:
            continue
        s = "".join(w["text"] for w in g).replace("(", "-").replace(")", "")
        if col in out:
            raise ParseError(f"two numbers in amount column {col}: {[w['text'] for w in line]}")
        out[col] = (int(s), {id(w) for w in g})
    return out


def _split(line: list[dict], cols: Columns):
    """Split a line into (label_text, wbs, description, amounts per column, department)."""
    groups = _amount_groups(line, cols)
    used = set().union(*(ids for _, ids in groups.values())) if groups else set()
    wbs = None
    desc, dept, label = [], [], []
    for w in line:
        t, x0 = w["text"], w["x0"]
        if id(w) in used:
            continue
        if wbs is None and x0 < cols.desc_left and WBS_RE.match(t):
            wbs = t
        elif x0 >= cols.dept_left:
            dept.append(t)
        elif x0 < cols.desc_left:
            label.append(t)
        else:
            desc.append(t)
    amounts = (
        [groups.get(i, (0, None))[0] for i in range(len(cols.amount_right))] if groups else None
    )
    return " ".join(label), wbs, " ".join(desc), amounts, " ".join(dept) or None


def parse(pdf_path: Path, first_page: int = 2) -> Parsed:
    out = Parsed()
    subcouncil: int | None = None
    ward: int | None = None
    in_multi = False
    unclassified: list[str] = []

    def total_of(pred) -> list[int]:
        rows = [r for r in out.rows if pred(r)]
        return (
            [sum(r.amounts[i] for r in rows) for i in range(len(rows[0].amounts))] if rows else []
        )

    def check(name: str, printed: list[int], pred) -> None:
        got = total_of(pred) or [0] * len(printed)
        if got != printed:
            raise ParseError(f"{name}: printed total {printed} != parsed {got}")
        out.checks.append(f"{name} = {printed}")

    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages[first_page - 1 :], start=first_page):
            lines = _lines(page)
            cols = _columns(lines)
            if cols is None:
                raise ParseError(f"page {pno}: header row not found")
            for line in lines:
                if line[0]["top"] <= cols.header_bottom:
                    continue  # page title and column headers
                text = " ".join(w["text"] for w in line)
                if FOOTER_RE.search(text):
                    continue
                label, wbs, desc, amounts, dept = _split(line, cols)
                head = (label + " " + desc).strip()

                if m := SUBCOUNCIL_RE.match(text):
                    subcouncil, ward, in_multi = int(m[1]), None, False
                elif m := WARD_RE.match(text):
                    ward, in_multi = int(m[1]), False
                elif m := MULTI_RE.match(text):
                    ward, in_multi = None, True
                elif (m := TOTAL_WARD_RE.match(head)) and amounts:
                    w = int(m[1])
                    check(f"ward {w}", amounts, lambda r, w=w: r.ward_no == w)
                elif (m := TOTAL_MULTI_RE.match(head)) and amounts:
                    s = int(m[1])
                    check(
                        f"subcouncil {s} multi-ward",
                        amounts,
                        lambda r, s=s: r.subcouncil == s and r.ward_no is None,
                    )
                elif (m := TOTAL_SC_RE.match(head)) and amounts:
                    s = int(m[1])
                    check(f"subcouncil {s}", amounts, lambda r, s=s: r.subcouncil == s)
                elif GRAND_RE.match(head) and amounts:
                    check("grand total", amounts, lambda r: True)
                elif amounts is not None and (wbs or desc):
                    if subcouncil is None or (ward is None and not in_multi):
                        raise ParseError(f"page {pno}: project row outside a ward: {text!r}")
                    out.rows.append(Row(subcouncil, ward, wbs, desc, dept, amounts, pno))
                elif amounts is None and out.rows and (desc or dept) and not label:
                    # Wrapped description/department continuing the previous row.
                    prev = out.rows[-1]
                    if desc:
                        prev.description = f"{prev.description} {desc}"
                    if dept:
                        prev.department = f"{prev.department or ''} {dept}".strip()
                else:
                    unclassified.append(f"p{pno}: {text}")
    if unclassified:
        raise ParseError("unclassified lines:\n  " + "\n  ".join(unclassified[:40]))
    if not any(c.startswith("grand total") for c in out.checks):
        out.checks.append("grand total: not printed in this annexure")
    return out


def inspect(pdf_path: Path, page: int) -> None:
    """Print each line's words with x positions, to help write or debug a layout."""
    with pdfplumber.open(pdf_path) as pdf:
        for line in _lines(pdf.pages[page - 1]):
            print(
                f"{line[0]['top']:7.1f} "
                + "  ".join(f"{w['text']}@{w['x0']:.0f}-{w['x1']:.0f}" for w in line)
            )
