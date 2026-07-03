import { TriangulatedSurface } from '../engine/types';
import {
  buildSpatialIndex,
  interpolateZIndexed,
  computeOverlapBounds,
  buildDifferenceSurface,
  SpatialIndex,
} from '../engine/surface-operations';
import { computeVolumeBetweenSurfaces, computeSurfaceArea } from '../engine/volume';
import { ConformanceDomain, ComplianceResult, DomainType, DOMAIN_COLORS } from './types';

export interface ComplianceInputs {
  preMining: TriangulatedSurface;
  plannedEOP: TriangulatedSurface;
  actualEOP: TriangulatedSurface;
  plannedStart?: TriangulatedSurface;
  actualStart?: TriangulatedSurface;
  plannedDump?: TriangulatedSurface;
  actualDump?: TriangulatedSurface;
  preDump?: TriangulatedSurface;
  resolution?: number;
}

interface ClassifiedCell {
  x: number;
  y: number;
  preZ: number | null;
  plannedZ: number | null;
  actualZ: number | null;
  startZ: number | null;
  domain: DomainType | null;
}

function classifyCutDomains(
  preMining: TriangulatedSurface,
  plannedEOP: TriangulatedSurface,
  actualEOP: TriangulatedSurface,
  plannedStart: TriangulatedSurface | undefined,
  resolution: number
): ClassifiedCell[] {
  const allSurfaces = [preMining, plannedEOP, actualEOP];
  if (plannedStart) allSurfaces.push(plannedStart);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of allSurfaces) {
    minX = Math.min(minX, s.bounds.min.x);
    maxX = Math.max(maxX, s.bounds.max.x);
    minY = Math.min(minY, s.bounds.min.y);
    maxY = Math.max(maxY, s.bounds.max.y);
  }

  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  if (rangeX <= 0 || rangeY <= 0) return [];

  const cellSize = Math.max(rangeX, rangeY) / resolution;
  const nx = Math.ceil(rangeX / cellSize);
  const ny = Math.ceil(rangeY / cellSize);

  const idxPre = buildSpatialIndex(preMining, cellSize * 2);
  const idxPlanned = buildSpatialIndex(plannedEOP, cellSize * 2);
  const idxActual = buildSpatialIndex(actualEOP, cellSize * 2);
  const idxStart = plannedStart ? buildSpatialIndex(plannedStart, cellSize * 2) : null;

  const cells: ClassifiedCell[] = [];
  const tolerance = cellSize * 0.1;

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = minX + (i + 0.5) * cellSize;
      const y = minY + (j + 0.5) * cellSize;

      const preZ = interpolateZIndexed(idxPre, x, y);
      const plannedZ = interpolateZIndexed(idxPlanned, x, y);
      const actualZ = interpolateZIndexed(idxActual, x, y);
      const startZ = idxStart ? interpolateZIndexed(idxStart, x, y) : null;

      let domain: DomainType | null = null;

      if (preZ === null && plannedZ === null && actualZ === null) {
        cells.push({ x, y, preZ, plannedZ, actualZ, startZ, domain: null });
        continue;
      }

      const hasMining = actualZ !== null && preZ !== null && (preZ - actualZ) > tolerance;
      const hasPlannedMining = plannedZ !== null && preZ !== null && (preZ - plannedZ) > tolerance;
      const hasStartMining = startZ !== null && preZ !== null && (preZ - startZ) > tolerance;

      if (hasMining && hasPlannedMining) {
        if (actualZ !== null && plannedZ !== null) {
          const diff = Math.abs(actualZ - plannedZ);
          if (diff <= tolerance * 3) {
            domain = DomainType.PlannedAndMined;
          } else if (actualZ < plannedZ) {
            domain = DomainType.AheadOfPlan;
          } else {
            domain = DomainType.PrescheduleDelay;
          }
        }
      } else if (hasMining && !hasPlannedMining) {
        if (hasStartMining) {
          domain = DomainType.MinedBeforeStart;
        } else {
          domain = DomainType.MinedNotPlanned;
        }
      } else if (!hasMining && hasPlannedMining) {
        domain = DomainType.PlannedNotMined;
      }

      cells.push({ x, y, preZ, plannedZ, actualZ, startZ, domain });
    }
  }

  return cells;
}

