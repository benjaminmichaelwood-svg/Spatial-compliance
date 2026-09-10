// Mesh-rendering components for the Viewer: the LOD system, the shader-
// based crease/wireframe overlay, and the two heavy per-surface /
// per-domain mesh components. Split out of Viewer.tsx (Priority 19:
// behavior-preserving file breakup — no logic changes), and additionally
// wrapped in React.memo here (new in this pass — see the note above each
// export) since these are exactly the expensive, frequently-reused leaf
// nodes CLAUDE.md's performance targets care about (300K+ triangle meshes,
// 30+ FPS during orbit/zoom): Viewer.tsx re-renders on every tooltip/cursor-
// elevation/measure-label update (mouse-move-driven, so often), and without
// memo every SurfaceMesh/BatchedDomainGroup/CreaseEdges instance previously
// re-ran on each of those unrelated state changes even though their own
// props hadn't changed.
import { memo, useRef, useMemo, useEffect, useCallback, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { SURFACE_ROLES } from '../../types';
import type { FlatDomainSolid } from '../../workers/engineClient';
import { sampleHeatmapRamp } from '../ThicknessLegend';
import { decimateGeometry } from '../../utils/decimation';
import { buildCreaseGeometry } from './geometryHelpers';
import type { DomainGroupProps, SelectionInfo, SurfaceMeshProps } from './types';

// --- LOD (level-of-detail) ---------------------------------------------
// decimateGeometry() (web/src/utils/decimation.ts) existed but was never
// called anywhere — every surface/domain solid always rendered at full
// resolution regardless of camera distance or movement, which is the
// leading suspect for "rendering is too slow" on large (300K+ triangle)
// meshes per CLAUDE.md. This wires it in.
//
// Ratios and thresholds:
//   LOD 0 = full resolution, LOD 1 = 25% of triangles, LOD 2 = 5%.
//   Distance thresholds are RELATIVE to each mesh's own bounding-sphere
//   radius (not a fixed meter value) so the same logic scales correctly
//   from a small test surface up to a 20km site: full detail within 1.5x
//   the mesh's radius, 25% within 4x, 5% beyond that.
//   While the camera is actively moving (checked by comparing its position
//   between throttled checks), the effective level is floored at 1 (25%)
//   even if the camera happens to be close — this is what keeps orbit/pan/
//   zoom responsive; it upgrades back to full detail once movement stops.
export const LOD_RATIOS = [1, 0.25, 0.05] as const;
const LOD_NEAR_MULTIPLE = 1.5;
const LOD_FAR_MULTIPLE = 4;
const LOD_CHECK_INTERVAL_MS = 150; // throttle: don't recompute the LOD decision every frame
const LOD_MOVING_HOLD_MS = 400; // stay in "moving" LOD for this long after the last detected camera movement

/**
 * Decides which precomputed LOD level (0/1/2) a mesh should render at,
 * based on camera distance to its bounding sphere (relative to the
 * sphere's own radius) and whether the camera is currently moving.
 * Runs its actual distance check on a throttled interval inside useFrame,
 * not every frame, and only triggers a re-render (via setState) when the
 * chosen level actually changes.
 */
export function useLodLevel(sphere: THREE.Sphere | null): number {
  const { camera } = useThree();
  const [level, setLevel] = useState(0);
  const lastCheckMs = useRef(0);
  const lastCamPos = useRef<THREE.Vector3 | null>(null);
  const movingUntilMs = useRef(0);

  useFrame((state) => {
    if (!sphere) return;
    const nowMs = state.clock.elapsedTime * 1000;
    if (nowMs - lastCheckMs.current < LOD_CHECK_INTERVAL_MS) return;
    lastCheckMs.current = nowMs;

    const radius = Math.max(sphere.radius, 1);
    if (!lastCamPos.current) lastCamPos.current = camera.position.clone();
    const moved = camera.position.distanceTo(lastCamPos.current) > radius * 0.001;
    lastCamPos.current.copy(camera.position);
    if (moved) movingUntilMs.current = nowMs + LOD_MOVING_HOLD_MS;
    const isMoving = nowMs < movingUntilMs.current;

    const dist = camera.position.distanceTo(sphere.center);
    let distanceLevel = 0;
    if (dist > radius * LOD_FAR_MULTIPLE) distanceLevel = 2;
    else if (dist > radius * LOD_NEAR_MULTIPLE) distanceLevel = 1;
    const effective = isMoving ? Math.max(distanceLevel, 1) : distanceLevel;

    setLevel((prev) => (prev === effective ? prev : effective));
  });

  return level;
}

const EDGE_COLOR_DARK = 0x222222;
const EDGE_COLOR_LIGHT = 0x666666;
const CREASE_THRESHOLD_DEG = 18;

const CREASE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 barycentric;
  attribute vec3 creaseMask;
  varying vec3 vBarycentric;
  varying vec3 vCreaseMask;
  void main() {
    vBarycentric = barycentric;
    vCreaseMask = creaseMask;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CREASE_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying vec3 vBarycentric;
  varying vec3 vCreaseMask;
  uniform vec3 edgeColor;
  uniform float opacity;
  uniform float lineWidth;
  void main() {
    vec3 d = fwidth(vBarycentric);
    vec3 a3 = smoothstep(vec3(0.0), d * lineWidth, vBarycentric);
    // Per component: if this edge isn't a crease, force it to 1.0 (never
    // draws a line here) — otherwise use the real distance-to-edge value.
    vec3 gated = mix(vec3(1.0), a3, vCreaseMask);
    float edgeFactor = min(min(gated.x, gated.y), gated.z);
    float alpha = (1.0 - edgeFactor) * opacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(edgeColor, alpha);
  }
`;

/**
 * React.memo added in Priority 19 — pure function of (geometry, visible,
 * isDark): same props, same rendered crease overlay every time, so the
 * default shallow prop comparison is exactly correct here. `geometry`
 * itself is the memoization-sensitive prop (it flips between LOD levels
 * from the parent), and callers already pass the same geometry reference
 * across re-renders where nothing changed (see SurfaceMesh/BatchedDomainGroup
 * below), so this actually skips re-renders in practice, not just in theory.
 */
export const CreaseEdges = memo(function CreaseEdges({ geometry, visible, isDark }: { geometry: THREE.BufferGeometry; visible: boolean; isDark: boolean }) {
  // `geometry` can flip between LOD levels as the camera moves. A plain
  // useMemo([geometry]) only remembers the single most-recently-seen
  // geometry, so switching back and forth between two LOD levels would
  // rebuild the crease overlay every single time. Cache per geometry
  // identity instead, so each LOD level's crease geometry is computed at
  // most once (lazily, the first time that level is actually reached).
  const cacheRef = useRef(new Map<THREE.BufferGeometry, THREE.BufferGeometry>());
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const g of cache.values()) g.dispose();
      cache.clear();
    };
  }, []);
  let creaseGeo = cacheRef.current.get(geometry);
  if (!creaseGeo) {
    creaseGeo = buildCreaseGeometry(geometry, CREASE_THRESHOLD_DEG);
    cacheRef.current.set(geometry, creaseGeo);
  }

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CREASE_VERTEX_SHADER,
        fragmentShader: CREASE_FRAGMENT_SHADER,
        uniforms: {
          edgeColor: { value: new THREE.Color(EDGE_COLOR_LIGHT) },
          opacity: { value: 0.7 },
          lineWidth: { value: 1.2 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useEffect(() => {
    (material.uniforms.edgeColor.value as THREE.Color).set(isDark ? EDGE_COLOR_DARK : EDGE_COLOR_LIGHT);
  }, [material, isDark]);

  useEffect(() => {
    return () => material.dispose();
  }, [material]);

  if (!visible) return null;

  return <mesh geometry={creaseGeo} material={material} frustumCulled />;
});

/**
 * React.memo added in Priority 19: SurfaceMesh is a pure function of its
 * props (no external mutable state it reads besides those props), and its
 * geometry-building/LOD-decimation work (useMemo internally) is exactly
 * the kind of per-surface cost CLAUDE.md's performance targets say to
 * avoid re-doing on unrelated parent re-renders (Viewer.tsx's tooltip/
 * cursor-elevation state changes on every mouse move).
 */
export const SurfaceMesh = memo(function SurfaceMesh({ upload, style, selected, highlighted, onHover, onSelect, isDark, domainMap, domainVisible, heatmapVertexThickness, heatmapMode }: SurfaceMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhongMaterial>(null);

  const { geometry, lodGeometries, triCount } = useMemo(() => {
    const build = (positions: Float32Array, indices: Uint32Array) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      (geo as any).boundsTree = new MeshBVH(geo);
      return geo;
    };
    // Precompute all LOD levels once here (on data load), not per camera
    // check — decimation itself isn't free. LOD 0 is the same full-res
    // geometry used everywhere else (raycasting, disposal, etc.).
    const full = build(upload.positions, upload.indices);
    const levels = LOD_RATIOS.map((ratio) => {
      if (ratio === 1) return full;
      const d = decimateGeometry(upload.positions, upload.indices, ratio);
      return build(d.positions, d.indices);
    });
    return { geometry: full, lodGeometries: levels, triCount: upload.triangleCount };
  }, [upload]);

  useEffect(() => {
    return () => {
      for (const g of lodGeometries) {
        // three-mesh-bvh's BVH is freed by calling the prototype-patched
        // disposeBoundsTree() on the geometry (it just nulls the
        // reference) — MeshBVH itself has no .dispose() method.
        (g as any).disposeBoundsTree?.();
        g.dispose();
      }
    };
  }, [lodGeometries]);

  const isHeatmapActive = !!(heatmapMode && heatmapVertexThickness && heatmapMode.paintRole === upload.role);

  const heatmapGeo = useMemo(() => {
    if (!isHeatmapActive || !heatmapVertexThickness) return null;
    const geo = geometry.clone();
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    (geo as any).boundsTree = new MeshBVH(geo);
    return geo;
  }, [geometry, isHeatmapActive, heatmapVertexThickness]);

  // heatmapGeo is a full clone of the base geometry (plus its own BVH) —
  // recreated whenever the heatmap is toggled or its data changes, and
  // previously never freed. On a real working session (load surfaces, run,
  // toggle the heatmap repeatedly) this leaked a full duplicate of
  // whatever surface was painted every time.
  useEffect(() => {
    return () => {
      if (!heatmapGeo) return;
      (heatmapGeo as any).disposeBoundsTree?.();
      heatmapGeo.dispose();
    };
  }, [heatmapGeo]);

  useEffect(() => {
    if (!heatmapGeo || !heatmapVertexThickness || !heatmapMode) return;
    const colorAttr = heatmapGeo.attributes.color as THREE.BufferAttribute;
    const arr = colorAttr.array as Float32Array;
    const { scaleMin, scaleMax, deadband } = heatmapMode;
    const range = scaleMax - scaleMin;
    // Base surface color for deadband vertices (material is white when painted,
    // so vertex color = surface color reproduces the unpainted look)
    const baseCol = new THREE.Color(style.color);

    for (let i = 0; i < heatmapVertexThickness.length; i++) {
      const dz = heatmapVertexThickness[i];
      let r: number, g: number, b: number;
      if (isNaN(dz)) {
        r = 0.3; g = 0.3; b = 0.3;
      } else if (deadband > 0 && Math.abs(dz) <= deadband) {
        // Within neutral zone — show base surface colour
        r = baseCol.r; g = baseCol.g; b = baseCol.b;
      } else {
        const t = range > 0 ? (dz - scaleMin) / range : 0.5;
        [r, g, b] = sampleHeatmapRamp(t);
      }
      arr[i * 3] = r;
      arr[i * 3 + 1] = g;
      arr[i * 3 + 2] = b;
    }
    colorAttr.needsUpdate = true;
  }, [heatmapGeo, heatmapVertexThickness, heatmapMode, style.color]);

  const isPainted = isHeatmapActive;
  // LOD is bypassed while the thickness heatmap is painted: per-vertex
  // heatmap colors are computed against the full-resolution vertex layout
  // (heatmapGeo is a clone of `geometry`, LOD 0), and re-deriving that
  // per-vertex coloring for each decimated LOD level's different vertex
  // layout is out of scope here — heatmap review is a deliberate,
  // stationary precision check anyway, not a casual navigation view.
  const lodLevel = useLodLevel(geometry.boundingSphere);
  const activeGeo = isHeatmapActive ? (heatmapGeo ?? geometry) : lodGeometries[lodLevel];

  useEffect(() => {
    if (!matRef.current) return;
    if (isPainted) {
      matRef.current.color.set('#ffffff');
      matRef.current.opacity = 0.95;
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

  const getThicknessAtFace = useCallback((faceIndex: number): number | undefined => {
    if (!heatmapVertexThickness || !isHeatmapActive) return undefined;
    const idx = upload.indices;
    const i0 = idx[faceIndex * 3], i1 = idx[faceIndex * 3 + 1], i2 = idx[faceIndex * 3 + 2];
    const t0 = heatmapVertexThickness[i0], t1 = heatmapVertexThickness[i1], t2 = heatmapVertexThickness[i2];
    const vals = [t0, t1, t2].filter(v => !isNaN(v));
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
  }, [heatmapVertexThickness, isHeatmapActive, upload.indices]);

  const handlePointerEvent = useCallback((e: any) => {
    e.stopPropagation();
    const thick = e.faceIndex != null ? getThicknessAtFace(e.faceIndex) : undefined;
    onHover({
      x: e.clientX, y: e.clientY, domain: roleLabel, volume: 0,
      surfaceFileName: upload.fileName, surfaceRoleLabel: roleLabel,
      thickness: thick,
    });
  }, [roleLabel, upload.fileName, getThicknessAtFace, onHover]);

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={activeGeo}
        frustumCulled
        onPointerOver={handlePointerEvent}
        onPointerMove={handlePointerEvent}
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
          opacity={isPainted ? 0.95 : style.opacity}
          transparent={isPainted || style.opacity < 1}
          side={THREE.DoubleSide}
          flatShading={false}
          shininess={isPainted ? 15 : 10}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <CreaseEdges geometry={activeGeo} visible={style.wireframe} isDark={isDark} />
    </group>
  );
});

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

/**
 * React.memo added in Priority 19, for the same reason as SurfaceMesh
 * above — this is the more expensive of the two (batches every solid in a
 * domain into one merged geometry, per LOD level, in a useMemo keyed only
 * on `solids`), so avoiding a full re-run on unrelated Viewer re-renders
 * matters even more here.
 */
export const BatchedDomainGroup = memo(function BatchedDomainGroup({
  domain, solids, visible, style, selected, highlighted, isDark, onHover, onSelect,
}: DomainGroupProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhongMaterial>(null);

  const { lodResults } = useMemo(() => {
    // Decimate each solid individually, BEFORE batching them into one
    // merged geometry — this is what keeps triRanges (used by findSolid()
    // below for hover/click attribution) correct at every LOD level: each
    // solid's own (now-reduced) triangleCount still marks out its own
    // range in the merged buffer, it's just a smaller range.
    const results = LOD_RATIOS.map((ratio) => {
      const levelSolids =
        ratio === 1
          ? solids
          : solids.map((s) => {
              const d = decimateGeometry(s.positions, s.indices, ratio);
              return { ...s, positions: d.positions, indices: d.indices, vertexCount: d.positions.length / 3, triangleCount: d.indices.length / 3 };
            });
      return buildBatchedGeometry(levelSolids);
    });
    return { lodResults: results, totalTris: results[0].totalTris };
  }, [solids]);

  const geo = lodResults[0].geometry;
  const lodLevel = useLodLevel(geo.boundingSphere);
  const { geometry: activeGeo, triRanges } = lodResults[lodLevel];

  useEffect(() => {
    return () => {
      for (const r of lodResults) {
        (r.geometry as any).disposeBoundsTree?.();
        r.geometry.dispose();
      }
    };
  }, [lodResults]);

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
      <CreaseEdges geometry={activeGeo} visible={style.wireframe} isDark={isDark} />
    </group>
  );
});
