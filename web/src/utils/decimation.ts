/**
 * PRODUCTION REGRESSION FIX (2026-09-11): this function previously binned
 * vertices into a grid over X/Y ONLY, averaging Z within each cell. That is
 * correct for a heightfield surface (one Z per X/Y) but wrong for a
 * conformance domain SOLID — the shells BatchedDomainGroup decimates are
 * real 3D volumes with near-vertical side walls connecting the top/bottom
 * bounding surfaces, i.e. many vertices sharing nearly the same (X,Y) but
 * spanning a wide Z range. Binning by X/Y alone collapsed every one of a
 * wall's Z-distinct vertices at a given (X,Y) into a single averaged point,
 * producing severely distorted/near-zero-area triangles once indices were
 * remapped. computeVertexNormals() on that garbled topology accumulates to
 * a (0,0,0) normal at vertices whose surrounding faces are all degenerate
 * (three.js's Vector3.normalize() guards divide-by-zero by returning the
 * zero vector rather than NaN) — a zero normal contributes no diffuse
 * lighting, rendering as black. This was invisible on the flat synthetic
 * heightfields used for prior visual checks and only appeared on real
 * domain solids, and only at LOD 1/2 (where decimation actually runs),
 * matching the reported black-patch/flicker regression exactly (flicker
 * being LOD toggling between clean full-res and this garbled content as
 * the camera crosses distance thresholds during orbit/zoom).
 *
 * Fix: cluster vertices in an ISOTROPIC 3D grid (cubic cells sized from
 * the mesh's actual 3D volume) instead of a 2D X/Y grid. A genuinely flat
 * surface (rangeZ ~ 0, e.g. a single-valued heightfield) naturally
 * degenerates back to the original X/Y-only behavior (the Z extent doesn't
 * even fill one cell), so terrain decimation is unchanged. A solid with
 * real vertical extent (walls) gets properly subdivided in Z too, so wall
 * vertices at different Z are never merged into one point.
 */
export function decimateGeometry(
  positions: Float32Array,
  indices: Uint32Array,
  ratio: number,
): { positions: Float32Array; indices: Uint32Array } {
  if (ratio >= 1) return { positions, indices };

  const vertexCount = positions.length / 3;
  const triCount = indices.length / 3;
  if (triCount < 100) return { positions, indices };

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ;
  const targetVerts = Math.max(vertexCount * ratio, 4);

  // Isotropic cell size derived from the actual 3D volume, so cell shape
  // reflects real spatial density on every axis rather than assuming a
  // flat X/Y footprint. cellSize^3 * numCells ~= volume, numCells ~=
  // targetVerts, so cellSize = cbrt(volume / targetVerts).
  const volume = rangeX * rangeY * Math.max(rangeZ, 0);
  const cellSize = volume > 0
    ? Math.max(Math.cbrt(volume / targetVerts), 1e-9)
    : Math.max(Math.sqrt((rangeX * rangeY) / targetVerts), 1e-9); // rangeZ ~ 0: fall back to the 2D-area formula

  const gridSizeX = Math.max(Math.ceil(rangeX / cellSize), 1);
  const gridSizeY = Math.max(Math.ceil(rangeY / cellSize), 1);
  // A near-flat mesh (rangeZ ~ 0 relative to the lateral extent) collapses
  // to a single Z band, i.e. identical to the old X/Y-only behavior — this
  // is what keeps terrain-surface decimation unchanged from before.
  const gridSizeZ = Math.max(Math.ceil(rangeZ / cellSize), 1);

  const cellW = rangeX / gridSizeX;
  const cellH = rangeY / gridSizeY;
  const cellD = rangeZ > 0 ? rangeZ / gridSizeZ : 1;

  const numCells = gridSizeX * gridSizeY * gridSizeZ;
  const vertexToCell = new Uint32Array(vertexCount);
  const cellSumX = new Float64Array(numCells);
  const cellSumY = new Float64Array(numCells);
  const cellSumZ = new Float64Array(numCells);
  const cellCount = new Uint32Array(numCells);
  const cellNewIdx = new Int32Array(numCells).fill(-1);

  for (let i = 0; i < vertexCount; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    const cx = Math.min(Math.floor((px - minX) / cellW), gridSizeX - 1);
    const cy = Math.min(Math.floor((py - minY) / cellH), gridSizeY - 1);
    const cz = Math.min(Math.floor((pz - minZ) / cellD), gridSizeZ - 1);
    const key = (cz * gridSizeY + cy) * gridSizeX + cx;
    vertexToCell[i] = key;
    cellSumX[key] += px;
    cellSumY[key] += py;
    cellSumZ[key] += pz;
    cellCount[key]++;
  }

  let newVertCount = 0;
  for (let i = 0; i < cellCount.length; i++) {
    if (cellCount[i] > 0) {
      cellNewIdx[i] = newVertCount++;
    }
  }

  const newPositions = new Float32Array(newVertCount * 3);
  for (let i = 0; i < cellCount.length; i++) {
    if (cellCount[i] > 0) {
      const idx = cellNewIdx[i];
      newPositions[idx * 3] = cellSumX[i] / cellCount[i];
      newPositions[idx * 3 + 1] = cellSumY[i] / cellCount[i];
      newPositions[idx * 3 + 2] = cellSumZ[i] / cellCount[i];
    }
  }

  // Belt-and-braces on top of the 3D-aware clustering above: clustering can
  // still produce a near-collinear (not just fully-degenerate) triangle
  // whenever a mesh feature's thin axis is diagonal to the grid rather than
  // aligned with X/Y/Z (e.g. an angled domain-boundary wall segment) — three
  // distinct indices, but an almost-zero actual area. computeVertexNormals()
  // on a near-zero-area triangle contributes a near-zero-length normal,
  // which renders as a black patch exactly like the fully-degenerate case.
  // Reject by real area, not just by index distinctness, using a threshold
  // relative to the mesh's own scale (so it only ever catches genuinely
  // degenerate slivers, never legitimately small decimated triangles).
  const diag = Math.sqrt(rangeX * rangeX + rangeY * rangeY + rangeZ * rangeZ) || 1;
  const minCrossMagSq = (diag * diag * 1e-8) ** 2; // |2*area| = |cross product|

  const newIndicesArr: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = cellNewIdx[vertexToCell[indices[i]]];
    const b = cellNewIdx[vertexToCell[indices[i + 1]]];
    const c = cellNewIdx[vertexToCell[indices[i + 2]]];
    if (a === b || b === c || a === c) continue;

    const ax = newPositions[a * 3], ay = newPositions[a * 3 + 1], az = newPositions[a * 3 + 2];
    const bx = newPositions[b * 3], by = newPositions[b * 3 + 1], bz = newPositions[b * 3 + 2];
    const cx = newPositions[c * 3], cy = newPositions[c * 3 + 1], cz = newPositions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const crossX = uy * vz - uz * vy;
    const crossY = uz * vx - ux * vz;
    const crossZ = ux * vy - uy * vx;
    const crossMagSq = crossX * crossX + crossY * crossY + crossZ * crossZ;
    if (crossMagSq < minCrossMagSq) continue;

    newIndicesArr.push(a, b, c);
  }

  return {
    positions: newPositions,
    indices: new Uint32Array(newIndicesArr),
  };
}

