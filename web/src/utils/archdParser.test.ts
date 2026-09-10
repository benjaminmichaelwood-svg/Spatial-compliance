import { describe, it, expect } from 'vitest';
import { parseArchd } from './archdParser';

// Each POLHED entity has TWO 'END' markers: one closing its header block
// (name/group/feature/colour/closed, one `key=value` per line) and a
// second closing its points block. Discovered while writing these tests —
// a POLHED with only one 'END' has its point lines silently swallowed by
// the header-reading loop (which only stops at 'END', not at the first
// non-`key=value` line), producing zero points rather than an error. Every
// fixture below intentionally includes both 'END' markers to match real
// archd file structure.

describe('parseArchd', () => {
  it('parses a single closed POLHED with name/group/feature/colour', () => {
    const text = [
      'POLHED',
      'name=Pit1_Boundary',
      'group=Boundaries',
      'feature=PitCrest',
      'colour=3',
      'closed=1',
      'END',
      '0.0 0.0 100.0',
      '10.0 0.0 100.0',
      '10.0 10.0 100.0',
      '0.0 10.0 100.0',
      'END',
    ].join('\n');

    const result = parseArchd(text);
    expect(result.polylines).toHaveLength(1);
    const p = result.polylines[0];
    expect(p.name).toBe('Pit1_Boundary');
    expect(p.group).toBe('Boundaries');
    expect(p.feature).toBe('PitCrest');
    expect(p.closed).toBe(true);
    expect(p.color).toBe('#00ff00'); // colour index 3
    expect(p.pointCount).toBe(4);
    expect(Array.from(p.points)).toEqual([0, 0, 100, 10, 0, 100, 10, 10, 100, 0, 10, 100]);
  });

  it('parses multiple POLHED blocks in one file', () => {
    const text = [
      'POLHED',
      'name=A',
      'END',
      '0 0 0',
      '1 0 0',
      '1 1 0',
      'END',
      'POLHED',
      'name=B',
      'END',
      '5 5 5',
      '6 5 5',
      '6 6 5',
      'END',
    ].join('\n');

    const result = parseArchd(text);
    expect(result.polylines.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('defaults to white (colour 7) and open when unspecified', () => {
    const text = ['POLHED', 'END', '0 0 0', '1 0 0', '1 1 0', 'END'].join('\n');
    const result = parseArchd(text);
    expect(result.polylines).toHaveLength(1);
    expect(result.polylines[0].color).toBe('#ffffff');
    expect(result.polylines[0].closed).toBe(false);
  });

  it('discards a polyline with fewer than 2 points (< 6 numbers)', () => {
    const text = ['POLHED', 'name=TooShort', 'END', '0 0 0', 'END'].join('\n');
    const result = parseArchd(text);
    expect(result.polylines).toHaveLength(0);
  });

  it('ignores comment lines (# and $) within the point list', () => {
    const text = [
      'POLHED',
      'END',
      '# a comment',
      '0 0 0',
      '$ another comment style',
      '1 0 0',
      '1 1 0',
      'END',
    ].join('\n');
    const result = parseArchd(text);
    expect(result.polylines).toHaveLength(1);
    expect(result.polylines[0].pointCount).toBe(3);
  });

  it('handles CRLF line endings', () => {
    const text = ['POLHED', 'name=CRLF', 'END', '0 0 0', '1 0 0', '1 1 0', 'END'].join('\r\n');
    const result = parseArchd(text);
    expect(result.polylines).toHaveLength(1);
    expect(result.polylines[0].name).toBe('CRLF');
  });

  it('returns no polylines for text with no POLHED blocks', () => {
    const result = parseArchd('just some unrelated text\nwith no markers');
    expect(result.polylines).toEqual([]);
  });

  it('accepts comma-separated coordinates', () => {
    const text = ['POLHED', 'END', '0,0,0', '1,0,0', '1,1,0', 'END'].join('\n');
    const result = parseArchd(text);
    expect(result.polylines).toHaveLength(1);
    expect(result.polylines[0].pointCount).toBe(3);
  });
});
