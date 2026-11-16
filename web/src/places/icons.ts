// Map-pin icons for place layers: a coloured disc (the group) with a white glyph (the category).
// The glyph is the secondary encoding, so two groups are never told apart by colour alone.
// Glyphs are drawn here on a 24-unit grid (no icon font or sprite sheet to host).

/** Group colours, validated as a set (dataviz validator, all pairs, light map). Heritage is ink. */
export const GROUP_COLOURS: Record<string, string> = {
  safety: "#6250d6",
  health: "#e34948",
  learning: "#eda100",
  community: "#008300",
  shopping: "#1baf7a",
  heritage: "#3d3d3a",
};
const FALLBACK = "#6b717a";

type Part = { d: string; stroke?: number };
const GLYPHS: Record<string, Part[]> = {
  police: [{ d: "M12 3 L19 6 V11 C19 15.5 16 19 12 21 C8 19 5 15.5 5 11 V6 Z" }],
  fire: [{ d: "M12 2.5 C13.5 7 17.5 9 17.5 14 A5.5 5.5 0 0 1 6.5 14 C6.5 11 8.5 9.5 9 6.5 C10.5 8.5 11.5 8 12 2.5 Z" }],
  courts: [{ d: "M3.5 9 L12 4 L20.5 9 Z M5 19 H19 V21 H5 Z M6 10 H8.5 V18 H6 Z M10.75 10 H13.25 V18 H10.75 Z M15.5 10 H18 V18 H15.5 Z" }],
  hospitals: [{ d: "M6.5 5 H10 V10.25 H14 V5 H17.5 V19 H14 V13.75 H10 V19 H6.5 Z" }],
  clinics: [{ d: "M10 4.5 H14 V10 H19.5 V14 H14 V19.5 H10 V14 H4.5 V10 H10 Z" }],
  schools: [{ d: "M12 4.5 L22.5 10 L12 15.5 L1.5 10 Z M6 12.8 V16.2 C6 17.6 9 19.2 12 19.2 C15 19.2 18 17.6 18 16.2 V12.8 L12 16 Z" }],
  libraries: [{ d: "M2.5 5.5 C5.5 4.5 8.8 5 11.2 6.8 V19.5 C8.8 17.8 5.5 17.3 2.5 18.3 Z M12.8 6.8 C15.2 5 18.5 4.5 21.5 5.5 V18.3 C18.5 17.3 15.2 17.8 12.8 19.5 Z" }],
  community_centres: [{ d: "M12 3.5 L21.5 11 H18.8 V20.5 H14.2 V15 H9.8 V20.5 H5.2 V11 H2.5 Z" }],
  sports_grounds: [
    { d: "M12 3.8 A8.2 8.2 0 1 0 12.01 3.8 Z", stroke: 2.2 },
    { d: "M12 8.2 L15.6 10.8 L14.2 15 H9.8 L8.4 10.8 Z" },
  ],
  stadia: [
    { d: "M2.8 12 A9.2 6 0 1 0 21.2 12 A9.2 6 0 1 0 2.8 12 Z", stroke: 2.4 },
    { d: "M7.5 12 A4.5 2.4 0 1 0 16.5 12 A4.5 2.4 0 1 0 7.5 12 Z" },
  ],
  pools: [
    {
      d: "M2.5 8.5 Q4.9 6.5 7.25 8.5 T12 8.5 T16.75 8.5 T21.5 8.5 M2.5 13 Q4.9 11 7.25 13 T12 13 T16.75 13 T21.5 13 M2.5 17.5 Q4.9 15.5 7.25 17.5 T12 17.5 T16.75 17.5 T21.5 17.5",
      stroke: 2.2,
    },
  ],
  beaches: [
    { d: "M12 3.5 C7 3.5 3.2 7.2 2.8 11.5 H21.2 C20.8 7.2 17 3.5 12 3.5 Z" },
    { d: "M12 11 V19 C12 20.8 9.6 20.8 9.2 19.2", stroke: 2 },
  ],
  malls: [
    { d: "M4.5 8.5 H19.5 L18.4 21 H5.6 Z" },
    { d: "M8.8 8 V6.5 A3.2 3.2 0 0 1 15.2 6.5 V8", stroke: 2 },
  ],
  monuments: [{ d: "M10.4 4.2 L12 2.5 L13.6 4.2 L14.6 17.8 H9.4 Z M6.5 18.6 H17.5 V21.3 H6.5 Z" }],
};

export const ICON_PX = 26; // CSS pixels
const RATIO = 2;

/** Draw one pin. Returns null outside the browser (tests). */
export function drawIcon(category: string, group: string): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  const s = ICON_PX * RATIO;
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.scale(RATIO, RATIO);
  const r = ICON_PX / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(r, r, r - 2.75, 0, Math.PI * 2);
  ctx.fillStyle = GROUP_COLOURS[group] ?? FALLBACK;
  ctx.fill();
  const glyph = 15;
  ctx.translate(r - glyph / 2, r - glyph / 2);
  ctx.scale(glyph / 24, glyph / 24);
  ctx.fillStyle = ctx.strokeStyle = "#ffffff";
  ctx.lineCap = ctx.lineJoin = "round";
  for (const part of GLYPHS[category] ?? [{ d: "M12 7 A5 5 0 1 0 12.01 7 Z" }]) {
    const p = new Path2D(part.d);
    if (part.stroke) {
      ctx.lineWidth = part.stroke;
      ctx.stroke(p);
    } else ctx.fill(p);
  }
  return c;
}

const urls = new Map<string, string>();
/** Data URL of a pin, for <img> in the layer list and ward panel. */
export function iconUrl(category: string, group: string): string {
  if (!urls.has(category)) urls.set(category, drawIcon(category, group)?.toDataURL() ?? "");
  return urls.get(category)!;
}
