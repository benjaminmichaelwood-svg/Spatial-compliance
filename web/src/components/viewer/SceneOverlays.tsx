// R3F "controller"/overlay components used inside the Viewer's <Canvas>:
// camera fitting, view presets, measurement tools, the polygon/section
// drawing tools, keyboard shortcuts, boundary/reference-layer rendering,
// and small readouts (cursor elevation, measurement labels). Split out of
// Viewer.tsx (Priority 19: behavior-preserving file breakup — no logic
// changes); every component here is moved verbatim except where noted.
import { useRef, useMemo, useEffect, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import type { BoundaryRegion, SurfaceRole, UploadedSurface, MeasureTool, ViewPreset, ReferenceLayer } from '../../types';
import type { FlatDomainSolid } from '../../workers/engineClient';
import { CreaseEdges } from './MeshRenderers';
import type {
  DrawingLayerProps,
  MeasurePoint,
  SavedMeasurement,
  SectionLineOverlayProps,
  ViewPresetControllerProps,
} from './types';

export function AutoFit({ flatDomains, visible, uploads }: { flatDomains: FlatDomainSolid[]; visible: Set<string>; uploads: Map<SurfaceRole, UploadedSurface> }) {
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

export function ViewPresetController({ preset, flatDomains, uploads, onDone }: ViewPresetControllerProps) {
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

export function MeasureCursorTracker({ active, onMove }: {
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

export function MeasureClickHandler({ active, onMeasureClick }: {
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

export function MeasureOverlay3D({
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

export function DrawingLayer({ points, isDrawing, onAddPoint, onFinish, displayZ, sphereRadius }: DrawingLayerProps) {
  const lastClickRef = useRef(0);
  const { scene, camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  // Root cause of "polygon draw tool does nothing": this used to be an
  // invisible THREE.PlaneGeometry(100000, 100000) mesh positioned at world
  // origin (position={[0, 0, displayZ]}). Mine surfaces render at their raw
  // Easting/Northing coordinates (routinely hundreds of thousands of units
  // from the origin — CLAUDE.md's own sample data sits around
  // 782000/7331000) with no recentering anywhere in the frontend, so that
  // catch-plane was never anywhere near the camera/terrain the user is
  // actually looking at and clicking on: raycasts from the camera toward
  // the visible mine site would essentially never intersect a 100,000-unit
  // plane centered 700+ km away at (0, 0). Fixed by raycasting against the
  // real, visible scene meshes instead — the same working pattern
  // MeasureClickHandler already uses above. Every mesh with a computed
  // .boundsTree (surfaces/domain solids, set up in MeshRenderers.tsx)
  // automatically gets three-mesh-bvh-accelerated raycasting via the
  // `THREE.Mesh.prototype.raycast = acceleratedRaycast` override at the top
  // of Viewer.tsx, satisfying CLAUDE.md's "Raycasting via three-mesh-bvh
  // only" — this is the same global override, not a separate path.
  useEffect(() => {
    if (!isDrawing) return;
    const canvas = gl.domElement;

    const onClick = (e: MouseEvent) => {
      // Capture phase + stopPropagation so this fires and consumes the
      // click before react-three-fiber's own (bubble-phase) click handling
      // reaches it — otherwise a click meant to place a draw point would
      // also trigger a surface's onClick (e.g. its selection tooltip)
      // underneath the cursor.
      e.stopPropagation();
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
      if (hits.length === 0) return;
      const point = hits[0].point;

      const now = Date.now();
      if (now - lastClickRef.current < 350 && points.length >= 3) {
        lastClickRef.current = 0;
        onFinish();
        return;
      }
      lastClickRef.current = now;
      onAddPoint(point.x, point.y);
    };

    canvas.addEventListener('click', onClick, { capture: true });
    return () => canvas.removeEventListener('click', onClick, { capture: true });
  }, [isDrawing, scene, camera, gl, raycaster, onAddPoint, onFinish, points.length]);

  if (!isDrawing && points.length === 0) return null;

  const z = displayZ + sphereRadius;
  const linePoints: [number, number, number][] = points.map(([x, y]) => [x, y, z]);
  if (points.length > 1) {
    linePoints.push([points[0][0], points[0][1], z]);
  }

  return (
    <>
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

export function SectionLineOverlay({
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

export function BoundaryLines({ boundaries, displayZ }: { boundaries: BoundaryRegion[]; displayZ: number }) {
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

export function ControlsBinder({ controlsRef }: { controlsRef: React.MutableRefObject<any> }) {
  const { camera } = useThree();
  useEffect(() => {
    (camera as any).__controls = controlsRef.current;
  }, [camera, controlsRef]);
  return null;
}

export function ZUpEnforcer() {
  const { camera } = useThree();
  useFrame(() => {
    const up = camera.up;
    if (Math.abs(up.x) > 1e-6 || Math.abs(up.y) > 1e-6 || Math.abs(up.z - 1) > 1e-6) {
      camera.up.set(0, 0, 1);
    }
  });
  return null;
}

export function SetPivotMode({
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

export function KeyboardShortcuts({
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

export function MeasureLabelsProjector({
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

export function CursorElevation({
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

export function RefSurfaceMesh({ layer, isDark }: { layer: ReferenceLayer; isDark: boolean }) {
  const surf = layer.surface;
  if (!surf) return null;

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(surf.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(surf.indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }, [surf]);

  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  return (
    <group visible={layer.visible}>
      <mesh geometry={geometry}>
        <meshPhongMaterial
          color={layer.style.color}
          opacity={layer.style.opacity}
          transparent={layer.style.opacity < 1}
          side={THREE.DoubleSide}
          depthWrite={layer.style.opacity >= 0.95}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <CreaseEdges geometry={geometry} visible={layer.style.wireframe} isDark={isDark} />
    </group>
  );
}

export function RefPolylinesMesh({ layer }: { layer: ReferenceLayer }) {
  if (!layer.polylines || layer.polylines.length === 0) return null;

  const lineData = useMemo(() => {
    return layer.polylines!.map(pl => {
      const pts: [number, number, number][] = [];
      for (let i = 0; i < pl.pointCount; i++) {
        pts.push([pl.points[i * 3], pl.points[i * 3 + 1], pl.points[i * 3 + 2]]);
      }
      if (pl.closed && pts.length > 0) pts.push(pts[0]);
      return { points: pts, color: pl.color, name: pl.name };
    });
  }, [layer.polylines]);

  return (
    <group visible={layer.visible}>
      {lineData.map((ld, i) => (
        <Line
          key={i}
          points={ld.points}
          color={layer.style.color !== '#cccccc' ? layer.style.color : ld.color}
          lineWidth={layer.style.lineWidth}
          dashed={layer.style.lineDash.length > 0}
          dashSize={layer.style.lineDash[0] ?? 1}
          gapSize={layer.style.lineDash[1] ?? 0}
          opacity={layer.style.opacity}
          transparent={layer.style.opacity < 1}
        />
      ))}
    </group>
  );
}
