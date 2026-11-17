// The only module that touches MapLibre. Exposes a tiny imperative API to the app.
//
// Layer order (bottom -> top): basemap fills/roads, ward fill, ward borders, selection and
// search outlines, basemap labels, ward numbers, place pins. Every line sits *under* the place
// names, so a busy junction of borders never hides a name.
import maplibregl, { type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { WardFeatures } from "../data";
import type { LandmarkRow } from "../generated/landmarks";
import { drawIcon } from "../places/icons";
import { bbox, type BBox } from "../geo";
import { NO_DATA } from "./scales";

// OpenFreeMap: free, no API key. If it is unavailable we fall back to a blank background; the
// choropleth is our own layer and works without a basemap.
const BASEMAP = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const blank = (dark: boolean): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": dark ? "#15181b" : "#f2f2ef" } }],
});
/** How far past the metro the map may pan (degrees), and how far out it may zoom. */
const BOUNDS_MARGIN = 0.35;
const MIN_ZOOM = 8.5;
const CANDIDATE = "#d9480f";
/** Line and label colours for each theme: ink on a halo, and the gap drawn between wards. */
const THEME = {
  light: { ink: "#16191d", halo: "#ffffff", gap: "#ffffff" },
  dark: { ink: "#eef0f2", halo: "#111316", gap: "#15181b" },
};

/** The basemap style, or a blank one if the basemap can't be reached (decided once, up front). */
export async function basemapStyle(dark = false): Promise<StyleSpecification> {
  try {
    const res = await fetch(BASEMAP[dark ? "dark" : "light"], { signal: AbortSignal.timeout(8000) });
    if (res.ok) return (await res.json()) as StyleSpecification;
  } catch {
    // fall through
  }
  return blank(dark);
}

export interface WardMapHandlers {
  onClick: (ward: number | null) => void;
  onHover: (ward: number | null, point: { x: number; y: number } | null) => void;
}

/** Place pins: rows, their category -> group, and a builder for the click popup. */
export interface PlaceLayer {
  rows: LandmarkRow[];
  groupOf: Record<string, string>;
  popup: (row: LandmarkRow) => HTMLElement;
}
const PLACE_LAYERS = ["place-cluster", "place-pin"];

export class WardMap {
  private map: MLMap;
  private places: PlaceLayer | null = null;
  private visible: string[] = [];
  private popup: maplibregl.Popup | null = null;
  private ready: Promise<void>;
  private selected: number | null = null;
  private candidates: number[] = [];
  private hovered: number | null = null;
  private colours = new Map<number, string>();
  private extent: BBox;

