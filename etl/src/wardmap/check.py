"""Validate data/ against the contracts and cross-file invariants. Returns a process exit code.

This is the main safety net: CI runs it on every change, and refresh workflows run it before
opening a PR.
"""

from __future__ import annotations

import json

from wardmap.config import DATA, VINTAGE_WARD_COUNT
from wardmap.models import ENVELOPES, Index


def _party(name: str) -> str:
    from wardmap.datasets.elections import _tidy_party

    return _tidy_party(name)


def run() -> int:
    errors: list[str] = []

    def err(msg: str) -> None:
        errors.append(msg)

    index = Index.model_validate_json((DATA / "index.json").read_text(encoding="utf-8"))
    for b in index.boundaries:
        fc = json.loads((DATA / b.file).read_text(encoding="utf-8"))
        nos = sorted(f["properties"]["ward_no"] for f in fc["features"])
        if nos != list(range(1, VINTAGE_WARD_COUNT[b.ward_vintage] + 1)):
            err(f"{b.file}: ward set is not 1..{VINTAGE_WARD_COUNT[b.ward_vintage]}")

    for entry in index.datasets:
        path = DATA / entry.file
        if not path.exists():
            err(f"{entry.file}: listed in index.json but missing")
            continue
        model = ENVELOPES[entry.dataset]
        try:
            env = model.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            err(f"{entry.file}: does not match schema: {e}")
            continue
        if entry.dataset == "parties":
            continue  # validated when built (datasets/parties.py)
        if entry.dataset == "donations":
            # Not ward data: check that every party's total adds up from its rows.
            for p in env.parties:
                rows = sum(r.amount for r in env.rows if _party(r.party) == p.party)
                if abs(rows - p.total) > 1:
                    err(f"{entry.file}: {p.party} total {p.total} != rows {rows}")
            continue
        if env.ward_vintage != entry.ward_vintage:
            err(f"{entry.file}: vintage {env.ward_vintage} != index {entry.ward_vintage}")
        expected = set(range(1, VINTAGE_WARD_COUNT[env.ward_vintage] + 1))

        # Every field and gap must point at a declared source; no figure without provenance.
        for name, fm in env.fields.items():
            if fm.source not in env.sources:
                err(f"{entry.file}: field {name!r} cites unknown source {fm.source!r}")

        if entry.dataset in ("wards", "service_requests", "land_use", "crime"):
            nos = [r.ward_no for r in env.rows]
            if sorted(nos) != sorted(expected):
                err(f"{entry.file}: rows are not exactly wards 1..{len(expected)}")
        if entry.dataset == "wards":
            pops = [r.population for r in env.rows if r.population is not None]
            if pops and not all(5_000 < p < 200_000 for p in pops):
                err(f"{entry.file}: implausible ward population {min(pops)}..{max(pops)}")
        if entry.dataset == "service_requests":
            for r in [*env.rows, env.citywide]:
                for f in ("pct_no_completion", "pct_closed_30d", "pct_located"):
                    v = getattr(r, f)
                    if v is not None and not 0 <= v <= 100:
                        err(f"{entry.file}: ward {r.ward_no} {f}={v} out of range")
                if r.median_days is not None and r.median_days < 0:
                    err(f"{entry.file}: ward {r.ward_no} negative median")
        if entry.dataset == "land_use":
            for r in env.rows:
                total = sum(r.shares.values())
                if r.zoned_km2 > 0 and abs(total - 1) > 0.01:
                    err(f"{entry.file}: ward {r.ward_no} shares sum to {total:.3f}")
        if entry.dataset == "landmarks":
            bad = {r.category for r in env.rows} - {c.key for c in env.categories}
            if bad:
                err(f"{entry.file}: rows with unlabelled categories {sorted(bad)}")
            stray = [
                r.ward_no for r in env.rows if r.ward_no is not None and r.ward_no not in expected
            ]
            if stray:
                err(f"{entry.file}: places in unknown wards {sorted(set(stray))[:10]}")
        if entry.dataset == "election_wards":
            nos = sorted(r.ward_no for r in env.rows)
            if nos != sorted(expected):
                err(f"{entry.file}: rows are not exactly wards 1..{len(expected)}")
        if entry.dataset == "election_wards" and env.ward_vintage == index.default_vintage:
            wards_entry = next(e for e in index.datasets if e.dataset == "wards")
            wards_env = ENVELOPES["wards"].model_validate_json(
                (DATA / wards_entry.file).read_text("utf-8")
            )
            for r in wards_env.rows:
                won = next((x.winner for x in env.rows if x.ward_no == r.ward_no), None)
                if r.councillor and r.councillor.party and r.councillor.party != won:
                    err(
                        f"ward {r.ward_no}: councillor's party {r.councillor.party} != winner {won}"
                    )
        if entry.dataset == "elections":
            for m in env.municipalities:
                won = sum(p.seats or 0 for p in m.parties)
                if won + m.independent_seats != m.seats_total or m.independent_seats < 0:
                    err(f"{entry.file}: {m.code} party seats {won} vs council {m.seats_total}")
                if not 0.05 < m.turnout < 1:
                    err(f"{entry.file}: {m.code} implausible turnout {m.turnout}")
        if entry.dataset == "allocations":
            wards = {r.ward_no for r in env.rows if r.ward_no is not None}
            if wards != expected:
                err(f"{entry.file}: wards differ from {env.ward_vintage} set")
            for r in env.rows:
                if set(r.amounts) != set(env.years):
                    err(f"{entry.file}: row {r.wbs} has years {sorted(r.amounts)}")
        if entry.dataset == "crosswalk":
            to_share: dict[int, float] = {}
            for r in env.rows:
                to_share[r.to_ward] = to_share.get(r.to_ward, 0) + r.share_of_to
            # Boundary sets from different publishers differ at the edges (reported as gaps),
            # but a ward mostly uncovered means something is wrong.
            bad = {w: s for w, s in to_share.items() if not 0.9 <= s <= 1.01}
            if bad:
                err(f"{entry.file}: shares don't sum to ~1 for wards {sorted(bad)[:10]}")
            flagged = {g.ward_no for g in env.gaps if g.code == "edge_mismatch"}
            missing = {w for w, s in to_share.items() if s < 0.98} - flagged
            if missing:
                err(f"{entry.file}: wards {sorted(missing)} under-covered but not flagged")

    for e in errors:
        print(f"CHECK FAILED: {e}")
    if not errors:
        print(f"check ok: {len(index.datasets)} datasets, {len(index.boundaries)} boundary files")
    return 1 if errors else 0
