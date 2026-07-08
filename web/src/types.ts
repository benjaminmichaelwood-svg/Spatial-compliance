export type Mode = 'dig' | 'dump';

export type SurfaceRole =
  | 'production_start'
  | 'production_end'
  | 'schedule_start'
  | 'schedule_end'
  | 'schedule_future';

export const SURFACE_ROLES: { key: SurfaceRole; label: string }[] = [
  { key: 'production_start', label: 'Production Start' },
  { key: 'production_end', label: 'Production End' },
  { key: 'schedule_start', label: 'Schedule Start' },
  { key: 'schedule_end', label: 'Schedule End' },
  { key: 'schedule_future', label: 'Schedule Future' },
];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TriSurface {
  name: string;
  vertices: Vec3[];
  indices: [number, number, number][];
}

export interface SolidMesh {
  label: string;
  vertices: Vec3[];
  indices: [number, number, number][];
  volume: number;
  surface_area: number;
}

export interface DomainSolid {
  domain: string;
  label: string;
  color: string;
  solid: SolidMesh;
  volume: number;
  block_name?: string;
}

export interface BlockSummary {
  block_name: string;
  domain_volumes: [string, number][];
  total_volume: number;
}

export interface BoundaryRegion {
  name: string;
  polygon: [number, number][];
}

export interface ConformanceSummary {
  total_planned_volume: number;
  total_actual_volume: number;
  conformance_volume: number;
  conformance_percent: number;
  domain_volumes: [string, number][];
  block_summaries?: BlockSummary[];
}

export interface ConformanceResult {
  mode: string;
  domains: DomainSolid[];
  summary: ConformanceSummary;
}

export interface UploadedSurface {
  role: SurfaceRole;
  fileName: string;
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface Settings {
  minVolume: number;
  minThickness: number;
}

export const DEFAULT_SETTINGS: Settings = {
  minVolume: 1.0,
  minThickness: 0.1,
};

export interface ObjectStyle {
  color: string;
  opacity: number;
  wireframe: boolean;
}

export type MeasureTool = 'none' | 'distance' | 'elevation' | 'area';
export type ViewPreset = 'plan' | 'north' | 'east' | 'isometric' | 'fit';
export type ViewerBackground = 'dark' | 'light';
