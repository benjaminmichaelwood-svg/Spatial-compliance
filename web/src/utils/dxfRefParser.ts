import DxfParser from 'dxf-parser';
import type { IDxf } from 'dxf-parser';
import type { I3DfaceEntity } from 'dxf-parser/dist/entities/3dface';
import type { ILineEntity } from 'dxf-parser/dist/entities/line';
import type { ILwpolylineEntity } from 'dxf-parser/dist/entities/lwpolyline';
import type { IPolylineEntity } from 'dxf-parser/dist/entities/polyline';
import AutoCadColorIndex from 'dxf-parser/dist/AutoCadColorIndex';

export interface DxfSurface {
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface DxfPolyline {
  points: Float32Array;
  pointCount: number;
  closed: boolean;
  color: string;
  layer: string;
}

export interface ParsedDxf {
  surfaces: DxfSurface[];
  polylines: DxfPolyline[];
  layers: Map<string, string>;
}

function aciToHex(colorIndex: number): string {
  if (colorIndex <= 0 || colorIndex > 255) return '#ffffff';
  const rgb = AutoCadColorIndex[colorIndex];
  if (rgb === undefined) return '#ffffff';
  return '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
}

function layerColor(dxf: IDxf, layerName: string): string {
  const layer = dxf.tables?.layer?.layers?.[layerName];
  if (layer && layer.colorIndex > 0) return aciToHex(layer.colorIndex);
  return '#cccccc';
}

function entityColor(dxf: IDxf, entity: { colorIndex: number; layer: string }): string {
  if (entity.colorIndex > 0 && entity.colorIndex < 256) return aciToHex(entity.colorIndex);
  return layerColor(dxf, entity.layer);
}

export function parseDxf(text: string): ParsedDxf {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error('Failed to parse DXF');

  const faces: I3DfaceEntity[] = [];
  const lines: (ILineEntity | ILwpolylineEntity | IPolylineEntity)[] = [];

  for (const ent of dxf.entities) {
    switch (ent.type) {
      case '3DFACE':
        faces.push(ent as I3DfaceEntity);
        break;
      case 'LINE':
        lines.push(ent as ILineEntity);
        break;
      case 'LWPOLYLINE':
        lines.push(ent as ILwpolylineEntity);
        break;
      case 'POLYLINE':
        lines.push(ent as IPolylineEntity);
        break;
    }
  }

  const surfaces: DxfSurface[] = [];
  if (faces.length > 0) {
    const verts: number[] = [];
    const idxs: number[] = [];
    const vertMap = new Map<string, number>();
    const key = (x: number, y: number, z: number) =>
      `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;

    for (const face of faces) {
      const faceVerts = face.vertices;
      if (!faceVerts || faceVerts.length < 3) continue;
      const vi: number[] = [];
      for (const v of faceVerts) {
        const k = key(v.x, v.y, v.z);
        let idx = vertMap.get(k);
        if (idx === undefined) {
          idx = verts.length / 3;
          vertMap.set(k, idx);
          verts.push(v.x, v.y, v.z);
        }
        vi.push(idx);
      }
      if (vi.length >= 3) {
        idxs.push(vi[0], vi[1], vi[2]);
      }
      if (vi.length >= 4 && vi[3] !== vi[2]) {
        idxs.push(vi[0], vi[2], vi[3]);
      }
    }

    if (idxs.length > 0) {
      surfaces.push({
        positions: new Float32Array(verts),
        indices: new Uint32Array(idxs),
        vertexCount: verts.length / 3,
        triangleCount: idxs.length / 3,
      });
    }
  }

  const polylines: DxfPolyline[] = [];
  for (const ent of lines) {
    const color = entityColor(dxf, ent);
    const layer = ent.layer || '';

    if (ent.type === 'LINE') {
      const line = ent as ILineEntity;
      if (line.vertices && line.vertices.length >= 2) {
        const pts = new Float32Array(line.vertices.length * 3);
        for (let i = 0; i < line.vertices.length; i++) {
          pts[i * 3] = line.vertices[i].x;
          pts[i * 3 + 1] = line.vertices[i].y;
          pts[i * 3 + 2] = line.vertices[i].z;
        }
        polylines.push({ points: pts, pointCount: line.vertices.length, closed: false, color, layer });
      }
    } else if (ent.type === 'LWPOLYLINE') {
      const lw = ent as ILwpolylineEntity;
      if (lw.vertices && lw.vertices.length >= 2) {
        const elev = lw.elevation || 0;
        const pts = new Float32Array(lw.vertices.length * 3);
        for (let i = 0; i < lw.vertices.length; i++) {
          pts[i * 3] = lw.vertices[i].x;
          pts[i * 3 + 1] = lw.vertices[i].y;
          pts[i * 3 + 2] = lw.vertices[i].z || elev;
        }
        polylines.push({ points: pts, pointCount: lw.vertices.length, closed: lw.shape ?? false, color, layer });
      }
    } else if (ent.type === 'POLYLINE') {
      const pl = ent as IPolylineEntity;
      if (pl.vertices && pl.vertices.length >= 2) {
        const pts = new Float32Array(pl.vertices.length * 3);
        for (let i = 0; i < pl.vertices.length; i++) {
          pts[i * 3] = pl.vertices[i].x;
          pts[i * 3 + 1] = pl.vertices[i].y;
          pts[i * 3 + 2] = pl.vertices[i].z;
        }
        polylines.push({ points: pts, pointCount: pl.vertices.length, closed: pl.shape ?? false, color, layer });
      }
    }
  }

  const layers = new Map<string, string>();
  if (dxf.tables?.layer?.layers) {
    for (const [name, layer] of Object.entries(dxf.tables.layer.layers)) {
      layers.set(name, aciToHex(layer.colorIndex));
    }
  }

  return { surfaces, polylines, layers };
}
