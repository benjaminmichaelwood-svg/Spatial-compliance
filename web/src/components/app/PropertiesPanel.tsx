import { SURFACE_ROLES } from '../../types';
import type { SelectionInfo } from '../Viewer';

// Split out of App.tsx (Priority 19: behavior-preserving file breakup — no
// logic changes; JSX moved verbatim).
function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}

interface Props {
  selectionInfo: SelectionInfo;
  onClose: () => void;
}

export default function PropertiesPanel({ selectionInfo, onClose }: Props) {
  return (
    <div className="flex w-56 flex-shrink-0 flex-col border-l border-slate-700 bg-slate-900 text-slate-200">
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Properties</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Type</div>
          <div className="text-xs font-medium">{selectionInfo.type === 'domain' ? 'Conformance Solid' : 'Input Surface'}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Name</div>
          <div className="text-xs font-medium">{selectionInfo.label}</div>
        </div>
        {selectionInfo.volume !== undefined && selectionInfo.volume > 0 && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Volume</div>
            <div className="text-xs font-mono">{formatVolume(selectionInfo.volume)} m³</div>
          </div>
        )}
        {selectionInfo.blockName && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Block</div>
            <div className="text-xs font-medium">{selectionInfo.blockName}</div>
          </div>
        )}
        {selectionInfo.domain && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Domain</div>
            <div className="text-xs font-medium">{selectionInfo.domain}</div>
          </div>
        )}
        {selectionInfo.surfaceFileName && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">File</div>
            <div className="text-xs font-mono truncate">{selectionInfo.surfaceFileName}</div>
          </div>
        )}
        {selectionInfo.surfaceRole && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Role</div>
            <div className="text-xs font-medium">
              {SURFACE_ROLES.find((r) => r.key === selectionInfo.surfaceRole)?.label ?? selectionInfo.surfaceRole}
            </div>
          </div>
        )}
        {selectionInfo.vertexCount !== undefined && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Vertices</div>
            <div className="text-xs font-mono">{selectionInfo.vertexCount.toLocaleString()}</div>
          </div>
        )}
        {selectionInfo.triangleCount !== undefined && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Triangles</div>
            <div className="text-xs font-mono">{selectionInfo.triangleCount.toLocaleString()}</div>
          </div>
        )}
        {selectionInfo.bbox && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Bounding Box</div>
            <div className="grid grid-cols-[auto_1fr_1fr] gap-x-1.5 gap-y-0.5 text-[10px] font-mono">
              <span className="text-slate-500">E</span>
              <span className="text-slate-300">{selectionInfo.bbox.minX.toFixed(1)}</span>
              <span className="text-slate-300">{selectionInfo.bbox.maxX.toFixed(1)}</span>
              <span className="text-slate-500">N</span>
              <span className="text-slate-300">{selectionInfo.bbox.minY.toFixed(1)}</span>
              <span className="text-slate-300">{selectionInfo.bbox.maxY.toFixed(1)}</span>
              <span className="text-slate-500">RL</span>
              <span className="text-slate-300">{selectionInfo.bbox.minZ.toFixed(1)}</span>
              <span className="text-slate-300">{selectionInfo.bbox.maxZ.toFixed(1)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
