"""The only code that writes to data/. Output is deterministic so that diffs are reviewable."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from wardmap.config import DATA, REPO


def _dump(obj: Any) -> str:
    return json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def write_model(name: str, model: BaseModel) -> Path:
    # Round-trip through validation so a builder can't publish something the schema rejects.
    type(model).model_validate(model.model_dump(by_alias=True))
    return write_json(name, model.model_dump(by_alias=True, exclude_none=False))


def write_json(name: str, obj: Any) -> Path:
    path = DATA / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_dump(obj), encoding="utf-8", newline="\n")
    print(f"wrote {path.relative_to(REPO)} ({path.stat().st_size / 1024:.0f} KB)")
    return path


def write_geojson(name: str, fc: dict) -> Path:
    # Compact: geometry dominates and nobody reviews coordinates by eye.
    path = DATA / name
    path.write_text(
        json.dumps(fc, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    print(f"wrote {path.relative_to(REPO)} ({path.stat().st_size / 1024:.0f} KB)")
    return path
