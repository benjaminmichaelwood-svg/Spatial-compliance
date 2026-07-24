export const HEATMAP_RAMP = [
  { t: 0.00, color: '#000000' },
  { t: 0.14, color: '#0033CC' },
  { t: 0.28, color: '#00CCCC' },
  { t: 0.43, color: '#33CC33' },
  { t: 0.57, color: '#CCCC00' },
  { t: 0.71, color: '#FF6600' },
  { t: 0.85, color: '#CC0000' },
  { t: 1.00, color: '#FFFFFF' },
];

export function sampleHeatmapRamp(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < HEATMAP_RAMP.length - 1; i++) {
    if (clamped >= HEATMAP_RAMP[i].t && clamped <= HEATMAP_RAMP[i + 1].t) {
      const seg = (clamped - HEATMAP_RAMP[i].t) / (HEATMAP_RAMP[i + 1].t - HEATMAP_RAMP[i].t);
      const c0 = hexToRgb(HEATMAP_RAMP[i].color);
      const c1 = hexToRgb(HEATMAP_RAMP[i + 1].color);
      return [
        c0[0] + (c1[0] - c0[0]) * seg,
        c0[1] + (c1[1] - c0[1]) * seg,
        c0[2] + (c1[2] - c0[2]) * seg,
      ];
    }
  }
  const last = hexToRgb(HEATMAP_RAMP[HEATMAP_RAMP.length - 1].color);
  return last;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

function buildGradientCSS(): string {
  const stops = HEATMAP_RAMP.map((s) => `${s.color} ${s.t * 100}%`);
  return `linear-gradient(to top, ${stops.join(', ')})`;
}

interface Props {
  scaleMin: number;
  scaleMax: number;
  isDark: boolean;
}

export default function ThicknessLegend({ scaleMin, scaleMax, isDark }: Props) {
  const range = scaleMax - scaleMin;
  const zeroT = range > 0 ? (0 - scaleMin) / range : 0.5;

  const tickValues: number[] = [];
  const numTicks = 7;
  for (let i = 0; i < numTicks; i++) {
    tickValues.push(scaleMin + (range * i) / (numTicks - 1));
  }

  return (
    <div
      className="absolute right-4 bottom-16 z-40 flex items-stretch gap-2 rounded-lg px-3 py-3 shadow-xl"
      style={{
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(30, 41, 59, 0.9)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="flex flex-col items-center gap-0.5">
        <div className="text-[9px] font-semibold text-white/70">Underdig</div>
        <div
          className="w-5 rounded-sm relative"
          style={{
            background: buildGradientCSS(),
            height: 200,
          }}
        >
          {zeroT > 0.05 && zeroT < 0.95 && (
            <div
              className="absolute left-0 right-0 h-px bg-white/80"
              style={{ bottom: `${zeroT * 100}%` }}
            />
          )}
        </div>
        <div className="text-[9px] font-semibold text-white/70">Overdig</div>
      </div>
      <div className="flex flex-col justify-between" style={{ height: 200, paddingTop: 14, paddingBottom: 14 }}>
        {[...tickValues].reverse().map((v, i) => (
          <div key={i} className="text-[10px] font-mono text-white/80 leading-none">
            {v > 0 ? '+' : ''}{v.toFixed(1)}m
          </div>
        ))}
      </div>
    </div>
  );
}

export { HEATMAP_RAMP as RAMP };
