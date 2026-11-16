import { describe, expect, it } from "vitest";
import { fmtDate, fmtRand, fmtUnit } from "../src/format";
import { legendEntries, quantileScale, RAMP } from "../src/map/scales";
import { predecessors } from "../src/panel/Allocations";
import { parseHash, toHash } from "../src/state";
import { suggest } from "../src/search/Search";
import { bbox, inPolygon } from "../src/geo";
import { standing } from "../src/metrics";
import { characterLine } from "../src/places/places";
import { wardResult } from "../src/elections/Elections";
import type { AppData } from "../src/data";
import type { AllocationsEnvelope } from "../src/generated/allocations";
import type { CrosswalkEnvelope } from "../src/generated/crosswalk";

describe("quantileScale", () => {
  it("assigns low values to the lightest class and high to the darkest", () => {
    const s = quantileScale([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.classOf(1)).toBe(0);
    expect(s.classOf(10)).toBe(RAMP.length - 1);
  });
  it("treats null as no data", () => {
    expect(quantileScale([1, 2, null]).classOf(null)).toBe(-1);
  });
  it("collapses tied breaks instead of producing empty classes", () => {
    const s = quantileScale([2, 2, 2, 2, 2, 2, 3, 3, 9]);
    expect(new Set(s.breaks).size).toBe(s.breaks.length);
    expect(s.classOf(2)).toBe(0);
    expect(s.classOf(9)).toBe(RAMP.length - 1);
  });
  it("legend covers min to max", () => {
    const s = quantileScale([10, 20, 30, 40, 50]);
    const e = legendEntries(s, String);
    expect(e[0]![1]).toMatch(/^10 /);
    expect(e[e.length - 1]![1]).toMatch(/50$/);
  });
});

describe("format", () => {
  it("formats rand with South African separators", () => {
    expect(fmtRand(1000000).replace(/\s/g, " ")).toBe("R1 000 000");
  });
  it("formats days and percentages by unit", () => {
    expect(fmtUnit(1, "days")).toBe("1 day");
    expect(fmtUnit(73.84, "%")).toBe("73.8%");
  });
  it("formats ISO dates and year-months", () => {
    expect(fmtDate("2026-11-13")).toBe("13 Nov 2026");
    expect(fmtDate("2024-05")).toBe("May 2024");
  });
});

describe("hash state", () => {
  it("round-trips", () => {
    const s = parseHash("#ward=57&metric=median_days");
    expect(s).toEqual({ ward: 57, metric: "median_days", city: false, layers: [] });
    expect(parseHash(toHash(s))).toEqual(s);
  });
  it("ignores junk", () => {
    expect(parseHash("#ward=abc&metric=nope")).toEqual({ ward: null, metric: "pct_closed_30d", city: false, layers: [] });
  });
  it("keeps the city overview only when no ward is open", () => {
    expect(parseHash(toHash({ ward: null, metric: "water_days", city: true, layers: [] }))).toEqual({ ward: null, metric: "water_days", city: true, layers: [] });
    expect(toHash({ ward: 3, metric: "pct_closed_30d", city: true, layers: [] })).toBe("#ward=3");
  });
  it("keeps place layers, dropping junk", () => {
    const s = parseHash("#layers=police,clinics,<b>");
    expect(s.layers).toEqual(["police", "clinics"]);
    expect(parseHash(toHash(s)).layers).toEqual(["police", "clinics"]);
  });
});

describe("predecessors", () => {
  const budget = { ward_vintage: 2021 } as AllocationsEnvelope;
  const crosswalk = {
    from_vintage: 2021,
    rows: [
      { from_ward: 3, to_ward: 7, share_of_from: 0.5, share_of_to: 0.7 },
      { from_ward: 4, to_ward: 7, share_of_from: 0.2, share_of_to: 0.28 },
      { from_ward: 5, to_ward: 7, share_of_from: 0.01, share_of_to: 0.02 },
    ],
  } as CrosswalkEnvelope;
  it("lists overlapping older wards by share, dropping slivers", () => {
    expect(predecessors(7, 2026, budget, crosswalk)).toEqual([
      { ward: 3, share: 0.7 },
      { ward: 4, share: 0.28 },
    ]);
  });
  it("is the ward itself when the budget uses the same boundaries", () => {
    expect(predecessors(7, 2021, budget, crosswalk)).toEqual([{ ward: 7, share: 1 }]);
  });
});

describe("search", () => {
  const places = [
    { name: "Observatory", bbox: [0, 0, 1, 1], wards: [{ ward_no: 53, share: 0.7 }, { ward_no: 92, share: 0.3 }] },
    { name: "Mowbray", bbox: [0, 0, 1, 1], wards: [{ ward_no: 59, share: 1 }] },
    { name: "Wynberg Observatory Hill", bbox: [0, 0, 1, 1], wards: [{ ward_no: 62, share: 1 }] },
  ];
  it("puts a ward number first, then suburbs starting with the query, then containing it", () => {
    expect(suggest("5", places, 118)[0]).toEqual({ kind: "ward", ward: 5 });
    expect(suggest("ward 12", places, 118)[0]).toEqual({ kind: "ward", ward: 12 });
    expect(suggest("obs", places, 118).map((s) => (s.kind === "place" ? s.place.name : s.ward))).toEqual([
      "Observatory",
      "Wynberg Observatory Hill",
    ]);
  });
  it("ignores out-of-range ward numbers", () => {
    expect(suggest("200", places, 118)).toEqual([]);
  });
});

describe("geometry", () => {
  const square = { type: "Polygon" as const, coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] };
  it("finds points inside a polygon and respects holes", () => {
    expect(inPolygon(3, 3, square)).toBe(true);
    expect(inPolygon(1.5, 1.5, square)).toBe(false);
    expect(inPolygon(5, 1, square)).toBe(false);
  });
  it("computes bounding boxes", () => {
    expect(bbox([square])).toEqual([0, 0, 4, 4]);
  });
});

