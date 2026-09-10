export interface ParsedOotSurface {
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export function parseOot(buffer: ArrayBuffer): ParsedOotSurface {
  const view = new DataView(buffer);

  const vertexCount = view.getUint32(0x48, false);
  const triangleCount = view.getUint32(0x60, false);

  const positions = new Float32Array(vertexCount * 3);
  const vertexStart = 0x78;
  for (let i = 0; i < vertexCount; i++) {
    const off = vertexStart + i * 24;
    positions[i * 3] = view.getFloat64(off, false);
    positions[i * 3 + 1] = view.getFloat64(off + 8, false);
    positions[i * 3 + 2] = view.getFloat64(off + 16, false);
  }

  // Matches format.rs::decode_surfaces exactly (see CLAUDE.md's Vulcan .00t
  // Format Specification) — no "8-byte overlap" subtraction. That subtraction
  // was present here previously and is a real bug: it reads triangle indices
  // 8 bytes early, corrupting every triangle in a reference-layer .00t upload.
  const triStart = vertexStart + vertexCount * 24;
  const indices = new Uint32Array(triangleCount * 3);
  for (let i = 0; i < triangleCount; i++) {
    const off = triStart + i * 24;
    indices[i * 3] = view.getUint32(off, false) - 1;
    indices[i * 3 + 1] = view.getUint32(off + 4, false) - 1;
    indices[i * 3 + 2] = view.getUint32(off + 8, false) - 1;
  }

  return { positions, indices, vertexCount, triangleCount };
}
