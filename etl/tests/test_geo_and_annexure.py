from pathlib import Path

import numpy as np
import pytest
import shapely

from wardmap import geo
from wardmap.config import SOURCES
from wardmap.datasets.annexure_layouts import v1


def test_assign_points_toy_squares():
    polys = np.array([shapely.box(0, 0, 1, 1), shapely.box(1, 0, 2, 1)])
    out = geo.assign_points(np.array([0.5, 1.5, 5.0]), np.array([0.5, 0.5, 5.0]), polys, [10, 20])
    assert out.tolist() == [10, 20, -1]


def test_overlay_weights_shares():
    src = np.array([shapely.box(0, 0, 2, 1)])  # one old ward split in two
    dst = np.array([shapely.box(0, 0, 1, 1), shapely.box(1, 0, 2, 1)])
    rows = geo.overlay_weights(src, [1], dst, [1, 2])
    assert sorted((s, d, round(sf, 3), round(sd, 3)) for s, d, sf, sd, _ in rows) == [
        (1, 1, 0.5, 1.0),
        (1, 2, 0.5, 1.0),
    ]


PDF = SOURCES / "annexures" / "2024-25.pdf"


@pytest.mark.skipif(not PDF.exists(), reason="annexure PDF not present")
def test_annexure_2024_25_golden():
    parsed = v1.parse(Path(PDF), first_page=2)
    # Every printed total (116 wards, 21 multi-ward blocks, 21 subcouncils, grand) was verified.
    assert len(parsed.checks) == 116 + 21 + 21 + 1
    assert parsed.checks[-1] == "grand total = [116000000, 116000000, 116000000]"
    assert len({r.ward_no for r in parsed.rows if r.ward_no}) == 116
    first = parsed.rows[0]
    assert (first.subcouncil, first.ward_no, first.wbs) == (1, 23, "WPX.0014327")
    assert first.description == "Capacity Building: Seniors - Ward 23"
    assert first.amounts == [50000, 0, 0]
    assert first.department == "Community, Arts & Culture Development"
    unalloc = next(r for r in parsed.rows if r.description.startswith("Unallocated"))
    assert unalloc.ward_no is None and unalloc.wbs is None
