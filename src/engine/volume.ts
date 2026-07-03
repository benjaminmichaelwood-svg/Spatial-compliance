import { TriangulatedSurface, CutFillResult } from './types';
import {
  buildSpatialIndex,
  interpolateZIndexed,
  computeOverlapBounds,
  buildDifferenceSurface,
} from './surface-operations';

export function computeCutFill(
  preMining: TriangulatedSurface,
  postMining: TriangulatedSurface,
  resolution: number = 80
): CutFillResult {
  const overlap = computeOverlapBounds(preMining, postMining);

  if (!overlap) {
    return {
      cutVolume: 0,
      fillVolume: 0,
      netVolume: 0,
      gridCells: [],
      cutSurface: null,
      fillSurface: null,
    };
  }

  const rangeX = overlap.max.x - overlap.min.x;
  const rangeY = overlap.max.y - overlap.min.y;
  const cellSize = Math.max(rangeX, rangeY) / resolution;
  const nx = Math.ceil(rangeX / cellSize);
  const ny = Math.ceil(rangeY / cellSize);
  const cellArea = cellSize * cellSize;

  const indexPre = buildSpatialIndex(preMining, cellSize * 2);
  const indexPost = buildSpatialIndex(postMining, cellSize * 2);

  let cutVolume = 0;
  let fillVolume = 0;
  const gridCells: CutFillResult['gridCells'] = [];

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = overlap.min.x + (i + 0.5) * cellSize;
      const y = overlap.min.y + (j + 0.5) * cellSize;

      const preZ = interpolateZIndexed(indexPre, x, y);
      const postZ = interpolateZIndexed(indexPost, x, y);

      gridCells.push({
        row: j,
        col: i,
        centroidX: x,
        centroidY: y,
        designZ: preZ,
        actualZ: postZ,
      });

      if (preZ !== null && postZ !== null) {
        const diff = preZ - postZ;
        if (diff > 0) {
          cutVolume += diff * cellArea;
        } else {
          fillVolume += Math.abs(diff) * cellArea;
        }
      }
    }
  }

  const cutSurface = buildDifferenceSurface(preMining, postMining, 'cut_solid', resolution);
  const fillSurface = buildDifferenceSurface(postMining, preMining, 'fill_solid', resolution);

  return {
    cutVolume,
    fillVolume,
    netVolume: cutVolume - fillVolume,
    gridCells,
    cutSurface,
    fillSurface,
  };
}

export function computeSurfaceArea(surface: TriangulatedSurface): number {
  const { vertices, indices } = surface;
  let area = 0;

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const ax = vertices[i1] - vertices[i0];
    const ay = vertices[i1 + 1] - vertices[i0 + 1];
    const az = vertices[i1 + 2] - vertices[i0 + 2];

    const bx = vertices[i2] - vertices[i0];
    const by = vertices[i2 + 1] - vertices[i0 + 1];
    const bz = vertices[i2 + 2] - vertices[i0 + 2];

    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;

    area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  }

  return area;
}

export function computeSignedVolume(surface: TriangulatedSurface): number {
  const { vertices, indices } = surface;
  let volume = 0;

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const x0 = vertices[i0], y0 = vertices[i0 + 1], z0 = vertices[i0 + 2];
    const x1 = vertices[i1], y1 = vertices[i1 + 1], z1 = vertices[i1 + 2];
    const x2 = vertices[i2], y2 = vertices[i2 + 1], z2 = vertices[i2 + 2];

    volume += (
      x0 * (y1 * z2 - y2 * z1) +
      x1 * (y2 * z0 - y0 * z2) +
      x2 * (y0 * z1 - y1 * z0)
    ) / 6;
  }

  return volume;
}

export function computeVolumeBetweenSurfaces(
  upper: TriangulatedSurface,
  lower: TriangulatedSurface,
  resolution: number = 80
): number {
  const overlap = computeOverlapBounds(upper, lower);
  if (!overlap) return 0;

  const rangeX = overlap.max.x - overlap.min.x;
  const rangeY = overlap.max.y - overlap.min.y;
  const cellSize = Math.max(rangeX, rangeY) / resolution;
  const nx = Math.ceil(rangeX / cellSize);
  const ny = Math.ceil(rangeY / cellSize);
  const cellArea = cellSize * cellSize;

  const indexUpper = buildSpatialIndex(upper, cellSize * 2);
  const indexLower = buildSpatialIndex(lower, cellSize * 2);

  let volume = 0;

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = overlap.min.x + (i + 0.5) * cellSize;
      const y = overlap.min.y + (j + 0.5) * cellSize;

      const zUpper = interpolateZIndexed(indexUpper, x, y);
      const zLower = interpolateZIndexed(indexLower, x, y);

      if (zUpper !== null && zLower !== null) {
        const diff = zUpper - zLower;
        if (diff > 0) {
          volume += diff * cellArea;
        }
      }
    }
  }

  return volume;
}
