/**
 * Parser for Vulcan .arch_d string/polyline format.
 *
 * Format: text-based with CRLF line endings.
 * Structure:
 *   FMT_3           — format identifier (first line)
 *   Layer:  NAME    — layer grouping
 *   POLHED:         — start of polyline block
 *   Graphic: N ...  — first number is Vulcan colour code
 *   Named:  TEXT    — optional name
 *   Point: flag E N RL val — 5 whitespace-separated values
 *   End:            — end of POLHED (no text after colon)
 *   End:  LAYER     — end of layer / end of file
 */

const VULCAN_COLORS: Record<number, string> = {
  1: '#ffffff',   // white
  2: '#ff0000',   // red (alt)
  3: '#00ff00',   // green (alt)
  4: '#0000ff',   // blue
  5: '#ffff00',   // yellow
  6: '#ff00ff',   // magenta
  7: '#808080',   // grey
  8: '#c0c0c0',   // light grey
  10: '#800000',  // dark red
  11: '#808000',  // olive
  12: '#008000',  // dark green
  13: '#008080',  // teal
  14: '#000080',  // navy
  15: '#800080',  // purple
  40: '#00ff00',  // green
  82: '#00ffff',  // cyan
  150: '#ff0000', // red
};

export interface ArchdPolyline {
  name: string;
  layer: string;
  color: string;
  points: Float32Array;
  pointCount: number;
  closed: boolean;
}

export interface ArchdLayer {
  name: string;
  polylines: ArchdPolyline[];
}

export interface ParsedArchd {
  layers: ArchdLayer[];
  polylines: ArchdPolyline[];
}

export function parseArchd(text: string): ParsedArchd {
  // Normalise line endings and split
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const allPolylines: ArchdPolyline[] = [];
  const layerMap = new Map<string, ArchdPolyline[]>();

  let currentLayer = 'Default';
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Skip empty and format lines
    if (trimmed === '' || trimmed === 'FMT_3' || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    // Layer: NAME
    if (trimmed.startsWith('Layer:')) {
      const layerName = trimmed.substring(6).trim();
      if (layerName) currentLayer = layerName;
      i++;
      continue;
    }

    // POLHED: — start a new polyline block
    if (trimmed.startsWith('POLHED:') || trimmed === 'POLHED') {
      i++;
      let name = '';
      let colorIdx = 7; // default grey
      const segments: number[][] = []; // each segment is a flat array of [x,y,z, ...]
      let currentSegment: number[] = [];

      while (i < lines.length) {
        const pline = lines[i].trim();

        // End: with nothing after or End: LAYER_NAME = end of POLHED
        if (pline.startsWith('End:') || pline === 'End') {
          break;
        }

        if (pline.startsWith('Graphic:')) {
          // Extract the FIRST number as the Vulcan colour code
          const gParts = pline.substring(8).trim().split(/\s+/);
          if (gParts.length > 0) {
            const code = parseInt(gParts[0]);
            if (!isNaN(code)) colorIdx = code;
          }
          i++;
          continue;
        }

        if (pline.startsWith('Named:')) {
          name = pline.substring(6).trim();
          i++;
          continue;
        }

        if (pline.startsWith('Point:')) {
          // Point: flag Easting Northing RL Value
          const parts = pline.substring(6).trim().split(/\s+/);
          if (parts.length >= 4) {
            const flag = parseInt(parts[0]);
            const easting = parseFloat(parts[1]);  // X
            const northing = parseFloat(parts[2]); // Y
            const rl = parseFloat(parts[3]);        // Z

            if (isFinite(easting) && isFinite(northing) && isFinite(rl)) {
              if (flag === 0) {
                // Start a new segment — save previous if it has points
                if (currentSegment.length >= 6) {
                  segments.push(currentSegment);
                }
                currentSegment = [easting, northing, rl];
              } else {
                // flag === 1 — continue from previous point
                currentSegment.push(easting, northing, rl);
              }
            }
          }
          i++;
          continue;
        }

        i++;
      }

      // Save final segment
      if (currentSegment.length >= 6) {
        segments.push(currentSegment);
      }

      // Skip End: line
      if (i < lines.length && (lines[i].trim().startsWith('End:') || lines[i].trim() === 'End')) {
        i++;
      }

      const color = VULCAN_COLORS[colorIdx] || '#808080';

      // Each segment becomes a separate polyline (segment flag 0 starts new)
      for (const seg of segments) {
        const pointCount = seg.length / 3;
        if (pointCount < 2) continue;
        const pl: ArchdPolyline = {
          name,
          layer: currentLayer,
          color,
          points: new Float32Array(seg),
          pointCount,
          closed: false,
        };
        allPolylines.push(pl);
        if (!layerMap.has(currentLayer)) layerMap.set(currentLayer, []);
        layerMap.get(currentLayer)!.push(pl);
      }
    } else {
      i++;
    }
  }

  const layers: ArchdLayer[] = [];
  for (const [lname, pls] of layerMap) {
    layers.push({ name: lname, polylines: pls });
  }

  return { layers, polylines: allPolylines };
}
