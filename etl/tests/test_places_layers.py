from wardmap.datasets.land_use import group_areas
from wardmap.datasets.landmarks import tidy


def test_tidy_names():
    assert tidy("GORDON'S BAY CDC") == "Gordon's Bay CDC"
    assert tidy("KING EDWARD VII") == "King Edward VII"
    assert tidy("VRYSTAAT (FREE STATE) ANCHOR") == "Vrystaat (Free State) Anchor"
    assert tidy("MULTI-PURPOSE CENTRE") == "Multi-Purpose Centre"
    assert tidy("Already Mixed case") == "Already Mixed case"


def test_group_areas_excludes_roads_and_unzoned():
    groups, excluded = group_areas({"R1": 100, "GR2": 50, "TR2": 30, "none": 20, "XX9": 5})
    assert groups["houses"] == 100
    assert groups["flats_group_housing"] == 50
    assert excluded == 55  # roads, unzoned, and codes we don't know
