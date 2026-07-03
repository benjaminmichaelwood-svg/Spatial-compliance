import { useMemo } from 'react';
import * as THREE from 'three';
import { TriangulatedSurface } from '../engine/types';

interface SurfaceMeshProps {
  surface: TriangulatedSurface;
  color: string;
  opacity?: number;
  wireframe?: boolean;
  visible?: boolean;
}

export function SurfaceMesh({
  surface,
  color,
  opacity = 0.7,
  wireframe = false,
  visible = true,
}: SurfaceMeshProps) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(surface.vertices.length);
    for (let i = 0; i < surface.vertices.length; i++) {
      positions[i] = surface.vertices[i];
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(surface.indices), 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    return geo;
  }, [surface]);

  if (!visible) return null;

  return (
    <group>
      <mesh geometry={geometry}>
        <meshPhongMaterial
          color={color}
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          depthWrite={opacity > 0.9}
        />
      </mesh>
      {wireframe && (
        <mesh geometry={geometry}>
          <meshBasicMaterial
            color="#000000"
            wireframe
            transparent
            opacity={0.15}
          />
        </mesh>
      )}
    </group>
  );
}
