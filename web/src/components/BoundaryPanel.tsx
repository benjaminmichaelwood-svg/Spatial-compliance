import { useCallback, useRef, useState } from 'react';
import type { BoundaryRegion } from '../types';
import { parseDxf, extractBoundaryFromSurfaceJson, parseSurfaces } from '../wasm';

interface Props {
  boundaries: BoundaryRegion[];
  onChange: (boundaries: BoundaryRegion[]) => void;
  onStartDraw: () => void;
  isDrawing: boolean;
}

export default function BoundaryPanel({ boundaries, onChange, onStartDraw, isDrawing }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setError(null);
      setLoading(true);
      console.log('[BoundaryPanel] File selected:', file.name, 'size:', file.size);

      try {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'dxf') {
          console.log('[BoundaryPanel] Parsing DXF file...');
          const text = await file.text();
          console.log('[BoundaryPanel] DXF text length:', text.length);
          const regions = await parseDxf(text);
          console.log('[BoundaryPanel] DXF parsed, regions:', regions.length);
          if (regions.length === 0) {
            setError('No polygons found in DXF file.');
          } else {
            onChange([...boundaries, ...regions]);
          }
        } else {
          console.log('[BoundaryPanel] Parsing surface file for boundary extraction...');
          const buf = new Uint8Array(await file.arrayBuffer());
          const surfaces = parseSurfaces(buf);
          console.log('[BoundaryPanel] Surfaces parsed:', surfaces.length);
          if (surfaces.length > 0) {
            const region = await extractBoundaryFromSurfaceJson(surfaces[0]);
            region.name = file.name.replace(/\.[^.]+$/, '');
            console.log('[BoundaryPanel] Boundary extracted:', region.name, 'points:', region.polygon.length);
            onChange([...boundaries, region]);
          } else {
            setError('No surfaces found in file.');
          }
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.error('[BoundaryPanel] Failed to parse boundary file:', msg);
        setError(msg);
      } finally {
        setLoading(false);
      }

      if (fileRef.current) fileRef.current.value = '';
    },
    [boundaries, onChange],
  );

  const handleDelete = useCallback(
    (idx: number) => {
      onChange(boundaries.filter((_, i) => i !== idx));
    },
    [boundaries, onChange],
  );

  const handleRename = useCallback(
    (idx: number) => {
      const updated = [...boundaries];
      updated[idx] = { ...updated[idx], name: editName };
      onChange(updated);
      setEditIdx(null);
    },
    [boundaries, editName, onChange],
  );

  return (
    <div className="sidebar-section">
      <div className="sidebar-heading">Boundaries</div>

      <div className="flex gap-1.5 mb-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex-1 rounded bg-white/5 px-2 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:bg-white/10"
        >
          Upload DXF / .00t
        </button>
        <button
          type="button"
          onClick={onStartDraw}
          disabled={isDrawing}
          className="flex-1 rounded bg-white/5 px-2 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          {isDrawing ? 'Drawing…' : 'Draw Polygon'}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="*/*"
        onChange={handleFile}
        className="hidden"
      />

      {loading && (
        <p className="text-[11px] text-indigo-400 mb-1">Loading boundary file…</p>
      )}

      {error && (
        <div className="mb-1 rounded bg-red-900/40 px-2 py-1.5 text-[11px] text-red-300">
          {error}
        </div>
      )}

      {boundaries.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">No boundaries defined</p>
      ) : (
        <div className="space-y-1">
          {boundaries.map((b, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1.5"
            >
              {editIdx === i ? (
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => handleRename(i)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRename(i)}
                  autoFocus
                  className="flex-1 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
                />
              ) : (
                <span
                  className="flex-1 cursor-pointer truncate text-xs text-slate-300"
                  onDoubleClick={() => {
                    setEditIdx(i);
                    setEditName(b.name);
                  }}
                >
                  {b.name}
                </span>
              )}
              <span className="text-[10px] text-slate-500">
                {b.polygon.length}pt
              </span>
              <button
                type="button"
                onClick={() => handleDelete(i)}
                className="text-slate-500 transition-colors hover:text-red-400"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
