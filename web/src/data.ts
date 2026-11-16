// Loads the published data contract. index.json is the only filename hard-coded here.
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { AllocationsEnvelope } from "./generated/allocations";
import type { CrosswalkEnvelope } from "./generated/crosswalk";
import type { DonationsEnvelope } from "./generated/donations";
import type { PartiesEnvelope } from "./generated/parties";
import type { ElectionWardsEnvelope } from "./generated/election_wards";
import type { ElectionsEnvelope } from "./generated/elections";
import type { Index } from "./generated/index";
import type { LandUseEnvelope } from "./generated/land_use";
import type { LandmarksEnvelope } from "./generated/landmarks";
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
  landmarks: LandmarksEnvelope;
  landUse: LandUseEnvelope;
  allocations: AllocationsEnvelope[];
  /** Newest first. National council results. */
  elections: ElectionsEnvelope[];
  /** Newest first. Cape Town ward-ballot results (each on its own ward vintage). */
  electionWards: ElectionWardsEnvelope[];
  crosswalk: CrosswalkEnvelope | null;
  /** Party funding declarations (national), when published. */
  donations: DonationsEnvelope | null;
  /** Party profiles (stated priorities and positions), when published. */
  parties: PartiesEnvelope | null;
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
  const all = (dataset: string) => index.datasets.filter((d) => d.dataset === dataset);
  const donationsEntry = index.datasets.find((d) => d.dataset === "donations");
  const partiesEntry = index.datasets.find((d) => d.dataset === "parties");
  const [boundaries, wards, serviceRequests, outages, places, landmarks, landUse, allocations, elections, electionWards, crosswalk, donations, parties] = await Promise.all([
    get<WardFeatures>(boundary!.file),
    get<WardsEnvelope>(one("wards")),
    get<ServiceRequestsEnvelope>(one("service_requests")),
    get<OutagesEnvelope>(one("outages")),
    get<PlacesEnvelope>(one("places")),
    get<LandmarksEnvelope>(one("landmarks")),
    get<LandUseEnvelope>(one("land_use")),
    Promise.all(allocationFiles.map((d) => get<AllocationsEnvelope>(d.file))),
    Promise.all(all("elections").map((d) => get<ElectionsEnvelope>(d.file))),
    Promise.all(all("election_wards").map((d) => get<ElectionWardsEnvelope>(d.file))),
    crosswalkEntry ? get<CrosswalkEnvelope>(crosswalkEntry.file) : Promise.resolve(null),
    donationsEntry ? get<DonationsEnvelope>(donationsEntry.file) : Promise.resolve(null),
    partiesEntry ? get<PartiesEnvelope>(partiesEntry.file) : Promise.resolve(null),
  ]);
  allocations.sort((a, b) => b.budget_year.localeCompare(a.budget_year));
  elections.sort((a, b) => b.year - a.year);
  electionWards.sort((a, b) => b.year - a.year);
  return { index, boundaries, wards, serviceRequests, outages, places, landmarks, landUse, allocations, elections, electionWards, crosswalk, donations, parties };
}

const boundaryCache = new Map<number, Promise<WardFeatures>>();

/** Ward boundaries of another vintage (e.g. an earlier council term), loaded on first use. */
export function loadBoundaries(d: AppData, vintage: number): Promise<WardFeatures> {
  if (vintage === d.wards.ward_vintage) return Promise.resolve(d.boundaries);
  if (!boundaryCache.has(vintage)) {
    const entry = d.index.boundaries.find((b) => b.ward_vintage === vintage);
    boundaryCache.set(vintage, entry ? get<WardFeatures>(entry.file) : Promise.reject(new Error(`no ${vintage} wards`)));
  }
  return boundaryCache.get(vintage)!;
}
