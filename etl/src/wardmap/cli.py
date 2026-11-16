"""Command-line entry point. `wardmap --help` lists commands."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _pin(args) -> None:
    from wardmap.datasets import allocations, boundaries, electricity, places, population

    pins = {
        "boundaries": boundaries.pin,
        "population": population.pin,
        "electricity": electricity.pin,
        "places": places.pin,
        "allocations": lambda: allocations.pin(args.year, local=args.local),
    }
    targets = list(pins) if args.dataset == "all" else [args.dataset]
    for t in targets:
        print(f"== pin {t}")
        pins[t]()


def _build(args) -> None:
    from wardmap import build

    build.build_all()


def _sr(args) -> None:
    from wardmap.datasets.service_requests import aggregate, db, outages, sync

    if args.sr_cmd == "load-csv":
        db.load_csv(Path(args.path))
    elif args.sr_cmd == "sync":
        sync.sync(full=args.full, max_delta=args.max_delta)
    elif args.sr_cmd == "assign":
        db.assign_wards()
    elif args.sr_cmd == "aggregate":
        aggregate.build()
        outages.build()


def _inspect(args) -> None:
    from wardmap.datasets.annexure_layouts import v1

    v1.inspect(Path(args.pdf), args.page)


def _schemas(args) -> None:
    from wardmap import schemas

    schemas.export()


def _check(args) -> None:
    from wardmap import check

    sys.exit(check.run())


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="wardmap", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    pin = sub.add_parser("pin", help="Fetch upstream data into sources/ (network, run locally)")
    pin.add_argument(
        "dataset",
        choices=["boundaries", "population", "electricity", "places", "allocations", "all"],
    )
    pin.add_argument("--year", default="2024-25", help="allocations: budget year, e.g. 2024-25")
    pin.add_argument("--local", action="store_true", help="allocations: use a PDF placed by hand")
    pin.set_defaults(fn=_pin)

    b = sub.add_parser("build", help="Build data/ from sources/ and the DB (offline)")
    b.set_defaults(fn=_build)

    sr = sub.add_parser("sr", help="Service-request mirror")
    srs = sr.add_subparsers(dest="sr_cmd", required=True)
    lc = srs.add_parser("load-csv", help="Bootstrap the DB from the hub's bulk CSV export")
    lc.add_argument("path")
    sy = srs.add_parser("sync", help="Apply changes from the live layer (delta by ChangedOnDT)")
    sy.add_argument("--full", action="store_true", help="Rebuild from the live layer")
    sy.add_argument("--max-delta", type=int, default=750_000)
    srs.add_parser("assign", help="Assign located requests to wards")
    srs.add_parser("aggregate", help="Write data/service_requests- and outages-<vintage>.json")
    sr.set_defaults(fn=_sr)

    ins = sub.add_parser("annexure-inspect", help="Dump words with x/y positions from a PDF page")
    ins.add_argument("pdf")
    ins.add_argument("--page", type=int, default=2)
    ins.set_defaults(fn=_inspect)

    sub.add_parser("schemas", help="Export JSON Schema for data contracts").set_defaults(
        fn=_schemas
    )
    sub.add_parser("check", help="Validate data/ and cross-file invariants").set_defaults(fn=_check)

    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
