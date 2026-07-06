import { useCallback, useRef } from 'react';
import type { SurfaceRole, UploadedSurface } from '../types';
import { SURFACE_ROLES } from '../types';

interface Props {
  uploads: Map<SurfaceRole, UploadedSurface>;
  onFileSelected: (role: SurfaceRole, file: File) => void;
  onLoadSample: () => void;
  decimationWarnings: Map<SurfaceRole, number>;
}

export default function UploadZone({ uploads, onFileSelected, onLoadSample, decimationWarnings }: Props) {
  const fileInputRefs = useRef<Map<SurfaceRole, HTMLInputElement>>(new Map());

  const handleDrop = useCallback(
    (role: SurfaceRole) => (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (file) onFileSelected(role, file);
    },
    [onFileSelected],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const assignedCount = uploads.size;
  const canRun = assignedCount >= 2;

  return (
    <div className="sidebar-section">
      <div className="flex items-center justify-between">
        <div className="sidebar-heading">Surfaces</div>
        <span className={`text-[10px] ${canRun ? 'text-emerald-400' : 'text-slate-500'}`}>
          {assignedCount}/5 assigned{assignedCount < 2 ? ' (min 2)' : ''}
        </span>
      </div>

      <div className="space-y-2">
        {SURFACE_ROLES.map(({ key, label }) => {
          const entry = uploads.get(key);
          const warning = decimationWarnings.get(key);
          return (
            <div
              key={key}
              onDrop={handleDrop(key)}
              onDragOver={handleDragOver}
              onClick={() => fileInputRefs.current.get(key)?.click()}
              className={`group flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs transition-colors ${
                entry
                  ? warning
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-slate-600 hover:border-slate-400 hover:bg-white/5'
              }`}
            >
              <div
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  entry
                    ? warning
                      ? 'bg-amber-500 text-white'
                      : 'bg-emerald-500 text-white'
                    : 'bg-slate-700 text-slate-400'
                }`}
              >
                {entry ? (
                  warning ? (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" />
                    </svg>
                  ) : (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )
                ) : (
                  SURFACE_ROLES.findIndex((r) => r.key === key) + 1
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-slate-300">{label}</span>
                  {!entry && (
                    <span className="text-[9px] text-slate-600">Optional</span>
                  )}
                </div>
                {entry && (
                  <div className="truncate text-[10px] text-slate-500">
                    {entry.fileName}
                    {warning && (
                      <span className="ml-1 text-amber-400">
                        ({(warning / 1000).toFixed(0)}K tris)
                      </span>
                    )}
                  </div>
                )}
              </div>

              {!entry && (
                <span className="text-[10px] text-slate-600 group-hover:text-slate-400">
                  Drop file
                </span>
              )}

              <input
                ref={(el) => {
                  if (el) fileInputRefs.current.set(key, el);
                }}
                type="file"
                accept="*/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFileSelected(key, file);
                  e.target.value = '';
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onLoadSample}
          className="text-[11px] text-indigo-400 transition-colors hover:text-indigo-300"
        >
          Load sample data
        </button>
        {canRun && (
          <span className="ml-auto text-[10px] text-emerald-400">
            {assignedCount === 5 ? 'All surfaces assigned' : 'Ready to run'}
          </span>
        )}
      </div>
    </div>
  );
}
