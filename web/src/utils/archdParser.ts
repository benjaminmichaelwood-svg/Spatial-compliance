const VULCAN_COLORS: Record<number, string> = {
  0: '#000000', 1: '#ff0000', 2: '#ffff00', 3: '#00ff00',
  4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#ffffff',
  8: '#808080', 9: '#c0c0c0', 10: '#800000', 11: '#808000',
  12: '#008000', 13: '#008080', 14: '#000080', 15: '#800080',
};

export interface ArchdPolyline {
  name: string;
  group: string;
  feature: string;
  color: string;
  points: Float32Array;
  pointCount: number;
  closed: boolean;
}

export interface ParsedArchd {
  polylines: ArchdPolyline[];
}

export function parseArchd(text: string): ParsedArchd {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const polylines: ArchdPolyline[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === 'POLHED' || line.startsWith('POLHED')) {
      let name = '';
      let group = '';
      let feature = '';
      let colorIdx = 7;
      let closed = false;
      i++;

      while (i < lines.length) {
        const hline = lines[i].trim();
        if (hline === 'END') { i++; break; }

        const eqIdx = hline.indexOf('=');
        if (eqIdx > 0) {
          const key = hline.substring(0, eqIdx).trim().toLowerCase();
          const val = hline.substring(eqIdx + 1).trim();
          if (key === 'name' || key === 'object_name') name = val;
          else if (key === 'group' || key === 'group_name') group = val;
          else if (key === 'feature' || key === 'feature_name') feature = val;
          else if (key === 'colour' || key === 'color') colorIdx = parseInt(val) || 7;
          else if (key === 'closed') closed = val === '1' || val.toLowerCase() === 'true';
        }
        i++;
      }

      const pts: number[] = [];
      while (i < lines.length) {
        const pline = lines[i].trim();
        if (pline === 'END' || pline === 'POLHED' || pline.startsWith('POLHED')) break;
        if (pline === '' || pline.startsWith('#') || pline.startsWith('$')) { i++; continue; }

        const parts = pline.split(/[\s,]+/).map(Number);
        if (parts.length >= 3 && isFinite(parts[0]) && isFinite(parts[1]) && isFinite(parts[2])) {
          pts.push(parts[0], parts[1], parts[2]);
        }
        i++;
      }
      if (lines[i]?.trim() === 'END') i++;

      if (pts.length >= 6) {
        polylines.push({
          name,
          group,
          feature,
          color: VULCAN_COLORS[colorIdx] || '#ffffff',
          points: new Float32Array(pts),
          pointCount: pts.length / 3,
          closed,
        });
      }
    } else {
      i++;
    }
  }

  return { polylines };
}
