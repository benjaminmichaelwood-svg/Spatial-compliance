import type { BoundaryRegion } from '../types';

let wasmModule: any = null;
let initialized = false;

const storedSurfaceBinaries = new Map<string, Uint8Array>();
const storedSurfaceJsons = new Map<string, string>();

interface ParseMsg {
  type: 'parseSurface';
  id: number;
  role: string;
  data: ArrayBuffer;
  fileName: string;
}

interface ParseJsonMsg {
  type: 'parseSurfaceJson';
  id: number;
  role: string;
  json: string;
  fileName: string;
}

interface RunMsg {
  type: 'runConformance';
  id: number;
  mode: string;
  minVolume: number;
  minThickness: number;
  boundaries: BoundaryRegion[];
}

interface ClearMsg {
  type: 'clearSurfaces';
}

interface InitMsg {
  type: 'init';
  wasmUrl: string;
}

interface RemoveSurfaceMsg {
  type: 'removeSurface';
  role: string;
}

type WorkerMessage = InitMsg | ParseMsg | ParseJsonMsg | RunMsg | ClearMsg | RemoveSurfaceMsg;

async function handleInit(msg: InitMsg) {
  try {
    const mod = await import('spatial-engine');
    await mod.default({ module_or_path: msg.wasmUrl });
    wasmModule = mod;
    initialized = true;
    self.postMessage({ type: 'ready' });
  } catch (e: any) {
    self.postMessage({ type: 'error', id: -1, message: `WASM init failed: ${e.message}` });
  }
}

function handleParseSurface(msg: ParseMsg) {
  if (!initialized) {
    self.postMessage({ type: 'error', id: msg.id, message: 'WASM not initialized' });
    return;
  }

  try {
    self.postMessage({ type: 'progress', id: msg.id, phase: 'parsing', progress: 0.1 });

    const data = new Uint8Array(msg.data);

    const result = wasmModule.parse_surface_flat(data);

    storedSurfaceBinaries.set(msg.role, data);

    self.postMessage({ type: 'progress', id: msg.id, phase: 'converting', progress: 0.7 });

    const positions: Float32Array = result.positions;
    const indices: Uint32Array = result.indices;

    self.postMessage(
      {
        type: 'surfaceParsed',
        id: msg.id,
        role: msg.role,
        fileName: msg.fileName,
        name: result.name || '',
        vertexCount: result.vertexCount,
        triangleCount: result.triangleCount,
        positions,
        indices,
      },
      { transfer: [positions.buffer, indices.buffer] } as any,
    );
  } catch (e: any) {
    self.postMessage({ type: 'error', id: msg.id, message: e.message || String(e) });
  }
}

function handleParseSurfaceJson(msg: ParseJsonMsg) {
  try {
    const surface = JSON.parse(msg.json);
    surface.name = surface.name || msg.fileName.replace(/\.[^.]+$/, '');

    storedSurfaceJsons.set(msg.role, JSON.stringify(surface));

    const verts = surface.vertices;
    const idxs = surface.indices;
    const positions = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
      positions[i * 3] = verts[i].x;
      positions[i * 3 + 1] = verts[i].y;
      positions[i * 3 + 2] = verts[i].z;
    }
    const indices = new Uint32Array(idxs.length * 3);
    for (let i = 0; i < idxs.length; i++) {
      indices[i * 3] = idxs[i][0];
      indices[i * 3 + 1] = idxs[i][1];
      indices[i * 3 + 2] = idxs[i][2];
    }

    self.postMessage(
      {
        type: 'surfaceParsed',
        id: msg.id,
        role: msg.role,
        fileName: msg.fileName,
        name: surface.name,
        vertexCount: verts.length,
        triangleCount: idxs.length,
        positions,
        indices,
      },
      { transfer: [positions.buffer, indices.buffer] } as any,
    );
  } catch (e: any) {
    self.postMessage({ type: 'error', id: msg.id, message: e.message || String(e) });
  }
}

function getSurfaceJson(role: string): string {
  if (storedSurfaceJsons.has(role)) {
    return storedSurfaceJsons.get(role)!;
  }
  if (storedSurfaceBinaries.has(role)) {
    const data = storedSurfaceBinaries.get(role)!;
    const surfaces = wasmModule.parse_surfaces(data);
    if (surfaces && surfaces.length > 0) {
      const json = JSON.stringify(surfaces[0]);
      storedSurfaceJsons.set(role, json);
      return json;
    }
  }
  return '';
}

function handleRunConformance(msg: RunMsg) {
  if (!initialized) {
    self.postMessage({ type: 'error', id: msg.id, message: 'WASM not initialized' });
    return;
  }

  try {
    self.postMessage({ type: 'progress', id: msg.id, phase: 'Preparing surfaces', progress: 0.05 });

    const ps = getSurfaceJson('production_start');
    const pe = getSurfaceJson('production_end');
    const ss = getSurfaceJson('schedule_start');
    const se = getSurfaceJson('schedule_end');
    const sf = getSurfaceJson('schedule_future');

    self.postMessage({ type: 'progress', id: msg.id, phase: 'Computing conformance', progress: 0.15 });

    const boundariesJson = msg.boundaries.length > 0 ? JSON.stringify(msg.boundaries) : '';

    const result = wasmModule.run_conformance_flat(
      ps, pe, ss, se, sf,
      msg.mode, msg.minVolume, msg.minThickness,
      boundariesJson,
    );

    self.postMessage({ type: 'progress', id: msg.id, phase: 'Transferring results', progress: 0.85 });

    const flatDomains: any[] = [];
    const transfers: ArrayBuffer[] = [];

    for (let i = 0; i < result.domains.length; i++) {
      const d = result.domains[i];
      const positions: Float32Array = d.positions;
      const indices: Uint32Array = d.indices;

      transfers.push(positions.buffer, indices.buffer);

      flatDomains.push({
        domain: d.domain,
        label: d.label,
        color: d.color,
        volume: d.volume,
        block_name: d.block_name,
        positions,
        indices,
        vertexCount: d.vertexCount,
        triangleCount: d.triangleCount,
        surface_area: d.surface_area,
      });
    }

    self.postMessage(
      {
        type: 'conformanceResult',
        id: msg.id,
        result: {
          mode: result.mode,
          summary: result.summary,
          flatDomains,
        },
      },
      { transfer: transfers } as any,
    );
  } catch (e: any) {
    self.postMessage({ type: 'error', id: msg.id, message: e.message || String(e) });
  }
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      handleInit(msg);
      break;
    case 'parseSurface':
      handleParseSurface(msg);
      break;
    case 'parseSurfaceJson':
      handleParseSurfaceJson(msg);
      break;
    case 'runConformance':
      handleRunConformance(msg);
      break;
    case 'clearSurfaces':
      storedSurfaceBinaries.clear();
      storedSurfaceJsons.clear();
      break;
    case 'removeSurface':
      storedSurfaceBinaries.delete(msg.role);
      storedSurfaceJsons.delete(msg.role);
      break;
  }
};
