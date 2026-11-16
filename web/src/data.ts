// Loads the published data contract. index.json is the only filename hard-coded here.
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { AllocationsEnvelope } from "./generated/allocations";
import type { CrosswalkEnvelope } from "./generated/crosswalk";
import type { Index } from "./generated/index";
import type { OutagesEnvelope } from "./generated/outages";
import type { PlacesEnvelope } from "./generated/places";
import type { ServiceRequestsEnvelope } from "./generated/service_requests";
import type { WardsEnvelope } from "./generated/wards";

/** Ward polygons; `label` is the [lon, lat] where the ward number is printed. */
export type WardFeatures = FeatureCollection<Polygon | MultiPolygon, { ward_no: number; label: [number, number] }>;

export interface AppData {
  index: Index;
  boundaries: WardFeatures;
  wards: WardsEnvelope;
  serviceRequests: ServiceRequestsEnvelope;
  outages: OutagesEnvelope;
  places: PlacesEnvelope;
  allocations: AllocationsEnvelope[];
  crosswalk: CrosswalkEnvelope | null;
}

const base = `${import.meta.env.BASE_URL}data/`;

async function get<T>(file: string): Promise<T> {
  const res = await fetch(base + file);
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  return (await res.json()) as T;
}

export async function loadAll(): Promise<AppData> {
  const index = await get<Index>("index.json");
  const vintage = index.default_vintage;
  const boundary = index.boundaries.find((b) => b.ward_vintage === vintage);
  const one = (dataset: string) => {
    const e = index.datasets.find((d) => d.dataset === dataset && d.ward_vintage === vintage);
    if (!e) throw new Error(`index.json has no ${dataset} for ${vintage} wards`);
    return e.file;
  };
  const allocationFiles = index.datasets.filter((d) => d.dataset === "allocations");
  const crosswalkEntry = index.datasets.find((d) => d.dataset === "crosswalk");
  const [boundaries, wards, serviceRequests, outages, places, allocations, crosswalk] = await Promise.all([
    get<WardFeatures>(boundary!.file),
    get<WardsEnvelope>(one("wards")),
    get<ServiceRequestsEnvelope>(one("service_requests")),
    get<OutagesEnvelope>(one("outages")),
    get<PlacesEnvelope>(one("places")),
    Promise.all(allocationFiles.map((d) => get<AllocationsEnvelope>(d.file))),
    crosswalkEntry ? get<CrosswalkEnvelope>(crosswalkEntry.file) : Promise.resolve(null),
  ]);
  allocations.sort((a, b) => b.budget_year.localeCompare(a.budget_year));
  return { index, boundaries, wards, serviceRequests, outages, places, allocations, crosswalk };
}
