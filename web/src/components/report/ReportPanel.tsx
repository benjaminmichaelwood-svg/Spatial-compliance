import { useMemo, useState, useCallback } from 'react';
import type { BoundaryRegion, ConformanceResult, DomainSolid, Mode } from '../../types';
import ScopeSelector, { type ReportScope, scopeLabel } from './ScopeSelector';
import WaterfallChart from './WaterfallChart';
import DonutGauge from './DonutGauge';
import VolumeTable from './VolumeTable';
import { exportCSV, exportOOT } from './exports';
import { generatePDF } from './pdfReport';

interface Props {
  result: ConformanceResult;
  mode: Mode;
  boundaries: BoundaryRegion[];
  comparisonName: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

function filterDomains(
  domains: DomainSolid[],
  scope: ReportScope,
  boundaries: BoundaryRegion[],
): DomainSolid[] {
  if (scope.type === 'all') return domains;
  const names = new Set<string>();
  if (scope.type === 'single') {
    names.add(boundaries[scope.index]?.name ?? '');
  } else {
    for (const i of scope.indices) {
      names.add(boundaries[i]?.name ?? '');
    }
  }
  return domains.filter((d) => d.block_name != null && names.has(d.block_name));
}

export default function ReportPanel({ result, mode, boundaries, comparisonName, canvasRef }: Props) {
  const [scope, setScope] = useState<ReportScope>({ type: 'all' });
  const [generating, setGenerating] = useState(false);

  const filtered = useMemo(
    () => filterDomains(result.domains, scope, boundaries),
    [result.domains, scope, boundaries],
  );

  const blockSummaries = useMemo(() => {
    if (scope.type === 'all') return result.summary.block_summaries ?? [];
    const names = new Set<string>();
    if (scope.type === 'single') names.add(boundaries[scope.index]?.name ?? '');
    else scope.indices.forEach((i) => names.add(boundaries[i]?.name ?? ''));
    return (result.summary.block_summaries ?? []).filter((b) => names.has(b.block_name));
  }, [result.summary.block_summaries, scope, boundaries]);

  const conformancePct = useMemo(() => {
    if (scope.type === 'all') return result.summary.conformance_percent;
    const conformKey = mode === 'dig' ? 'PlannedAndMined' : 'PlannedAndDumped';
    const plannedKey = mode === 'dig' ? 'PlannedNotMined' : 'PlannedNotDumped';
    const confVol = filtered.filter((d) => d.domain === conformKey).reduce((s, d) => s + d.volume, 0);
    const pnmVol = filtered.filter((d) => d.domain === plannedKey).reduce((s, d) => s + d.volume, 0);
    const planned = confVol + pnmVol;
    return planned > 0 ? (confVol / planned) * 100 : 0;
  }, [filtered, scope, result.summary.conformance_percent, mode]);

  const { plannedVol, actualVol } = useMemo(() => {
    if (scope.type === 'all') {
      return {
        plannedVol: result.summary.total_planned_volume,
        actualVol: result.summary.total_actual_volume,
      };
    }
    const conformKey = mode === 'dig' ? 'PlannedAndMined' : 'PlannedAndDumped';
    const pnmKey = mode === 'dig' ? 'PlannedNotMined' : 'PlannedNotDumped';
    const mnpKey = mode === 'dig' ? 'MinedNotPlanned' : 'DumpedNotPlanned';
    const confVol = filtered.filter((d) => d.domain === conformKey).reduce((s, d) => s + d.volume, 0);
    const pnmVol = filtered.filter((d) => d.domain === pnmKey).reduce((s, d) => s + d.volume, 0);
    const mnpVol = filtered.filter((d) => d.domain === mnpKey).reduce((s, d) => s + d.volume, 0);
    return {
      plannedVol: confVol + pnmVol,
      actualVol: confVol + mnpVol,
    };
  }, [filtered, scope, result.summary, mode]);

  const productionPct = plannedVol > 0 ? (actualVol / plannedVol) * 100 : 0;

  const scopeStr = scopeLabel(scope, boundaries);

  const handleGeneratePDF = useCallback(async () => {
    setGenerating(true);
    try {
      const screenshot = canvasRef.current?.toDataURL('image/png') ?? null;
      await generatePDF(
        filtered,
        blockSummaries,
        mode,
        scopeStr,
        comparisonName,
        conformancePct,
        plannedVol,
        actualVol,
        screenshot,
      );
    } finally {
      setGenerating(false);
    }
  }, [filtered, blockSummaries, mode, scopeStr, comparisonName, conformancePct, plannedVol, actualVol, canvasRef]);

  const handleExportCSV = useCallback(() => {
    exportCSV(filtered, blockSummaries, `${comparisonName.replace(/\s+/g, '_')}_volumes.csv`);
  }, [filtered, blockSummaries, comparisonName]);

  const handleExportOOT = useCallback(() => {
    exportOOT(filtered, `${comparisonName.replace(/\s+/g, '_')}_solids.00t`);
  }, [filtered, comparisonName]);

  return (
    <div className="h-full overflow-y-auto bg-white p-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{comparisonName} — Report</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {mode.toUpperCase()} mode · {scopeStr}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExportCSV}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleExportOOT}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Export .00t
            </button>
            <button
              type="button"
              onClick={handleGeneratePDF}
              disabled={generating}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate Report'}
            </button>
          </div>
        </div>

        {/* Scope selector */}
        <div className="mb-6">
          <ScopeSelector scope={scope} onChange={setScope} boundaries={boundaries} />
        </div>

        {/* KPI row */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-[11px] font-medium text-slate-400">Conformance</div>
            <div className="mt-1 text-2xl font-semibold text-slate-800">
              {conformancePct.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-[11px] font-medium text-slate-400">Planned Volume</div>
            <div className="mt-1 text-2xl font-semibold text-slate-800">
              {formatVol(plannedVol)} m³
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-[11px] font-medium text-slate-400">Actual Volume</div>
            <div className="mt-1 text-2xl font-semibold text-slate-800">
              {formatVol(actualVol)} m³
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-[11px] font-medium text-slate-400">Net Difference</div>
            <div className="mt-1 text-2xl font-semibold text-slate-800">
              {formatVol(plannedVol - actualVol)} m³
            </div>
          </div>
        </div>

        {/* Waterfall + donuts */}
        <div className="mb-6 grid grid-cols-3 gap-6">
          <div className="col-span-2 rounded-lg border border-slate-200 p-4">
            <WaterfallChart domains={filtered} mode={mode} />
          </div>
          <div className="flex flex-col items-center justify-center gap-6 rounded-lg border border-slate-200 p-4">
            <DonutGauge value={conformancePct} label="Conformance" mode="conformance" />
            <DonutGauge value={productionPct} label="Cumulative Mined vs Plan" mode="production" />
          </div>
        </div>

        {/* Volume table */}
        <div className="rounded-lg border border-slate-200 p-4">
          <VolumeTable domains={filtered} blockSummaries={blockSummaries} />
        </div>
      </div>
    </div>
  );
}

function formatVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}