  constructor(
    container: HTMLElement,
    private wards: WardFeatures,
    style: StyleSpecification,
    handlers: WardMapHandlers,
    private dark = false,
  ) {
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

    this.map.on("click", (e) => {
      const placeLayers = PLACE_LAYERS.filter((l) => this.map.getLayer(l));
      const place = placeLayers.length ? this.map.queryRenderedFeatures(e.point, { layers: placeLayers })[0] : undefined;
      if (place) return this.openPlace(place);
      const hit = this.map.queryRenderedFeatures(e.point, { layers: ["ward-fill"] });
      handlers.onClick(wardOf(hit[0]));
    });
    for (const l of PLACE_LAYERS) {
      this.map.on("mouseenter", l, () => (this.map.getCanvas().style.cursor = "pointer"));
      this.map.on("mouseleave", l, () => (this.map.getCanvas().style.cursor = ""));
    }
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

  private get theme() {
    return THEME[this.dark ? "dark" : "light"];
  }

  /** Switch between the light and dark basemap; our layers are re-added on the new style. */
  setTheme(dark: boolean, style: StyleSpecification) {
    if (dark === this.dark) return;
    this.dark = dark;
    this.popup?.remove();
    this.hovered = null;
    this.map.setStyle(style);
  }

  private addLayers() {
    if (this.map.getSource("wards")) return;
    const style = this.map.getStyle();
    const { ink, halo, gap } = this.theme;
    // Points of interest compete with the data for attention; keep places and roads only.
    for (const l of style.layers) {
      if (l.type === "symbol" && /poi|housenum|aerialway/i.test(l.id)) this.map.setLayoutProperty(l.id, "visibility", "none");
    }
    // Our layers go under the basemap's label stack: the run of label layers at the top. (Some
    // styles put a label or two lower down; anchoring there would leave roads above the wards.)
    let top = style.layers.length;
    while (top > 0 && style.layers[top - 1]!.type === "symbol") top--;
    const firstLabel = style.layers[top]?.id;
    this.map.addSource("wards", { type: "geojson", data: this.wards, promoteId: "ward_no" });
    // One label point per ward (computed in the ETL), so numbers aren't repeated per tile.
    this.map.addSource("ward-points", { type: "geojson", data: labelPoints(this.wards) });
    // Each ward's colour is set as feature state (see setColours), so any scheme or category
    // colour works without rebuilding the layer.
    const colour = ["feature-state", "colour"];
    const fillColor = ["case", ["to-boolean", colour], ["to-color", colour], NO_DATA] as unknown as maplibregl.ExpressionSpecification;
    const below = (layer: maplibregl.AddLayerObject) => this.map.addLayer(layer, firstLabel);
    below({
      id: "ward-fill",
      type: "fill",
      source: "wards",
      paint: {
        "fill-color": fillColor,
        // Wards without data are left nearly clear, so they never read as a colour step.
        "fill-opacity": [
          "case",
          ["!", ["to-boolean", ["feature-state", "colour"]]],
          ["case", ["boolean", ["feature-state", "hover"], false], 0.35, 0.18],
          ["boolean", ["feature-state", "hover"], false],
          0.92,
          0.78,
        ],
      },
    });
    below({
      id: "ward-line",
      type: "line",
      source: "wards",
      paint: { "line-color": gap, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 13, 1.5], "line-opacity": 0.9 },
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
      paint: { "line-color": halo, "line-width": 6 },
    });
    below({
      id: "ward-selected",
      type: "line",
      source: "wards",
      filter: ["==", ["get", "ward_no"], -1],
      paint: { "line-color": ink, "line-width": 3 },
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
        paint: { "text-color": ink, "text-halo-color": halo, "text-halo-width": 1.8 },
      });
    }
    this.addIcons();
    this.addPlaceLayers(style.glyphs != null);
    this.applyColours();
    this.applySelection();
  }

  /** Place icons belong to the style, so they're added again after a basemap switch. */
  private addIcons() {
    if (!this.places) return;
    for (const [cat, group] of Object.entries(this.places.groupOf)) {
      if (this.map.hasImage(cat)) continue;
      const c = drawIcon(cat, group);
      const ctx = c?.getContext("2d");
      if (c && ctx) this.map.addImage(cat, ctx.getImageData(0, 0, c.width, c.height), { pixelRatio: 2 });
    }
  }

  private addPlaceLayers(glyphs: boolean) {
    const { ink, halo } = this.theme;
    this.map.addSource("places", {
      type: "geojson",
      data: this.placeData(),
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 28,
    });
    this.map.addLayer({
      id: "place-cluster",
      type: "circle",
      source: "places",
      filter: ["has", "point_count"],
      paint: {
        // Dark discs, so clusters never read as the (plain-text) ward numbers.
        "circle-color": ink,
        "circle-opacity": 0.85,
        "circle-stroke-color": halo,
        "circle-stroke-width": 1.5,
        "circle-radius": ["step", ["get", "point_count"], 11, 10, 14, 50, 18],
      },
    });
    if (glyphs) {
      this.map.addLayer({
        id: "place-cluster-count",
        type: "symbol",
        source: "places",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 11,
          "text-allow-overlap": true,
        },
        paint: { "text-color": halo },
      });
    }
    this.map.addLayer({
      id: "place-pin",
      type: "symbol",
      source: "places",
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["get", "category"],
        "icon-allow-overlap": true,
        ...(glyphs
          ? {
              "text-field": ["step", ["zoom"], "", 14, ["get", "name"]],
              "text-font": ["Noto Sans Regular"],
              "text-size": 11.5,
              "text-offset": [0, 1.3],
              "text-anchor": "top",
              "text-optional": true,
              "text-max-width": 9,
            }
          : {}),
      },
      paint: { "text-color": ink, "text-halo-color": halo, "text-halo-width": 1.5 },
    });
  }

  private placeData(): GeoJSON.FeatureCollection {
    const on = new Set(this.visible);
    const rows = this.places?.rows ?? [];
    return {
      type: "FeatureCollection",
      features: rows.flatMap((r, i) =>
        on.has(r.category)
          ? [{ type: "Feature", properties: { i, category: r.category, name: r.name }, geometry: { type: "Point", coordinates: [r.lon, r.lat] } }]
          : [],
      ),
    };
  }

  /** Register place rows once; icons are drawn on first use. */
  async setPlaces(places: PlaceLayer) {
    this.places = places;
    await this.ready;
    this.addIcons();
    this.refreshPlaces();
  }

  async setVisiblePlaces(categories: string[]) {
    this.visible = categories;
    await this.ready;
    this.refreshPlaces();
  }

  private refreshPlaces() {
    const src = this.map.getSource("places") as maplibregl.GeoJSONSource | undefined;
    src?.setData(this.placeData());
    if (this.popup && !this.visible.length) this.popup.remove();
  }

  private async openPlace(f: maplibregl.MapGeoJSONFeature) {
    const geom = f.geometry as GeoJSON.Point;
    const at = geom.coordinates as [number, number];
    if (f.properties?.cluster_id != null) {
      const src = this.map.getSource("places") as maplibregl.GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
      this.map.easeTo({ center: at, zoom });
      return;
    }
    const row = this.places?.rows[f.properties?.i as number];
    if (!row || !this.places) return;
    this.popup?.remove();
    this.popup = new maplibregl.Popup({ offset: 14, maxWidth: "280px", closeButton: true })
      .setLngLat(at)
      .setDOMContent(this.places.popup(row))
      .addTo(this.map);
  }

  closePopup() {
    this.popup?.remove();
  }

  /** Swap the ward boundaries (a different council term's wards). */
  async setWards(wards: WardFeatures) {
    if (wards === this.wards) return;
    this.wards = wards;
    this.extent = bbox(wards.features.map((f) => f.geometry));
    await this.ready;
    (this.map.getSource("wards") as maplibregl.GeoJSONSource | undefined)?.setData(wards);
    (this.map.getSource("ward-points") as maplibregl.GeoJSONSource | undefined)?.setData(labelPoints(wards));
    this.hovered = null;
    this.applyColours();
    this.applySelection();
  }

  /** Colour each ward (wards missing from the map get the no-data colour). */
  async setColours(colours: Map<number, string>) {
    this.colours = colours;
    await this.ready;
    this.applyColours();
  }

  private applyColours() {
    if (!this.map.getSource("wards")) return;
    for (const f of this.wards.features) {
      const w = f.properties.ward_no;
      this.map.setFeatureState({ source: "wards", id: w }, { colour: this.colours.get(w) ?? "" });
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

/** One label point per ward (computed in the ETL), so numbers aren't repeated per tile. */
function labelPoints(wards: WardFeatures): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: wards.features.map((f) => ({
      type: "Feature",
      properties: { ward_no: f.properties.ward_no },
      geometry: { type: "Point", coordinates: f.properties.label },
    })),
  };
}

function wardOf(f: maplibregl.MapGeoJSONFeature | undefined): number | null {
  const n = f?.properties?.ward_no;
  return typeof n === "number" ? n : null;
}
