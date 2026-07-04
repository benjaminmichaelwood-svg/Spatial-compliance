import { useRef, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useThree, type CanvasProps } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import type { ConformanceResult, DomainSolid } from '../types';

interface DomainMeshProps {
  solid: DomainSolid;
  visible: boolean;
}

function DomainMesh({ solid, visible }: DomainMeshProps) {
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
    <mesh geometry={geometry}>
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

interface ViewerProps {
  result: ConformanceResult;
  visible: Set<string>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export default function Viewer({ result, visible, canvasRef }: ViewerProps) {
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
          />
        ))}

        <AutoFit domains={result.domains} visible={visible} />

        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.8} />
        </GizmoHelper>
        <gridHelper
          args={[1000, 100, '#cbd5e1', '#e2e8f0']}
          rotation={[Math.PI / 2, 0, 0]}
        />
      </Canvas>
    </div>
  );
}
