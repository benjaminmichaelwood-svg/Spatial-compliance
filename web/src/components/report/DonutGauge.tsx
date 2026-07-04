import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface Props {
  value: number;
  label: string;
  mode?: 'conformance' | 'production';
}

function statusColor(pct: number): string {
  if (pct >= 80) return '#0ca30c';
  if (pct >= 60) return '#fab219';
  return '#d03b3b';
}

export default function DonutGauge({ value, label, mode = 'conformance' }: Props) {
  const clamped = Math.min(Math.max(value, 0), 100);
  const data = [
    { value: clamped },
    { value: 100 - clamped },
  ];

  const fillColor = mode === 'conformance' ? statusColor(clamped) : '#2a78d6';
  const trackColor = '#e1e0d9';

  return (
    <div className="flex flex-col items-center" id={`donut-${mode}`}>
      <div className="relative h-[160px] w-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={70}
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
            >
              <Cell fill={fillColor} />
              <Cell fill={trackColor} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-slate-800">
            {clamped.toFixed(1)}%
          </span>
        </div>
      </div>
      <span className="mt-1 text-xs font-medium text-slate-500">{label}</span>
    </div>
  );
}
