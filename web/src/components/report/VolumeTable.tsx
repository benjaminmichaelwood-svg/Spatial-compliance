import type { DomainSolid, BlockSummary } from '../../types';

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(1);
}

interface Props {
  domains: DomainSolid[];
  blockSummaries: BlockSummary[];
}

export default function VolumeTable({ domains, blockSummaries }: Props) {
  const grouped = new Map<string, { label: string; color: string; volume: number }>();
  for (const d of domains) {
    const existing = grouped.get(d.domain);
    if (existing) {
      existing.volume += d.volume;
    } else {
      grouped.set(d.domain, { label: d.label, color: d.color, volume: d.volume });
    }
  }
  const totalVolume = domains.reduce((s, d) => s + d.volume, 0);

  return (
    <div id="volume-table">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Volume Summary</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-4 font-semibold text-slate-500">Domain</th>
              <th className="py-2 pr-4 text-right font-semibold text-slate-500">Volume (m³)</th>
              <th className="py-2 text-right font-semibold text-slate-500">Share</th>
            </tr>
          </thead>
          <tbody>
            {[...grouped.entries()].map(([key, info]) => (
              <tr key={key} className="border-b border-slate-100">
                <td className="flex items-center gap-2 py-2 pr-4">
                  <span
                    className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                    style={{ backgroundColor: info.color }}
                  />
                  <span className="text-slate-700">{info.label}</span>
                </td>
                <td className="py-2 pr-4 text-right font-mono text-slate-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatVolume(info.volume)}
                </td>
                <td className="py-2 text-right font-mono text-slate-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {totalVolume > 0 ? ((info.volume / totalVolume) * 100).toFixed(1) : '0.0'}%
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300">
              <td className="py-2 pr-4 font-semibold text-slate-700">Total</td>
              <td className="py-2 pr-4 text-right font-mono font-semibold text-slate-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatVolume(totalVolume)}
              </td>
              <td className="py-2 text-right font-mono font-semibold text-slate-700">100%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {blockSummaries.length > 0 && (
        <>
          <h4 className="mb-2 mt-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            By Block
          </h4>
          {blockSummaries.map((block) => (
            <div key={block.block_name} className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">{block.block_name}</span>
                <span className="text-xs font-mono text-slate-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatVolume(block.total_volume)} m³
                </span>
              </div>
              <table className="w-full text-left text-[11px]">
                <tbody>
                  {block.domain_volumes.map(([label, vol]) => (
                    <tr key={label} className="border-b border-slate-50">
                      <td className="py-1 pr-4 text-slate-500">{label}</td>
                      <td className="py-1 text-right font-mono text-slate-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatVolume(vol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
