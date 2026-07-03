import { useRef, useMemo, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { TriangulatedSurface } from '../engine/types';
import { ConformanceDomain } from '../compliance/types';
import { SurfaceMesh } from './SurfaceMesh';

interface SceneViewerProps {
  domains: ConformanceDomain[];
  inputSurfaces?: { surface: TriangulatedSurface; color: string; name: string; visible: boolean }[];
  wireframe: boolean;
}

function SceneContent({
  domains,
  inputSurfaces,
  wireframe,
}: SceneViewerProps) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  const center = useMemo(() => {
    const allSurfaces = [
      ...domains.filter((d) => d.surface && d.visible).map((d) => d.surface!),
      ...(inputSurfaces?.filter((s) => s.visible).map((s) => s.surface) ?? []),
    ];

    if (allSurfaces.length === 0) return new THREE.Vector3(0, 0, 0);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const s of allSurfaces) {
      minX = Math.min(minX, s.bounds.min.x);
      maxX = Math.max(maxX, s.bounds.max.x);
      minY = Math.min(minY, s.bounds.min.y);
      maxY = Math.max(maxY, s.bounds.max.y);
      minZ = Math.min(minZ, s.bounds.min.z);
      maxZ = Math.max(maxZ, s.bounds.max.z);
    }

    return new THREE.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    );
  }, [domains, inputSurfaces]);

  const sceneScale = useMemo(() => {
    const allSurfaces = [
      ...domains.filter((d) => d.surface).map((d) => d.surface!),
      ...(inputSurfaces?.map((s) => s.surface) ?? []),
    ];

    if (allSurfaces.length === 0) return 100;

    let maxRange = 0;
    for (const s of allSurfaces) {
      maxRange = Math.max(
        maxRange,
        s.bounds.max.x - s.bounds.min.x,
        s.bounds.max.y - s.bounds.min.y,
        s.bounds.max.z - s.bounds.min.z
      );
    }
    return maxRange || 100;
  }, [domains, inputSurfaces]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[1, 1, 1]} intensity={0.8} />
      <directionalLight position={[-1, -0.5, 0.5]} intensity={0.3} />

      <group position={[-center.x, -center.y, -center.z]}>
        {domains.map((domain, i) =>
          domain.surface ? (
            <SurfaceMesh
              key={`domain-${i}`}
              surface={domain.surface}
              color={domain.color}
              opacity={0.7}
              wireframe={wireframe}
              visible={domain.visible}
            />
          ) : null
        )}

        {inputSurfaces?.map((s, i) => (
          <SurfaceMesh
            key={`input-${i}`}
            surface={s.surface}
            color={s.color}
            opacity={0.3}
            wireframe={true}
            visible={s.visible}
          />
        ))}
      </group>

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        maxDistance={sceneScale * 5}
      />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </>
  );
}

export function SceneViewer(props: SceneViewerProps) {
  return (
    <Canvas
      camera={{
        position: [200, 200, 200],
        fov: 50,
        near: 0.1,
        far: 100000,
        up: [0, 0, 1],
      }}
      style={{ background: '#1a1a2e' }}
    >
      <SceneContent {...props} />
    </Canvas>
  );
}
