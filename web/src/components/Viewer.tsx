import { useRef, useMemo, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, useThree, useFrame, type CanvasProps } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
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
import { decimateGeometry } from '../utils/decimation';
import PerformanceOverlay from './PerformanceOverlay';

interface DomainGroupProps {
  domain: string;
  solids: FlatDomainSolid[];
  visible: boolean;
  style: ObjectStyle;
  selected: boolean;
  highlighted: boolean;
  lodLevel: number;
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
}

export interface MeasurePoint {
  position: THREE.Vector3;
  screenX: number;
  screenY: number;
}

const DEFAULT_SURFACE_COLORS: Record<SurfaceRole, string> = {
  production_start: '#94a3b8',
  production_end: '#64748b',
  schedule_start: '#7dd3fc',
  schedule_end: '#38bdf8',
  schedule_future: '#a78bfa',
};

const BG_COLORS: Record<ViewerBackground, string> = {
  dark: '#1a1a2e',
  light: '#f1f5f9',
};

const WIREFRAME_TRI_LIMIT = 10_000;

interface SurfaceMeshProps {
  upload: UploadedSurface;
  style: ObjectStyle;
  selected: boolean;
  highlighted: boolean;
  onHover: (info: TooltipInfo | null) => void;
  onSelect: (id: string, info: SelectionInfo) => void;
}

function SurfaceMesh({ upload, style, selected, highlighted, onHover, onSelect }: SurfaceMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => {
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
    return geo;
  }, [upload.surface]);

  const triCount = upload.surface.indices.length;
  const canWireframe = triCount <= WIREFRAME_TRI_LIMIT;
  const showWireframe = style.wireframe && canWireframe;

  const roleLabel = SURFACE_ROLES.find((r) => r.key === upload.role)?.label ?? upload.role;
  const color = useMemo(() => new THREE.Color(style.color), [style.color]);
  const highlightColor = useMemo(() => {
    const c = new THREE.Color(style.color);
    c.lerp(new THREE.Color('#ffffff'), 0.3);
    return c;
  }, [style.color]);

  const id = `surface-${upload.role}`;

  return (
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
        });
      }}
    >
      <meshPhysicalMaterial
        color={highlighted ? highlightColor : color}
        side={THREE.DoubleSide}
        transparent
        opacity={style.opacity}
        roughness={0.5}
        metalness={0.05}
        envMapIntensity={0.4}
        clearcoat={selected ? 0.3 : 0}
        wireframe={showWireframe}
        emissive={selected ? '#fbbf24' : '#000000'}
        emissiveIntensity={selected ? 0.15 : 0}
      />
    </mesh>
  );
}

function buildBatchedGeometry(
  solids: FlatDomainSolid[],
): { geometry: THREE.BufferGeometry; triRanges: { start: number; end: number; solidIdx: number }[] } {
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
  return { geometry: geo, triRanges };
}

function BatchedDomainGroup({
  domain, solids, visible, style, selected, highlighted, lodLevel, onHover, onSelect,
}: DomainGroupProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const { fullGeo, triRanges, lodGeos } = useMemo(() => {
    const { geometry: full, triRanges: ranges } = buildBatchedGeometry(solids);
    const posAttr = full.getAttribute('position') as THREE.BufferAttribute;
    const idxAttr = full.index!;
    const positions = posAttr.array as Float32Array;
    const indices = idxAttr.array as Uint32Array;

    const totalTris = indices.length / 3;
    const lods: THREE.BufferGeometry[] = [];

    if (totalTris > 1000) {
      const med = decimateGeometry(positions, indices, 0.25);
      const medGeo = new THREE.BufferGeometry();
      medGeo.setAttribute('position', new THREE.BufferAttribute(med.positions, 3));
      medGeo.setIndex(new THREE.BufferAttribute(med.indices, 1));
      medGeo.computeVertexNormals();
      medGeo.computeBoundingSphere();
      lods.push(medGeo);

      const low = decimateGeometry(positions, indices, 0.05);
      const lowGeo = new THREE.BufferGeometry();
      lowGeo.setAttribute('position', new THREE.BufferAttribute(low.positions, 3));
      lowGeo.setIndex(new THREE.BufferAttribute(low.indices, 1));
      lowGeo.computeVertexNormals();
      lowGeo.computeBoundingSphere();
      lods.push(lowGeo);
    }

    return { fullGeo: full, triRanges: ranges, lodGeos: lods };
  }, [solids]);

  const activeGeo = lodLevel === 0 ? fullGeo :
    lodLevel === 1 && lodGeos.length > 0 ? lodGeos[0] :
    lodLevel === 2 && lodGeos.length > 1 ? lodGeos[1] :
    fullGeo;

  const totalTris = useMemo(() => {
    let count = 0;
    for (const s of solids) count += s.triangleCount;
    return count;
  }, [solids]);
  const canWireframe = totalTris <= WIREFRAME_TRI_LIMIT;
  const showWireframe = style.wireframe && canWireframe;

  const color = useMemo(() => new THREE.Color(style.color), [style.color]);
  const highlightColor = useMemo(() => {
    const c = new THREE.Color(style.color);
    c.lerp(new THREE.Color('#ffffff'), 0.25);
    return c;
  }, [style.color]);

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
    <mesh
      ref={meshRef}
      geometry={activeGeo}
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
        onSelect(solidId, {
          type: 'domain', id: solidId, domain: solid?.domain ?? domain,
          label: solid?.label ?? domain, volume: solid?.volume ?? 0,
          blockName: solid?.block_name,
        });
      }}
    >
      <meshPhysicalMaterial
        color={highlighted ? highlightColor : color}
        side={THREE.DoubleSide}
        transparent
        opacity={style.opacity}
        roughness={0.5}
        metalness={0.05}
        envMapIntensity={0.4}
        clearcoat={selected ? 0.3 : 0}
        wireframe={showWireframe}
        emissive={selected ? '#fbbf24' : '#000000'}
        emissiveIntensity={selected ? 0.15 : 0}
      />
    </mesh>
  );
}

