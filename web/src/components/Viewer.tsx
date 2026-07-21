import { useRef, useMemo, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, useThree, useFrame, type CanvasProps } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type {
  BoundaryRegion,
  SurfaceRole,
  UploadedSurface,
  ObjectStyle,
  MeasureTool,
  ViewPreset,
  ViewerBackground,
} from '../types';
import { SURFACE_ROLES } from '../types';
import type { FlatDomainSolid } from '../workers/engineClient';
import PerformanceOverlay from './PerformanceOverlay';
import ThicknessLegend, { RAMP } from './ThicknessLegend';

interface ThicknessMode {
  domain: string;
  scaleMin: number;
  scaleMax: number;
  hideBelow: number | null;
}

const DOMAIN_NAME_TO_INDEX: Record<string, number> = {
  PlannedAndMined: 1, PlannedNotMined: 2, MinedNotPlanned: 3,
  MinedBeforeStart: 4, PrescheduleDelay: 5, AheadOfPlan: 6,
  PlannedAndDumped: 7, PlannedNotDumped: 8, DumpedNotPlanned: 9,
  DumpedBeforeStart: 10, DumpPrescheduleDelay: 11, DumpedAheadOfPlan: 12,
};

function sampleRamp(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < RAMP.length - 1; i++) {
    if (clamped >= RAMP[i].t && clamped <= RAMP[i + 1].t) {
      const seg = (clamped - RAMP[i].t) / (RAMP[i + 1].t - RAMP[i].t);
      const c0 = new THREE.Color(RAMP[i].color);
      const c1 = new THREE.Color(RAMP[i + 1].color);
      return [
        c0.r + (c1.r - c0.r) * seg,
        c0.g + (c1.g - c0.g) * seg,
        c0.b + (c1.b - c0.b) * seg,
      ];
    }
  }
  const last = new THREE.Color(RAMP[RAMP.length - 1].color);
  return [last.r, last.g, last.b];
}

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

interface DomainGroupProps {
  domain: string;
  solids: FlatDomainSolid[];
  visible: boolean;
  style: ObjectStyle;
  selected: boolean;
  highlighted: boolean;
  isDark: boolean;
  onHover: (info: TooltipInfo | null) => void;
  onSelect: (id: string, info: SelectionInfo) => void;
}

export interface TooltipInfo {
  x: number;
  y: number;
  domain: string;
  volume: number;
  blockName?: string;
  surfaceFileName?: string;
  surfaceRoleLabel?: string;
  thickness?: number;
}

export interface SelectionInfo {
  type: 'domain' | 'surface';
  id: string;
  domain?: string;
  label: string;
  volume?: number;
  blockName?: string;
  surfaceFileName?: string;
  surfaceRole?: string;
  vertexCount?: number;
  triangleCount?: number;
  bbox?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

export interface MeasurePoint {
  position: THREE.Vector3;
  screenX: number;
  screenY: number;
}

export interface SavedMeasurement {
  id: number;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  distance: number;
}

const DEFAULT_SURFACE_COLORS: Record<SurfaceRole, string> = {
  production_start: '#94a3b8',
  production_end: '#64748b',
  schedule_start: '#7dd3fc',
  schedule_end: '#38bdf8',
  schedule_future: '#a78bfa',
};

interface DomainIndexInfo {
  domain: string;
  label: string;
  color: THREE.Color;
}

const DOMAIN_INDEX_MAP: DomainIndexInfo[] = [
  { domain: '', label: '', color: new THREE.Color(0x808080) },
  { domain: 'PlannedAndMined', label: 'Planned and Mined', color: new THREE.Color('#4CAF50') },
  { domain: 'PlannedNotMined', label: 'Planned Not Mined', color: new THREE.Color('#FFEB3B') },
  { domain: 'MinedNotPlanned', label: 'Mined Not Planned', color: new THREE.Color('#F44336') },
  { domain: 'MinedBeforeStart', label: 'Mined Before Start', color: new THREE.Color('#9C27B0') },
  { domain: 'PrescheduleDelay', label: 'Preschedule Delay', color: new THREE.Color('#FF9800') },
  { domain: 'AheadOfPlan', label: 'Ahead of Plan', color: new THREE.Color('#2196F3') },
  { domain: 'PlannedAndDumped', label: 'Planned and Dumped', color: new THREE.Color('#66BB6A') },
  { domain: 'PlannedNotDumped', label: 'Planned Not Dumped', color: new THREE.Color('#FFF176') },
  { domain: 'DumpedNotPlanned', label: 'Dumped Not Planned', color: new THREE.Color('#EF5350') },
  { domain: 'DumpedBeforeStart', label: 'Dumped Before Start', color: new THREE.Color('#AB47BC') },
  { domain: 'DumpPrescheduleDelay', label: 'Dump Preschedule Delay', color: new THREE.Color('#FFA726') },
  { domain: 'DumpedAheadOfPlan', label: 'Dumped Ahead of Plan', color: new THREE.Color('#42A5F5') },
];

const BG_COLORS: Record<ViewerBackground, string> = {
  dark: '#1a1a1a',
  light: '#ffffff',
};

const EDGE_COLOR_DARK = 0x444444;
const EDGE_COLOR_LIGHT = 0x999999;

function computeSmoothNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  const acc = new Map<string, [number, number, number]>();
  const key = (i: number) =>
    `${Math.round(positions[i * 3] * 1000)},${Math.round(positions[i * 3 + 1] * 1000)},${Math.round(positions[i * 3 + 2] * 1000)}`;

  for (let t = 0; t < positions.length / 9; t++) {
    const i0 = t * 3, i1 = t * 3 + 1, i2 = t * 3 + 2;
    const ax = positions[i1 * 3] - positions[i0 * 3], ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1], az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
    const bx = positions[i2 * 3] - positions[i0 * 3], by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1], bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    for (const i of [i0, i1, i2]) {
      const k = key(i);
      const e = acc.get(k);
      if (e) { e[0] += nx; e[1] += ny; e[2] += nz; } else { acc.set(k, [nx, ny, nz]); }
    }
  }
  for (let i = 0; i < positions.length / 3; i++) {
    const [nx, ny, nz] = acc.get(key(i))!;
    const len = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / len; normals[i * 3 + 1] = ny / len; normals[i * 3 + 2] = nz / len;
  }
  return normals;
}

interface SurfaceMeshProps {
  upload: UploadedSurface;
  style: ObjectStyle;
  selected: boolean;
  highlighted: boolean;
  isDark: boolean;
  onHover: (info: TooltipInfo | null) => void;
  onSelect: (id: string, info: SelectionInfo) => void;
  domainMap?: Uint8Array;
  thicknessMap?: Float32Array;
  thicknessMode?: ThicknessMode | null;
  domainVisible?: Set<string>;
}

