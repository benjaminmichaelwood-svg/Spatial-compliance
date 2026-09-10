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

// Priority R2 (PPTX & Reporting action list): a saved report view, keyed by
// pit/boundary name (BoundaryRegion.name — the same identifier already used
// as DomainSolid.block_name and by pptxReport.ts's buildSlides to group
// per-pit domains) so a report can automatically reuse a deliberately
// composed camera angle or cross-section line instead of falling back to
// auto-fit every time it's regenerated. SITE_WIDE_KEY is used when no
// specific pit is the capture target — there is no other "whole site"
// identifier anywhere else in the app to collide with.
export const SITE_WIDE_KEY = '__site_wide__';

export interface SavedCameraView {
  position: [number, number, number];
  target: [number, number, number];
  capturedAt: number;
}

export interface SavedCrossSectionView {
  p1: [number, number];
  p2: [number, number];
  capturedAt: number;
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
  minTriangles: number;
}

export const DEFAULT_SETTINGS: Settings = {
  minVolume: 100.0,
  minThickness: 0.5,
  minTriangles: 20,
};

export interface ObjectStyle {
  color: string;
  opacity: number;
  wireframe: boolean;
}

export interface HeatmapMode {
  paintRole: SurfaceRole;
  refRole: SurfaceRole;
  scaleMin: number;
  scaleMax: number;
  deadband: number;
}

export type RefLayerKind = 'surface' | 'lines';

export interface RefSurfaceData {
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface RefPolylineData {
  points: Float32Array;
  pointCount: number;
  closed: boolean;
  color: string;
  layer: string;
  name: string;
}

export interface RefLayerStyle {
  color: string;
  opacity: number;
  wireframe: boolean;
  lineWidth: number;
  lineDash: number[];
}

export interface ReferenceLayer {
  id: string;
  fileName: string;
  kind: RefLayerKind;
  visible: boolean;
  style: RefLayerStyle;
  surface?: RefSurfaceData;
  polylines?: RefPolylineData[];
}

export type MeasureTool = 'none' | 'distance' | 'elevation' | 'area';
export type ViewPreset = 'plan' | 'north' | 'east' | 'isometric' | 'fit';
export type ViewerBackground = 'dark' | 'light';
