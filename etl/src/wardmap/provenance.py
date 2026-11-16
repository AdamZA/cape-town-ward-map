"""Provenance sidecars for pinned source files.

Every file under sources/ has a sibling ``<name>.source.json`` saying where it came from,
when, and its sha256. Builders read the sidecar to fill the ``sources`` block of envelopes.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path

from pydantic import BaseModel

from wardmap.config import REPO


class SourceRecord(BaseModel):
    title: str
    publisher: str
    url: str
    retrieved_at: str  # ISO date
    licence: str
    sha256: str | None = None
    method: str = "download"  # download | wayback | manual
    notes: str | None = None


def sidecar_path(path: Path) -> Path:
    return path.with_name(path.name + ".source.json")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_sidecar(path: Path, record: SourceRecord) -> None:
    record = record.model_copy(update={"sha256": sha256_file(path)})
    sidecar_path(path).write_text(
        json.dumps(record.model_dump(exclude_none=True), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",  # sources are checksummed; LF on every OS (see .gitattributes)
    )
    print(f"pinned {path.relative_to(REPO)} ({record.method}, {record.retrieved_at})")


def read_sidecar(path: Path) -> SourceRecord:
    sc = sidecar_path(path)
    if not sc.exists():
        raise FileNotFoundError(f"{path} has no provenance sidecar ({sc.name}); run `wardmap pin`")
    rec = SourceRecord.model_validate_json(sc.read_text(encoding="utf-8"))
    if rec.sha256 and rec.sha256 != sha256_file(path):
        raise ValueError(f"{path} does not match the sha256 in its sidecar; re-pin it")
    return rec


def today() -> str:
    return date.today().isoformat()


def write_source_geojson(path: Path, fc: dict, record: SourceRecord) -> None:
    """Pin a GeoJSON source compactly (LF, sorted keys) with its sidecar."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(fc, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    write_sidecar(path, record)
