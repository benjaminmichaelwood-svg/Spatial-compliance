interface Props {
  domainLabel: string;
  scaleMin: number;
  scaleMax: number;
  isDark: boolean;
}

const RAMP = [
  { t: 0.0, color: '#0033CC' },
  { t: 0.25, color: '#00CCCC' },
  { t: 0.5, color: '#33CC33' },
  { t: 0.75, color: '#CCCC00' },
  { t: 1.0, color: '#CC0000' },
];

function buildGradientCSS(): string {
  const stops = RAMP.map((s) => `${s.color} ${s.t * 100}%`);
  return `linear-gradient(to top, ${stops.join(', ')})`;
}

export default function ThicknessLegend({ domainLabel, scaleMin, scaleMax, isDark }: Props) {
  const range = scaleMax - scaleMin;
  const ticks = 5;
  const tickValues: number[] = [];
  for (let i = 0; i < ticks; i++) {
    tickValues.push(scaleMin + (range * i) / (ticks - 1));
  }

  return (
    <div
      className="absolute right-4 bottom-16 z-40 flex items-stretch gap-2 rounded-lg px-3 py-3 shadow-xl"
      style={{
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(30, 41, 59, 0.9)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="w-5 rounded-sm"
        style={{
          background: buildGradientCSS(),
          height: 180,
        }}
      />
      <div className="flex flex-col justify-between" style={{ height: 180 }}>
        <div>
          <div className="text-[10px] font-semibold text-white/90 leading-tight max-w-[90px] truncate">
            {domainLabel}
          </div>
          <div className="text-[9px] text-white/50 leading-tight">Thickness (m)</div>
        </div>
        <div className="flex flex-col justify-between flex-1 mt-1">
          {[...tickValues].reverse().map((v, i) => (
            <div key={i} className="text-[10px] font-mono text-white/80 leading-none">
              {v.toFixed(1)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { RAMP };
