"""Export JSON Schema for every published contract to schemas/ (the frontend generates its
TypeScript types from these; CI fails if they drift from models.py)."""

from __future__ import annotations

import json

from wardmap.config import REPO, SCHEMAS
from wardmap.models import ENVELOPES


def export() -> None:
    SCHEMAS.mkdir(exist_ok=True)
    for name, model in ENVELOPES.items():
        path = SCHEMAS / f"{name}.schema.json"
        schema = model.model_json_schema(by_alias=True, mode="serialization")
        path.write_text(
            json.dumps(schema, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
        )
        print(f"wrote {path.relative_to(REPO)}")
