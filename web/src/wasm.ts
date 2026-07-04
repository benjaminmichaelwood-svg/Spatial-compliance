import type { ConformanceResult, Mode, TriSurface } from './types';

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
