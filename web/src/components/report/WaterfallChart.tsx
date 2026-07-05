import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  LabelList,
} from 'recharts';
import type { ConformanceResult, DomainSolid, Mode } from '../../types';

const CHART_COLORS: Record<string, string> = {
  PlannedAndMined: '#2a78d6',
  PlannedNotMined: '#eda100',
  MinedNotPlanned: '#e34948',
  MinedBeforeStart: '#4a3aa7',
  PrescheduleDelay: '#eb6834',
  AheadOfPlan: '#1baf7a',
  PlannedAndDumped: '#2a78d6',
  PlannedNotDumped: '#eda100',
  DumpedNotPlanned: '#e34948',
  DumpedBeforeStart: '#4a3aa7',
  DumpPrescheduleDelay: '#eb6834',
  DumpedAheadOfPlan: '#1baf7a',
};

const TOTAL_BAR_COLOR = '#52514e';

interface WaterfallItem {
  name: string;
  base: number;
  value: number;
  total: number;
  color: string;
  isTotal: boolean;
  pct: string;
}

function getWaterfallSteps(mode: Mode): { key: string; label: string; sign: -1 | 1 }[] {
  if (mode === 'dig') {
    return [
      { key: 'PlannedNotMined', label: 'Planned Not Mined', sign: -1 },
      { key: 'MinedBeforeStart', label: 'Mined Before Start', sign: 1 },
      { key: 'MinedNotPlanned', label: 'Mined Not Planned', sign: 1 },
      { key: 'PrescheduleDelay', label: 'Preschedule Delay', sign: 1 },
      { key: 'AheadOfPlan', label: 'Ahead of Plan', sign: 1 },
    ];
  }
  return [
    { key: 'PlannedNotDumped', label: 'Planned Not Dumped', sign: -1 },
    { key: 'DumpedBeforeStart', label: 'Dumped Before Start', sign: 1 },
    { key: 'DumpedNotPlanned', label: 'Dumped Not Planned', sign: 1 },
    { key: 'DumpPrescheduleDelay', label: 'Preschedule Delay', sign: 1 },
    { key: 'DumpedAheadOfPlan', label: 'Ahead of Plan', sign: 1 },
  ];
}

function buildWaterfallData(
  domains: DomainSolid[],
  mode: Mode,
): WaterfallItem[] {
  const volumeByDomain = new Map<string, number>();
  for (const d of domains) {
    volumeByDomain.set(d.domain, (volumeByDomain.get(d.domain) ?? 0) + d.volume);
  }

  const conformKey = mode === 'dig' ? 'PlannedAndMined' : 'PlannedAndDumped';
  const pnmKey = mode === 'dig' ? 'PlannedNotMined' : 'PlannedNotDumped';
  const mnpKey = mode === 'dig' ? 'MinedNotPlanned' : 'DumpedNotPlanned';

  const conformVol = volumeByDomain.get(conformKey) ?? 0;
  const pnmVol = volumeByDomain.get(pnmKey) ?? 0;
  const mnpVol = volumeByDomain.get(mnpKey) ?? 0;
  const planned = conformVol + pnmVol;

  const hasSchedule = planned > 0.01 || conformVol > 0.01;
  const hasProduction = conformVol > 0.01 || mnpVol > 0.01 ||
    (volumeByDomain.get(mode === 'dig' ? 'MinedBeforeStart' : 'DumpedBeforeStart') ?? 0) > 0.01;

  const items: WaterfallItem[] = [];

  if (hasSchedule) {
    items.push({
      name: 'Planned',
      base: 0,
      value: planned,
      total: planned,
      color: TOTAL_BAR_COLOR,
      isTotal: true,
      pct: '',
    });
  }

  let running = planned;
  const steps = getWaterfallSteps(mode);

  for (const step of steps) {
    const vol = volumeByDomain.get(step.key) ?? 0;
    if (vol < 0.01) continue;
    const delta = step.sign * vol;
    const base = delta >= 0 ? running : running + delta;
    running += delta;
    const ref = hasSchedule ? planned : running;
    const pct = ref > 0 ? `${((vol / ref) * 100).toFixed(1)}%` : '0%';
    items.push({
      name: step.label,
      base,
      value: vol,
      total: running,
      color: CHART_COLORS[step.key] ?? '#898781',
      isTotal: false,
      pct,
    });
  }

  if (hasProduction || hasSchedule) {
    items.push({
      name: hasProduction ? 'Production' : 'Total',
      base: 0,
      value: running,
      total: running,
      color: TOTAL_BAR_COLOR,
      isTotal: true,
      pct: planned > 0 ? `${((running / planned) * 100).toFixed(1)}%` : '',
    });
  }

  return items;
}

function formatVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

interface Props {
  domains: DomainSolid[];
  mode: Mode;
}

export default function WaterfallChart({ domains, mode }: Props) {
  const data = useMemo(() => buildWaterfallData(domains, mode), [domains, mode]);
  const maxVal = Math.max(...data.map((d) => d.base + d.value)) * 1.15;

  return (
    <div className="w-full" id="waterfall-chart">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        Volume Waterfall — Planned to Production
      </h3>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart
          data={data}
          margin={{ top: 24, right: 16, bottom: 8, left: 16 }}
          barCategoryGap="20%"
        >
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: '#898781' }}
            axisLine={{ stroke: '#c3c2b7' }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tickFormatter={formatVol}
            tick={{ fontSize: 10, fill: '#898781' }}
            axisLine={false}
            tickLine={false}
            domain={[0, maxVal]}
          />
          <Tooltip
            formatter={(value, name) => {
              if (name === 'base') return [null, null];
              return [`${formatVol(Number(value))} m³`, 'Volume'];
            }}
            contentStyle={{
              backgroundColor: '#1a1a19',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              color: '#fff',
            }}
            itemStyle={{ color: '#fff' }}
          />
          <ReferenceLine y={0} stroke="#c3c2b7" strokeWidth={1} />
          <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false} />
          <Bar
            dataKey="value"
            stackId="a"
            isAnimationActive={false}
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
            <LabelList
              dataKey="pct"
              position="top"
              style={{
                fontSize: 10,
                fill: '#52514e',
                fontWeight: 600,
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export { buildWaterfallData, type WaterfallItem };