function LODController({ onLodChange }: { onLodChange: (level: number) => void }) {
  const { camera } = useThree();
  const orbitingRef = useRef(false);
  const lastPosRef = useRef(new THREE.Vector3());
  const stableFramesRef = useRef(0);
  const currentLodRef = useRef(0);

  useFrame(() => {
    const pos = camera.position;
    const dist = pos.distanceTo(lastPosRef.current);
    lastPosRef.current.copy(pos);

    if (dist > 0.01) {
      orbitingRef.current = true;
      stableFramesRef.current = 0;
      if (currentLodRef.current !== 2) {
        currentLodRef.current = 2;
        onLodChange(2);
      }
    } else {
      stableFramesRef.current++;
      if (orbitingRef.current && stableFramesRef.current > 15) {
        orbitingRef.current = false;
        currentLodRef.current = 0;
        onLodChange(0);
      }
    }
  });

  return null;
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
}: {
  points: MeasurePoint[];
  tool: MeasureTool;
}) {
  if (points.length === 0 || tool === 'none') return null;

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
          <sphereGeometry args={[0.3, 12, 12]} />
          <meshBasicMaterial color="#22d3ee" />
        </mesh>
      ))}
    </>
  );
}

interface DrawingLayerProps {
  points: [number, number][];
  isDrawing: boolean;
  onAddPoint: (x: number, y: number) => void;
}

