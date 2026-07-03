import { TriangulatedSurface, BoundingBox, Vec3 } from '../engine/types';

const VULCAN_HEADER_SIZE = 256;
const RECORD_HEADER_SIZE = 64;

interface ParsedObject {
  name: string;
  vertices: number[];
  indices: number[];
}

function computeBounds(vertices: Float64Array): BoundingBox {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };

  for (let i = 0; i < vertices.length; i += 3) {
    min.x = Math.min(min.x, vertices[i]);
    min.y = Math.min(min.y, vertices[i + 1]);
    min.z = Math.min(min.z, vertices[i + 2]);
    max.x = Math.max(max.x, vertices[i]);
    max.y = Math.max(max.y, vertices[i + 1]);
    max.z = Math.max(max.z, vertices[i + 2]);
  }

  return { min, max };
}

function readNullTerminatedString(view: DataView, offset: number, maxLen: number): string {
  const bytes: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    const byte = view.getUint8(offset + i);
    if (byte === 0) break;
    bytes.push(byte);
  }
  return String.fromCharCode(...bytes);
}

function tryParseVulcanBinary(buffer: ArrayBuffer): ParsedObject[] | null {
  const view = new DataView(buffer);
  const objects: ParsedObject[] = [];

  if (buffer.byteLength < VULCAN_HEADER_SIZE) return null;

  try {
    const magic = readNullTerminatedString(view, 0, 32);
    const isVulcan = magic.includes('VULCAN') ||
                     magic.includes('Vulcan') ||
                     magic.includes('triangulation') ||
                     magic.includes('TRIANGULATION');

    let offset = VULCAN_HEADER_SIZE;

    if (isVulcan) {
      while (offset + RECORD_HEADER_SIZE < buffer.byteLength) {
        const recordType = view.getInt32(offset, true);
        const recordSize = view.getInt32(offset + 4, true);
        const objectName = readNullTerminatedString(view, offset + 8, 48);

        offset += RECORD_HEADER_SIZE;

        if (recordSize <= 0 || offset + recordSize > buffer.byteLength) break;

        if (recordType === 1 || recordType === 2) {
          const result = parseTriangulationRecord(view, offset, recordSize);
          if (result) {
            objects.push({ name: objectName || `surface_${objects.length}`, ...result });
          }
        }

        offset += recordSize;
      }
    }

    if (objects.length === 0) {
      const result = tryParseGenericTriangulation(buffer);
      if (result) objects.push(result);
    }

    return objects.length > 0 ? objects : null;
  } catch {
    return null;
  }
}

function parseTriangulationRecord(
  view: DataView,
  offset: number,
  size: number
): { vertices: number[]; indices: number[] } | null {
  try {
    const vertCount = view.getInt32(offset, true);
    const triCount = view.getInt32(offset + 4, true);
    let pos = offset + 8;

    if (vertCount <= 0 || triCount <= 0) return null;
    if (vertCount > 10_000_000 || triCount > 10_000_000) return null;

    const neededBytes = vertCount * 24 + triCount * 12;
    if (pos + neededBytes > offset + size + 100) return null;

    const vertices: number[] = [];
    for (let i = 0; i < vertCount; i++) {
      vertices.push(
        view.getFloat64(pos, true),
        view.getFloat64(pos + 8, true),
        view.getFloat64(pos + 16, true),
      );
      pos += 24;
    }

    const indices: number[] = [];
    for (let i = 0; i < triCount; i++) {
      const i0 = view.getInt32(pos, true);
      const i1 = view.getInt32(pos + 4, true);
      const i2 = view.getInt32(pos + 8, true);
      if (i0 >= 0 && i1 >= 0 && i2 >= 0 && i0 < vertCount && i1 < vertCount && i2 < vertCount) {
        indices.push(i0, i1, i2);
      }
      pos += 12;
    }

    return indices.length >= 3 ? { vertices, indices } : null;
  } catch {
    return null;
  }
}

