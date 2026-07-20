interface DomainEntry {
  name: string;
  color: string;
  volume: number;
}

interface Props {
  domains: DomainEntry[];
  isDark: boolean;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}

export default function DomainLegend({ domains, isDark }: Props) {
  if (domains.length === 0) return null;

  return (
    <div
      className="absolute left-4 bottom-16 z-40 rounded-lg px-3 py-3 shadow-xl"
      style={{
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(30, 41, 59, 0.9)',
        backdropFilter: 'blur(8px)',
        maxHeight: '40vh',
        overflowY: 'auto',
      }}
    >
      <div className="text-[10px] font-semibold text-white/90 mb-2 uppercase tracking-wider">
        Conformance Domains
      </div>
      <div className="space-y-1">
        {domains.map((d) => (
          <div key={d.name} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-[10px] text-white/80 flex-1 truncate max-w-[120px]">
              {d.name}
            </span>
            <span className="text-[10px] font-mono text-white/50">
              {formatVolume(d.volume)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
