import type { ConformanceResult } from '../types';

interface Props {
  result: ConformanceResult;
  visible: Set<string>;
  onToggle: (domain: string) => void;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}

export default function LayerPanel({ result, visible, onToggle }: Props) {
  const grouped = new Map<string, { color: string; label: string; totalVolume: number; count: number }>();
  for (const d of result.domains) {
    const existing = grouped.get(d.domain);
    if (existing) {
      existing.totalVolume += d.volume;
      existing.count++;
    } else {
      grouped.set(d.domain, {
        color: d.color,
        label: d.label,
        totalVolume: d.volume,
        count: 1,
      });
    }
  }

  return (
    <div className="sidebar-section">
      <div className="sidebar-heading">Conformance Domains</div>

      <div className="space-y-1">
        {[...grouped.entries()].map(([domain, info]) => {
          const isVisible = visible.has(domain);
          return (
            <button
              key={domain}
              type="button"
              onClick={() => onToggle(domain)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                isVisible ? 'bg-white/5' : 'opacity-40'
              } hover:bg-white/10`}
            >
              <span
                className="h-3 w-3 flex-shrink-0 rounded-sm"
                style={{ backgroundColor: info.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-200">
                  {info.label}
                </div>
                <div className="text-[10px] text-slate-500">
                  {formatVolume(info.totalVolume)} m³
                  {info.count > 1 && ` · ${info.count} solids`}
                </div>
              </div>
              <svg
                className={`h-3.5 w-3.5 flex-shrink-0 ${isVisible ? 'text-indigo-400' : 'text-slate-600'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                {isVisible ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                )}
              </svg>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg bg-slate-800/50 p-3">
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
              {formatVolume(
                result.summary.total_planned_volume - result.summary.total_actual_volume,
              )}{' '}
              m³
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