function SurfaceMesh({ upload, style, selected, highlighted, onHover, onSelect, isDark, domainMap, domainVisible, thicknessMap, thicknessMode }: SurfaceMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhongMaterial>(null);

  const { geometry, triCount } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(upload.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(upload.indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    (geo as any).boundsTree = new MeshBVH(geo);
    return { geometry: geo, triCount: upload.triangleCount };
  }, [upload]);

  const paintedGeo = useMemo(() => {
    if (!domainMap || domainMap.length === 0) return null;
    const nonIndexed = geometry.toNonIndexed();
    const positions = nonIndexed.attributes.position.array as Float32Array;
    nonIndexed.setAttribute('normal', new THREE.BufferAttribute(
      computeSmoothNormals(positions), 3,
    ));
    nonIndexed.computeBoundingSphere();
    const count = nonIndexed.attributes.position.count;
    const colors = new Float32Array(count * 3);
    nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    (nonIndexed as any).boundsTree = new MeshBVH(nonIndexed);
    return nonIndexed;
  }, [geometry, domainMap]);

  useEffect(() => {
    if (!paintedGeo || !domainMap) return;
    const colorAttr = paintedGeo.attributes.color as THREE.BufferAttribute;
    const arr = colorAttr.array as Float32Array;
    const defaultColor = new THREE.Color(style.color);

    const activeThickness = thicknessMode && thicknessMap;
    const targetDomainIdx = activeThickness ? DOMAIN_NAME_TO_INDEX[thicknessMode!.domain] : undefined;

    for (let ti = 0; ti < domainMap.length; ti++) {
      const idx = domainMap[ti];
      let r: number, g: number, b: number;
      let alpha = 1.0;

      if (activeThickness && targetDomainIdx !== undefined) {
        if (idx === targetDomainIdx) {
          const thick = thicknessMap![ti] || 0;
          if (thicknessMode!.hideBelow !== null && thick < thicknessMode!.hideBelow) {
            alpha = 0;
            r = 0; g = 0; b = 0;
          } else {
            const range = thicknessMode!.scaleMax - thicknessMode!.scaleMin;
            const t = range > 0 ? (thick - thicknessMode!.scaleMin) / range : 0;
            [r, g, b] = sampleRamp(t);
          }
        } else {
          r = defaultColor.r * 0.3;
          g = defaultColor.g * 0.3;
          b = defaultColor.b * 0.3;
          alpha = 0.05;
        }
      } else if (idx > 0 && idx < DOMAIN_INDEX_MAP.length) {
        const c = DOMAIN_INDEX_MAP[idx].color;
        r = c.r; g = c.g; b = c.b;
      } else {
        r = defaultColor.r; g = defaultColor.g; b = defaultColor.b;
      }

      const vi = ti * 3;
      for (let v = 0; v < 3; v++) {
        arr[(vi + v) * 3] = alpha > 0 ? r : 0;
        arr[(vi + v) * 3 + 1] = alpha > 0 ? g : 0;
        arr[(vi + v) * 3 + 2] = alpha > 0 ? b : 0;
      }
    }
    colorAttr.needsUpdate = true;
  }, [paintedGeo, domainMap, style.color, thicknessMap, thicknessMode]);

  const isPainted = !!paintedGeo;
  const activeGeo = paintedGeo ?? geometry;

  useEffect(() => {
    if (!matRef.current) return;
    if (isPainted) {
      matRef.current.color.set('#ffffff');
      matRef.current.opacity = 0.92;
      matRef.current.transparent = true;
    } else {
      const c = new THREE.Color(style.color);
      if (selected) c.lerp(new THREE.Color('#ffffff'), 0.15);
      else if (highlighted) c.lerp(new THREE.Color('#ffffff'), 0.25);
      matRef.current.color.copy(c);
      matRef.current.opacity = style.opacity;
      matRef.current.transparent = style.opacity < 1;
    }
    matRef.current.needsUpdate = true;
  }, [style.color, style.opacity, selected, highlighted, isPainted]);

  const roleLabel = SURFACE_ROLES.find((r) => r.key === upload.role)?.label ?? upload.role;
  const id = `surface-${upload.role}`;

  const surfaceMeta = useMemo(() => {
    const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < upload.vertexCount; i++) {
      const x = upload.positions[i * 3], y = upload.positions[i * 3 + 1], z = upload.positions[i * 3 + 2];
      if (x < box.minX) box.minX = x; if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y; if (y > box.maxY) box.maxY = y;
      if (z < box.minZ) box.minZ = z; if (z > box.maxZ) box.maxZ = z;
    }
    return { vertexCount: upload.vertexCount, triangleCount: upload.triangleCount, bbox: box };
  }, [upload]);

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={activeGeo}
        frustumCulled
        onPointerOver={(e) => {
          e.stopPropagation();
          let thick: number | undefined;
          if (thicknessMode && thicknessMap && e.faceIndex != null) {
            const fi = isPainted ? e.faceIndex : e.faceIndex;
            thick = thicknessMap[fi];
          }
          onHover({
            x: e.clientX, y: e.clientY, domain: roleLabel, volume: 0,
            surfaceFileName: upload.fileName, surfaceRoleLabel: roleLabel,
            thickness: thick,
          });
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          let thick: number | undefined;
          if (thicknessMode && thicknessMap && e.faceIndex != null) {
            const fi = isPainted ? e.faceIndex : e.faceIndex;
            thick = thicknessMap[fi];
          }
          onHover({
            x: e.clientX, y: e.clientY, domain: roleLabel, volume: 0,
            surfaceFileName: upload.fileName, surfaceRoleLabel: roleLabel,
            thickness: thick,
          });
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id, {
            type: 'surface', id, label: roleLabel,
            surfaceFileName: upload.fileName, surfaceRole: upload.role,
            ...surfaceMeta,
          });
        }}
      >
        <meshPhongMaterial
          ref={matRef}
          color={isPainted ? '#ffffff' : style.color}
          vertexColors={isPainted}
          opacity={isPainted ? 0.92 : style.opacity}
          transparent={isPainted || style.opacity < 1}
          side={THREE.DoubleSide}
          flatShading={false}
          shininess={isPainted ? 15 : 10}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {style.wireframe && (
        <mesh geometry={activeGeo} frustumCulled>
          <meshBasicMaterial
            wireframe
            color={isDark ? EDGE_COLOR_DARK : EDGE_COLOR_LIGHT}
            transparent
            opacity={0.15}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

function buildBatchedGeometry(
  solids: FlatDomainSolid[],
): { geometry: THREE.BufferGeometry; triRanges: { start: number; end: number; solidIdx: number }[]; totalTris: number } {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const s of solids) {
    totalVerts += s.vertexCount;
    totalIndices += s.triangleCount * 3;
  }

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);
  const triRanges: { start: number; end: number; solidIdx: number }[] = [];

  let vOffset = 0;
  let iOffset = 0;
  let triOffset = 0;

  for (let si = 0; si < solids.length; si++) {
    const s = solids[si];
    for (let i = 0; i < s.vertexCount * 3; i++) {
      positions[vOffset * 3 + i] = s.positions[i];
    }
    for (let i = 0; i < s.triangleCount * 3; i++) {
      indices[iOffset + i] = s.indices[i] + vOffset;
    }
    triRanges.push({
      start: triOffset,
      end: triOffset + s.triangleCount,
      solidIdx: si,
    });
    vOffset += s.vertexCount;
    iOffset += s.triangleCount * 3;
    triOffset += s.triangleCount;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  (geo as any).boundsTree = new MeshBVH(geo);
  return { geometry: geo, triRanges, totalTris: triOffset };
}

function BatchedDomainGroup({
  domain, solids, visible, style, selected, highlighted, isDark, onHover, onSelect,
}: DomainGroupProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhongMaterial>(null);

  const { geo, triRanges, totalTris } = useMemo(() => {
    const result = buildBatchedGeometry(solids);
    return { geo: result.geometry, triRanges: result.triRanges, totalTris: result.totalTris };
  }, [solids]);

  useEffect(() => {
    if (!matRef.current) return;
    const c = new THREE.Color(style.color);
    if (selected) c.lerp(new THREE.Color('#ffffff'), 0.15);
    else if (highlighted) c.lerp(new THREE.Color('#ffffff'), 0.25);
    matRef.current.color.copy(c);
    matRef.current.opacity = style.opacity;
    matRef.current.transparent = style.opacity < 1;
    matRef.current.needsUpdate = true;
  }, [style.color, style.opacity, selected, highlighted]);

  const findSolid = useCallback((faceIndex: number) => {
    for (const range of triRanges) {
      if (faceIndex >= range.start && faceIndex < range.end) {
        return solids[range.solidIdx];
      }
    }
    return solids[0];
  }, [triRanges, solids]);

  if (!visible) return null;

  const id = `domain-${domain}`;

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={geo}
        frustumCulled
        onPointerOver={(e) => {
          e.stopPropagation();
          const solid = e.faceIndex != null ? findSolid(e.faceIndex) : solids[0];
          onHover({
            x: e.clientX, y: e.clientY, domain: solid?.label ?? domain,
            volume: solid?.volume ?? 0, blockName: solid?.block_name,
          });
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          const solid = e.faceIndex != null ? findSolid(e.faceIndex) : solids[0];
          onHover({
            x: e.clientX, y: e.clientY, domain: solid?.label ?? domain,
            volume: solid?.volume ?? 0, blockName: solid?.block_name,
          });
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          const solid = e.faceIndex != null ? findSolid(e.faceIndex) : solids[0];
          const solidId = `domain-${solid?.domain ?? domain}-${solid?.block_name ?? ''}`;
          let bbox: SelectionInfo['bbox'] | undefined;
          if (solid) {
            const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
            for (let i = 0; i < solid.vertexCount; i++) {
              const x = solid.positions[i * 3], y = solid.positions[i * 3 + 1], z = solid.positions[i * 3 + 2];
              if (x < box.minX) box.minX = x; if (x > box.maxX) box.maxX = x;
              if (y < box.minY) box.minY = y; if (y > box.maxY) box.maxY = y;
              if (z < box.minZ) box.minZ = z; if (z > box.maxZ) box.maxZ = z;
            }
            bbox = box;
          }
          onSelect(solidId, {
            type: 'domain', id: solidId, domain: solid?.domain ?? domain,
            label: solid?.label ?? domain, volume: solid?.volume ?? 0,
            blockName: solid?.block_name,
            vertexCount: solid?.vertexCount, triangleCount: solid?.triangleCount,
            bbox,
          });
        }}
      >
        <meshPhongMaterial
          ref={matRef}
          color={style.color}
          opacity={style.opacity}
          transparent={style.opacity < 1}
          side={THREE.DoubleSide}
          flatShading={false}
          shininess={10}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {style.wireframe && (
        <mesh geometry={geo} frustumCulled>
          <meshBasicMaterial
            wireframe
            color={isDark ? EDGE_COLOR_DARK : EDGE_COLOR_LIGHT}
            transparent
            opacity={0.15}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

function AutoFit({ flatDomains, visible, uploads }: { flatDomains: FlatDomainSolid[]; visible: Set<string>; uploads: Map<SurfaceRole, UploadedSurface> }) {
  const { camera } = useThree();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) return;
    const box = new THREE.Box3();
    for (const d of flatDomains) {
      for (let i = 0; i < d.vertexCount; i++) {
        box.expandByPoint(new THREE.Vector3(d.positions[i * 3], d.positions[i * 3 + 1], d.positions[i * 3 + 2]));
      }
    }
    for (const [, upload] of uploads) {
      for (let i = 0; i < upload.vertexCount; i++) {
        box.expandByPoint(new THREE.Vector3(upload.positions[i * 3], upload.positions[i * 3 + 1], upload.positions[i * 3 + 2]));
      }
    }
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.8;

    camera.position.set(center.x + dist * 0.6, center.y - dist * 0.6, center.z + dist * 0.5);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    fitted.current = true;
  }, [flatDomains, visible, uploads, camera]);

  return null;
}

interface ViewPresetControllerProps {
  preset: ViewPreset | null;
  flatDomains: FlatDomainSolid[];
  uploads: Map<SurfaceRole, UploadedSurface>;
  onDone: () => void;
}

function ViewPresetController({ preset, flatDomains, uploads, onDone }: ViewPresetControllerProps) {
  const { camera } = useThree();

  useEffect(() => {
    if (!preset) return;

    const box = new THREE.Box3();
    for (const d of flatDomains) {
      for (let i = 0; i < d.vertexCount; i++) {
        box.expandByPoint(new THREE.Vector3(d.positions[i * 3], d.positions[i * 3 + 1], d.positions[i * 3 + 2]));
      }
    }
    for (const [, upload] of uploads) {
      for (let i = 0; i < upload.vertexCount; i++) {
        box.expandByPoint(new THREE.Vector3(upload.positions[i * 3], upload.positions[i * 3 + 1], upload.positions[i * 3 + 2]));
      }
    }
    if (box.isEmpty()) { onDone(); return; }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 2.0;

    switch (preset) {
      case 'plan':
        camera.position.set(center.x, center.y, center.z + dist);
        break;
      case 'north':
        camera.position.set(center.x, center.y - dist, center.z);
        break;
      case 'east':
        camera.position.set(center.x + dist, center.y, center.z);
        break;
      case 'isometric':
        camera.position.set(center.x + dist * 0.6, center.y - dist * 0.6, center.z + dist * 0.5);
        break;
      case 'fit': {
        const cam = camera as THREE.PerspectiveCamera;
        const fov = cam.fov * (Math.PI / 180);
        const aspect = cam.aspect;
        const fitDist = Math.max(
          maxDim / (2 * Math.tan(fov / 2)),
          maxDim / (2 * Math.tan(fov * aspect / 2)),
        ) * 1.2;
        camera.position.set(
          center.x + fitDist * 0.5,
          center.y - fitDist * 0.5,
          center.z + fitDist * 0.4,
        );
        break;
      }
    }

    camera.lookAt(center);
    camera.updateProjectionMatrix();

    const controls = (camera as any).__controls;
    if (controls?.target) {
      controls.target.copy(center);
      controls.update();
    }

    onDone();
  }, [preset, flatDomains, uploads, camera, onDone]);

  return null;
}

function computeMeasureMetrics(p1: THREE.Vector3, p2: THREE.Vector3) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.z - p1.z;
  const dist3d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const planLen = Math.sqrt(dx * dx + dy * dy);
  const bearingRad = Math.atan2(dx, dy);
  let bearingDeg = bearingRad * (180 / Math.PI);
  if (bearingDeg < 0) bearingDeg += 360;
  const grade = planLen > 0.001 ? (dz / planLen) * 100 : 0;
  return { dist3d, planLen, dz, bearingDeg, grade };
}