function tryParseGenericTriangulation(buffer: ArrayBuffer): ParsedObject | null {
  const view = new DataView(buffer);
  const scanOffsets = [0, 4, 8, 64, 128, 256, 512];

  for (const startOffset of scanOffsets) {
    if (startOffset + 8 > buffer.byteLength) continue;

    for (const littleEndian of [true, false]) {
      const vertCount = view.getInt32(startOffset, littleEndian);
      const triCount = view.getInt32(startOffset + 4, littleEndian);

      if (vertCount <= 0 || triCount <= 0) continue;
      if (vertCount > 10_000_000 || triCount > 10_000_000) continue;

      for (const vertSize of [24, 12]) {
        const isDouble = vertSize === 24;
        const dataStart = startOffset + 8;
        const vertexEnd = dataStart + vertCount * vertSize;
        const indexEnd = vertexEnd + triCount * 12;

        if (indexEnd > buffer.byteLength + 100) continue;
        if (vertexEnd > buffer.byteLength) continue;

        try {
          const vertices: number[] = [];
          let pos = dataStart;
          let validVerts = true;

          for (let i = 0; i < vertCount && validVerts; i++) {
            const x = isDouble
              ? view.getFloat64(pos, littleEndian)
              : view.getFloat32(pos, littleEndian);
            const y = isDouble
              ? view.getFloat64(pos + (isDouble ? 8 : 4), littleEndian)
              : view.getFloat32(pos + 4, littleEndian);
            const z = isDouble
              ? view.getFloat64(pos + (isDouble ? 16 : 8), littleEndian)
              : view.getFloat32(pos + 8, littleEndian);

            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
              validVerts = false;
              break;
            }
            if (Math.abs(x) > 1e10 || Math.abs(y) > 1e10 || Math.abs(z) > 1e10) {
              validVerts = false;
              break;
            }

            vertices.push(x, y, z);
            pos += vertSize;
          }

          if (!validVerts) continue;

          const indices: number[] = [];
          pos = vertexEnd;
          let validIndices = true;

          for (let i = 0; i < triCount && pos + 12 <= buffer.byteLength; i++) {
            const i0 = view.getInt32(pos, littleEndian);
            const i1 = view.getInt32(pos + 4, littleEndian);
            const i2 = view.getInt32(pos + 8, littleEndian);

            if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= vertCount || i1 >= vertCount || i2 >= vertCount) {
              validIndices = false;
              break;
            }

            indices.push(i0, i1, i2);
            pos += 12;
          }

          if (validIndices && indices.length >= 3) {
            return {
              name: 'surface_0',
              vertices,
              indices,
            };
          }
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}

export function parseOOTFile(buffer: ArrayBuffer, fileName: string): TriangulatedSurface[] {
  const objects = tryParseVulcanBinary(buffer);

  if (!objects || objects.length === 0) {
    throw new Error(
      `Unable to parse ${fileName}. The file may be corrupted or in an unsupported .00t variant. ` +
      `Expected a Vulcan triangulation file with vertex and triangle data.`
    );
  }

  return objects.map((obj) => {
    const vertices = new Float64Array(obj.vertices);
    const indices = new Uint32Array(obj.indices);
    const bounds = computeBounds(vertices);

    return {
      name: obj.name,
      vertices,
      indices,
      bounds,
    };
  });
}

export function parseOBJFile(text: string, fileName: string): TriangulatedSurface[] {
  const vertices: number[] = [];
  const indices: number[] = [];

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('v ')) {
      const parts = trimmed.split(/\s+/);
      vertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (trimmed.startsWith('f ')) {
      const parts = trimmed.split(/\s+/).slice(1);
      const faceIndices = parts.map((p) => parseInt(p.split('/')[0]) - 1);
      for (let i = 1; i < faceIndices.length - 1; i++) {
        indices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
      }
    }
  }

  if (vertices.length === 0 || indices.length === 0) {
    throw new Error(`No geometry found in ${fileName}`);
  }

  const verts = new Float64Array(vertices);
  const idxs = new Uint32Array(indices);

  return [{
    name: fileName.replace(/\.\w+$/, ''),
    vertices: verts,
    indices: idxs,
    bounds: computeBounds(verts),
  }];
}

export function parseCSVSurface(text: string, fileName: string): TriangulatedSurface[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error(`Insufficient data in ${fileName}`);

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('x') || header.includes('east') || header.includes('north');
  const startLine = hasHeader ? 1 : 0;

  const points: { x: number; y: number; z: number }[] = [];

  for (let i = startLine; i < lines.length; i++) {
    const parts = lines[i].split(/[,\t]+/).map((s) => parseFloat(s.trim()));
    if (parts.length >= 3 && parts.every(isFinite)) {
      points.push({ x: parts[0], y: parts[1], z: parts[2] });
    }
  }

  if (points.length < 3) throw new Error(`Need at least 3 points in ${fileName}`);

  const { vertices, indices } = delaunayTriangulate2D(points);
  const verts = new Float64Array(vertices);
  const idxs = new Uint32Array(indices);

  return [{
    name: fileName.replace(/\.\w+$/, ''),
    vertices: verts,
    indices: idxs,
    bounds: computeBounds(verts),
  }];
}

function delaunayTriangulate2D(points: { x: number; y: number; z: number }[]): {
  vertices: number[];
  indices: number[];
} {
  const n = points.length;
  const vertices: number[] = [];
  for (const p of points) {
    vertices.push(p.x, p.y, p.z);
  }

  if (n < 3) return { vertices, indices: [] };

  const sorted = points.map((p, i) => ({ ...p, idx: i }));
  sorted.sort((a, b) => a.x - b.x || a.y - b.y);

  const indices: number[] = [];

  const gridSize = Math.ceil(Math.sqrt(n));
  const minX = sorted[0].x;
  const maxX = sorted[sorted.length - 1].x;
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const cellW = (maxX - minX) / gridSize || 1;
  const cellH = (maxY - minY) / gridSize || 1;

  const grid: Map<string, number[]> = new Map();
  for (let i = 0; i < n; i++) {
    const cx = Math.floor((points[i].x - minX) / cellW);
    const cy = Math.floor((points[i].y - minY) / cellH);
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(i);
  }

  const processedEdges = new Set<string>();

  for (let i = 0; i < n; i++) {
    const neighbors: number[] = [];
    const cx = Math.floor((points[i].x - minX) / cellW);
    const cy = Math.floor((points[i].y - minY) / cellH);

    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const cell = grid.get(key);
        if (cell) {
          for (const j of cell) {
            if (j !== i) neighbors.push(j);
          }
        }
      }
    }

    neighbors.sort((a, b) => {
      const da = (points[a].x - points[i].x) ** 2 + (points[a].y - points[i].y) ** 2;
      const db = (points[b].x - points[i].x) ** 2 + (points[b].y - points[i].y) ** 2;
      return da - db;
    });

    const nearest = neighbors.slice(0, Math.min(20, neighbors.length));

    for (let j = 0; j < nearest.length; j++) {
      for (let k = j + 1; k < nearest.length; k++) {
        const a = i, b = nearest[j], c = nearest[k];
        const triKey = [a, b, c].sort((x, y) => x - y).join(',');
        if (processedEdges.has(triKey)) continue;

        const cross = (points[b].x - points[a].x) * (points[c].y - points[a].y) -
                      (points[b].y - points[a].y) * (points[c].x - points[a].x);

        if (Math.abs(cross) < 1e-10) continue;

        processedEdges.add(triKey);

        if (cross > 0) {
          indices.push(a, b, c);
        } else {
          indices.push(a, c, b);
        }
      }
    }
  }

  return { vertices, indices };
}

export function parseSurfaceFile(
  buffer: ArrayBuffer,
  fileName: string
): TriangulatedSurface[] {
  const ext = fileName.toLowerCase().split('.').pop() || '';

  if (ext === '00t' || ext === 'oot') {
    return parseOOTFile(buffer, fileName);
  }

  const text = new TextDecoder().decode(buffer);

  if (ext === 'obj') {
    return parseOBJFile(text, fileName);
  }

  if (ext === 'csv' || ext === 'txt' || ext === 'xyz') {
    return parseCSVSurface(text, fileName);
  }

  try {
    return parseOOTFile(buffer, fileName);
  } catch {
    try {
      return parseOBJFile(text, fileName);
    } catch {
      return parseCSVSurface(text, fileName);
    }
  }
}
