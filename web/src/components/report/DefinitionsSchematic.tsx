import type { Mode } from '../../types';
import { getColumns, type ColumnData } from './definitionsData';

interface Props {
  mode: Mode;
}

const COL_LEFT_X = 80;
const COL_RIGHT_X = 370;
const COL_W = 210;

function renderColumn(col: ColumnData, x: number, side: 'left' | 'right') {
  return (
    <g key={side}>
      <text
        x={x + COL_W / 2}
        y={22}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill="#333"
      >
        {col.title}
      </text>

      {col.bands.map((band, i) => (
        <g key={i}>
          <rect
            x={x}
            y={band.y1}
            width={COL_W}
            height={band.y2 - band.y1}
            fill={band.color}
            opacity={band.label ? 0.85 : 0.3}
            rx={1}
          />
          {band.label && (
            <text
              x={x + COL_W / 2}
              y={(band.y1 + band.y2) / 2 + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={8.5}
              fontWeight={600}
              fill="#fff"
            >
              {band.label}
            </text>
          )}
          <line
            x1={x}
            y1={band.y1}
            x2={x + COL_W}
            y2={band.y1}
            stroke="#555"
            strokeWidth={0.75}
          />
        </g>
      ))}

      <line
        x1={x}
        y1={col.bands[col.bands.length - 1].y2}
        x2={x + COL_W}
        y2={col.bands[col.bands.length - 1].y2}
        stroke="#555"
        strokeWidth={0.75}
      />

      <rect
        x={x}
        y={col.bands[0].y1}
        width={COL_W}
        height={col.bands[col.bands.length - 1].y2 - col.bands[0].y1}
        fill="none"
        stroke="#444"
        strokeWidth={1}
        rx={2}
      />

      {col.leftLabels.map((sl, i) => (
        <g key={`ll-${i}`}>
          <line x1={x - 4} y1={sl.y} x2={x} y2={sl.y} stroke="#888" strokeWidth={0.75} />
          <text
            x={x - 7}
            y={sl.y + 1}
            textAnchor="end"
            dominantBaseline="central"
            fontSize={8}
            fontWeight={700}
            fill="#444"
          >
            {sl.label}
          </text>
          <text
            x={x - 7}
            y={sl.y + 10}
            textAnchor="end"
            dominantBaseline="central"
            fontSize={6}
            fill="#888"
          >
            {sl.fullName}
          </text>
        </g>
      ))}

      {col.rightLabels.map((sl, i) => (
        <g key={`rl-${i}`}>
          <line x1={x + COL_W} y1={sl.y} x2={x + COL_W + 4} y2={sl.y} stroke="#888" strokeWidth={0.75} />
          <text
            x={x + COL_W + 7}
            y={sl.y + 1}
            textAnchor="start"
            dominantBaseline="central"
            fontSize={8}
            fontWeight={700}
            fill="#444"
          >
            {sl.label}
          </text>
          <text
            x={x + COL_W + 7}
            y={sl.y + 10}
            textAnchor="start"
            dominantBaseline="central"
            fontSize={6}
            fill="#888"
          >
            {sl.fullName}
          </text>
        </g>
      ))}
    </g>
  );
}

export default function DefinitionsSchematic({ mode }: Props) {
  const [left, right] = getColumns(mode);
  const depthLabel = mode === 'dig' ? 'Increasing Depth' : 'Increasing Height';
  const arrowY1 = mode === 'dig' ? 60 : 190;
  const arrowY2 = mode === 'dig' ? 190 : 60;

  return (
    <svg viewBox="0 0 660 230" className="w-full" style={{ maxHeight: 230 }}>
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="3" refY="2" orient="auto">
          <polygon points="0 0, 6 2, 0 4" fill="#aaa" />
        </marker>
      </defs>

      {/* Depth/height arrow */}
      <line
        x1={16}
        y1={arrowY1}
        x2={16}
        y2={arrowY2}
        stroke="#aaa"
        strokeWidth={1}
        markerEnd="url(#arrowhead)"
      />
      <text
        x={16}
        y={125}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={7}
        fill="#aaa"
        transform="rotate(-90 16 125)"
      >
        {depthLabel}
      </text>

      {renderColumn(left, COL_LEFT_X, 'left')}
      {renderColumn(right, COL_RIGHT_X, 'right')}
    </svg>
  );
}
