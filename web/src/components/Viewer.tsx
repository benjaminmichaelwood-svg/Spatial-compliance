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

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const EDGES_TRI_THRESHOLD = 100_000;

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

const BG_COLORS: Record<ViewerBackground, string> = {
  dark: '#1a1a1a',
  light: '#ffffff',
};

const EDGE_COLOR_DARK = 0x444444;
const EDGE_COLOR_LIGHT = 0x999999;

interface SurfaceMeshProps {
  upload: UploadedSurface;
  style: ObjectStyle;
  selected: boolean;
  highlighted: boolean;
  isDark: boolean;
  onHover: (info: TooltipInfo | null) => void;
  onSelect: (id: string, info: SelectionInfo) => void;
}

function SurfaceMesh({ upload, style, selected, highlighted, onHover, onSelect, isDark }: SurfaceMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const edgesRef = useRef<THREE.LineSegments>(null);
  const matRef = useRef<THREE.MeshPhongMaterial>(null);

  const { geometry, triCount } = useMemo(() => {
    const verts = upload.surface.vertices;
    const idxs = upload.surface.indices;
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    (geo as any).boundsTree = new MeshBVH(geo);
    return { geometry: geo, triCount: idxs.length };
  }, [upload.surface]);

  const edgesGeo = useMemo(() => {
    if (triCount >= EDGES_TRI_THRESHOLD) return null;
    return new THREE.EdgesGeometry(geometry, 30);
  }, [geometry, triCount]);

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

  const roleLabel = SURFACE_ROLES.find((r) => r.key === upload.role)?.label ?? upload.role;
  const id = `surface-${upload.role}`;

  const surfaceMeta = useMemo(() => {
    const verts = upload.surface.vertices;
    const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const v of verts) {
      if (v.x < box.minX) box.minX = v.x; if (v.x > box.maxX) box.maxX = v.x;
      if (v.y < box.minY) box.minY = v.y; if (v.y > box.maxY) box.maxY = v.y;
      if (v.z < box.minZ) box.minZ = v.z; if (v.z > box.maxZ) box.maxZ = v.z;
    }
    return { vertexCount: verts.length, triangleCount: upload.surface.indices.length, bbox: box };
  }, [upload.surface]);

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={geometry}
        frustumCulled
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover({
            x: e.clientX, y: e.clientY, domain: roleLabel, volume: 0,
            surfaceFileName: upload.fileName, surfaceRoleLabel: roleLabel,
          });
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          onHover({
            x: e.clientX, y: e.clientY, domain: roleLabel, volume: 0,
            surfaceFileName: upload.fileName, surfaceRoleLabel: roleLabel,
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
          color={style.color}
          opacity={style.opacity}
          transparent={style.opacity < 1}
          side={THREE.DoubleSide}
          flatShading={false}
          shininess={10}
        />
      </mesh>
      {edgesGeo && (
        <lineSegments ref={edgesRef} geometry={edgesGeo} frustumCulled>
          <lineBasicMaterial color={isDark ? EDGE_COLOR_DARK : EDGE_COLOR_LIGHT} transparent opacity={0.3} />
        </lineSegments>
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
  const edgesRef = useRef<THREE.LineSegments>(null);
  const matRef = useRef<THREE.MeshPhongMaterial>(null);

  const { geo, triRanges, totalTris } = useMemo(() => {
    const result = buildBatchedGeometry(solids);
    return { geo: result.geometry, triRanges: result.triRanges, totalTris: result.totalTris };
  }, [solids]);

  const edgesGeo = useMemo(() => {
    if (totalTris >= EDGES_TRI_THRESHOLD) return null;
    return new THREE.EdgesGeometry(geo, 30);
  }, [geo, totalTris]);

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
        />
      </mesh>
      {edgesGeo && (
        <lineSegments ref={edgesRef} geometry={edgesGeo} frustumCulled>
          <lineBasicMaterial color={isDark ? EDGE_COLOR_DARK : EDGE_COLOR_LIGHT} transparent opacity={0.3} />
        </lineSegments>
      )}
    </group>
  );
}

function AutoFit({ flatDomains, visible }: { flatDomains: FlatDomainSolid[]; visible: Set<string> }) {
  const { camera } = useThree();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) return;
    const box = new THREE.Box3();
    for (const d of flatDomains) {
      if (!visible.has(d.domain)) continue;
      for (let i = 0; i < d.vertexCount; i++) {
        box.expandByPoint(new THREE.Vector3(d.positions[i * 3], d.positions[i * 3 + 1], d.positions[i * 3 + 2]));
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
  }, [flatDomains, visible, camera]);

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
      for (const v of upload.surface.vertices) {
        box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
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

function MeasureOverlay3D({
  points,
  tool,
  savedMeasurements,
  sphereRadius,
}: {
  points: MeasurePoint[];
  tool: MeasureTool;
  savedMeasurements: SavedMeasurement[];
  sphereRadius: number;
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
  const { camera, gl } = useThree();
  const myRaycaster = useMemo(() => new THREE.Raycaster(), []);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), -displayZ), [displayZ]);

  useEffect(() => {
    if (!isDrawing) setTempStart(null);
  }, [isDrawing]);

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

  const handlePlaneClick = useCallback(
    (e: any) => {
      if (!isDrawing) return;
      e.stopPropagation();
      const p = e.point;
      if (!p) return;
      if (!tempStart) {
        setTempStart([p.x, p.y]);
      } else {
        onChange([tempStart, [p.x, p.y]]);
        setTempStart(null);
        onDrawComplete();
      }
    },
    [isDrawing, tempStart, onChange, onDrawComplete],
  );

  return (
    <>
      {isDrawing && (
        <mesh visible={false} onClick={handlePlaneClick} position={[0, 0, displayZ]}>
          <planeGeometry args={[100000, 100000]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}
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

function ClickToPivot({ controlsRef, disabled }: { controlsRef: React.MutableRefObject<any>; disabled?: boolean }) {
  const { camera, gl, raycaster, scene } = useThree();
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    const canvas = gl.domElement;
    let lastDblClick = 0;
    const onDblClick = (e: MouseEvent) => {
      if (disabledRef.current) return;
      const now = performance.now();
      if (now - lastDblClick < 100) return;
      lastDblClick = now;
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
    };
    canvas.addEventListener('dblclick', onDblClick);
    return () => canvas.removeEventListener('dblclick', onDblClick);
  }, [camera, gl, raycaster, scene, controlsRef]);

  return null;
}

function KeyboardShortcuts({
  controlsRef,
  flatDomains,
  uploads,
}: {
  controlsRef: React.MutableRefObject<any>;
  flatDomains: FlatDomainSolid[];
  uploads: Map<SurfaceRole, UploadedSurface>;
}) {
  const { camera } = useThree();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'z' && !e.ctrlKey && !e.metaKey) {
        camera.up.set(0, 0, 1);
        camera.updateProjectionMatrix();
        if (controlsRef.current) controlsRef.current.update();
        return;
      }

      if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
        const box = new THREE.Box3();
        for (const d of flatDomains) {
          for (let i = 0; i < d.vertexCount; i++) {
            box.expandByPoint(new THREE.Vector3(d.positions[i * 3], d.positions[i * 3 + 1], d.positions[i * 3 + 2]));
          }
        }
        for (const [, upload] of uploads) {
          for (const v of upload.surface.vertices) {
            box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [camera, controlsRef, flatDomains, uploads]);

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
        dz: `${String.fromCharCode(0x0394)}Z: ${Math.abs(m.p2.z - m.p1.z).toFixed(2)} m`,
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
}

const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer({
  flatDomains, visible, canvasRef, boundaries, isDrawing, drawPoints, onAddDrawPoint, onFinishDrawing,
  uploads, surfaceVisible, isDrawingSection, sectionLine, onSectionLineChange,
  onSectionDrawComplete, background, domainStyles, surfaceStyles, selectedId,
  onSelect, measureTool, measurePoints, onAddMeasurePoint, savedMeasurements, showPerf,
}, ref) {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [isDraggingEndpoint, setIsDraggingEndpoint] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cursorElev, setCursorElev] = useState<{ x: number; y: number; z: number } | null>(null);
  const [viewPreset, setViewPreset] = useState<ViewPreset | null>(null);
  const [measureLabels, setMeasureLabels] = useState<{ id: number; x: number; y: number; text: string; dz: string }[]>([]);
  const controlsRef = useRef<any>(null);

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

  const handleCanvasClick = useCallback((e: any) => {
    if (measureTool === 'none') return;
    if (!e.point) return;
    onAddMeasurePoint({
      position: e.point.clone(),
      screenX: e.clientX ?? 0,
      screenY: e.clientY ?? 0,
    });
  }, [measureTool, onAddMeasurePoint]);

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

        <ambientLight intensity={isDark ? 0.25 : 0.4} />
        <directionalLight position={[1, -0.5, 0.8]} intensity={isDark ? 0.8 : 0.9} />
        <directionalLight position={[-0.6, 0.4, 0.3]} intensity={isDark ? 0.2 : 0.3} />
        <hemisphereLight
          args={[isDark ? '#334155' : '#d4e5f7', isDark ? '#0f172a' : '#f5f0e6', isDark ? 0.15 : 0.2]}
        />

        {[...domainGroups.entries()].map(([domain, solids]) => {
          const id = `domain-${domain}`;
          const defaultStyle: ObjectStyle = { color: solids[0].color, opacity: 0.85, wireframe: false };
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
          const defaultStyle: ObjectStyle = {
            color: DEFAULT_SURFACE_COLORS[role],
            opacity: 0.3,
            wireframe: false,
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

        <MeasureOverlay3D points={measurePoints} tool={measureTool} savedMeasurements={savedMeasurements} sphereRadius={sphereRadius} />

        {measureTool !== 'none' && (
          <mesh visible={false} onClick={handleCanvasClick} position={[0, 0, displayZ]}>
            <planeGeometry args={[100000, 100000]} />
            <meshBasicMaterial transparent opacity={0} />
          </mesh>
        )}

        <AutoFit flatDomains={flatDomains} visible={visible} />
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
          enabled={!isDrawing && !isDrawingSection && !isDraggingEndpoint && measureTool === 'none'}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          }}
          enableZoom
          zoomSpeed={1.2}
          maxPolarAngle={Math.PI}
          minPolarAngle={0}
        />
        <ControlsBinder controlsRef={controlsRef} />
        <ClickToPivot controlsRef={controlsRef} disabled={isDrawing} />
        <KeyboardShortcuts controlsRef={controlsRef} flatDomains={flatDomains} uploads={uploads} />
      </Canvas>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded bg-black/85 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          {tooltip.surfaceFileName ? (
            <div className="font-medium">
              {tooltip.surfaceFileName} &mdash; {tooltip.surfaceRoleLabel}
            </div>
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
      {isDrawingSection && (
        <div className="absolute left-3 top-3 rounded bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          Click two points to define section line
        </div>
      )}
      {measureTool !== 'none' && (
        <div className="absolute left-3 top-3 rounded bg-cyan-600/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          {measureTool === 'distance' && (measurePoints.length === 0 ? 'Click first point to measure distance' : 'Click second point to complete measurement')}
          {measureTool === 'elevation' && 'Hover over surfaces to read elevation'}
          {measureTool === 'area' && `Click points to define area · ${measurePoints.length} placed · Press Enter to close`}
        </div>
      )}
    </div>
  );
});

export default Viewer;
