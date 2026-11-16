import { describe, expect, it } from "vitest";
import { fmtDate, fmtRand, fmtUnit } from "../src/format";
import { legendEntries, quantileScale, RAMP } from "../src/map/scales";
import { predecessors } from "../src/panel/Allocations";
import { parseHash, toHash } from "../src/state";
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
    expect(s).toEqual({ ward: 57, metric: "median_days" });
    expect(parseHash(toHash(s))).toEqual(s);
  });
  it("ignores junk", () => {
    expect(parseHash("#ward=abc&metric=nope")).toEqual({ ward: null, metric: "pct_closed_30d" });
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
