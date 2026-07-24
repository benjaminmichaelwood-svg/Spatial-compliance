import { useState, useRef, useCallback } from 'react';
import type { ConformanceResult, SurfaceRole, UploadedSurface, ObjectStyle, HeatmapMode } from '../types';
import { SURFACE_ROLES } from '../types';

const DEFAULT_SURFACE_COLORS: Record<SurfaceRole, string> = {
  production_start: '#94a3b8',
  production_end: '#64748b',
  schedule_start: '#7dd3fc',
  schedule_end: '#38bdf8',
  schedule_future: '#a78bfa',
};

interface Props {
  result: ConformanceResult;
  visible: Set<string>;
  onToggle: (domain: string) => void;
  uploads: Map<SurfaceRole, UploadedSurface>;
  surfaceVisible: Set<SurfaceRole>;
  onToggleSurface: (role: SurfaceRole) => void;
  domainStyles: Map<string, ObjectStyle>;
  surfaceStyles: Map<SurfaceRole, ObjectStyle>;
  onDomainStyleChange: (domain: string, style: ObjectStyle) => void;
  onSurfaceStyleChange: (role: SurfaceRole, style: ObjectStyle) => void;
  heatmapMode: HeatmapMode | null;
  onHeatmapModeChange: (mode: HeatmapMode | null) => void;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}

function StyleControls({
  style,
  onChange,
}: {
  style: ObjectStyle;
  onChange: (s: ObjectStyle) => void;
}) {
  const [localOpacity, setLocalOpacity] = useState(Math.round(style.opacity * 100));
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const colorDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const debouncedOpacity = useCallback((value: number) => {
    setLocalOpacity(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange({ ...style, opacity: value / 100 });
    }, 100);
  }, [style, onChange]);

  const debouncedColor = useCallback((color: string) => {
    clearTimeout(colorDebounceRef.current);
    colorDebounceRef.current = setTimeout(() => {
      onChange({ ...style, color });
    }, 100);
  }, [style, onChange]);

  return (
    <div className="mt-1.5 flex items-center gap-2 pl-5">
      <input
        type="color"
        value={style.color}
        onChange={(e) => debouncedColor(e.target.value)}
        className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
        title="Color"
      />
      <input
        type="range"
        min={0}
        max={100}
        value={localOpacity}
        onChange={(e) => debouncedOpacity(Number(e.target.value))}
        className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-slate-600 accent-indigo-400"
        title={`Opacity: ${localOpacity}%`}
      />
      <span className="text-[9px] text-slate-500 w-7">{localOpacity}%</span>
      <button
        type="button"
        onClick={() => onChange({ ...style, wireframe: !style.wireframe })}
        className={`rounded px-1 py-0.5 text-[9px] transition-colors ${
          style.wireframe
            ? 'bg-indigo-500/30 text-indigo-300'
            : 'bg-slate-700/50 text-slate-500 hover:text-slate-300'
        }`}
        title="Toggle edge traces"
      >
        Edges
      </button>
    </div>
  );
}

