import { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import { Canvas, useThree, type CanvasProps } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { BoundaryRegion, ConformanceResult, DomainSolid } from '../types';

interface DomainMeshProps {
  solid: DomainSolid;
  visible: boolean;
  onHover: (info: TooltipInfo | null) => void;
}

interface TooltipInfo {
  x: number;
  y: number;
  domain: string;
  volume: number;
  blockName?: string;
}

function DomainMesh({ solid, visible, onHover }: DomainMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => {
    const verts = solid.solid.vertices;
    const idxs = solid.solid.indices;
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
    return geo;
  }, [solid]);

  const color = useMemo(() => new THREE.Color(solid.color), [solid.color]);

  if (!visible) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      onPointerOver={(e) => {
        e.stopPropagation();
        const { clientX, clientY } = e;
        onHover({
          x: clientX,
          y: clientY,
          domain: solid.label,
          volume: solid.volume,
          blockName: solid.block_name,
        });
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const { clientX, clientY } = e;
        onHover({
          x: clientX,
          y: clientY,
          domain: solid.label,
          volume: solid.volume,
          blockName: solid.block_name,
        });
      }}
      onPointerOut={() => onHover(null)}
    >
      <meshStandardMaterial
        color={color}
        side={THREE.DoubleSide}
        transparent
        opacity={0.85}
        roughness={0.6}
        metalness={0.1}
      />
    </mesh>
  );
}

function AutoFit({ domains, visible }: { domains: DomainSolid[]; visible: Set<string> }) {
  const { camera } = useThree();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) return;
    const box = new THREE.Box3();
    for (const d of domains) {
      if (!visible.has(d.domain)) continue;
      for (const v of d.solid.vertices) {
        box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
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
  }, [domains, visible, camera]);

  return null;
}

interface DrawingLayerProps {
  points: [number, number][];
  isDrawing: boolean;
  onAddPoint: (x: number, y: number) => void;
}

function DrawingLayer({ points, isDrawing, onAddPoint }: DrawingLayerProps) {
  const { camera, gl, raycaster } = useThree();
  const planeRef = useRef<THREE.Mesh>(null);

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
      <mesh
        ref={planeRef}
        visible={false}
        onClick={handleClick as any}
        position={[0, 0, 0]}
      >
        <planeGeometry args={[100000, 100000]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      {linePoints.length >= 2 && (
        <Line
          points={linePoints}
          color="#f97316"
          lineWidth={2}
        />
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

function BoundaryLines({ boundaries }: { boundaries: BoundaryRegion[] }) {
  const colors = ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];
  return (
    <>
      {boundaries.map((b, i) => {
        const pts: [number, number, number][] = [
          ...b.polygon.map(([x, y]) => [x, y, 0.3] as [number, number, number]),
          [b.polygon[0][0], b.polygon[0][1], 0.3],
        ];
        return (
          <Line
            key={i}
            points={pts}
            color={colors[i % colors.length]}
            lineWidth={1.5}
          />
        );
      })}
    </>
  );
}

interface ViewerProps {
  result: ConformanceResult;
  visible: Set<string>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  boundaries: BoundaryRegion[];
  isDrawing: boolean;
  drawPoints: [number, number][];
  onAddDrawPoint: (x: number, y: number) => void;
}

export default function Viewer({
  result,
  visible,
  canvasRef,
  boundaries,
  isDrawing,
  drawPoints,
  onAddDrawPoint,
}: ViewerProps) {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  const handleCreated = useCallback(
    (state: { gl: THREE.WebGLRenderer }) => {
      (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current =
        state.gl.domElement;
    },
    [canvasRef],
  );

  return (
    <div className="relative h-full w-full bg-slate-50">
      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: 50, near: 0.1, far: 100000, up: [0, 0, 1] } as CanvasProps['camera']}
        onCreated={(state) => {
          state.camera.up.set(0, 0, 1);
          state.camera.updateProjectionMatrix();
          handleCreated(state);
        }}
      >
        <color attach="background" args={['#f1f5f9']} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[50, -50, 100]} intensity={0.8} />
        <directionalLight position={[-30, 40, 60]} intensity={0.3} />

        {result.domains.map((d, i) => (
          <DomainMesh
            key={`${d.domain}-${i}`}
            solid={d}
            visible={visible.has(d.domain)}
            onHover={setTooltip}
          />
        ))}

        <BoundaryLines boundaries={boundaries} />
        <DrawingLayer
          points={drawPoints}
          isDrawing={isDrawing}
          onAddPoint={onAddDrawPoint}
        />

        <AutoFit domains={result.domains} visible={visible} />

        <OrbitControls makeDefault enableDamping dampingFactor={0.1} enabled={!isDrawing} />
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.8} />
        </GizmoHelper>
        <gridHelper
          args={[1000, 100, '#cbd5e1', '#e2e8f0']}
          rotation={[Math.PI / 2, 0, 0]}
        />
      </Canvas>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded-md bg-slate-900/90 px-3 py-2 text-xs text-white shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          <div className="font-medium">{tooltip.domain}</div>
          <div className="text-slate-300">
            {tooltip.volume.toFixed(1)} m³
          </div>
          {tooltip.blockName && (
            <div className="text-slate-400">{tooltip.blockName}</div>
          )}
        </div>
      )}

      {isDrawing && (
        <div className="absolute left-3 top-3 rounded-md bg-orange-500/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          Click to place points · Double-click or press Enter to close
        </div>
      )}
    </div>
  );
}
