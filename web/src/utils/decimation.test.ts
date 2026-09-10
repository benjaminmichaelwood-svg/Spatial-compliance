import { describe, it, expect } from 'vitest';
import { decimateGeometry } from './decimation';

/** Builds a flat n x n grid mesh (2 triangles per cell) for testing. */
function buildGrid(n: number, step = 1): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  let vi = 0;
  for (let row = 0; row <= n; row++) {
    for (let col = 0; col <= n; col++) {
      positions[vi++] = col * step;
      positions[vi++] = row * step;
      positions[vi++] = 0;
    }
  }
  const indicesArr: number[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const tl = row * (n + 1) + col;
      const tr = tl + 1;
      const bl = tl + (n + 1);
      const br = bl + 1;
      indicesArr.push(tl, bl, tr, tr, bl, br);
    }
  }
  return { positions, indices: new Uint32Array(indicesArr) };
}

describe('decimateGeometry', () => {
  it('returns the input unchanged when ratio >= 1', () => {
    const { positions, indices } = buildGrid(20);
    const result = decimateGeometry(positions, indices, 1);
    expect(result.positions).toBe(positions);
    expect(result.indices).toBe(indices);
  });

  it('returns the input unchanged for small meshes (< 100 triangles) regardless of ratio', () => {
    const { positions, indices } = buildGrid(5); // 5*5*2 = 50 triangles
    expect(indices.length / 3).toBeLessThan(100);
    const result = decimateGeometry(positions, indices, 0.1);
    expect(result.positions).toBe(positions);
    expect(result.indices).toBe(indices);
  });

  it('reduces triangle count for a large mesh at a low ratio', () => {
    const { positions, indices } = buildGrid(50); // 5000 triangles
    const result = decimateGeometry(positions, indices, 0.1);
    const originalTris = indices.length / 3;
    const newTris = result.indices.length / 3;
    expect(newTris).toBeLessThan(originalTris);
    expect(newTris).toBeGreaterThan(0);
  });

  it('never fabricates vertices — every index in the output stays in bounds', () => {
    const { positions, indices } = buildGrid(60);
    const result = decimateGeometry(positions, indices, 0.2);
    const vertexCount = result.positions.length / 3;
    for (let i = 0; i < result.indices.length; i++) {
      expect(result.indices[i]).toBeLessThan(vertexCount);
      expect(result.indices[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces no degenerate triangles (all three indices distinct)', () => {
    const { positions, indices } = buildGrid(50);
    const result = decimateGeometry(positions, indices, 0.15);
    for (let i = 0; i < result.indices.length; i += 3) {
      const [a, b, c] = [result.indices[i], result.indices[i + 1], result.indices[i + 2]];
      expect(a).not.toBe(b);
      expect(b).not.toBe(c);
      expect(a).not.toBe(c);
    }
  });

  it('keeps decimated vertices within the original mesh bounding box', () => {
    const { positions, indices } = buildGrid(50, 10); // spans [0, 500] in x and y
    const result = decimateGeometry(positions, indices, 0.1);
    for (let i = 0; i < result.positions.length; i += 3) {
      expect(result.positions[i]).toBeGreaterThanOrEqual(-1e-9);
      expect(result.positions[i]).toBeLessThanOrEqual(500 + 1e-9);
      expect(result.positions[i + 1]).toBeGreaterThanOrEqual(-1e-9);
      expect(result.positions[i + 1]).toBeLessThanOrEqual(500 + 1e-9);
    }
  });

  it('handles a flat surface (all Z=0) without producing NaN', () => {
    const { positions, indices } = buildGrid(40);
    const result = decimateGeometry(positions, indices, 0.25);
    for (let i = 0; i < result.positions.length; i++) {
      expect(Number.isNaN(result.positions[i])).toBe(false);
    }
  });
});
