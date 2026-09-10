import { useCallback, useRef, useState } from 'react';
import type { ReferenceLayer, RefLayerStyle } from '../types';
import { parseOot } from '../utils/ootParser';
import { parseDxf } from '../utils/dxfRefParser';
import { parseArchd } from '../utils/archdParser';

// Split out of App.tsx (Priority 19: behavior-preserving file breakup — no
// logic changes). Reference layers (dropped .00t/.dxf/.arch_d overlay
// files — see Viewer.tsx's onRefDrop handling) are self-contained: nothing
// outside this feature reads or writes `refLayers`/`refIdRef`, so this is a
// clean hook boundary with no cross-cutting state to thread through.
export function useReferenceLayers() {
  const [refLayers, setRefLayers] = useState<ReferenceLayer[]>([]);
  const refIdRef = useRef(0);

  const handleRefDrop = useCallback(async (files: FileList) => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const id = `ref-${++refIdRef.current}`;
      const defaultStyle: RefLayerStyle = { color: '#cccccc', opacity: 0.6, wireframe: false, lineWidth: 2, lineDash: [] };

      try {
        if (ext === '00t') {
          const buf = await file.arrayBuffer();
          const parsed = parseOot(buf);
          setRefLayers(prev => [...prev, {
            id, fileName: file.name, kind: 'surface', visible: true,
            style: { ...defaultStyle, color: '#9ca3af' },
            surface: parsed,
          }]);
        } else if (ext === 'dxf') {
          const text = await file.text();
          const parsed = parseDxf(text);
          if (parsed.surfaces.length > 0) {
            for (const surf of parsed.surfaces) {
              const sid = `ref-${++refIdRef.current}`;
              setRefLayers(prev => [...prev, {
                id: sid, fileName: file.name, kind: 'surface', visible: true,
                style: { ...defaultStyle, color: '#9ca3af' },
                surface: surf,
              }]);
            }
          }
          if (parsed.polylines.length > 0) {
            setRefLayers(prev => [...prev, {
              id, fileName: file.name, kind: 'lines', visible: true,
              style: defaultStyle,
              polylines: parsed.polylines.map(p => ({
                points: p.points, pointCount: p.pointCount, closed: p.closed,
                color: p.color, layer: p.layer, name: p.layer || file.name,
              })),
            }]);
          }
        } else if (ext === 'arch_d') {
          const text = await file.text();
          const parsed = parseArchd(text);
          if (parsed.polylines.length > 0) {
            setRefLayers(prev => [...prev, {
              id, fileName: file.name, kind: 'lines', visible: true,
              style: defaultStyle,
              polylines: parsed.polylines.map(p => ({
                points: p.points, pointCount: p.pointCount, closed: p.closed,
                color: p.color, layer: p.group || p.feature, name: p.name || p.feature,
              })),
            }]);
          }
        }
      } catch (err) {
        console.error(`Failed to parse reference file ${file.name}:`, err);
      }
    }
  }, []);

  const handleRefToggle = useCallback((id: string) => {
    setRefLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  }, []);

  const handleRefStyleChange = useCallback((id: string, style: RefLayerStyle) => {
    setRefLayers(prev => prev.map(l => l.id === id ? { ...l, style } : l));
  }, []);

  const handleRefRemove = useCallback((id: string) => {
    setRefLayers(prev => prev.filter(l => l.id !== id));
  }, []);

  // Only external reset need (the "back to landing" button clears every
  // feature's state, this feature's included) — exposed rather than
  // exposing setRefLayers itself, to keep this hook's write surface
  // limited to actions that make sense for a caller to take.
  const resetRefLayers = useCallback(() => setRefLayers([]), []);

  return { refLayers, handleRefDrop, handleRefToggle, handleRefStyleChange, handleRefRemove, resetRefLayers };
}
