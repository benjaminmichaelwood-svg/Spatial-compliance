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
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const targetTris = triCount * ratio;
  const gridSize = Math.max(Math.ceil(Math.sqrt(targetTris * 0.5)), 2);
  const cellW = rangeX / gridSize;
  const cellH = rangeY / gridSize;

  const vertexToCell = new Uint32Array(vertexCount);
  const cellSumX = new Float64Array(gridSize * gridSize);
  const cellSumY = new Float64Array(gridSize * gridSize);
  const cellSumZ = new Float64Array(gridSize * gridSize);
  const cellCount = new Uint32Array(gridSize * gridSize);
  const cellNewIdx = new Int32Array(gridSize * gridSize).fill(-1);

  for (let i = 0; i < vertexCount; i++) {
    const cx = Math.min(Math.floor((positions[i * 3] - minX) / cellW), gridSize - 1);
    const cy = Math.min(Math.floor((positions[i * 3 + 1] - minY) / cellH), gridSize - 1);
    const key = cy * gridSize + cx;
    vertexToCell[i] = key;
    cellSumX[key] += positions[i * 3];
    cellSumY[key] += positions[i * 3 + 1];
    cellSumZ[key] += positions[i * 3 + 2];
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

  const newIndicesArr: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = cellNewIdx[vertexToCell[indices[i]]];
    const b = cellNewIdx[vertexToCell[indices[i + 1]]];
    const c = cellNewIdx[vertexToCell[indices[i + 2]]];
    if (a !== b && b !== c && a !== c) {
      newIndicesArr.push(a, b, c);
    }
  }

  return {
    positions: newPositions,
    indices: new Uint32Array(newIndicesArr),
  };
}
