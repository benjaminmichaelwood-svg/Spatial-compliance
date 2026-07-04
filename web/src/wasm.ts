import type { BoundaryRegion, ConformanceResult, Mode, TriSurface } from './types';

let initialized = false;
let wasmModule: any = null;

export async function initWasm(): Promise<void> {
  if (initialized) return;
  const mod = await import('spatial-engine');
  await mod.default({ module_or_path: '/spatial_engine_bg.wasm' });
  wasmModule = mod;
  initialized = true;
}

export function parseSurfaces(data: Uint8Array): TriSurface[] {
  return wasmModule.parse_surfaces(data) as TriSurface[];
}

export function runConformance(
  surfaces: Record<string, TriSurface>,
  mode: Mode,
  resolution: number,
  minVolume: number,
  minThickness: number,
): ConformanceResult {
  return wasmModule.run_conformance(
    JSON.stringify(surfaces.production_start),
    JSON.stringify(surfaces.production_end),
    JSON.stringify(surfaces.schedule_start),
    JSON.stringify(surfaces.schedule_end),
    JSON.stringify(surfaces.schedule_future),
    mode,
    resolution,
    minVolume,
    minThickness,
  ) as ConformanceResult;
}

export function runConformanceWithBoundaries(
  surfaces: Record<string, TriSurface>,
  mode: Mode,
  resolution: number,
  minVolume: number,
  minThickness: number,
  boundaries: BoundaryRegion[],
): ConformanceResult {
  return wasmModule.run_conformance_with_boundaries(
    JSON.stringify(surfaces.production_start),
    JSON.stringify(surfaces.production_end),
    JSON.stringify(surfaces.schedule_start),
    JSON.stringify(surfaces.schedule_end),
    JSON.stringify(surfaces.schedule_future),
    mode,
    resolution,
    minVolume,
    minThickness,
    JSON.stringify(boundaries),
  ) as ConformanceResult;
}

export function parseDxf(content: string): BoundaryRegion[] {
  return wasmModule.parse_dxf(content) as BoundaryRegion[];
}

export function extractBoundaryFromSurface(data: Uint8Array): BoundaryRegion {
  return wasmModule.extract_boundary_from_surface(data) as BoundaryRegion;
}

export function extractBoundaryFromSurfaceJson(surface: TriSurface): BoundaryRegion {
  return wasmModule.extract_boundary_from_surface_json(
    JSON.stringify(surface),
  ) as BoundaryRegion;
}