function MeasureCursorTracker({ active, onMove }: {
  active: boolean;
  onMove: (pos: { world: THREE.Vector3; screenX: number; screenY: number } | null) => void;
}) {
  const { scene, camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useEffect(() => {
    if (!active) { onMove(null); return; }
    const canvas = gl.domElement;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const meshes: THREE.Mesh[] = [];
      scene.traverse((obj) => { if (obj instanceof THREE.Mesh && obj.visible) meshes.push(obj); });
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        onMove({ world: hits[0].point.clone(), screenX: e.clientX, screenY: e.clientY });
      } else {
        onMove(null);
      }
    };
    canvas.addEventListener('mousemove', handleMouseMove);
    return () => canvas.removeEventListener('mousemove', handleMouseMove);
  }, [active, scene, camera, gl, raycaster, onMove]);

  return null;
}

function MeasureClickHandler({ active, onMeasureClick }: {
  active: boolean;
  onMeasureClick: (point: MeasurePoint) => void;
}) {
  const { scene, camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useEffect(() => {
    if (!active) return;
    const canvas = gl.domElement;
    const prevCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const meshes: THREE.Mesh[] = [];
      scene.traverse((obj) => { if (obj instanceof THREE.Mesh && obj.visible) meshes.push(obj); });
      raycaster.firstHitOnly = true;
      const hits = raycaster.intersectObjects(meshes, false);
      raycaster.firstHitOnly = false;
      if (hits.length > 0) {
        onMeasureClick({
          position: hits[0].point.clone(),
          screenX: e.clientX,
          screenY: e.clientY,
        });
      }
    };

    canvas.addEventListener('click', onClick);
    return () => {
      canvas.style.cursor = prevCursor;
      canvas.removeEventListener('click', onClick);
    };
  }, [active, scene, camera, gl, raycaster, onMeasureClick]);

  return null;
}

