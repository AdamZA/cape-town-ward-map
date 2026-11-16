// The only module that touches MapLibre. Exposes a tiny imperative API to the app.
//
// Layer order (bottom -> top): basemap fills/roads, ward fill, ward borders, selection and
// search outlines, basemap labels, ward numbers. Every line sits *under* the place names, so a
// busy junction of borders never hides a name.
import maplibregl, { type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { WardFeatures } from "../data";
import { bbox, type BBox } from "../geo";
import { NO_DATA, RAMP } from "./scales";

// OpenFreeMap: free, no API key. If it is unavailable we fall back to a blank background; the
// choropleth is our own layer and works without a basemap.
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const BLANK: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#f2f2ef" } }],
};
/** How far past the metro the map may pan (degrees), and how far out it may zoom. */
const BOUNDS_MARGIN = 0.35;
const MIN_ZOOM = 8.5;
const INK = "#16191d";
const CANDIDATE = "#d9480f";

/** The basemap style, or a blank one if the basemap can't be reached (decided once, up front). */
export async function basemapStyle(): Promise<StyleSpecification> {
  try {
    const res = await fetch(BASEMAP, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return (await res.json()) as StyleSpecification;
  } catch {
    // fall through
  }
  return BLANK;
}

export interface WardMapHandlers {
  onClick: (ward: number | null) => void;
  onHover: (ward: number | null, point: { x: number; y: number } | null) => void;
}

export class WardMap {
  private map: MLMap;
  private ready: Promise<void>;
  private selected: number | null = null;
  private candidates: number[] = [];
  private hovered: number | null = null;
  private classes = new Map<number, number>();
  private extent: BBox;

  constructor(container: HTMLElement, private wards: WardFeatures, style: StyleSpecification, handlers: WardMapHandlers) {
    this.extent = bbox(wards.features.map((f) => f.geometry));
    const [x0, y0, x1, y1] = this.extent;
    this.map = new maplibregl.Map({
      container,
      style,
      bounds: [x0, y0, x1, y1],
      fitBoundsOptions: { padding: 24 },
      maxBounds: [x0 - BOUNDS_MARGIN, y0 - BOUNDS_MARGIN, x1 + BOUNDS_MARGIN, y1 + BOUNDS_MARGIN],
      minZoom: MIN_ZOOM,
      maxZoom: 17,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // Tile or glyph failures are non-fatal: the ward layer is ours and still renders.
    this.map.on("error", (e) => console.warn("map:", e.error?.message ?? e));
    this.ready = new Promise((resolve) => this.map.on("load", () => resolve()));
    this.map.on("style.load", () => this.addLayers());

    this.map.on("click", "ward-fill", (e) => handlers.onClick(wardOf(e.features?.[0])));
    this.map.on("click", (e) => {
      const hit = this.map.queryRenderedFeatures(e.point, { layers: ["ward-fill"] });
      if (!hit.length) handlers.onClick(null);
    });
    this.map.on("mousemove", "ward-fill", (e) => {
      const w = wardOf(e.features?.[0]);
      this.setHovered(w);
      this.map.getCanvas().style.cursor = "pointer";
      handlers.onHover(w, e.point);
    });
    this.map.on("mouseleave", "ward-fill", () => {
      this.setHovered(null);
      this.map.getCanvas().style.cursor = "";
      handlers.onHover(null, null);
    });
  }

  private addLayers() {
    if (this.map.getSource("wards")) return;
    const style = this.map.getStyle();
    // Points of interest compete with the data for attention; keep places and roads only.
    for (const l of style.layers) {
      if (l.type === "symbol" && /poi|housenum|aerialway/i.test(l.id)) this.map.setLayoutProperty(l.id, "visibility", "none");
    }
    const firstLabel = style.layers.find((l) => l.type === "symbol")?.id;
    this.map.addSource("wards", { type: "geojson", data: this.wards, promoteId: "ward_no" });
    // One label point per ward (computed in the ETL), so numbers aren't repeated per tile.
    this.map.addSource("ward-points", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: this.wards.features.map((f) => ({
          type: "Feature",
          properties: { ward_no: f.properties.ward_no },
          geometry: { type: "Point", coordinates: f.properties.label },
        })),
      },
    });
    const fillColor = [
      "match",
      ["coalesce", ["feature-state", "cls"], -1],
      ...RAMP.flatMap((c, i) => [i, c]),
      NO_DATA,
    ] as unknown as maplibregl.ExpressionSpecification;
    const below = (layer: maplibregl.AddLayerObject) => this.map.addLayer(layer, firstLabel);
    below({
      id: "ward-fill",
      type: "fill",
      source: "wards",
      paint: {
        "fill-color": fillColor,
        "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.92, 0.78],
      },
    });
    below({
      id: "ward-line",
      type: "line",
      source: "wards",
      paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 13, 1.5], "line-opacity": 0.9 },
    });
    below({
      id: "ward-candidate",
      type: "line",
      source: "wards",
      filter: ["in", ["get", "ward_no"], ["literal", []]],
      paint: { "line-color": CANDIDATE, "line-width": 3, "line-dasharray": [2, 1] },
    });
    below({
      id: "ward-selected-halo",
      type: "line",
      source: "wards",
      filter: ["==", ["get", "ward_no"], -1],
      paint: { "line-color": "#ffffff", "line-width": 6 },
    });
    below({
      id: "ward-selected",
      type: "line",
      source: "wards",
      filter: ["==", ["get", "ward_no"], -1],
      paint: { "line-color": INK, "line-width": 3 },
    });
    if (style.glyphs) {
      // Ward numbers go on top, and take part in label collision with the basemap's names.
      this.map.addLayer({
        id: "ward-label",
        type: "symbol",
        source: "ward-points",
        minzoom: 10,
        layout: {
          "text-field": ["to-string", ["get", "ward_no"]],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10.5, 11, 14, 14],
          "text-font": ["Noto Sans Bold"],
        },
        paint: { "text-color": INK, "text-halo-color": "#ffffff", "text-halo-width": 1.8 },
      });
    }
    this.applyClasses();
    this.applySelection();
  }

  async setClasses(classes: Map<number, number>) {
    this.classes = classes;
    await this.ready;
    this.applyClasses();
  }

  private applyClasses() {
    if (!this.map.getSource("wards")) return;
    for (const f of this.wards.features) {
      const w = f.properties.ward_no;
      this.map.setFeatureState({ source: "wards", id: w }, { cls: this.classes.get(w) ?? -1 });
    }
  }

  async setSelected(ward: number | null, fly = false) {
    this.selected = ward;
    await this.ready;
    this.applySelection();
    if (fly && ward) this.fitWards([ward]);
  }

  /** Outline wards that might be the one the user is looking for (search results). */
  async setCandidates(wards: number[]) {
    this.candidates = wards;
    await this.ready;
    this.applySelection();
  }

  private applySelection() {
    if (!this.map.getLayer("ward-selected")) return;
    const sel: maplibregl.FilterSpecification = ["==", ["get", "ward_no"], this.selected ?? -1];
    this.map.setFilter("ward-selected", sel);
    this.map.setFilter("ward-selected-halo", sel);
    this.map.setFilter("ward-candidate", ["in", ["get", "ward_no"], ["literal", this.candidates]]);
  }

  fitWards(wards: number[]) {
    const fs = this.wards.features.filter((x) => wards.includes(x.properties.ward_no));
    if (fs.length) this.fit(bbox(fs.map((f) => f.geometry)));
  }

  fit(b: BBox) {
    this.map.fitBounds([b[0], b[1], b[2], b[3]], { padding: 60, maxZoom: 14 });
  }

  showCity() {
    this.fit(this.extent);
  }

  private setHovered(ward: number | null) {
    if (this.hovered === ward) return;
    if (this.hovered !== null) this.map.setFeatureState({ source: "wards", id: this.hovered }, { hover: false });
    if (ward !== null) this.map.setFeatureState({ source: "wards", id: ward }, { hover: true });
    this.hovered = ward;
  }

  resize() {
    this.map.resize();
  }
}

function wardOf(f: maplibregl.MapGeoJSONFeature | undefined): number | null {
  const n = f?.properties?.ward_no;
  return typeof n === "number" ? n : null;
}
