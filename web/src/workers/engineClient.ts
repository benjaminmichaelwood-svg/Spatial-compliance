import type { BoundaryRegion, SurfaceRole } from '../types';

export interface FlatSurface {
  name: string;
  role: SurfaceRole;
  fileName: string;
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface FlatDomainSolid {
  domain: string;
  label: string;
  color: string;
  volume: number;
  block_name?: string;
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  surface_area: number;
}

export interface FlatConformanceResult {
  mode: string;
  summary: any;
  flatDomains: FlatDomainSolid[];
  domainMaps?: Record<string, Uint8Array>;
}

export type ProgressCallback = (phase: string, progress: number) => void;

let worker: Worker | null = null;
let workerReady = false;
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 1;

const pendingCallbacks = new Map<number, {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onProgress?: ProgressCallback;
}>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = handleMessage;
    worker.onerror = (e) => {
      console.error('Worker error:', e);
    };
  }
  return worker;
}

function handleMessage(e: MessageEvent) {
  const msg = e.data;

  if (msg.type === 'ready') {
    workerReady = true;
    readyResolve?.();
    return;
  }

  if (msg.type === 'progress') {
    const cb = pendingCallbacks.get(msg.id);
    cb?.onProgress?.(msg.phase, msg.progress);
    return;
  }

  const cb = pendingCallbacks.get(msg.id);
  if (!cb) return;
  pendingCallbacks.delete(msg.id);

  if (msg.type === 'error') {
    cb.reject(new Error(msg.message));
    return;
  }

  cb.resolve(msg);
}

export async function initWorker(wasmUrl: string): Promise<void> {
  const w = getWorker();
  if (workerReady) return;
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });
    w.postMessage({ type: 'init', wasmUrl });
  }
  return readyPromise;
}

export async function workerParseSurface(
  role: SurfaceRole,
  data: ArrayBuffer,
  fileName: string,
  onProgress?: ProgressCallback,
): Promise<FlatSurface> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<FlatSurface>((resolve, reject) => {
    pendingCallbacks.set(id, {
      resolve: (msg: any) => {
        resolve({
          name: msg.name,
          role: msg.role as SurfaceRole,
          fileName: msg.fileName,
          positions: msg.positions,
          indices: msg.indices,
          vertexCount: msg.vertexCount,
          triangleCount: msg.triangleCount,
        });
      },
      reject,
      onProgress,
    });
    w.postMessage(
      { type: 'parseSurface', id, role, data, fileName },
      [data],
    );
  });
}

export async function workerParseSurfaceJson(
  role: SurfaceRole,
  json: string,
  fileName: string,
): Promise<FlatSurface> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<FlatSurface>((resolve, reject) => {
    pendingCallbacks.set(id, {
      resolve: (msg: any) => {
        resolve({
          name: msg.name,
          role: msg.role as SurfaceRole,
          fileName: msg.fileName,
          positions: msg.positions,
          indices: msg.indices,
          vertexCount: msg.vertexCount,
          triangleCount: msg.triangleCount,
        });
      },
      reject,
    });
    w.postMessage({ type: 'parseSurfaceJson', id, role, json, fileName });
  });
}

export async function workerRunConformance(
  mode: string,
  minVolume: number,
  minThickness: number,
  boundaries: BoundaryRegion[],
  onProgress?: ProgressCallback,
): Promise<FlatConformanceResult> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<FlatConformanceResult>((resolve, reject) => {
    pendingCallbacks.set(id, {
      resolve: (msg: any) => {
        resolve(msg.result as FlatConformanceResult);
      },
      reject,
      onProgress,
    });
    w.postMessage({ type: 'runConformance', id, mode, minVolume, minThickness, boundaries });
  });
}

export function workerClearSurfaces() {
  getWorker().postMessage({ type: 'clearSurfaces' });
}

export function workerRemoveSurface(role: string) {
  getWorker().postMessage({ type: 'removeSurface', role });
}