export default function LayerPanel({
  result, visible, onToggle, uploads, surfaceVisible, onToggleSurface,
  domainStyles, surfaceStyles, onDomainStyleChange, onSurfaceStyleChange,
  heatmapMode, onHeatmapModeChange,
}: Props) {
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [expandedSurface, setExpandedSurface] = useState<SurfaceRole | null>(null);
  const [inputSurfacesCollapsed, setInputSurfacesCollapsed] = useState(true);

  const grouped = new Map<string, { color: string; label: string; totalVolume: number; count: number }>();
  for (const d of result.domains) {
    const existing = grouped.get(d.domain);
    if (existing) {
      existing.totalVolume += d.volume;
      existing.count++;
    } else {
      grouped.set(d.domain, { color: d.color, label: d.label, totalVolume: d.volume, count: 1 });
    }
  }

  const blockSummaries = result.summary.block_summaries ?? [];
  const uploadedRoles = SURFACE_ROLES.filter((r) => uploads.has(r.key));

  return (
    <div className="sidebar-section">
      {/* Summary pinned at top */}
      <div className="rounded-lg bg-slate-800/50 p-3 mb-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Summary
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-400">Conformance</span>
            <span className="font-mono font-semibold text-emerald-400">
              {result.summary.conformance_percent.toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Planned Vol.</span>
            <span className="font-mono text-slate-300">
              {formatVolume(result.summary.total_planned_volume)} m³
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Actual Vol.</span>
            <span className="font-mono text-slate-300">
              {formatVolume(result.summary.total_actual_volume)} m³
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Net</span>
            <span className="font-mono text-slate-300">
              {formatVolume(result.summary.total_planned_volume - result.summary.total_actual_volume)} m³
            </span>
          </div>
        </div>
      </div>

      {uploadedRoles.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setInputSurfacesCollapsed(c => !c)}
            className="sidebar-heading flex w-full items-center justify-between text-left"
          >
            <span>Input Surfaces</span>
            <svg
              className={`h-3 w-3 text-slate-500 transition-transform ${inputSurfacesCollapsed ? '' : 'rotate-180'}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!inputSurfacesCollapsed && <div className="mb-3 space-y-0.5">
            {uploadedRoles.map(({ key, label }) => {
              const upload = uploads.get(key)!;
              const isOn = surfaceVisible.has(key);
              const defaultStyle: ObjectStyle = { color: DEFAULT_SURFACE_COLORS[key], opacity: 0.3, wireframe: true };
              const style = surfaceStyles.get(key) ?? defaultStyle;
              const isExpanded = expandedSurface === key;
              return (
                <div key={key}>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => onToggleSurface(key)}
                      className={`flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                        isOn ? 'bg-white/5' : 'opacity-40'
                      } hover:bg-white/10`}
                    >
                      <span
                        className="h-3 w-3 flex-shrink-0 rounded-sm"
                        style={{ backgroundColor: style.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-slate-200">{label}</div>
                        <div className="truncate text-[10px] text-slate-500">{upload.fileName}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedSurface(isExpanded ? null : key)}
                      className="mr-1 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-300"
                      title="Style settings"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                  </div>
                  {isExpanded && isOn && (
                    <StyleControls
                      style={style}
                      onChange={(s) => onSurfaceStyleChange(key, s)}
                    />
                  )}
                </div>
              );
            })}
          </div>}
        </>
      )}

      <div className="sidebar-heading">Conformance Domains</div>
      <div className="space-y-0.5">
        {[...grouped.entries()].map(([domain, info]) => {
          const isVisible = visible.has(domain);
          const defaultStyle: ObjectStyle = { color: info.color, opacity: 0.85, wireframe: true };
          const style = domainStyles.get(domain) ?? defaultStyle;
          const isExpanded = expandedDomain === domain;
          return (
            <div key={domain}>
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => onToggle(domain)}
                  className={`flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                    isVisible ? 'bg-white/5' : 'opacity-40'
                  } hover:bg-white/10`}
                >
                  <span
                    className="h-3 w-3 flex-shrink-0 rounded-sm"
                    style={{ backgroundColor: style.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">{info.label}</div>
                    <div className="text-[10px] text-slate-500">
                      {formatVolume(info.totalVolume)} m³
                      {info.count > 1 && ` · ${info.count} solids`}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedDomain(isExpanded ? null : domain)}
                  className="mr-1 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-300"
                  title="Style settings"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
              {isExpanded && isVisible && (
                <StyleControls
                  style={style}
                  onChange={(s) => onDomainStyleChange(domain, s)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Heatmap section */}
      {uploads.size >= 2 && (() => {
        const uploadedRoleKeys = [...uploads.keys()];
        const isActive = !!heatmapMode;
        const defaultPaint: SurfaceRole = uploadedRoleKeys.includes('production_end') ? 'production_end' : uploadedRoleKeys[0];
        const defaultRef: SurfaceRole = uploadedRoleKeys.includes('schedule_end') ? 'schedule_end' : uploadedRoleKeys.find(r => r !== defaultPaint) ?? uploadedRoleKeys[0];

        return (
          <div className="mt-3 rounded-lg bg-slate-800/50 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Thickness Heatmap
            </div>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => {
                  if (e.target.checked) {
                    onHeatmapModeChange({
                      paintRole: defaultPaint,
                      refRole: defaultRef,
                      scaleMin: -10,
                      scaleMax: 10,
                    });
                  } else {
                    onHeatmapModeChange(null);
                  }
                }}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-indigo-500"
              />
              <span className="text-xs text-slate-200">Show Heatmap</span>
            </label>

            {isActive && (
              <div className="space-y-2 pl-1">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-slate-500 w-14">Paint on:</span>
                  <select
                    value={heatmapMode!.paintRole}
                    onChange={(e) => onHeatmapModeChange({ ...heatmapMode!, paintRole: e.target.value as SurfaceRole })}
                    className="flex-1 rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-[10px] text-slate-200 outline-none focus:border-indigo-500"
                  >
                    {uploadedRoleKeys.map((role) => (
                      <option key={role} value={role}>
                        {SURFACE_ROLES.find(r => r.key === role)?.label ?? role}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-slate-500 w-14">Ref:</span>
                  <select
                    value={heatmapMode!.refRole}
                    onChange={(e) => onHeatmapModeChange({ ...heatmapMode!, refRole: e.target.value as SurfaceRole })}
                    className="flex-1 rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-[10px] text-slate-200 outline-none focus:border-indigo-500"
                  >
                    {uploadedRoleKeys.filter(r => r !== heatmapMode!.paintRole).map((role) => (
                      <option key={role} value={role}>
                        {SURFACE_ROLES.find(r => r.key === role)?.label ?? role}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-slate-500 w-14">Scale:</span>
                  <input
                    type="number"
                    step="1"
                    defaultValue={heatmapMode!.scaleMin}
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) onHeatmapModeChange({ ...heatmapMode!, scaleMin: v });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-14 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-200 outline-none focus:border-indigo-500"
                  />
                  <span className="text-slate-500">to</span>
                  <input
                    type="number"
                    step="1"
                    defaultValue={heatmapMode!.scaleMax}
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) onHeatmapModeChange({ ...heatmapMode!, scaleMax: v });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-14 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-200 outline-none focus:border-indigo-500"
                  />
                  <span className="text-slate-500">m</span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {[
                    { label: '±5m', min: -5, max: 5 },
                    { label: '±10m', min: -10, max: 10 },
                    { label: '±20m', min: -20, max: 20 },
                    { label: '-20/+10', min: -20, max: 10 },
                  ].map(({ label, min, max }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => onHeatmapModeChange({ ...heatmapMode!, scaleMin: min, scaleMax: max })}
                      className={`rounded px-1.5 py-0.5 text-[9px] transition-colors ${
                        heatmapMode!.scaleMin === min && heatmapMode!.scaleMax === max
                          ? 'bg-indigo-500/30 text-indigo-300'
                          : 'bg-slate-700/50 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-[9px] text-slate-500 pt-0.5">
                  +ve = underdig (above plan) | -ve = overdig (below plan)
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {blockSummaries.length > 0 && (
        <div className="mt-3 rounded-lg bg-slate-800/50 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Volume by Block
          </div>
          <div className="space-y-3">
            {blockSummaries.map((block) => (
              <div key={block.block_name}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-200">{block.block_name}</span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {formatVolume(block.total_volume)} m³
                  </span>
                </div>
                <div className="space-y-0.5">
                  {block.domain_volumes.map(([label, vol]) => (
                    <div key={label} className="flex justify-between text-[10px]">
                      <span className="truncate text-slate-500">{label}</span>
                      <span className="font-mono text-slate-400">{formatVolume(vol)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