function MeasureOverlay3D({
  points,
  tool,
  savedMeasurements,
  sphereRadius,
  liveCursorPos,
}: {
  points: MeasurePoint[];
  tool: MeasureTool;
  savedMeasurements: SavedMeasurement[];
  sphereRadius: number;
  liveCursorPos?: THREE.Vector3 | null;
}) {
  const markerR = sphereRadius * 0.5;

  return (
    <>
      {savedMeasurements.map((m) => (
        <group key={m.id}>
          <Line
            points={[[m.p1.x, m.p1.y, m.p1.z], [m.p2.x, m.p2.y, m.p2.z]]}
            color="#22d3ee"
            lineWidth={2}
          />
          <mesh position={m.p1}>
            <sphereGeometry args={[markerR, 12, 12]} />
            <meshBasicMaterial color="#22d3ee" />
          </mesh>
          <mesh position={m.p2}>
            <sphereGeometry args={[markerR, 12, 12]} />
            <meshBasicMaterial color="#22d3ee" />
          </mesh>
        </group>
      ))}

      {tool === 'distance' && points.length === 1 && liveCursorPos && (
        <group>
          <Line
            points={[
              [points[0].position.x, points[0].position.y, points[0].position.z],
              [liveCursorPos.x, liveCursorPos.y, liveCursorPos.z],
            ]}
            color="#22d3ee"
            lineWidth={1.5}
            dashed
            dashSize={sphereRadius * 2}
            gapSize={sphereRadius}
          />
          <mesh position={points[0].position}>
            <sphereGeometry args={[markerR, 12, 12]} />
            <meshBasicMaterial color="#22d3ee" />
          </mesh>
        </group>
      )}

      {tool !== 'none' && points.length > 0 && (() => {
        const linePoints: [number, number, number][] = points.map(p => [p.position.x, p.position.y, p.position.z]);
        if (tool === 'area' && points.length > 2) {
          linePoints.push([points[0].position.x, points[0].position.y, points[0].position.z]);
        }
        return (
          <>
            {linePoints.length >= 2 && (
              <Line points={linePoints} color="#22d3ee" lineWidth={2} />
            )}
            {points.map((p, i) => (
              <mesh key={i} position={p.position}>
                <sphereGeometry args={[markerR, 12, 12]} />
                <meshBasicMaterial color="#22d3ee" />
              </mesh>
            ))}
          </>
        );
      })()}
    </>
  );
}

interface DrawingLayerProps {
  points: [number, number][];
  isDrawing: boolean;
  onAddPoint: (x: number, y: number) => void;
  onFinish: () => void;
  displayZ: number;
  sphereRadius: number;
}

