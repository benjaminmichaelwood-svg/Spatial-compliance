import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { CrossSectionData } from '../utils/crossSection';

interface Props {
  data: CrossSectionData;
  onClose: () => void;
}

interface ViewBox {
  minD: number;
  maxD: number;
  minZ: number;
  maxZ: number;
}

const MARGIN = { top: 16, right: 16, bottom: 36, left: 56 };

function niceStep(range: number, target: number): number {
  const rough = range / target;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const n = rough / mag;
  const step = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return step * mag;
}

export default function CrossSectionPanel({ data, onClose }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 250 });

  const bounds = useMemo(() => {
    let minD = Infinity, maxD = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of data.profiles) {
      for (const pt of p.points) {
        if (pt.dist < minD) minD = pt.dist;
        if (pt.dist > maxD) maxD = pt.dist;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      }
    }
    for (const s of data.solids) {
      for (const pt of s.polygon) {
        if (pt.dist < minD) minD = pt.dist;
        if (pt.dist > maxD) maxD = pt.dist;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      }
    }
    if (!isFinite(minD)) return { minD: 0, maxD: 100, minZ: 0, maxZ: 100 };
    const dPad = (maxD - minD || 1) * 0.05;
    const zPad = (maxZ - minZ || 1) * 0.05;
    return { minD: minD - dPad, maxD: maxD + dPad, minZ: minZ - zPad, maxZ: maxZ + zPad };
  }, [data]);

  const [view, setView] = useState<ViewBox>(bounds);
  useEffect(() => setView(bounds), [bounds]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = size.w - MARGIN.left - MARGIN.right;
  const plotH = size.h - MARGIN.top - MARGIN.bottom;

  const toX = useCallback(
    (d: number) => MARGIN.left + ((d - view.minD) / (view.maxD - view.minD)) * plotW,
    [view.minD, view.maxD, plotW],
  );
  const toY = useCallback(
    (z: number) => MARGIN.top + (1 - (z - view.minZ) / (view.maxZ - view.minZ)) * plotH,
    [view.minZ, view.maxZ, plotH],
  );

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || plotW <= 0 || plotH <= 0) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(MARGIN.left, MARGIN.top, plotW, plotH);

    const dRange = view.maxD - view.minD;
    const zRange = view.maxZ - view.minZ;
    if (dRange <= 0 || zRange <= 0) return;

    const dStep = niceStep(dRange, 8);
    const zStep = niceStep(zRange, 6);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.5;
    ctx.font = '10px system-ui,sans-serif';
    ctx.fillStyle = '#94a3b8';

    ctx.textAlign = 'center';
    for (let d = Math.ceil(view.minD / dStep) * dStep; d <= view.maxD; d += dStep) {
      const x = toX(d);
      if (x < MARGIN.left || x > MARGIN.left + plotW) continue;
      ctx.beginPath();
      ctx.moveTo(x, MARGIN.top);
      ctx.lineTo(x, MARGIN.top + plotH);
      ctx.stroke();
      ctx.fillText(d.toFixed(1), x, MARGIN.top + plotH + 14);
    }

    ctx.textAlign = 'right';
    for (let z = Math.ceil(view.minZ / zStep) * zStep; z <= view.maxZ; z += zStep) {
      const y = toY(z);
      if (y < MARGIN.top || y > MARGIN.top + plotH) continue;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, y);
      ctx.lineTo(MARGIN.left + plotW, y);
      ctx.stroke();
      ctx.fillText(z.toFixed(1), MARGIN.left - 4, y + 3);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN.left, MARGIN.top, plotW, plotH);
    ctx.clip();

    for (const s of data.solids) {
      if (s.polygon.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(toX(s.polygon[0].dist), toY(s.polygon[0].z));
      for (let i = 1; i < s.polygon.length; i++) {
        ctx.lineTo(toX(s.polygon[i].dist), toY(s.polygon[i].z));
      }
      ctx.closePath();
      ctx.fillStyle = s.color + '55';
      ctx.fill();
      ctx.strokeStyle = s.color + 'aa';
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }

    for (const p of data.profiles) {
      if (p.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(toX(p.points[0].dist), toY(p.points[0].z));
      for (let i = 1; i < p.points.length; i++) {
        ctx.lineTo(toX(p.points[i].dist), toY(p.points[i].z));
      }
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Distance (m)', MARGIN.left + plotW / 2, size.h - 4);
    ctx.save();
    ctx.translate(13, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('RL (m)', 0, 0);
    ctx.restore();

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN.left, MARGIN.top, plotW, plotH);
  }, [data, size, view, plotW, plotH, toX, toY]);

  const dragRef = useRef<{ sx: number; sy: number; sv: ViewBox } | null>(null);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || plotW <= 0 || plotH <= 0) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const d = view.minD + ((cx - MARGIN.left) / plotW) * (view.maxD - view.minD);
      const z = view.minZ + (1 - (cy - MARGIN.top) / plotH) * (view.maxZ - view.minZ);
      const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setView(v => ({
        minD: d - (d - v.minD) * f,
        maxD: d + (v.maxD - d) * f,
        minZ: z - (z - v.minZ) * f,
        maxZ: z + (v.maxZ - z) * f,
      }));
    },
    [view, plotW, plotH],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragRef.current = { sx: e.clientX, sy: e.clientY, sv: { ...view } };
    },
    [view],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current || plotW <= 0 || plotH <= 0) return;
      const { sx, sy, sv } = dragRef.current;
      const dd = ((e.clientX - sx) / plotW) * (sv.maxD - sv.minD);
      const dz = ((e.clientY - sy) / plotH) * (sv.maxZ - sv.minZ);
      setView({ minD: sv.minD - dd, maxD: sv.maxD - dd, minZ: sv.minZ + dz, maxZ: sv.maxZ + dz });
    },
    [plotW, plotH],
  );

  const stopDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div className="flex h-full flex-col bg-slate-800">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-700 px-3 py-1.5">
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold text-slate-200">Cross Section</span>
          <div className="flex flex-wrap gap-3">
            {data.profiles.map(p => (
              <div key={p.role} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: p.color }} />
                <span className="text-[10px] text-slate-400">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView(bounds)}
            className="rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>
      <div ref={wrapRef} className="flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h, display: 'block' }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
          className="cursor-grab active:cursor-grabbing"
        />
      </div>
    </div>
  );
}
