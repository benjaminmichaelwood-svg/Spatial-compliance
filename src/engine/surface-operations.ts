import { TriangulatedSurface, BoundingBox, Vec3 } from './types';

export function interpolateZ(
  surface: TriangulatedSurface,
  x: number,
  y: number
): number | null {
  const { vertices, indices } = surface;

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const x0 = vertices[i0], y0 = vertices[i0 + 1], z0 = vertices[i0 + 2];
    const x1 = vertices[i1], y1 = vertices[i1 + 1], z1 = vertices[i1 + 2];
    const x2 = vertices[i2], y2 = vertices[i2 + 1], z2 = vertices[i2 + 2];

    const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(d) < 1e-12) continue;

    const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
    const b = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
    const c = 1 - a - b;

    if (a >= -1e-6 && b >= -1e-6 && c >= -1e-6) {
      return a * z0 + b * z1 + c * z2;
    }
  }

  return null;
}

export interface SpatialIndex {
  cells: Map<string, number[]>;
  cellSize: number;
  surface: TriangulatedSurface;
}

export function buildSpatialIndex(surface: TriangulatedSurface, cellSize?: number): SpatialIndex {
  const { bounds, indices, vertices } = surface;
  const size = cellSize || Math.max(
    (bounds.max.x - bounds.min.x) / 100,
    (bounds.max.y - bounds.min.y) / 100,
    1
  );

  const cells = new Map<string, number[]>();

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const minX = Math.min(vertices[i0], vertices[i1], vertices[i2]);
    const maxX = Math.max(vertices[i0], vertices[i1], vertices[i2]);
    const minY = Math.min(vertices[i0 + 1], vertices[i1 + 1], vertices[i2 + 1]);
    const maxY = Math.max(vertices[i0 + 1], vertices[i1 + 1], vertices[i2 + 1]);

    const cx0 = Math.floor(minX / size);
    const cx1 = Math.floor(maxX / size);
    const cy0 = Math.floor(minY / size);
    const cy1 = Math.floor(maxY / size);

    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = `${cx},${cy}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(i);
      }
    }
  }

  return { cells, cellSize: size, surface };
}

export function interpolateZIndexed(
  index: SpatialIndex,
  x: number,
  y: number
): number | null {
  const cx = Math.floor(x / index.cellSize);
  const cy = Math.floor(y / index.cellSize);
  const { vertices, indices } = index.surface;

  for (let dx = 0; dx <= 1; dx++) {
    for (let dy = 0; dy <= 1; dy++) {
      const key = `${cx + dx},${cy + dy}`;
      const triIndices = index.cells.get(key);
      if (!triIndices) continue;

      for (const i of triIndices) {
        const i0 = indices[i] * 3;
        const i1 = indices[i + 1] * 3;
        const i2 = indices[i + 2] * 3;

        const x0 = vertices[i0], y0 = vertices[i0 + 1], z0 = vertices[i0 + 2];
        const x1 = vertices[i1], y1 = vertices[i1 + 1], z1 = vertices[i1 + 2];
        const x2 = vertices[i2], y2 = vertices[i2 + 1], z2 = vertices[i2 + 2];

        const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(d) < 1e-12) continue;

        const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
        const b = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
        const c = 1 - a - b;

        if (a >= -1e-6 && b >= -1e-6 && c >= -1e-6) {
          return a * z0 + b * z1 + c * z2;
        }
      }
    }
  }

  return null;
}

export function computeOverlapBounds(
  a: TriangulatedSurface,
  b: TriangulatedSurface
): BoundingBox | null {
  const minX = Math.max(a.bounds.min.x, b.bounds.min.x);
  const maxX = Math.min(a.bounds.max.x, b.bounds.max.x);
  const minY = Math.max(a.bounds.min.y, b.bounds.min.y);
  const maxY = Math.min(a.bounds.max.y, b.bounds.max.y);

  if (minX >= maxX || minY >= maxY) return null;

  return {
    min: { x: minX, y: minY, z: Math.min(a.bounds.min.z, b.bounds.min.z) },
    max: { x: maxX, y: maxY, z: Math.max(a.bounds.max.z, b.bounds.max.z) },
  };
}

export function generateComparisonGrid(
  surfaceA: TriangulatedSurface,
  surfaceB: TriangulatedSurface,
  resolution: number = 50
): {
  gridPoints: { x: number; y: number; zA: number | null; zB: number | null }[];
  cellArea: number;
  gridResolution: number;
} {
  const overlap = computeOverlapBounds(surfaceA, surfaceB);
  if (!overlap) return { gridPoints: [], cellArea: 0, gridResolution: resolution };

  const rangeX = overlap.max.x - overlap.min.x;
  const rangeY = overlap.max.y - overlap.min.y;

  const cellSize = Math.max(rangeX, rangeY) / resolution;
  const nx = Math.ceil(rangeX / cellSize);
  const ny = Math.ceil(rangeY / cellSize);

  const indexA = buildSpatialIndex(surfaceA, cellSize * 2);
  const indexB = buildSpatialIndex(surfaceB, cellSize * 2);

  const gridPoints: { x: number; y: number; zA: number | null; zB: number | null }[] = [];

  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const x = overlap.min.x + (i + 0.5) * cellSize;
      const y = overlap.min.y + (j + 0.5) * cellSize;

      const zA = interpolateZIndexed(indexA, x, y);
      const zB = interpolateZIndexed(indexB, x, y);

      gridPoints.push({ x, y, zA, zB });
    }
  }

  return { gridPoints, cellArea: cellSize * cellSize, gridResolution: resolution };
}

export function buildDifferenceSurface(
  upper: TriangulatedSurface,
  lower: TriangulatedSurface,
  name: string,
  resolution: number = 50
): TriangulatedSurface | null {
  const overlap = computeOverlapBounds(upper, lower);
  if (!overlap) return null;

  const rangeX = overlap.max.x - overlap.min.x;
  const rangeY = overlap.max.y - overlap.min.y;
  const cellSize = Math.max(rangeX, rangeY) / resolution;
  const nx = Math.ceil(rangeX / cellSize) + 1;
  const ny = Math.ceil(rangeY / cellSize) + 1;

  const indexUpper = buildSpatialIndex(upper, cellSize * 2);
  const indexLower = buildSpatialIndex(lower, cellSize * 2);

  const vertices: number[] = [];
  const indices: number[] = [];
  const vertexMap: Map<string, number> = new Map();

  function getOrCreateVertex(x: number, y: number, z: number): number {
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    if (vertexMap.has(key)) return vertexMap.get(key)!;
    const idx = vertices.length / 3;
    vertices.push(x, y, z);
    vertexMap.set(key, idx);
    return idx;
  }

  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < ny - 1; j++) {
      const x0 = overlap.min.x + i * cellSize;
      const y0 = overlap.min.y + j * cellSize;
      const x1 = x0 + cellSize;
      const y1 = y0 + cellSize;

      const corners = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];

      const upperZ: (number | null)[] = [];
      const lowerZ: (number | null)[] = [];

      let allValid = true;
      for (const c of corners) {
        const zu = interpolateZIndexed(indexUpper, c.x, c.y);
        const zl = interpolateZIndexed(indexLower, c.x, c.y);
        upperZ.push(zu);
        lowerZ.push(zl);
        if (zu === null || zl === null) {
          allValid = false;
          break;
        }
      }

      if (!allValid) continue;

      const topVerts = corners.map((c, idx) =>
        getOrCreateVertex(c.x, c.y, upperZ[idx]!)
      );
      const botVerts = corners.map((c, idx) =>
        getOrCreateVertex(c.x, c.y, lowerZ[idx]!)
      );

      indices.push(topVerts[0], topVerts[1], topVerts[2]);
      indices.push(topVerts[0], topVerts[2], topVerts[3]);

      indices.push(botVerts[0], botVerts[2], botVerts[1]);
      indices.push(botVerts[0], botVerts[3], botVerts[2]);

      for (let s = 0; s < 4; s++) {
        const s2 = (s + 1) % 4;
        indices.push(topVerts[s], topVerts[s2], botVerts[s2]);
        indices.push(topVerts[s], botVerts[s2], botVerts[s]);
      }
    }
  }

  if (vertices.length === 0) return null;

  const verts = new Float64Array(vertices);
  const idxs = new Uint32Array(indices);

  return {
    name,
    vertices: verts,
    indices: idxs,
    bounds: {
      min: { x: overlap.min.x, y: overlap.min.y, z: Math.min(upper.bounds.min.z, lower.bounds.min.z) },
      max: { x: overlap.max.x, y: overlap.max.y, z: Math.max(upper.bounds.max.z, lower.bounds.max.z) },
    },
  };
}