function DrawingLayer({ points, isDrawing, onAddPoint, onFinish, displayZ, sphereRadius }: DrawingLayerProps) {
  const lastClickRef = useRef(0);

  const handleClick = useCallback(
    (e: any) => {
      if (!isDrawing) return;
      e.stopPropagation();
      const now = Date.now();
      if (now - lastClickRef.current < 350 && points.length >= 3) {
        lastClickRef.current = 0;
        onFinish();
        return;
      }
      lastClickRef.current = now;
      if (e.point) {
        onAddPoint(e.point.x, e.point.y);
      }
    },
    [isDrawing, onAddPoint, onFinish, points.length],
  );

  if (!isDrawing && points.length === 0) return null;

  const z = displayZ + sphereRadius;
  const linePoints: [number, number, number][] = points.map(([x, y]) => [x, y, z]);
  if (points.length > 1) {
    linePoints.push([points[0][0], points[0][1], z]);
  }

  return (
    <>
      {isDrawing && (
        <mesh visible={false} onClick={handleClick} position={[0, 0, displayZ]}>
          <planeGeometry args={[100000, 100000]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}
      {linePoints.length >= 2 && (
        <Line points={linePoints} color="#f97316" lineWidth={2} />
      )}
      {points.map(([x, y], i) => (
        <mesh key={i} position={[x, y, z]}>
          <sphereGeometry args={[sphereRadius * 0.6, 12, 12]} />
          <meshBasicMaterial color="#f97316" />
        </mesh>
      ))}
    </>
  );
}

interface SectionLineOverlayProps {
  sectionLine: [[number, number], [number, number]] | null;
  onChange: (line: [[number, number], [number, number]]) => void;
  isDrawing: boolean;
  onDrawComplete: () => void;
  onDragChange: (dragging: boolean) => void;
  displayZ: number;
  sphereRadius: number;
}

function SectionLineOverlay({
  sectionLine, onChange, isDrawing, onDrawComplete, onDragChange, displayZ, sphereRadius,
}: SectionLineOverlayProps) {
  const [tempStart, setTempStart] = useState<[number, number] | null>(null);
  const draggingRef = useRef<number | null>(null);
  const sectionLineRef = useRef(sectionLine);
  sectionLineRef.current = sectionLine;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDragChangeRef = useRef(onDragChange);
  onDragChangeRef.current = onDragChange;
  const onDrawCompleteRef = useRef(onDrawComplete);
  onDrawCompleteRef.current = onDrawComplete;
  const tempStartRef = useRef(tempStart);
  tempStartRef.current = tempStart;
  const { camera, gl, raycaster, scene } = useThree();
  const myRaycaster = useMemo(() => new THREE.Raycaster(), []);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), -displayZ), [displayZ]);

  useEffect(() => {
    if (!isDrawing) setTempStart(null);
  }, [isDrawing]);

  // Direct DOM click handler — bypasses R3F event propagation so surface
  // meshes with stopPropagation() cannot block section point selection.
  useEffect(() => {
    if (!isDrawing) return;
    const canvas = gl.domElement;
    const prevCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);

      // Try hitting any visible mesh first (surfaces, domains)
      const meshes: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && obj.visible) meshes.push(obj as THREE.Mesh);
      });
      raycaster.firstHitOnly = true;
      const intersects = raycaster.intersectObjects(meshes, false);
      raycaster.firstHitOnly = false;

      let hitXY: [number, number] | null = null;
      if (intersects.length > 0) {
        const p = intersects[0].point;
        hitXY = [p.x, p.y];
      } else {
        // Fallback: intersect the ground plane at displayZ
        const pt = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(groundPlane, pt);
        if (hit) hitXY = [pt.x, pt.y];
      }

      if (!hitXY) return;

      if (!tempStartRef.current) {
        setTempStart(hitXY);
      } else {
        onChangeRef.current([tempStartRef.current, hitXY]);
        setTempStart(null);
        onDrawCompleteRef.current();
      }
    };

    canvas.addEventListener('click', onClick);
    return () => {
      canvas.style.cursor = prevCursor;
      canvas.removeEventListener('click', onClick);
    };
  }, [isDrawing, gl, camera, raycaster, scene, groundPlane]);

  // Endpoint drag handlers
  useEffect(() => {
    const canvas = gl.domElement;
    const getXY = (e: PointerEvent): [number, number] | null => {
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      myRaycaster.setFromCamera(mouse, camera);
      const pt = new THREE.Vector3();
      const hit = myRaycaster.ray.intersectPlane(groundPlane, pt);
      return hit ? [pt.x, pt.y] : null;
    };
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current === null || !sectionLineRef.current) return;
      const xy = getXY(e);
      if (!xy) return;
      const newLine = [[...sectionLineRef.current[0]], [...sectionLineRef.current[1]]] as [[number, number], [number, number]];
      newLine[draggingRef.current] = xy;
      onChangeRef.current(newLine);
    };
    const onUp = () => {
      if (draggingRef.current !== null) {
        draggingRef.current = null;
        onDragChangeRef.current(false);
      }
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, myRaycaster, groundPlane]);

  return (
    <>
      {sectionLine && (
        <>
          <Line
            points={[
              [sectionLine[0][0], sectionLine[0][1], displayZ],
              [sectionLine[1][0], sectionLine[1][1], displayZ],
            ]}
            color="#f59e0b"
            lineWidth={2.5}
          />
          {sectionLine.map((pt, i) => (
            <mesh
              key={i}
              position={[pt[0], pt[1], displayZ]}
              onPointerDown={(e) => {
                e.stopPropagation();
                draggingRef.current = i;
                onDragChange(true);
              }}
            >
              <sphereGeometry args={[sphereRadius, 16, 16]} />
              <meshBasicMaterial color="#f59e0b" />
            </mesh>
          ))}
        </>
      )}
      {tempStart && (
        <mesh position={[tempStart[0], tempStart[1], displayZ]}>
          <sphereGeometry args={[sphereRadius * 0.8, 16, 16]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      )}
    </>
  );
}

function BoundaryLines({ boundaries, displayZ }: { boundaries: BoundaryRegion[]; displayZ: number }) {
  const colors = ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];
  return (
    <>
      {boundaries.map((b, i) => {
        const pts: [number, number, number][] = [
          ...b.polygon.map(([x, y]) => [x, y, displayZ] as [number, number, number]),
          [b.polygon[0][0], b.polygon[0][1], displayZ],
        ];
        return <Line key={i} points={pts} color={colors[i % colors.length]} lineWidth={1.5} />;
      })}
    </>
  );
}

function ControlsBinder({ controlsRef }: { controlsRef: React.MutableRefObject<any> }) {
  const { camera } = useThree();
  useEffect(() => {
    (camera as any).__controls = controlsRef.current;
  }, [camera, controlsRef]);
  return null;
}

function ZUpEnforcer() {
  const { camera } = useThree();
  useFrame(() => {
    const up = camera.up;
    if (Math.abs(up.x) > 1e-6 || Math.abs(up.y) > 1e-6 || Math.abs(up.z - 1) > 1e-6) {
      camera.up.set(0, 0, 1);
    }
  });
  return null;
}

function SetPivotMode({
  controlsRef,
  active,
  onDone,
}: {
  controlsRef: React.MutableRefObject<any>;
  active: boolean;
  onDone: () => void;
}) {
  const { camera, gl, raycaster, scene } = useThree();

  useEffect(() => {
    if (!active) return;
    const canvas = gl.domElement;
    const prevCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      const meshes: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && obj.visible) meshes.push(obj as THREE.Mesh);
      });
      raycaster.firstHitOnly = true;
      const intersects = raycaster.intersectObjects(meshes, false);
      raycaster.firstHitOnly = false;
      if (intersects.length > 0 && controlsRef.current) {
        controlsRef.current.target.copy(intersects[0].point);
        controlsRef.current.update();
      }
      onDone();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };

    canvas.addEventListener('click', onClick, { once: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      canvas.style.cursor = prevCursor;
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [active, camera, gl, raycaster, scene, controlsRef, onDone]);

  return null;
}

