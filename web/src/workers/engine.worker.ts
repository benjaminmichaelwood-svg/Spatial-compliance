import type { BoundaryRegion } from '../types';

let wasmModule: any = null;
let initialized = false;

const storedSurfaces = new Map<string, any>();

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

function surfaceToFlat(surface: any): {
  name: string;
  positions: Float64Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
} {
  const verts = surface.vertices;
  const idxs = surface.indices;
  const positions = new Float64Array(verts.length * 3);
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
  return {
    name: surface.name || '',
    positions,
    indices,
    vertexCount: verts.length,
    triangleCount: idxs.length,
  };
}

function flattenDomainSolids(domains: any[]): any[] {
  return domains.map((d: any) => {
    const flat = surfaceToFlat(d.solid);
    return {
      domain: d.domain,
      label: d.label,
      color: d.color,
      volume: d.volume,
      block_name: d.block_name,
      positions: flat.positions,
      indices: flat.indices,
      vertexCount: flat.vertexCount,
      triangleCount: flat.triangleCount,
      surface_area: d.solid.surface_area,
    };
  });
}

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
    const surfaces = wasmModule.parse_surfaces(data) as any[];

    if (!surfaces || surfaces.length === 0) {
      self.postMessage({ type: 'error', id: msg.id, message: `No surfaces found in ${msg.fileName}` });
      return;
    }

    const surface = surfaces[0];
    surface.name = surface.name || msg.fileName.replace(/\.[^.]+$/, '');

    storedSurfaces.set(msg.role, surface);

    self.postMessage({ type: 'progress', id: msg.id, phase: 'converting', progress: 0.7 });

    const flat = surfaceToFlat(surface);

    self.postMessage(
      {
        type: 'surfaceParsed',
        id: msg.id,
        role: msg.role,
        fileName: msg.fileName,
        name: flat.name,
        vertexCount: flat.vertexCount,
        triangleCount: flat.triangleCount,
        positions: flat.positions,
        indices: flat.indices,
      },
      { transfer: [flat.positions.buffer, flat.indices.buffer] } as any,
    );
  } catch (e: any) {
    self.postMessage({ type: 'error', id: msg.id, message: e.message || String(e) });
  }
}

function handleParseSurfaceJson(msg: ParseJsonMsg) {
  try {
    const surface = JSON.parse(msg.json);
    surface.name = surface.name || msg.fileName.replace(/\.[^.]+$/, '');
    storedSurfaces.set(msg.role, surface);

    const flat = surfaceToFlat(surface);

    self.postMessage(
      {
        type: 'surfaceParsed',
        id: msg.id,
        role: msg.role,
        fileName: msg.fileName,
        name: flat.name,
        vertexCount: flat.vertexCount,
        triangleCount: flat.triangleCount,
        positions: flat.positions,
        indices: flat.indices,
      },
      { transfer: [flat.positions.buffer, flat.indices.buffer] } as any,
    );
  } catch (e: any) {
    self.postMessage({ type: 'error', id: msg.id, message: e.message || String(e) });
  }
}

function surfaceJson(surface: any | undefined): string {
  return surface ? JSON.stringify(surface) : '';
}

function handleRunConformance(msg: RunMsg) {
  if (!initialized) {
    self.postMessage({ type: 'error', id: msg.id, message: 'WASM not initialized' });
    return;
  }

  try {
    self.postMessage({ type: 'progress', id: msg.id, phase: 'conformance', progress: 0.1 });

    const ps = storedSurfaces.get('production_start');
    const pe = storedSurfaces.get('production_end');
    const ss = storedSurfaces.get('schedule_start');
    const se = storedSurfaces.get('schedule_end');
    const sf = storedSurfaces.get('schedule_future');

    self.postMessage({ type: 'progress', id: msg.id, phase: 'conformance', progress: 0.3 });

    let result: any;
    if (msg.boundaries.length > 0) {
      result = wasmModule.run_conformance_with_boundaries(
        surfaceJson(ps), surfaceJson(pe),
        surfaceJson(ss), surfaceJson(se), surfaceJson(sf),
        msg.mode, msg.minVolume, msg.minThickness,
        JSON.stringify(msg.boundaries),
      );
    } else {
      result = wasmModule.run_conformance(
        surfaceJson(ps), surfaceJson(pe),
        surfaceJson(ss), surfaceJson(se), surfaceJson(sf),
        msg.mode, msg.minVolume, msg.minThickness,
      );
    }

    self.postMessage({ type: 'progress', id: msg.id, phase: 'transferring', progress: 0.8 });

    const flatDomains = flattenDomainSolids(result.domains);
    const transfers: ArrayBuffer[] = [];
    for (const d of flatDomains) {
      transfers.push(d.positions.buffer, d.indices.buffer);
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
      storedSurfaces.clear();
      break;
    case 'removeSurface':
      storedSurfaces.delete(msg.role);
      break;
  }
};
