// The only module that touches MapLibre. Exposes a tiny imperative API to the app.
import maplibregl, { type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { WardFeatures } from "../data";
import { NO_DATA, RAMP } from "./scales";

// OpenFreeMap: free, no API key. If it is unavailable we fall back to a blank background; the
// choropleth is our own layer and works without a basemap.
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const BLANK: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#f2f2ef" } }],
};

export interface WardMapHandlers {
  onClick: (ward: number | null) => void;
  onHover: (ward: number | null, point: { x: number; y: number } | null) => void;
}

export class WardMap {
  private map: MLMap;
  private ready: Promise<void>;
  private selected: number | null = null;
  private hovered: number | null = null;
  private classes = new Map<number, number>();

  constructor(container: HTMLElement, private wards: WardFeatures, handlers: WardMapHandlers) {
    this.map = new maplibregl.Map({
      container,
      style: BASEMAP,
      bounds: bbox(wards),
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    let fellBack = false;
    this.map.on("error", (e) => {
      // A basemap failure before load: switch to the blank style once.
      if (!fellBack && !this.map.isStyleLoaded() && String(e.error?.message ?? "").match(/style|fetch|load/i)) {
        fellBack = true;
        this.map.setStyle(BLANK);
      }
    });
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
    this.map.addSource("wards", { type: "geojson", data: this.wards, promoteId: "ward_no" });
    const firstLabel = this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    const fillColor: maplibregl.ExpressionSpecification = [
      "match",
      ["coalesce", ["feature-state", "cls"], -1],
      ...RAMP.flatMap((c, i) => [i, c]),
      NO_DATA,
    ] as unknown as maplibregl.ExpressionSpecification;
    this.map.addLayer(
      {
        id: "ward-fill",
        type: "fill",
        source: "wards",
        paint: {
          "fill-color": fillColor,
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.95, 0.8],
        },
      },
      firstLabel,
    );
    this.map.addLayer({
      id: "ward-line",
      type: "line",
      source: "wards",
      paint: { "line-color": "#fcfcfb", "line-width": 0.8 },
    });
    this.map.addLayer({
      id: "ward-selected",
      type: "line",
      source: "wards",
      filter: ["==", ["get", "ward_no"], -1],
      paint: { "line-color": "#0b0b0b", "line-width": 2.5 },
    });
    if (this.map.getStyle().glyphs) {
      this.map.addLayer({
        id: "ward-label",
        type: "symbol",
        source: "wards",
        minzoom: 11,
        layout: { "text-field": ["to-string", ["get", "ward_no"]], "text-size": 12, "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": "#0b0b0b", "text-halo-color": "#fcfcfb", "text-halo-width": 1.5 },
      });
    }
    this.applyClasses();
    this.setSelected(this.selected);
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
    if (!this.map.getLayer("ward-selected")) return;
    this.map.setFilter("ward-selected", ["==", ["get", "ward_no"], ward ?? -1]);
    if (fly && ward) {
      const f = this.wards.features.find((x) => x.properties.ward_no === ward);
      if (f) this.map.fitBounds(bbox({ type: "FeatureCollection", features: [f] }), { padding: 80, maxZoom: 13.5 });
    }
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

function bbox(fc: WardFeatures): [[number, number], [number, number]] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as [number, number];
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  fc.features.forEach((f) => visit(f.geometry.coordinates));
  return [
    [x0, y0],
    [x1, y1],
  ];
}