describe("standing", () => {
  it("counts wards below and above", () => {
    const v = new Map<number, number | null>([[1, 10], [2, 20], [3, 30], [4, null]]);
    expect(standing(v, 2)).toEqual({ lower: 1, higher: 1, n: 3, median: 20 });
    expect(standing(v, 4)).toBeNull();
  });
});

describe("characterLine", () => {
  const labels = { houses: "Houses", industrial: "Industrial", open_space: "Parks and conservation", business_mixed: "Business and mixed use", flats_group_housing: "Flats and group housing" };
  const row = (shares: Record<string, number>) => ({ ward_no: 1, shares, zoned_km2: 2, excluded_km2: 0.5, parcel_coverage: 0.9 });
  it("names a dominant use", () => {
    expect(characterLine(row({ houses: 0.64, open_space: 0.18, industrial: 0.05 }), labels)).toBe(
      "Zoned mostly for houses (64%), with parks and conservation (18%).",
    );
  });
  it("calls a residential majority residential", () => {
    expect(characterLine(row({ houses: 0.3, flats_group_housing: 0.25, industrial: 0.45 }), labels)).toBe(
      "Mostly residential (55%: houses 30% and flats and group housing 25%), with industrial (45%).",
    );
  });
  it("describes a mix", () => {
    expect(characterLine(row({ industrial: 0.4, business_mixed: 0.35, open_space: 0.25 }), labels)).toBe(
      "A mix: industrial (40%), business and mixed use (35%) and parks and conservation (25%).",
    );
  });
  it("returns null with no zoned land", () => {
    expect(characterLine({ ...row({}), zoned_km2: 0 }, labels)).toBeNull();
  });
});

describe("wardResult", () => {
  const row = (ward_no: number) => ({ ward_no, registered: 100, turnout: 0.5, winner: "A", parties: [] });
  const base = { wards: { ward_vintage: 2026 }, crosswalk: { from_vintage: 2021, rows: [{ from_ward: 3, to_ward: 7, share_of_from: 0.5, share_of_to: 0.7 }] } };
  it("uses the same ward when the election was on current boundaries", () => {
    const data = { ...base, electionWards: [{ year: 2026, ward_vintage: 2026, rows: [row(7)] }] } as unknown as AppData;
    expect(wardResult(data, 7)?.oldWard).toBeNull();
  });
  it("falls back to the old ward covering most of the ward", () => {
    const data = { ...base, electionWards: [{ year: 2021, ward_vintage: 2021, rows: [row(3)] }] } as unknown as AppData;
    const r = wardResult(data, 7);
    expect(r?.row.ward_no).toBe(3);
    expect(r?.oldWard).toEqual({ ward: 3, share: 0.7 });
  });
});
