import type { BoundaryRegion } from '../../types';

export type ReportScope =
  | { type: 'all' }
  | { type: 'single'; index: number }
  | { type: 'multi'; indices: number[] };

interface Props {
  scope: ReportScope;
  onChange: (scope: ReportScope) => void;
  boundaries: BoundaryRegion[];
}

export default function ScopeSelector({ scope, onChange, boundaries }: Props) {
  const hasBoundaries = boundaries.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">Scope:</span>
      <button
        type="button"
        onClick={() => onChange({ type: 'all' })}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          scope.type === 'all'
            ? 'bg-indigo-600 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        Whole Site
      </button>
      {hasBoundaries &&
        boundaries.map((b, i) => {
          const isActive =
            (scope.type === 'single' && scope.index === i) ||
            (scope.type === 'multi' && scope.indices.includes(i));
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                if (scope.type === 'multi') {
                  const indices = scope.indices.includes(i)
                    ? scope.indices.filter((x) => x !== i)
                    : [...scope.indices, i];
                  if (indices.length === 0) onChange({ type: 'all' });
                  else if (indices.length === 1) onChange({ type: 'single', index: indices[0] });
                  else onChange({ type: 'multi', indices });
                } else if (scope.type === 'single' && scope.index === i) {
                  onChange({ type: 'all' });
                } else if (scope.type === 'single') {
                  onChange({ type: 'multi', indices: [scope.index, i] });
                } else {
                  onChange({ type: 'single', index: i });
                }
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {b.name}
            </button>
          );
        })}
    </div>
  );
}

export function scopeLabel(scope: ReportScope, boundaries: BoundaryRegion[]): string {
  if (scope.type === 'all') return 'Whole Site';
  if (scope.type === 'single') return boundaries[scope.index]?.name ?? 'Region';
  return scope.indices.map((i) => boundaries[i]?.name ?? '?').join(', ');
}
