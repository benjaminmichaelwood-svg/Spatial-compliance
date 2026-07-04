import type { Vec3, DomainSolid, UploadedSurface, SurfaceRole } from '../types';
import { SURFACE_ROLES } from '../types';

export interface SectionPoint {
  dist: number;
  z: number;
}

export interface SurfaceProfile {
  role: SurfaceRole;
  label: string;
  fileName: string;
  color: string;
  points: SectionPoint[];
}

export interface SolidSection {
  domain: string;
  label: string;
  color: string;
  polygon: SectionPoint[];
}

export interface CrossSectionData {
  profiles: SurfaceProfile[];
  solids: SolidSection[];
}

const PROFILE_COLORS: Record<SurfaceRole, string> = {
  production_start: '#94a3b8',
  production_end: '#64748b',
  schedule_start: '#7dd3fc',
  schedule_end: '#38bdf8',
  schedule_future: '#a78bfa',
};

function intersectEdge(
  v0: Vec3, v1: Vec3,
  d0: number, d1: number,
  dirX: number, dirY: number,
  ox: number, oy: number,
): SectionPoint | null {
  if ((d0 > 0) === (d1 > 0)) return null;
  if (Math.abs(d0 - d1) < 1e-12) return null;
  const t = d0 / (d0 - d1);
  const x = v0.x + t * (v1.x - v0.x);
  const y = v0.y + t * (v1.y - v0.y);
  const z = v0.z + t * (v1.z - v0.z);
  const dist = (x - ox) * dirX + (y - oy) * dirY;
  return { dist, z };
}

function intersectMesh(
  vertices: Vec3[],
  indices: [number, number, number][],
  nx: number, ny: number,
  ox: number, oy: number,
  dirX: number, dirY: number,
): [SectionPoint, SectionPoint][] {
  const segments: [SectionPoint, SectionPoint][] = [];

  for (const [i0, i1, i2] of indices) {
    const vs = [vertices[i0], vertices[i1], vertices[i2]];
    const ds = vs.map(v => nx * (v.x - ox) + ny * (v.y - oy));

    const crossings: SectionPoint[] = [];
    for (let e = 0; e < 3; e++) {
      const e2 = (e + 1) % 3;
      const pt = intersectEdge(vs[e], vs[e2], ds[e], ds[e2], dirX, dirY, ox, oy);
      if (pt) crossings.push(pt);
    }

    for (let e = 0; e < 3; e++) {
      if (Math.abs(ds[e]) < 1e-10) {
        const dist = (vs[e].x - ox) * dirX + (vs[e].y - oy) * dirY;
        crossings.push({ dist, z: vs[e].z });
      }
    }

    if (crossings.length >= 2) {
      segments.push([crossings[0], crossings[1]]);
    }
  }

  return segments;
}

function computePlaneParams(p1: [number, number], p2: [number, number]) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return null;
  return { nx: -dy / len, ny: dx / len, dirX: dx / len, dirY: dy / len, ox: p1[0], oy: p1[1] };
}

function computeSurfaceProfile(
  vertices: Vec3[],
  indices: [number, number, number][],
  p1: [number, number],
  p2: [number, number],
): SectionPoint[] {
  const params = computePlaneParams(p1, p2);
  if (!params) return [];

  const segments = intersectMesh(vertices, indices, params.nx, params.ny, params.ox, params.oy, params.dirX, params.dirY);
  const points: SectionPoint[] = [];
  for (const [a, b] of segments) {
    points.push(a, b);
  }
  points.sort((a, b) => a.dist - b.dist);

  const result: SectionPoint[] = [];
  for (const p of points) {
    if (
      result.length === 0 ||
      Math.abs(p.dist - result[result.length - 1].dist) > 0.01 ||
      Math.abs(p.z - result[result.length - 1].z) > 0.01
    ) {
      result.push(p);
    }
  }
  return result;
}

function quantize(dist: number, z: number): string {
  return `${Math.round(dist * 50)}:${Math.round(z * 50)}`;
}

function computeSolidSections(
  solid: DomainSolid,
  p1: [number, number],
  p2: [number, number],
): SectionPoint[][] {
  const params = computePlaneParams(p1, p2);
  if (!params) return [];

  const segments = intersectMesh(
    solid.solid.vertices, solid.solid.indices,
    params.nx, params.ny, params.ox, params.oy, params.dirX, params.dirY,
  );
  if (segments.length === 0) return [];

  const adj = new Map<string, { segIdx: number; other: SectionPoint }[]>();
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    const ka = quantize(a.dist, a.z);
    const kb = quantize(b.dist, b.z);
    for (const [key, pt] of [[ka, b], [kb, a]] as [string, SectionPoint][]) {
      if (!adj.has(key)) adj.set(key, []);
      adj.get(key)!.push({ segIdx: i, other: pt });
    }
  }

  const used = new Set<number>();
  const polygons: SectionPoint[][] = [];

  for (let start = 0; start < segments.length; start++) {
    if (used.has(start)) continue;
    used.add(start);

    const poly: SectionPoint[] = [segments[start][0]];
    let current = segments[start][1];

    for (let iter = 0; iter < segments.length + 1; iter++) {
      poly.push(current);
      const key = quantize(current.dist, current.z);
      const neighbors = adj.get(key);
      if (!neighbors) break;
      const next = neighbors.find(e => !used.has(e.segIdx));
      if (!next) break;
      used.add(next.segIdx);
      current = next.other;
    }

    if (poly.length >= 3) polygons.push(poly);
  }

  return polygons;
}

export function computeCrossSection(
  uploads: Map<SurfaceRole, UploadedSurface>,
  domains: DomainSolid[],
  p1: [number, number],
  p2: [number, number],
): CrossSectionData {
  const profiles: SurfaceProfile[] = [];

  for (const { key, label } of SURFACE_ROLES) {
    const upload = uploads.get(key);
    if (!upload) continue;
    const points = computeSurfaceProfile(upload.surface.vertices, upload.surface.indices, p1, p2);
    if (points.length > 0) {
      profiles.push({ role: key, label, fileName: upload.fileName, color: PROFILE_COLORS[key], points });
    }
  }

  const solids: SolidSection[] = [];
  for (const domain of domains) {
    const polygons = computeSolidSections(domain, p1, p2);
    for (const polygon of polygons) {
      solids.push({ domain: domain.domain, label: domain.label, color: domain.color, polygon });
    }
  }

  return { profiles, solids };
}