function classifyDumpDomains(
  preDump: TriangulatedSurface,
  plannedDump: TriangulatedSurface,
  actualDump: TriangulatedSurface,
  resolution: number
): ClassifiedCell[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of [preDump, plannedDump, actualDump]) {
    minX = Math.min(minX, s.bounds.min.x);
    maxX = Math.max(maxX, s.bounds.max.x);
    minY = Math.min(minY, s.bounds.min.y);
    maxY = Math.max(maxY, s.bounds.max.y);
  }

  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  if (rangeX <= 0 || rangeY <= 0) return [];

  const cellSize = Math.max(rangeX, rangeY) / resolution;
  const nx = Math.ceil(rangeX / cellSize);
  const ny = Math.ceil(rangeY / cellSize);

  const idxPre = buildSpatialIndex(preDump, cellSize * 2);
  const idxPlanned = buildSpatialIndex(plannedDump, cellSize * 2);
  const idxActual = buildSpatialIndex(actualDump, cellSize * 2);

  const cells: ClassifiedCell[] = [];
  const tolerance = cellSize * 0.1;

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = minX + (i + 0.5) * cellSize;
      const y = minY + (j + 0.5) * cellSize;

      const preZ = interpolateZIndexed(idxPre, x, y);
      const plannedZ = interpolateZIndexed(idxPlanned, x, y);
      const actualZ = interpolateZIndexed(idxActual, x, y);

      let domain: DomainType | null = null;

      const hasPlacement = actualZ !== null && preZ !== null && (actualZ - preZ) > tolerance;
      const hasPlannedPlacement = plannedZ !== null && preZ !== null && (plannedZ - preZ) > tolerance;

      if (hasPlacement && hasPlannedPlacement) {
        if (actualZ !== null && plannedZ !== null) {
          const diff = Math.abs(actualZ - plannedZ);
          if (diff <= tolerance * 3) {
            domain = DomainType.DumpPlannedAndMined;
          } else if (actualZ > plannedZ) {
            domain = DomainType.DumpAheadOfPlan;
          } else {
            domain = DomainType.DumpPrescheduleDelay;
          }
        }
      } else if (hasPlacement && !hasPlannedPlacement) {
        domain = DomainType.DumpMinedNotPlanned;
      } else if (!hasPlacement && hasPlannedPlacement) {
        domain = DomainType.DumpPlannedNotMined;
      }

      cells.push({ x, y, preZ, plannedZ, actualZ, startZ: null, domain });
    }
  }

  return cells;
}

function buildDomainSurface(
  cells: ClassifiedCell[],
  domainType: DomainType,
  cellSize: number
): TriangulatedSurface | null {
  const domainCells = cells.filter((c) => c.domain === domainType);
  if (domainCells.length === 0) return null;

  const vertices: number[] = [];
  const indices: number[] = [];

  for (const cell of domainCells) {
    const baseIdx = vertices.length / 3;
    const half = cellSize / 2;
    const z = cell.actualZ ?? cell.plannedZ ?? cell.preZ ?? 0;

    vertices.push(cell.x - half, cell.y - half, z);
    vertices.push(cell.x + half, cell.y - half, z);
    vertices.push(cell.x + half, cell.y + half, z);
    vertices.push(cell.x - half, cell.y + half, z);

    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
  }

  const verts = new Float64Array(vertices);
  const idxs = new Uint32Array(indices);

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < verts.length; i += 3) {
    minX = Math.min(minX, verts[i]);
    maxX = Math.max(maxX, verts[i]);
    minY = Math.min(minY, verts[i + 1]);
    maxY = Math.max(maxY, verts[i + 1]);
    minZ = Math.min(minZ, verts[i + 2]);
    maxZ = Math.max(maxZ, verts[i + 2]);
  }

  return {
    name: domainType,
    vertices: verts,
    indices: idxs,
    bounds: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
  };
}

