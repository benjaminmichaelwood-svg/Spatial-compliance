// Pure geometry/math helpers used by the Viewer module. No React, no JSX —
// split out of Viewer.tsx (Priority 19: behavior-preserving file breakup,
// no logic changes) purely to shrink that file; every function here is
// moved verbatim.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// NOTE: unused (moved verbatim from Viewer.tsx, where it was already dead
// code prior to this split — nothing calls it). Left in place rather than
// deleted, since Priority 19 is explicitly a behavior-preserving refactor
// only and removing dead code is a separate decision.
export function computeSmoothNormals(positions: Float32Array): Float32Array {
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

export function computePerVertexThickness(
  paintPositions: Float32Array,
  paintVertexCount: number,
  refPositions: Float32Array,
  refIndices: Uint32Array,
): Float32Array {
  const refGeo = new THREE.BufferGeometry();
  refGeo.setAttribute('position', new THREE.BufferAttribute(refPositions.slice(), 3));
  refGeo.setIndex(new THREE.BufferAttribute(refIndices.slice(), 1));
  const bvh = new MeshBVH(refGeo);

  const result = new Float32Array(paintVertexCount);
  const ray = new THREE.Ray();

  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < paintVertexCount; i++) {
    const z = paintPositions[i * 3 + 2];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const refTriCount = refIndices.length / 3;
  for (let i = 0; i < refTriCount; i++) {
    for (let v = 0; v < 3; v++) {
      const z = refPositions[refIndices[i * 3 + v] * 3 + 2];
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  const zSpan = maxZ - minZ + 100;

  for (let i = 0; i < paintVertexCount; i++) {
    const x = paintPositions[i * 3];
    const y = paintPositions[i * 3 + 1];
    const z = paintPositions[i * 3 + 2];

    ray.origin.set(x, y, maxZ + zSpan);
    ray.direction.set(0, 0, -1);

    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    if (hit) {
      result[i] = z - hit.point.z;
    } else {
      result[i] = NaN;
    }
  }

  refGeo.dispose();
  return result;
}

// Shader-based replacement for THREE.EdgesGeometry (banned by CLAUDE.md: "No
// EdgesGeometry — causes crashes on large meshes"). EdgesGeometry's failure
// mode is an unbounded-size lineSegments buffer (one line per kept edge,
// which can be a large and unpredictable fraction of a 300K+ triangle
// terrain mesh) built by a CPU-side edge-adjacency pass. This replacement
// still needs one CPU pass over the triangles to find which edges are
// creases (that adjacency computation is unavoidable for an *angle-based*
// selective wireframe — a plain barycentric wireframe shader alone only
// gives ALL edges, not creases), but the OUTPUT is bounded and predictable:
// exactly 3 vertices per source triangle, always, tagged with a per-vertex
// barycentric coordinate and a "which of my 3 edges are creases" flag. The
// actual crease *rendering* happens per-pixel in the fragment shader (see
// MeshRenderers.tsx's CREASE_FRAGMENT_SHADER, a standard barycentric-
// wireframe technique gated per-edge by the crease flag) — no lineSegments
// geometry, no per-edge draw calls.
export function buildCreaseGeometry(source: THREE.BufferGeometry, thresholdDeg: number): THREE.BufferGeometry {
  const posAttr = source.getAttribute('position') as THREE.BufferAttribute;
  const srcIndex = source.getIndex();
  const triCount = srcIndex ? srcIndex.count / 3 : posAttr.count / 3;
  const idx = (i: number) => (srcIndex ? srcIndex.getX(i) : i);

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const faceNormals = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = idx(t * 3), i1 = idx(t * 3 + 1), i2 = idx(t * 3 + 2);
    vA.fromBufferAttribute(posAttr, i0);
    vB.fromBufferAttribute(posAttr, i1);
    vC.fromBufferAttribute(posAttr, i2);
    vB.sub(vA);
    vC.sub(vA);
    vB.cross(vC).normalize();
    faceNormals[t * 3] = vB.x;
    faceNormals[t * 3 + 1] = vB.y;
    faceNormals[t * 3 + 2] = vB.z;
  }

  // One pass to find, per undirected vertex-pair, which triangle(s) use it.
  // A boundary edge (used by exactly one triangle) is always a crease —
  // matching THREE.EdgesGeometry's own behavior — otherwise compare face
  // normals against the angle threshold.
  const edgeFirstTri = new Map<string, number>();
  const cosThreshold = Math.cos(THREE.MathUtils.degToRad(thresholdDeg));
  const isCrease = new Uint8Array(triCount * 3); // 3 flags per triangle: [opp v0, opp v1, opp v2]

  // String keys rather than a packed number: a packed key (lo * 2^32 + hi)
  // silently loses precision once vertex indices exceed ~2^21 (~2 million),
  // which real 300K+ triangle terrain meshes can reach — string keys stay
  // exact at any mesh size, at the cost of a bit more GC pressure for one
  // O(triangles) pass.
  const edgeKey = (a: number, b: number) => (a < b ? a + '_' + b : b + '_' + a);

  // Pass 1: record first occurrence of each edge.
  for (let t = 0; t < triCount; t++) {
    const i0 = idx(t * 3), i1 = idx(t * 3 + 1), i2 = idx(t * 3 + 2);
    const edges: [number, number][] = [[i1, i2], [i0, i2], [i0, i1]];
    for (const [a, b] of edges) {
      const key = edgeKey(a, b);
      if (!edgeFirstTri.has(key)) edgeFirstTri.set(key, t);
    }
  }
  // Pass 2: decide crease-ness by comparing against the SECOND triangle
  // that shares each edge (if any); mark both triangles' matching slot.
  const edgeSecondSeen = new Set<string>();
  for (let t = 0; t < triCount; t++) {
    const i0 = idx(t * 3), i1 = idx(t * 3 + 1), i2 = idx(t * 3 + 2);
    const edges: [number, number][] = [[i1, i2], [i0, i2], [i0, i1]];
    for (let e = 0; e < 3; e++) {
      const [a, b] = edges[e];
      const key = edgeKey(a, b);
      const firstTri = edgeFirstTri.get(key)!;
      if (firstTri === t) continue; // this triangle is the first occurrence; handled when the second is found (or never, if boundary)
      // `t` is a second-or-later occurrence sharing this edge with `firstTri`.
      const dot =
        faceNormals[firstTri * 3] * faceNormals[t * 3] +
        faceNormals[firstTri * 3 + 1] * faceNormals[t * 3 + 1] +
        faceNormals[firstTri * 3 + 2] * faceNormals[t * 3 + 2];
      const crease = dot < cosThreshold ? 1 : 0;
      isCrease[t * 3 + e] = crease;
      // Find which edge-slot this same key occupies on firstTri and mark it too.
      const fi0 = idx(firstTri * 3), fi1 = idx(firstTri * 3 + 1), fi2 = idx(firstTri * 3 + 2);
      const fEdges: [number, number][] = [[fi1, fi2], [fi0, fi2], [fi0, fi1]];
      for (let fe = 0; fe < 3; fe++) {
        if (edgeKey(fEdges[fe][0], fEdges[fe][1]) === key) {
          isCrease[firstTri * 3 + fe] = crease;
          break;
        }
      }
      edgeSecondSeen.add(key);
    }
  }
  // Boundary edges (only one triangle ever claimed them) are always creases.
  for (let t = 0; t < triCount; t++) {
    const i0 = idx(t * 3), i1 = idx(t * 3 + 1), i2 = idx(t * 3 + 2);
    const edges: [number, number][] = [[i1, i2], [i0, i2], [i0, i1]];
    for (let e = 0; e < 3; e++) {
      const key = edgeKey(edges[e][0], edges[e][1]);
      if (!edgeSecondSeen.has(key)) isCrease[t * 3 + e] = 1;
    }
  }

  const positions = new Float32Array(triCount * 9);
  const barycentric = new Float32Array(triCount * 9);
  const creaseMask = new Float32Array(triCount * 9);
  const BARY = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let t = 0; t < triCount; t++) {
    const tIdx = [idx(t * 3), idx(t * 3 + 1), idx(t * 3 + 2)];
    // creaseMask is identical at all 3 corners of a triangle (a per-face
    // property), matching the vertex-order convention above: component 0 =
    // edge opposite v0 (i.e. v1-v2), component 1 = opposite v1, component 2
    // = opposite v2.
    const cm = [isCrease[t * 3], isCrease[t * 3 + 1], isCrease[t * 3 + 2]];
    for (let c = 0; c < 3; c++) {
      const vi = tIdx[c];
      const o = t * 9 + c * 3;
      positions[o] = posAttr.getX(vi);
      positions[o + 1] = posAttr.getY(vi);
      positions[o + 2] = posAttr.getZ(vi);
      barycentric[o] = BARY[c][0];
      barycentric[o + 1] = BARY[c][1];
      barycentric[o + 2] = BARY[c][2];
      creaseMask[o] = cm[0];
      creaseMask[o + 1] = cm[1];
      creaseMask[o + 2] = cm[2];
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('barycentric', new THREE.BufferAttribute(barycentric, 3));
  geo.setAttribute('creaseMask', new THREE.BufferAttribute(creaseMask, 3));
  return geo;
}

export function computeMeasureMetrics(p1: THREE.Vector3, p2: THREE.Vector3) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.z - p1.z;
  const dist3d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const planLen = Math.sqrt(dx * dx + dy * dy);
  const bearingRad = Math.atan2(dx, dy);
  let bearingDeg = bearingRad * (180 / Math.PI);
  if (bearingDeg < 0) bearingDeg += 360;
  const gradePercent = planLen > 0.001 ? (dz / planLen) * 100 : 0;
  const gradeDeg = planLen > 0.001 ? Math.atan2(Math.abs(dz), planLen) * (180 / Math.PI) : 0;
  return { dist3d, planLen, dz, bearingDeg, gradePercent, gradeDeg };
}