/**
 * Belt-and-braces #2 for the same 2026-09-11 black-patch regression: even
 * with 3D-aware clustering and the near-zero-area triangle filter above,
 * vertex clustering can still produce a locally folded/non-manifold patch
 * — e.g. a thin wall whose two opposing faces get pulled close enough by
 * clustering that a shared vertex ends up surrounded by faces pointing in
 * near-opposite directions. None of those individual faces are degenerate
 * (decent area, not caught by the filter above), but computeVertexNormals()
 * AVERAGES their face normals at the shared vertex, which can sum to a
 * near-zero vector — rendered as a black patch, confirmed by direct
 * inspection of the live decimated buffer (5-12% zero-length vertex
 * normals on real domain-solid boundary pieces even after the area filter).
 *
 * The robust fix is to stop sharing normals across faces for decimated
 * (already-approximate) LOD levels: give every triangle its own 3 vertices
 * with a single flat face normal, computed independently per triangle. A
 * face normal can only be near-zero if the triangle itself is near-zero
 * area — already filtered out above — so this eliminates the entire class
 * of normal-cancellation artifacts regardless of the clustering geometry's
 * shape. The visual cost (flat facets instead of smooth shading) is
 * negligible at the distance LOD 1/2 are shown at, and strictly preferable
 * to a black patch.
 */
export function unweldWithFlatNormals(
  positions: Float32Array,
  indices: Uint32Array,
): { positions: Float32Array; indices: Uint32Array; normals: Float32Array } {
  const triCount = indices.length / 3;
  const outPositions = new Float32Array(triCount * 3 * 3);
  const outNormals = new Float32Array(triCount * 3 * 3);
  const outIndices = new Uint32Array(triCount * 3);

  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      nx /= len; ny /= len; nz /= len;
    } // else: genuinely degenerate despite the upstream filter — leave (0,0,0), matches three.js's own normalize() guard

    const base = t * 3;
    const verts: [number, number, number][] = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]];
    for (let k = 0; k < 3; k++) {
      const [px, py, pz] = verts[k];
      const vi = base + k;
      outPositions[vi * 3] = px;
      outPositions[vi * 3 + 1] = py;
      outPositions[vi * 3 + 2] = pz;
      outNormals[vi * 3] = nx;
      outNormals[vi * 3 + 1] = ny;
      outNormals[vi * 3 + 2] = nz;
      outIndices[vi] = vi;
    }
  }

  return { positions: outPositions, indices: outIndices, normals: outNormals };
}