export function computeCompliance(inputs: ComplianceInputs): ComplianceResult {
  const resolution = inputs.resolution ?? 80;
  const domains: ConformanceDomain[] = [];

  const cutCells = classifyCutDomains(
    inputs.preMining,
    inputs.plannedEOP,
    inputs.actualEOP,
    inputs.plannedStart,
    resolution
  );

  const allBounds = [inputs.preMining, inputs.plannedEOP, inputs.actualEOP];
  let rangeX = 0, rangeY = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of allBounds) {
    minX = Math.min(minX, s.bounds.min.x);
    maxX = Math.max(maxX, s.bounds.max.x);
    minY = Math.min(minY, s.bounds.min.y);
    maxY = Math.max(maxY, s.bounds.max.y);
  }
  rangeX = maxX - minX;
  rangeY = maxY - minY;
  const cellSize = Math.max(rangeX, rangeY) / resolution;
  const cellArea = cellSize * cellSize;

  const cutDomainTypes = [
    DomainType.PlannedAndMined,
    DomainType.MinedNotPlanned,
    DomainType.PrescheduleDelay,
    DomainType.AheadOfPlan,
    DomainType.MinedBeforeStart,
    DomainType.PlannedNotMined,
  ];

  for (const dt of cutDomainTypes) {
    const matchingCells = cutCells.filter((c) => c.domain === dt);
    const surface = buildDomainSurface(cutCells, dt, cellSize);

    let volume = 0;
    for (const cell of matchingCells) {
      if (cell.preZ !== null && cell.actualZ !== null) {
        volume += Math.abs(cell.preZ - cell.actualZ) * cellArea;
      } else if (cell.preZ !== null && cell.plannedZ !== null) {
        volume += Math.abs(cell.preZ - cell.plannedZ) * cellArea;
      }
    }

    domains.push({
      type: dt,
      surface,
      volume,
      area: matchingCells.length * cellArea,
      color: DOMAIN_COLORS[dt],
      visible: true,
    });
  }

  if (inputs.plannedDump && inputs.actualDump) {
    const preDump = inputs.preDump ?? inputs.preMining;
    const dumpCells = classifyDumpDomains(preDump, inputs.plannedDump, inputs.actualDump, resolution);

    const dumpDomainTypes = [
      DomainType.DumpPlannedAndMined,
      DomainType.DumpMinedNotPlanned,
      DomainType.DumpPrescheduleDelay,
      DomainType.DumpAheadOfPlan,
      DomainType.DumpPlannedNotMined,
    ];

    for (const dt of dumpDomainTypes) {
      const matchingCells = dumpCells.filter((c) => c.domain === dt);
      const surface = buildDomainSurface(dumpCells, dt, cellSize);

      let volume = 0;
      for (const cell of matchingCells) {
        if (cell.preZ !== null && cell.actualZ !== null) {
          volume += Math.abs(cell.actualZ - cell.preZ) * cellArea;
        }
      }

      domains.push({
        type: dt,
        surface,
        volume,
        area: matchingCells.length * cellArea,
        color: DOMAIN_COLORS[dt],
        visible: true,
      });
    }
  }

  const totalPlannedVolume = domains
    .filter((d) => d.type.includes('Planned'))
    .reduce((sum, d) => sum + d.volume, 0);

  const totalActualVolume = domains
    .filter((d) => !d.type.includes('Not Mined') && !d.type.includes('Not Placed'))
    .reduce((sum, d) => sum + d.volume, 0);

  const conformanceVolume = domains
    .filter((d) => d.type === DomainType.PlannedAndMined || d.type === DomainType.DumpPlannedAndMined)
    .reduce((sum, d) => sum + d.volume, 0);

  const conformancePercent = totalPlannedVolume > 0
    ? (conformanceVolume / totalPlannedVolume) * 100
    : 0;

  return {
    domains,
    totalPlannedVolume,
    totalActualVolume,
    conformancePercent,
    timestamp: new Date().toISOString(),
  };
}
