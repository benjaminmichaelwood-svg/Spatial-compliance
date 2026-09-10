import { describe, it, expect } from 'vitest';
import { parseOot } from './ootParser';

/**
 * Builds a minimal, spec-correct .00t buffer: 128-byte header with
 * vertex_count @ 0x48 and triangle_count @ 0x60 (both big-endian u32),
 * vertex data from 0x78 (24 bytes/vertex: 3 x BE f64), then triangle data
 * immediately after — NO gap or overlap (see CLAUDE.md's Vulcan .00t
 * Format Specification, and format.rs::decode_surfaces, the authoritative,
 * empirically-validated implementation this mirrors).
 */
function buildOotBuffer(vertices: [number, number, number][], triangles1Indexed: [number, number, number][]): ArrayBuffer {
  const vertexStart = 0x78;
  const triStart = vertexStart + vertices.length * 24;
  const size = triStart + triangles1Indexed.length * 24;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);

  view.setUint32(0x48, vertices.length, false);
  view.setUint32(0x60, triangles1Indexed.length, false);

  vertices.forEach((v, i) => {
    const off = vertexStart + i * 24;
    view.setFloat64(off, v[0], false);
    view.setFloat64(off + 8, v[1], false);
    view.setFloat64(off + 16, v[2], false);
  });

  triangles1Indexed.forEach((t, i) => {
    const off = triStart + i * 24;
    view.setUint32(off, t[0], false);
    view.setUint32(off + 4, t[1], false);
    view.setUint32(off + 8, t[2], false);
    // remaining 12 bytes of padding left as zero
  });

  return buf;
}

describe('parseOot', () => {
  it('parses vertex count and positions correctly', () => {
    // Small local coordinates, not mine-scale eastings — parseOot's output
    // is a Float32Array (24-bit mantissa, ~7.2 significant decimal digits),
    // so a real mine coordinate like 7331000.25 cannot round-trip exactly
    // through it (7331000 alone already uses ~23 of those 24 bits). That's
    // an inherent, accepted precision tradeoff of the render-only flat
    // buffer (see CLAUDE.md — WASM mesh transfer is always f32 for
    // rendering; volume computation itself stays f64 in Rust), not
    // something this test is meant to probe — so it uses values that
    // round-trip exactly through float32 instead of fighting that limit.
    const vertices: [number, number, number][] = [
      [100.5, 200.25, 10.0],
      [110.5, 200.25, 11.0],
      [110.5, 210.25, 12.0],
      [100.5, 210.25, 13.0],
    ];
    const buf = buildOotBuffer(vertices, [[1, 2, 3], [1, 3, 4]]);
    const parsed = parseOot(buf);

    expect(parsed.vertexCount).toBe(4);
    for (let i = 0; i < vertices.length; i++) {
      expect(parsed.positions[i * 3]).toBeCloseTo(vertices[i][0], 3);
      expect(parsed.positions[i * 3 + 1]).toBeCloseTo(vertices[i][1], 3);
      expect(parsed.positions[i * 3 + 2]).toBeCloseTo(vertices[i][2], 3);
    }
  });

  it('parses triangle indices correctly and converts them to 0-indexed', () => {
    // Regression test for a real bug: parseOot previously computed
    // triStart with an incorrect "- 8" byte overlap subtraction, which
    // read every triangle's indices 8 bytes early — silently corrupting
    // every triangle in any real reference-layer .00t upload. This test
    // would have failed against that buggy version (it would decode the
    // trailing bytes of the last vertex as the first triangle's indices
    // instead of the real triangle data).
    const vertices: [number, number, number][] = [
      [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [5, 5, 5],
    ];
    // 1-indexed, as .00t stores them
    const triangles1Indexed: [number, number, number][] = [
      [1, 2, 3],
      [1, 3, 4],
      [2, 5, 3],
    ];
    const buf = buildOotBuffer(vertices, triangles1Indexed);
    const parsed = parseOot(buf);

    expect(parsed.triangleCount).toBe(3);
    expect(Array.from(parsed.indices)).toEqual([0, 1, 2, 0, 2, 3, 1, 4, 2]);
  });

  it('places triangle data with no gap or overlap after vertex data', () => {
    // A file sized exactly to the spec-correct triStart (no "-8") must
    // parse cleanly with no out-of-bounds DataView reads.
    const vertices: [number, number, number][] = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const buf = buildOotBuffer(vertices, [[1, 2, 3]]);
    expect(buf.byteLength).toBe(0x78 + 3 * 24 + 1 * 24);
    expect(() => parseOot(buf)).not.toThrow();
  });

  it('handles a surface with zero triangles', () => {
    const buf = buildOotBuffer([[0, 0, 0], [1, 0, 0], [0, 1, 0]], []);
    const parsed = parseOot(buf);
    expect(parsed.triangleCount).toBe(0);
    expect(parsed.indices.length).toBe(0);
    expect(parsed.vertexCount).toBe(3);
  });
});