function KeyboardShortcuts({
  controlsRef,
  flatDomains,
  uploads,
  onTogglePivot,
}: {
  controlsRef: React.MutableRefObject<any>;
  flatDomains: FlatDomainSolid[];
  uploads: Map<SurfaceRole, UploadedSurface>;
  onTogglePivot: () => void;
}) {
  const { camera } = useThree();

  useEffect(() => {
    const fitAll = () => {
      const box = new THREE.Box3();
      for (const d of flatDomains) {
        for (let i = 0; i < d.vertexCount; i++) {
          box.expandByPoint(new THREE.Vector3(d.positions[i * 3], d.positions[i * 3 + 1], d.positions[i * 3 + 2]));
        }
      }
      for (const [, upload] of uploads) {
        for (let i = 0; i < upload.vertexCount; i++) {
          box.expandByPoint(new THREE.Vector3(upload.positions[i * 3], upload.positions[i * 3 + 1], upload.positions[i * 3 + 2]));
        }
      }
      if (box.isEmpty()) return;

      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const cam = camera as THREE.PerspectiveCamera;
      const fov = cam.fov * (Math.PI / 180);
      const aspect = cam.aspect;
      const fitDist = Math.max(
        maxDim / (2 * Math.tan(fov / 2)),
        maxDim / (2 * Math.tan(fov * aspect / 2)),
      ) * 1.2;

      camera.position.set(
        center.x + fitDist * 0.5,
        center.y - fitDist * 0.5,
        center.z + fitDist * 0.4,
      );
      camera.lookAt(center);
      camera.updateProjectionMatrix();

      if (controlsRef.current?.target) {
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'z' && !e.ctrlKey && !e.metaKey) {
        onTogglePivot();
        return;
      }

      if ((e.key === 'f' || e.key === 'r') && !e.ctrlKey && !e.metaKey) {
        fitAll();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [camera, controlsRef, flatDomains, uploads, onTogglePivot]);

  return null;
}

function MeasureLabelsProjector({
  savedMeasurements,
  onUpdate,
}: {
  savedMeasurements: SavedMeasurement[];
  onUpdate: (labels: { id: number; x: number; y: number; text: string; dz: string }[]) => void;
}) {
  const { camera, gl } = useThree();
  const prevJson = useRef('');

  useFrame(() => {
    if (savedMeasurements.length === 0) {
      if (prevJson.current !== '[]') {
        prevJson.current = '[]';
        onUpdate([]);
      }
      return;
    }
    const rect = gl.domElement.getBoundingClientRect();
    const labels = savedMeasurements.map((m) => {
      const mid = new THREE.Vector3().addVectors(m.p1, m.p2).multiplyScalar(0.5);
      mid.project(camera);
      return {
        id: m.id,
        x: (mid.x * 0.5 + 0.5) * rect.width,
        y: (-mid.y * 0.5 + 0.5) * rect.height,
        text: `${m.distance.toFixed(2)} m`,
        dz: `ΔZ: ${(m.p2.z - m.p1.z) >= 0 ? '+' : ''}${(m.p2.z - m.p1.z).toFixed(2)} m · Plan: ${Math.sqrt((m.p2.x-m.p1.x)**2+(m.p2.y-m.p1.y)**2).toFixed(2)} m`,
      };
    });
    const json = JSON.stringify(labels.map(l => [l.x | 0, l.y | 0]));
    if (json !== prevJson.current) {
      prevJson.current = json;
      onUpdate(labels);
    }
  });

  return null;
}

function CursorElevation({
  onUpdate,
}: {
  onUpdate: (info: { x: number; y: number; z: number } | null) => void;
}) {
  const { camera, gl, raycaster, scene } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    let lastTime = 0;
    const onMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastTime < 33) return;
      lastTime = now;
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      const meshes: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && obj.visible) meshes.push(obj as THREE.Mesh);
      });
      raycaster.firstHitOnly = true;
      const intersects = raycaster.intersectObjects(meshes, false);
      raycaster.firstHitOnly = false;
      if (intersects.length > 0) {
        const p = intersects[0].point;
        onUpdate({ x: p.x, y: p.y, z: p.z });
      } else {
        onUpdate(null);
      }
    };
    canvas.addEventListener('mousemove', onMove);
    return () => canvas.removeEventListener('mousemove', onMove);
  }, [camera, gl, raycaster, scene, onUpdate]);

  return null;
}

export interface ViewerHandle {
  applyPreset: (preset: ViewPreset) => void;
}

export interface ViewerProps {
  flatDomains: FlatDomainSolid[];
  visible: Set<string>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  boundaries: BoundaryRegion[];
  isDrawing: boolean;
  drawPoints: [number, number][];
  onAddDrawPoint: (x: number, y: number) => void;
  onFinishDrawing: () => void;
  uploads: Map<SurfaceRole, UploadedSurface>;
  surfaceVisible: Set<SurfaceRole>;
  isDrawingSection: boolean;
  sectionLine: [[number, number], [number, number]] | null;
  onSectionLineChange: (line: [[number, number], [number, number]]) => void;
  onSectionDrawComplete: () => void;
  background: ViewerBackground;
  domainStyles: Map<string, ObjectStyle>;
  surfaceStyles: Map<SurfaceRole, ObjectStyle>;
  selectedId: string | null;
  onSelect: (id: string | null, info: SelectionInfo | null) => void;
  measureTool: MeasureTool;
  measurePoints: MeasurePoint[];
  onAddMeasurePoint: (point: MeasurePoint) => void;
  savedMeasurements: SavedMeasurement[];
  showPerf: boolean;
  domainMaps: Map<SurfaceRole, Uint8Array>;
  thicknessMaps: Map<SurfaceRole, Float32Array>;
  thicknessMode: ThicknessMode | null;
}

