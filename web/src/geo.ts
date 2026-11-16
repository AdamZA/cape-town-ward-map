// Small geometry helpers for the browser: bounding boxes and point-in-ward (for "use my
// location"). Pure functions; unit-tested.
import type { MultiPolygon, Polygon, Position } from "geojson";
import type { WardFeatures } from "./data";

export type BBox = [west: number, south: number, east: number, north: number];

export function bbox(geoms: (Polygon | MultiPolygon)[]): BBox {
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of geoms) {
    for (const ring of rings(g)) {
      for (const [x, y] of ring) {
        b[0] = Math.min(b[0], x!);
        b[1] = Math.min(b[1], y!);
        b[2] = Math.max(b[2], x!);
        b[3] = Math.max(b[3], y!);
      }
    }
  }
  return b;
}

function rings(g: Polygon | MultiPolygon): Position[][] {
  return g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
}

/** Even-odd ray casting over every ring, so holes are handled. */
export function inPolygon(x: number, y: number, g: Polygon | MultiPolygon): boolean {
  let inside = false;
  for (const ring of rings(g)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
  }
  return inside;
}

export function wardAt(wards: WardFeatures, lon: number, lat: number): number | null {
  return wards.features.find((f) => inPolygon(lon, lat, f.geometry))?.properties.ward_no ?? null;
}
