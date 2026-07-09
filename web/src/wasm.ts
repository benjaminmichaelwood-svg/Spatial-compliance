import type { BoundaryRegion, ConformanceResult, Mode, TriSurface } from './types';

let initialized = false;
let wasmModule: any = null;
let initPromise: Promise<void> | null = null;

export async function initWasm(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mod = await import('spatial-engine');
    const base = import.meta.env.BASE_URL ?? '/';
    await mod.default({ module_or_path: `${base}spatial_engine_bg.wasm` });
    wasmModule = mod;
    initialized = true;
  })();
  return initPromise;
}

async function ensureWasm(): Promise<void> {
  if (initialized) return;
  await initWasm();
}

export function parseSurfaces(data: Uint8Array): TriSurface[] {
  return wasmModule.parse_surfaces(data) as TriSurface[];
}

function surfaceJson(s: TriSurface | undefined): string {
  return s ? JSON.stringify(s) : '';
}

export function runConformance(
  surfaces: Partial<Record<string, TriSurface>>,
  mode: Mode,
  minVolume: number,
  minThickness: number,
): ConformanceResult {
  return wasmModule.run_conformance(
    surfaceJson(surfaces.production_start),
    surfaceJson(surfaces.production_end),
    surfaceJson(surfaces.schedule_start),
    surfaceJson(surfaces.schedule_end),
    surfaceJson(surfaces.schedule_future),
    mode,
    minVolume,
    minThickness,
  ) as ConformanceResult;
}

export function runConformanceWithBoundaries(
  surfaces: Partial<Record<string, TriSurface>>,
  mode: Mode,
  minVolume: number,
  minThickness: number,
  boundaries: BoundaryRegion[],
): ConformanceResult {
  return wasmModule.run_conformance_with_boundaries(
    surfaceJson(surfaces.production_start),
    surfaceJson(surfaces.production_end),
    surfaceJson(surfaces.schedule_start),
    surfaceJson(surfaces.schedule_end),
    surfaceJson(surfaces.schedule_future),
    mode,
    minVolume,
    minThickness,
    JSON.stringify(boundaries),
  ) as ConformanceResult;
}

export async function parseDxf(content: string): Promise<BoundaryRegion[]> {
  await ensureWasm();
  return wasmModule.parse_dxf(content) as BoundaryRegion[];
}

export async function extractBoundaryFromSurface(data: Uint8Array): Promise<BoundaryRegion> {
  await ensureWasm();
  return wasmModule.extract_boundary_from_surface(data) as BoundaryRegion;
}

export async function extractBoundaryFromSurfaceJson(surface: TriSurface): Promise<BoundaryRegion> {
  await ensureWasm();
  return wasmModule.extract_boundary_from_surface_json(
    JSON.stringify(surface),
  ) as BoundaryRegion;
}

export function encodeSurfaces(surfaces: TriSurface[]): Uint8Array {
  return wasmModule.encode_surfaces_from_json(
    JSON.stringify(surfaces),
  ) as Uint8Array;
}