const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer({
  flatDomains, visible, canvasRef, boundaries, isDrawing, drawPoints, onAddDrawPoint, onFinishDrawing,
  uploads, surfaceVisible, isDrawingSection, sectionLine, onSectionLineChange,
  onSectionDrawComplete, background, domainStyles, surfaceStyles, selectedId,
  onSelect, measureTool, measurePoints, onAddMeasurePoint, savedMeasurements, showPerf,
  domainMaps, thicknessMaps, thicknessMode,
}, ref) {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [isDraggingEndpoint, setIsDraggingEndpoint] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cursorElev, setCursorElev] = useState<{ x: number; y: number; z: number } | null>(null);
  const [liveMeasurePos, setLiveMeasurePos] = useState<{ world: THREE.Vector3; screenX: number; screenY: number } | null>(null);
  const [viewPreset, setViewPreset] = useState<ViewPreset | null>(null);
  const [measureLabels, setMeasureLabels] = useState<{ id: number; x: number; y: number; text: string; dz: string }[]>([]);
  const [pivotMode, setPivotMode] = useState(false);
  const controlsRef = useRef<any>(null);

  const togglePivot = useCallback(() => setPivotMode((v) => !v), []);
  const exitPivot = useCallback(() => setPivotMode(false), []);

  useImperativeHandle(ref, () => ({
    applyPreset: (preset: ViewPreset) => setViewPreset(preset),
  }), []);

  const domainGroups = useMemo(() => {
    const groups = new Map<string, FlatDomainSolid[]>();
    for (const d of flatDomains) {
      if (!groups.has(d.domain)) groups.set(d.domain, []);
      groups.get(d.domain)!.push(d);
    }
    return groups;
  }, [flatDomains]);

  const { displayZ, sphereRadius } = useMemo(() => {
    const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const d of flatDomains) {
      for (let i = 0; i < d.vertexCount; i++) {
        const x = d.positions[i * 3], y = d.positions[i * 3 + 1], z = d.positions[i * 3 + 2];
        if (x < box.minX) box.minX = x;
        if (x > box.maxX) box.maxX = x;
        if (y < box.minY) box.minY = y;
        if (y > box.maxY) box.maxY = y;
        if (z < box.minZ) box.minZ = z;
        if (z > box.maxZ) box.maxZ = z;
      }
    }
    if (!isFinite(box.minX)) return { displayZ: 0, sphereRadius: 1 };
    const maxDim = Math.max(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ);
    return { displayZ: (box.minZ + box.maxZ) / 2, sphereRadius: maxDim * 0.008 };
  }, [flatDomains]);

  const handleCreated = useCallback(
    (state: { gl: THREE.WebGLRenderer }) => {
      (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = state.gl.domElement;
    },
    [canvasRef],
  );

  const handleHover = useCallback((info: TooltipInfo | null) => {
    setTooltip(info);
    if (info) {
      const hId = info.surfaceFileName
        ? `surface-${uploads.entries().next()?.value?.[0] ?? ''}`
        : `domain-${info.domain}-${info.blockName ?? ''}`;
      setHoveredId(hId);
    } else {
      setHoveredId(null);
    }
  }, [uploads]);

  const handleMeshClick = useCallback((id: string, info: SelectionInfo) => {
    if (measureTool !== 'none') return;
    onSelect(id, info);
  }, [measureTool, onSelect]);

  const handleBgClick = useCallback(() => {
    if (measureTool === 'none') {
      onSelect(null, null);
    }
  }, [measureTool, onSelect]);

  const isDark = background === 'dark';

  return (
    <div className={`relative h-full w-full ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'}`}>
      <PerformanceOverlay visible={showPerf} isDark={isDark} />

      {/* View preset buttons */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0.5 rounded-lg bg-black/40 backdrop-blur-sm px-1 py-0.5">
        {([
          { key: 'plan' as ViewPreset, label: 'Plan' },
          { key: 'north' as ViewPreset, label: 'North' },
          { key: 'east' as ViewPreset, label: 'East' },
          { key: 'isometric' as ViewPreset, label: 'Iso' },
          { key: 'fit' as ViewPreset, label: 'Fit All' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setViewPreset(key)}
            className="rounded px-2.5 py-1 text-[10px] font-medium text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            title={label}
          >
            {label}
          </button>
        ))}
      </div>

      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.NoToneMapping }}
        camera={{ fov: 50, near: 0.1, far: 100000, up: [0, 0, 1] } as CanvasProps['camera']}
        onCreated={(state) => {
          state.camera.up.set(0, 0, 1);
          state.camera.updateProjectionMatrix();
          handleCreated(state);
        }}
        onPointerMissed={handleBgClick}
      >
        <color attach="background" args={[BG_COLORS[background]]} />

        <ambientLight intensity={isDark ? 0.3 : 0.45} />
        <directionalLight position={[1, -0.8, 0.4]} intensity={isDark ? 1.0 : 1.1} />
        <directionalLight position={[-0.5, 0.6, 0.2]} intensity={isDark ? 0.3 : 0.4} />
        <directionalLight position={[0.2, 0.3, 1.0]} intensity={isDark ? 0.15 : 0.2} />
        <hemisphereLight
          args={[isDark ? '#334155' : '#d4e5f7', isDark ? '#0f172a' : '#f5f0e6', isDark ? 0.2 : 0.25]}
        />

        {[...domainGroups.entries()].map(([domain, solids]) => {
          const id = `domain-${domain}`;
          const defaultStyle: ObjectStyle = { color: solids[0].color, opacity: 0.85, wireframe: true };
          const style = domainStyles.get(domain) ?? defaultStyle;
          return (
            <BatchedDomainGroup
              key={domain}
              domain={domain}
              solids={solids}
              visible={visible.has(domain)}
              style={style}
              selected={selectedId?.startsWith(id) ?? false}
              highlighted={hoveredId?.startsWith(id) ?? false}
              isDark={isDark}
              onHover={handleHover}
              onSelect={handleMeshClick}
            />
          );
        })}

        {[...uploads.entries()].map(([role, upload]) => {
          if (!surfaceVisible.has(role)) return null;
          const id = `surface-${role}`;
          const hasDomainMap = domainMaps.has(role);
          const defaultStyle: ObjectStyle = {
            color: DEFAULT_SURFACE_COLORS[role],
            opacity: hasDomainMap ? 0.92 : 0.3,
            wireframe: true,
          };
          const style = surfaceStyles.get(role) ?? defaultStyle;
          return (
            <SurfaceMesh
              key={role}
              upload={upload}
              style={style}
              selected={selectedId === id}
              highlighted={hoveredId === id}
              isDark={isDark}
              onHover={handleHover}
              onSelect={handleMeshClick}
              domainMap={domainMaps.get(role)}
              domainVisible={visible}
              thicknessMap={thicknessMaps.get(role)}
              thicknessMode={thicknessMode}
            />
          );
        })}

        <SectionLineOverlay
          sectionLine={sectionLine}
          onChange={onSectionLineChange}
          isDrawing={isDrawingSection}
          onDrawComplete={onSectionDrawComplete}
          onDragChange={setIsDraggingEndpoint}
          displayZ={displayZ}
          sphereRadius={sphereRadius}
        />

        <BoundaryLines boundaries={boundaries} displayZ={displayZ} />
        <DrawingLayer points={drawPoints} isDrawing={isDrawing} onAddPoint={onAddDrawPoint} onFinish={onFinishDrawing} displayZ={displayZ} sphereRadius={sphereRadius} />

        <MeasureOverlay3D points={measurePoints} tool={measureTool} savedMeasurements={savedMeasurements} sphereRadius={sphereRadius} liveCursorPos={liveMeasurePos?.world} />
        <MeasureCursorTracker active={measureTool === 'distance' && measurePoints.length === 1} onMove={setLiveMeasurePos} />
        <MeasureClickHandler active={measureTool !== 'none'} onMeasureClick={onAddMeasurePoint} />

        <AutoFit flatDomains={flatDomains} visible={visible} uploads={uploads} />
        <ViewPresetController
          preset={viewPreset}
          flatDomains={flatDomains}
          uploads={uploads}
          onDone={() => setViewPreset(null)}
        />
        <CursorElevation onUpdate={setCursorElev} />
        <MeasureLabelsProjector savedMeasurements={savedMeasurements} onUpdate={setMeasureLabels} />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.1}
          enabled={!isDrawing && !isDrawingSection && !isDraggingEndpoint && measureTool === 'none' && !pivotMode}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          }}
          enableZoom
          zoomSpeed={1.2}
          zoomToCursor
          maxPolarAngle={Math.PI * 0.47}
          minPolarAngle={0.05}
          rotateSpeed={0.8}
          panSpeed={0.8}
        />
        <ControlsBinder controlsRef={controlsRef} />
        <ZUpEnforcer />
        <SetPivotMode controlsRef={controlsRef} active={pivotMode} onDone={exitPivot} />
        <KeyboardShortcuts controlsRef={controlsRef} flatDomains={flatDomains} uploads={uploads} onTogglePivot={togglePivot} />
      </Canvas>

      {/* Thickness Legend */}
      {thicknessMode && (
        <ThicknessLegend
          domainLabel={
            DOMAIN_INDEX_MAP[DOMAIN_NAME_TO_INDEX[thicknessMode.domain] ?? 0]?.label ?? thicknessMode.domain
          }
          scaleMin={thicknessMode.scaleMin}
          scaleMax={thicknessMode.scaleMax}
          isDark={isDark}
        />
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded bg-black/85 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          {tooltip.surfaceFileName ? (
            <>
              <div className="font-medium">
                {tooltip.surfaceFileName} &mdash; {tooltip.surfaceRoleLabel}
              </div>
              {tooltip.thickness !== undefined && tooltip.thickness > 0 && (
                <div className="text-cyan-300">Thickness: {tooltip.thickness.toFixed(1)}m</div>
              )}
            </>
          ) : (
            <>
              <div className="font-semibold">{tooltip.domain}</div>
              <div className="text-slate-300">{tooltip.volume.toFixed(1)} m³</div>
              {tooltip.blockName && <div className="text-slate-400">{tooltip.blockName}</div>}
            </>
          )}
        </div>
      )}

      {/* Saved measurement labels */}
      {measureLabels.map((l) => (
        <div
          key={l.id}
          className="pointer-events-none absolute z-40 rounded bg-cyan-900/90 px-2 py-1 text-[10px] font-mono text-cyan-100 shadow -translate-x-1/2 -translate-y-full"
          style={{ left: l.x, top: l.y - 8 }}
        >
          {l.text} | {l.dz}
        </div>
      ))}

      {/* Elevation readout */}
      {cursorElev && (
        <div className={`absolute bottom-2 left-2 rounded px-2 py-1 text-[11px] font-mono ${isDark ? 'bg-black/70 text-slate-300' : 'bg-white/90 text-slate-600'} shadow`}>
          RL: {cursorElev.z.toFixed(2)}m
        </div>
      )}

      {/* Measure result overlay */}
      {measureTool === 'area' && measurePoints.length >= 3 && (() => {
        let area = 0;
        const pts = measurePoints.map(p => p.position);
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
        }
        area = Math.abs(area) / 2;
        return (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded bg-cyan-900/90 px-3 py-1.5 text-xs font-medium text-cyan-100 shadow">
            Area: {area.toFixed(1)} m²
          </div>
        );
      })()}

      {/* Drawing mode indicators */}
      {isDrawing && (
        <div className="absolute left-3 top-3 rounded bg-orange-500/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          Click to place points · Double-click or press Enter to close
        </div>
      )}
      {pivotMode && (
        <div className="absolute left-3 top-3 rounded bg-violet-600/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          Click a surface to set orbit pivot · Escape to cancel
        </div>
      )}
      {isDrawingSection && (
        <div className="absolute left-3 top-3 rounded bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          Click two points to define section line
        </div>
      )}
      {measureTool !== 'none' && (
        <div className="absolute left-3 top-3 rounded bg-cyan-600/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          {measureTool === 'distance' && measurePoints.length === 0 && 'Click first point to measure distance'}
          {measureTool === 'distance' && measurePoints.length === 1 && !liveMeasurePos && 'Move cursor over surface...'}
          {measureTool === 'elevation' && 'Hover over surfaces to read elevation'}
          {measureTool === 'area' && `Click points to define area · ${measurePoints.length} placed · Press Enter to close`}
        </div>
      )}
      {measureTool === 'distance' && measurePoints.length === 1 && liveMeasurePos && (() => {
        const m = computeMeasureMetrics(measurePoints[0].position, liveMeasurePos.world);
        return (
          <div
            className="pointer-events-none absolute z-50 rounded bg-slate-900/95 px-3 py-2 text-[11px] text-white shadow-lg border border-cyan-500/40"
            style={{ left: liveMeasurePos.screenX + 16, top: liveMeasurePos.screenY - 80 }}
          >
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <span className="text-cyan-300">Distance:</span><span className="font-mono">{m.dist3d.toFixed(2)} m</span>
              <span className="text-cyan-300">Plan:</span><span className="font-mono">{m.planLen.toFixed(2)} m</span>
              <span className="text-cyan-300">dZ:</span><span className="font-mono">{m.dz >= 0 ? '+' : ''}{m.dz.toFixed(2)} m</span>
              <span className="text-cyan-300">Bearing:</span><span className="font-mono">{m.bearingDeg.toFixed(1)}°</span>
              <span className="text-cyan-300">Grade:</span><span className="font-mono">{m.grade >= 0 ? '+' : ''}{m.grade.toFixed(1)}%</span>
            </div>
            <div className="mt-1 text-[9px] text-slate-400 font-mono">
              E {liveMeasurePos.world.x.toFixed(1)} N {liveMeasurePos.world.y.toFixed(1)} RL {liveMeasurePos.world.z.toFixed(1)}
            </div>
            <div className="mt-0.5 text-[9px] text-cyan-400">Click to lock measurement</div>
          </div>
        );
      })()}
    </div>
  );
});

export default Viewer;