function DrawingLayer({ points, isDrawing, onAddPoint }: DrawingLayerProps) {
  const { camera, gl, raycaster } = useThree();

  const handleClick = useCallback(
    (e: any) => {
      if (!isDrawing) return;
      e.stopPropagation();
      if (e.point) {
        onAddPoint(e.point.x, e.point.y);
        return;
      }
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const pt = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, pt);
      if (pt) {
        onAddPoint(pt.x, pt.y);
      }
    },
    [isDrawing, camera, gl, raycaster, onAddPoint],
  );

  if (!isDrawing && points.length === 0) return null;

  const linePoints: [number, number, number][] = points.map(([x, y]) => [x, y, 0.5]);
  if (points.length > 1) {
    linePoints.push([points[0][0], points[0][1], 0.5]);
  }

  return (
    <>
      <mesh visible={false} onClick={handleClick as any} position={[0, 0, 0]}>
        <planeGeometry args={[100000, 100000]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      {linePoints.length >= 2 && (
        <Line points={linePoints} color="#f97316" lineWidth={2} />
      )}
      {points.map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0.5]}>
          <sphereGeometry args={[0.4, 8, 8]} />
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

function BoundaryLines({ boundaries }: { boundaries: BoundaryRegion[] }) {
  const colors = ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];
  return (
    <>
      {boundaries.map((b, i) => {
        const pts: [number, number, number][] = [
          ...b.polygon.map(([x, y]) => [x, y, 0.3] as [number, number, number]),
          [b.polygon[0][0], b.polygon[0][1], 0.3],
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

function CursorElevation({
  onUpdate,
}: {
  onUpdate: (info: { x: number; y: number; z: number } | null) => void;
}) {
  const { camera, gl, raycaster, scene } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const onMove = (e: MouseEvent) => {
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
      const intersects = raycaster.intersectObjects(meshes, false);
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
  showPerf: boolean;
}

const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer({
  flatDomains, visible, canvasRef, boundaries, isDrawing, drawPoints, onAddDrawPoint,
  uploads, surfaceVisible, isDrawingSection, sectionLine, onSectionLineChange,
  onSectionDrawComplete, background, domainStyles, surfaceStyles, selectedId,
  onSelect, measureTool, measurePoints, onAddMeasurePoint, showPerf,
}, ref) {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [isDraggingEndpoint, setIsDraggingEndpoint] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cursorElev, setCursorElev] = useState<{ x: number; y: number; z: number } | null>(null);
  const [viewPreset, setViewPreset] = useState<ViewPreset | null>(null);
  const [lodLevel, setLodLevel] = useState(0);
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
    <div className={`relative h-full w-full ${isDark ? 'bg-[#1a1a2e]' : 'bg-slate-50'}`}>
      <PerformanceOverlay visible={showPerf} isDark={isDark} />

      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        camera={{ fov: 50, near: 0.1, far: 100000, up: [0, 0, 1] } as CanvasProps['camera']}
        onCreated={(state) => {
          state.camera.up.set(0, 0, 1);
          state.camera.updateProjectionMatrix();
          handleCreated(state);
        }}
        onPointerMissed={handleBgClick}
      >
        <color attach="background" args={[BG_COLORS[background]]} />

        <ambientLight intensity={0.35} />
        <directionalLight position={[50, -50, 100]} intensity={0.7} castShadow />
        <directionalLight position={[-30, 40, 60]} intensity={0.35} />
        <directionalLight position={[0, 0, -80]} intensity={0.15} />
        <hemisphereLight
          args={[isDark ? '#334155' : '#e0f2fe', isDark ? '#0f172a' : '#fef3c7', 0.3]}
        />

        <LODController onLodChange={setLodLevel} />

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
              lodLevel={lodLevel}
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

        <BoundaryLines boundaries={boundaries} />
        <DrawingLayer points={drawPoints} isDrawing={isDrawing} onAddPoint={onAddDrawPoint} />

        <MeasureOverlay3D points={measurePoints} tool={measureTool} />

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

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.1}
          enabled={!isDrawing && !isDrawingSection && !isDraggingEndpoint && measureTool === 'none'}
          mouseButtons={{
            LEFT: -1 as any,
            MIDDLE: THREE.MOUSE.ROTATE,
            RIGHT: THREE.MOUSE.PAN,
          }}
          enableZoom
          zoomSpeed={1.2}
        />
        <ControlsBinder controlsRef={controlsRef} />
      </Canvas>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded bg-black/85 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          {tooltip.surfaceFileName ? (
            <>
              <div className="font-semibold">{tooltip.surfaceRoleLabel}</div>
              <div className="text-slate-300">{tooltip.surfaceFileName}</div>
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

      {/* Elevation readout */}
      {cursorElev && (
        <div className={`absolute bottom-2 ${showPerf ? 'right-36' : 'right-2'} rounded px-2 py-1 text-[10px] font-mono ${isDark ? 'bg-black/70 text-slate-300' : 'bg-white/90 text-slate-600'} shadow`}>
          E {cursorElev.x.toFixed(1)} &nbsp; N {cursorElev.y.toFixed(1)} &nbsp; RL {cursorElev.z.toFixed(1)}
        </div>
      )}

      {/* Measure result overlay */}
      {measureTool === 'distance' && measurePoints.length === 2 && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded bg-cyan-900/90 px-3 py-1.5 text-xs font-medium text-cyan-100 shadow">
          Distance: {measurePoints[0].position.distanceTo(measurePoints[1].position).toFixed(2)} m
          &nbsp;|&nbsp; ΔZ: {Math.abs(measurePoints[1].position.z - measurePoints[0].position.z).toFixed(2)} m
        </div>
      )}

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
          {measureTool === 'distance' && `Click ${2 - measurePoints.length} point${measurePoints.length === 1 ? '' : 's'} to measure distance`}
          {measureTool === 'elevation' && 'Hover over surfaces to read elevation'}
          {measureTool === 'area' && `Click points to define area · ${measurePoints.length} placed · Press Enter to close`}
        </div>
      )}
    </div>
  );
});

export default Viewer;
