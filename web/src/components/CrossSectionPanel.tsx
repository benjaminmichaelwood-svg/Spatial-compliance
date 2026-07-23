import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { CrossSectionData, SurfaceProfile, SolidSection } from '../utils/crossSection';
import type { SurfaceRole, UploadedSurface } from '../types';

interface Props {
  data: CrossSectionData;
  onClose: () => void;
  surfaceVisible: Set<SurfaceRole>;
  domainVisible: Set<string>;
  domainStyles: Map<string, { color: string; opacity: number }>;
  surfaceStyles: Map<SurfaceRole, { color: string; opacity: number }>;
  sectionLine: [[number, number], [number, number]];
  pitBounds: { minX: number; maxX: number; minY: number; maxY: number } | null;
  pitOutlineEdges?: [number, number, number, number][];
  uploads?: Map<SurfaceRole, UploadedSurface>;
  onSelectProfile?: (role: SurfaceRole) => void;
  onSelectSolid?: (domain: string) => void;
  onStepSection?: (offset: number) => void;
}

interface ViewBox {
  minD: number;
  maxD: number;
  minZ: number;
  maxZ: number;
}

interface TraceStyle {
  color: string;
  dash: number[];
  width: number;
}

interface OverviewView {
  cx: number;
  cy: number;
  zoom: number;
}

const MARGIN = { top: 40, right: 16, bottom: 44, left: 64 };

function niceStep(range: number, target: number): number {
  const rough = range / target;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const n = rough / mag;
  const step = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return step * mag;
}

const PRODUCTION_ROLES: SurfaceRole[] = ['production_start', 'production_end'];
const SCHEDULE_ROLES: SurfaceRole[] = ['schedule_start', 'schedule_end'];
const FUTURE_ROLES: SurfaceRole[] = ['schedule_future'];

function defaultTraceStyle(role: SurfaceRole, baseColor: string): TraceStyle {
  if (PRODUCTION_ROLES.includes(role)) return { color: baseColor, dash: [], width: 2 };
  if (SCHEDULE_ROLES.includes(role)) return { color: baseColor, dash: [8, 4], width: 2 };
  if (FUTURE_ROLES.includes(role)) return { color: baseColor, dash: [3, 3], width: 1 };
  return { color: baseColor, dash: [], width: 2 };
}

const DASH_PRESETS: { label: string; dash: number[] }[] = [
  { label: 'Solid', dash: [] },
  { label: 'Dashed', dash: [8, 4] },
  { label: 'Dotted', dash: [2, 3] },
  { label: 'Dash-dot', dash: [8, 3, 2, 3] },
];

const THEME = {
  dark: {
    bg: '#1e293b',
    plotBg: '#0f172a',
    grid: '#334155',
    axisText: '#94a3b8',
    border: '#475569',
    scaleBar: '#94a3b8',
    overviewBg: '#0f172a',
    overviewGrid: '#1e293b',
    overviewBorder: '#334155',
  },
  light: {
    bg: '#f1f5f9',
    plotBg: '#ffffff',
    grid: '#cbd5e1',
    axisText: '#475569',
    border: '#94a3b8',
    scaleBar: '#64748b',
    overviewBg: '#ffffff',
    overviewGrid: '#e2e8f0',
    overviewBorder: '#94a3b8',
  },
};

export default function CrossSectionPanel({
  data,
  onClose,
  surfaceVisible,
  domainVisible,
  domainStyles,
  surfaceStyles,
  sectionLine,
  pitBounds,
  pitOutlineEdges,
  uploads: uploadsForOverview,
  onSelectProfile,
  onSelectSolid,
  onStepSection,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });

  // Item 1: Background toggle
  const [isDark, setIsDark] = useState(true);
  const theme = isDark ? THEME.dark : THEME.light;

  // Item 2: Per-surface trace style overrides
  const [traceOverrides, setTraceOverrides] = useState<Map<SurfaceRole, Partial<TraceStyle>>>(new Map());
  const [stylePopover, setStylePopover] = useState<{ role: SurfaceRole; x: number; y: number } | null>(null);

  // Item 4: VE editing
  const [veEditMode, setVeEditMode] = useState(false);
  const [veEditValue, setVeEditValue] = useState('');
  const veInputRef = useRef<HTMLInputElement>(null);

  // Item 3: Overview zoom/pan
  const [overviewView, setOverviewView] = useState<OverviewView>({ cx: 0, cy: 0, zoom: 1 });
  const overviewDragRef = useRef<{ sx: number; sy: number; sv: OverviewView } | null>(null);
  const overviewInitialized = useRef(false);

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

  // Initialize overview center from pit bounds
  useEffect(() => {
    if (pitBounds && !overviewInitialized.current) {
      setOverviewView({
        cx: (pitBounds.minX + pitBounds.maxX) / 2,
        cy: (pitBounds.minY + pitBounds.maxY) / 2,
        zoom: 1,
      });
      overviewInitialized.current = true;
    }
  }, [pitBounds]);

  // Legend visibility toggles (local to section view)
  const [hiddenProfiles, setHiddenProfiles] = useState<Set<SurfaceRole>>(new Set());
  const [hiddenSolids, setHiddenSolids] = useState<Set<string>>(new Set());

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

  // Vertical exaggeration
  const ve = useMemo(() => {
    if (plotW <= 0 || plotH <= 0) return 1;
    const dRange = view.maxD - view.minD;
    const zRange = view.maxZ - view.minZ;
    if (dRange <= 0 || zRange <= 0) return 1;
    const dScale = plotW / dRange;
    const zScale = plotH / zRange;
    return zScale / dScale;
  }, [view, plotW, plotH]);

  // Resolve trace style for a profile
  const getTraceStyle = useCallback((role: SurfaceRole, baseColor: string): TraceStyle => {
    const base = defaultTraceStyle(role, baseColor);
    const override = traceOverrides.get(role);
    if (!override) return base;
    return {
      color: override.color ?? base.color,
      dash: override.dash ?? base.dash,
      width: override.width ?? base.width,
    };
  }, [traceOverrides]);

  // Filter profiles and solids by local checkbox state only
  const visibleProfiles = useMemo(() => {
    return data.profiles.filter(p => !hiddenProfiles.has(p.role));
  }, [data.profiles, hiddenProfiles]);

  const visibleSolids = useMemo(() => {
    return data.solids.filter(s => !hiddenSolids.has(s.domain));
  }, [data.solids, hiddenSolids]);

  // Unique domains for legend
  const uniqueDomains = useMemo(() => {
    const seen = new Map<string, SolidSection>();
    for (const s of data.solids) {
      if (!seen.has(s.domain)) seen.set(s.domain, s);
    }
    return [...seen.values()];
  }, [data.solids]);

  // Scale bar
  const scaleBar = useMemo(() => {
    if (plotW <= 0) return { widthPx: 0, label: '' };
    const dRange = view.maxD - view.minD;
    const pxPerM = plotW / dRange;
    const targetPx = 120;
    const targetM = targetPx / pxPerM;
    const mag = 10 ** Math.floor(Math.log10(targetM));
    const n = targetM / mag;
    const niceM = (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
    return { widthPx: niceM * pxPerM, label: niceM >= 1000 ? `${(niceM / 1000).toFixed(1)}km` : `${Math.round(niceM)}m` };
  }, [view, plotW]);

  // Hit testing for selection
  const hitTestRef = useRef<{ profiles: { role: SurfaceRole; path: Path2D }[]; solids: { domain: string; path: Path2D }[] }>({ profiles: [], solids: [] });

  // Main canvas render
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || plotW <= 0 || plotH <= 0) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.fillStyle = theme.plotBg;
    ctx.fillRect(MARGIN.left, MARGIN.top, plotW, plotH);

    const dRange = view.maxD - view.minD;
    const zRange = view.maxZ - view.minZ;
    if (dRange <= 0 || zRange <= 0) return;

    const dStep = niceStep(dRange, 8);
    const zStep = niceStep(zRange, 6);

    // Grid
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 0.5;
    ctx.font = '10px system-ui,sans-serif';
    ctx.fillStyle = theme.axisText;

    ctx.textAlign = 'center';
    for (let d = Math.ceil(view.minD / dStep) * dStep; d <= view.maxD; d += dStep) {
      const x = toX(d);
      if (x < MARGIN.left || x > MARGIN.left + plotW) continue;
      ctx.beginPath();
      ctx.moveTo(x, MARGIN.top);
      ctx.lineTo(x, MARGIN.top + plotH);
      ctx.stroke();
      ctx.fillText(`${Math.round(d)}m`, x, MARGIN.top + plotH + 14);
    }

    ctx.textAlign = 'right';
    for (let z = Math.ceil(view.minZ / zStep) * zStep; z <= view.maxZ; z += zStep) {
      const y = toY(z);
      if (y < MARGIN.top || y > MARGIN.top + plotH) continue;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, y);
      ctx.lineTo(MARGIN.left + plotW, y);
      ctx.stroke();
      ctx.fillText(`${Math.round(z)}m RL`, MARGIN.left - 4, y + 3);
    }

    // Clip to plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN.left, MARGIN.top, plotW, plotH);
    ctx.clip();

    const solidHits: { domain: string; path: Path2D }[] = [];
    const profileHits: { role: SurfaceRole; path: Path2D }[] = [];

    // Draw solid fills
    for (const s of visibleSolids) {
      if (s.polygon.length < 3) continue;
      const style = domainStyles.get(s.domain);
      const color = style?.color || s.color;
      const opacity = style?.opacity ?? 0.85;
      const alpha = Math.round(opacity * 0.4 * 255).toString(16).padStart(2, '0');
      const strokeAlpha = Math.round(opacity * 0.67 * 255).toString(16).padStart(2, '0');

      const path = new Path2D();
      path.moveTo(toX(s.polygon[0].dist), toY(s.polygon[0].z));
      for (let i = 1; i < s.polygon.length; i++) {
        path.lineTo(toX(s.polygon[i].dist), toY(s.polygon[i].z));
      }
      path.closePath();

      ctx.fillStyle = color + alpha;
      ctx.fill(path);
      ctx.strokeStyle = color + strokeAlpha;
      ctx.lineWidth = 0.75;
      ctx.stroke(path);
      solidHits.push({ domain: s.domain, path });
    }

    // Draw surface profiles with trace styles
    for (const p of visibleProfiles) {
      if (p.points.length < 2) continue;
      const pStyle = surfaceStyles.get(p.role);
      const baseColor = pStyle?.color || p.color;
      const ts = getTraceStyle(p.role, baseColor);

      const path = new Path2D();
      path.moveTo(toX(p.points[0].dist), toY(p.points[0].z));
      for (let i = 1; i < p.points.length; i++) {
        path.lineTo(toX(p.points[i].dist), toY(p.points[i].z));
      }

      ctx.setLineDash(ts.dash);
      ctx.strokeStyle = ts.color;
      ctx.lineWidth = ts.width;
      ctx.stroke(path);
      ctx.setLineDash([]);
      profileHits.push({ role: p.role, path });
    }

    ctx.restore();

    hitTestRef.current = { profiles: profileHits, solids: solidHits };

    // Axis labels
    ctx.fillStyle = theme.axisText;
    ctx.font = '11px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Chainage (m)', MARGIN.left + plotW / 2, size.h - 4);
    ctx.save();
    ctx.translate(13, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('RL (m)', 0, 0);
    ctx.restore();

    // Plot border
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN.left, MARGIN.top, plotW, plotH);

    // Scale bar (bottom-left)
    if (scaleBar.widthPx > 10) {
      const sbX = MARGIN.left + 12;
      const sbY = MARGIN.top + plotH - 16;
      ctx.strokeStyle = theme.scaleBar;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sbX, sbY);
      ctx.lineTo(sbX + scaleBar.widthPx, sbY);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sbX, sbY - 4);
      ctx.lineTo(sbX, sbY + 4);
      ctx.moveTo(sbX + scaleBar.widthPx, sbY - 4);
      ctx.lineTo(sbX + scaleBar.widthPx, sbY + 4);
      ctx.stroke();
      ctx.fillStyle = theme.scaleBar;
      ctx.font = '10px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(scaleBar.label, sbX + scaleBar.widthPx / 2, sbY + 14);
    }
  }, [data, size, view, plotW, plotH, toX, toY, visibleProfiles, visibleSolids, domainStyles, surfaceStyles, scaleBar, theme, getTraceStyle]);

  // Plan overview render
  useEffect(() => {
    const c = overviewRef.current;
    if (!c || !pitBounds) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = devicePixelRatio || 1;
    const cw = 200;
    const ch = 200;
    c.width = cw * dpr;
    c.height = ch * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = theme.overviewBg;
    ctx.fillRect(0, 0, cw, ch);

    const pad = 20;
    const { minX, maxX, minY, maxY } = pitBounds;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const baseScale = Math.min((cw - pad * 2) / rangeX, (ch - pad * 2) / rangeY);
    const scale = baseScale * overviewView.zoom;

    const baseCx = (minX + maxX) / 2;
    const baseCy = (minY + maxY) / 2;
    const viewCx = overviewView.cx || baseCx;
    const viewCy = overviewView.cy || baseCy;

    const mapX = (x: number) => cw / 2 + (x - viewCx) * scale;
    const mapY = (y: number) => ch / 2 - (y - viewCy) * scale;

    // Grid
    const gridStep = niceStep(Math.max(rangeX, rangeY), 4);
    ctx.strokeStyle = theme.overviewGrid;
    ctx.lineWidth = 0.5;
    for (let gx = Math.ceil(minX / gridStep) * gridStep; gx <= maxX; gx += gridStep) {
      const sx = mapX(gx);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, ch);
      ctx.stroke();
    }
    for (let gy = Math.ceil(minY / gridStep) * gridStep; gy <= maxY; gy += gridStep) {
      const sy = mapY(gy);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(cw, sy);
      ctx.stroke();
    }

    // Draw filled surface footprints
    const surfaceColors: Record<string, string> = {
      production_start: '#94a3b8',
      production_end: '#64748b',
      schedule_start: '#7dd3fc',
      schedule_end: '#38bdf8',
      schedule_future: '#a78bfa',
    };
    if (uploadsForOverview && uploadsForOverview.size > 0) {
      for (const [role, upload] of uploadsForOverview) {
        const pStyle = surfaceStyles.get(role);
        const color = pStyle?.color || surfaceColors[role] || '#64748b';
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.15;
        const step = Math.max(1, Math.floor(upload.triangleCount / 8000));
        ctx.beginPath();
        for (let t = 0; t < upload.triangleCount; t += step) {
          const i0 = upload.indices[t * 3], i1 = upload.indices[t * 3 + 1], i2 = upload.indices[t * 3 + 2];
          ctx.moveTo(mapX(upload.positions[i0 * 3]), mapY(upload.positions[i0 * 3 + 1]));
          ctx.lineTo(mapX(upload.positions[i1 * 3]), mapY(upload.positions[i1 * 3 + 1]));
          ctx.lineTo(mapX(upload.positions[i2 * 3]), mapY(upload.positions[i2 * 3 + 1]));
          ctx.closePath();
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Pit outline from boundary edges
    if (pitOutlineEdges && pitOutlineEdges.length > 0) {
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of pitOutlineEdges) {
        ctx.moveTo(mapX(x1), mapY(y1));
        ctx.lineTo(mapX(x2), mapY(y2));
      }
      ctx.stroke();
    }

    // Draw surface intersection trace on plan overview
    const [sl1, sl2] = sectionLine;
    const sdx = sl2[0] - sl1[0];
    const sdy = sl2[1] - sl1[1];
    const sLen = Math.sqrt(sdx * sdx + sdy * sdy);
    if (sLen > 1e-6) {
      const dirX = sdx / sLen;
      const dirY = sdy / sLen;
      for (const pr of data.profiles) {
        if (pr.points.length < 2) continue;
        const pStyle = surfaceStyles.get(pr.role);
        const pColor = pStyle?.color || pr.color;
        ctx.strokeStyle = pColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        const fx = sl1[0] + pr.points[0].dist * dirX;
        const fy = sl1[1] + pr.points[0].dist * dirY;
        ctx.moveTo(mapX(fx), mapY(fy));
        for (let i = 1; i < pr.points.length; i++) {
          const px = sl1[0] + pr.points[i].dist * dirX;
          const py = sl1[1] + pr.points[i].dist * dirY;
          ctx.lineTo(mapX(px), mapY(py));
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Section line
    const [p1, p2] = sectionLine;
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(mapX(p1[0]), mapY(p1[1]));
    ctx.lineTo(mapX(p2[0]), mapY(p2[1]));
    ctx.stroke();

    // Endpoint dots
    ctx.fillStyle = '#facc15';
    for (const p of [p1, p2]) {
      ctx.beginPath();
      ctx.arc(mapX(p[0]), mapY(p[1]), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // North arrow
    const naX = cw - 16;
    const naY = 20;
    ctx.strokeStyle = theme.axisText;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(naX, naY + 14);
    ctx.lineTo(naX, naY - 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(naX - 4, naY);
    ctx.lineTo(naX, naY - 6);
    ctx.lineTo(naX + 4, naY);
    ctx.stroke();
    ctx.fillStyle = theme.axisText;
    ctx.font = 'bold 9px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', naX, naY - 10);

    // Border
    ctx.strokeStyle = theme.overviewBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, cw, ch);
  }, [pitBounds, pitOutlineEdges, uploadsForOverview, sectionLine, data.profiles, surfaceStyles, theme, overviewView]);

  // Interactions — main canvas
  const dragRef = useRef<{ sx: number; sy: number; sv: ViewBox } | null>(null);

  const stepSize = useMemo(() => {
    if (!pitBounds) return 50;
    const range = Math.max(pitBounds.maxX - pitBounds.minX, pitBounds.maxY - pitBounds.minY);
    return Math.max(10, Math.round(range / 50));
  }, [pitBounds]);

  // Item 4: Scroll = horizontal zoom, SHIFT+scroll = adjust VE, CTRL+scroll = step section
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      // CTRL+scroll = step section line
      if (e.ctrlKey && onStepSection) {
        const dir = e.deltaY > 0 ? 1 : -1;
        onStepSection(dir * stepSize);
        return;
      }

      // SHIFT+scroll = adjust vertical exaggeration
      if (e.shiftKey) {
        const factor = e.deltaY > 0 ? 1.08 : 1 / 1.08;
        setView(v => {
          const zMid = (v.minZ + v.maxZ) / 2;
          const halfZ = (v.maxZ - v.minZ) / 2;
          return {
            ...v,
            minZ: zMid - halfZ * factor,
            maxZ: zMid + halfZ * factor,
          };
        });
        return;
      }

      // Plain scroll = horizontal zoom centered on cursor
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || plotW <= 0 || plotH <= 0) return;
      const cx = e.clientX - rect.left;
      const d = view.minD + ((cx - MARGIN.left) / plotW) * (view.maxD - view.minD);
      const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setView(v => ({
        ...v,
        minD: d - (d - v.minD) * f,
        maxD: d + (v.maxD - d) * f,
      }));
    },
    [view, plotW, plotH, onStepSection, stepSize],
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

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current) return;
      const c = canvasRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const dpr = devicePixelRatio || 1;
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      for (let i = hitTestRef.current.profiles.length - 1; i >= 0; i--) {
        const { role, path } = hitTestRef.current.profiles[i];
        ctx.lineWidth = 8 * dpr;
        if (ctx.isPointInStroke(path, x, y)) {
          onSelectProfile?.(role);
          return;
        }
      }
      for (let i = hitTestRef.current.solids.length - 1; i >= 0; i--) {
        const { domain, path } = hitTestRef.current.solids[i];
        if (ctx.isPointInPath(path, x, y)) {
          onSelectSolid?.(domain);
          return;
        }
      }
    },
    [onSelectProfile, onSelectSolid],
  );

  // Item 3: Overview interactions
  const handleOverviewWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const f = e.deltaY > 0 ? 1 / 1.2 : 1.2;
      setOverviewView(v => ({ ...v, zoom: Math.max(0.5, Math.min(20, v.zoom * f)) }));
    },
    [],
  );

  const handleOverviewMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      overviewDragRef.current = { sx: e.clientX, sy: e.clientY, sv: { ...overviewView } };
    },
    [overviewView],
  );

  const handleOverviewMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!overviewDragRef.current || !pitBounds) return;
      e.stopPropagation();
      const { sx, sy, sv } = overviewDragRef.current;
      const { minX, maxX, minY, maxY } = pitBounds;
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const baseScale = Math.min(160 / rangeX, 160 / rangeY);
      const scale = baseScale * sv.zoom;
      const dx = (e.clientX - sx) / scale;
      const dy = (e.clientY - sy) / scale;
      setOverviewView({ ...sv, cx: sv.cx - dx, cy: sv.cy + dy });
    },
    [pitBounds],
  );

  const stopOverviewDrag = useCallback(() => {
    overviewDragRef.current = null;
  }, []);

  // Item 4: VE badge double-click to edit
  const handleVeDoubleClick = useCallback(() => {
    setVeEditMode(true);
    setVeEditValue(ve.toFixed(1));
    setTimeout(() => veInputRef.current?.select(), 0);
  }, [ve]);

  const applyVeEdit = useCallback(() => {
    const newVe = parseFloat(veEditValue);
    if (isFinite(newVe) && newVe > 0 && plotW > 0 && plotH > 0) {
      const dRange = view.maxD - view.minD;
      const dScale = plotW / dRange;
      const targetZScale = dScale * newVe;
      const zMid = (view.minZ + view.maxZ) / 2;
      const halfZ = (plotH / targetZScale) / 2;
      setView(v => ({ ...v, minZ: zMid - halfZ, maxZ: zMid + halfZ }));
    }
    setVeEditMode(false);
  }, [veEditValue, view, plotW, plotH]);

  // Item 2: Trace style popover handlers
  const updateTrace = useCallback((role: SurfaceRole, update: Partial<TraceStyle>) => {
    setTraceOverrides(prev => {
      const next = new Map(prev);
      const existing = next.get(role) || {};
      next.set(role, { ...existing, ...update });
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col bg-slate-800">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-700 px-3 py-1.5">
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold text-slate-200">Cross Section</span>
          {/* VE badge — double-click to edit */}
          {(ve > 1.05 || ve < 0.95) && !veEditMode && (
            <span
              className="cursor-pointer rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-amber-400 hover:bg-slate-600"
              title="Double-click to set VE, SHIFT+scroll to adjust"
              onDoubleClick={handleVeDoubleClick}
            >
              VE: {ve.toFixed(1)}x
            </span>
          )}
          {veEditMode && (
            <span className="flex items-center gap-1 rounded bg-slate-700 px-1 py-0.5">
              <span className="text-[10px] text-amber-400">VE:</span>
              <input
                ref={veInputRef}
                type="text"
                value={veEditValue}
                onChange={e => setVeEditValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') applyVeEdit();
                  if (e.key === 'Escape') setVeEditMode(false);
                }}
                onBlur={applyVeEdit}
                className="w-12 rounded bg-slate-600 px-1 py-0 text-[10px] text-amber-400 outline-none"
              />
              <span className="text-[10px] text-amber-400">x</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onStepSection && (
            <>
              <button
                type="button"
                onClick={() => onStepSection(-stepSize)}
                className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700 hover:text-white"
                title={`Step back ${stepSize}m`}
              >
                &#9664;
              </button>
              <span className="text-[9px] text-slate-500">{stepSize}m</span>
              <button
                type="button"
                onClick={() => onStepSection(stepSize)}
                className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700 hover:text-white"
                title={`Step forward ${stepSize}m`}
              >
                &#9654;
              </button>
              <div className="mx-1 h-3 w-px bg-slate-600" />
            </>
          )}
          {/* Item 1: Background toggle */}
          <button
            type="button"
            onClick={() => setIsDark(d => !d)}
            className="rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700 hover:text-white"
            title={isDark ? 'Switch to light background' : 'Switch to dark background'}
          >
            {isDark ? (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="5" />
                <path strokeLinecap="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>
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
            className="rounded bg-indigo-600 px-3 py-0.5 text-[10px] font-medium text-white hover:bg-indigo-500"
          >
            Back to 3D
          </button>
        </div>
      </div>

      {/* Main area with canvas + legend sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area */}
        <div ref={wrapRef} className="relative flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            style={{ width: size.w, height: size.h, display: 'block' }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={stopDrag}
            onMouseLeave={stopDrag}
            onClick={handleCanvasClick}
            className="cursor-grab active:cursor-grabbing"
          />
          {/* Plan overview sub-window */}
          {pitBounds && (
            <div className="absolute bottom-3 right-3 rounded border border-slate-600 shadow-lg">
              <canvas
                ref={overviewRef}
                style={{ width: 200, height: 200, display: 'block', cursor: 'grab' }}
                onWheel={handleOverviewWheel}
                onMouseDown={handleOverviewMouseDown}
                onMouseMove={handleOverviewMouseMove}
                onMouseUp={stopOverviewDrag}
                onMouseLeave={stopOverviewDrag}
              />
              <div className="absolute bottom-1 left-1 text-[8px] text-slate-500">Plan View</div>
              {overviewView.zoom !== 1 && (
                <button
                  type="button"
                  onClick={() => setOverviewView(v => ({ ...v, zoom: 1, cx: pitBounds ? (pitBounds.minX + pitBounds.maxX) / 2 : v.cx, cy: pitBounds ? (pitBounds.minY + pitBounds.maxY) / 2 : v.cy }))}
                  className="absolute bottom-1 right-1 rounded bg-slate-700/80 px-1 py-0 text-[8px] text-slate-400 hover:text-white"
                  title="Reset overview zoom"
                >
                  {overviewView.zoom.toFixed(1)}x
                </button>
              )}
            </div>
          )}
        </div>

        {/* Legend sidebar */}
        <div className="w-48 flex-shrink-0 overflow-y-auto border-l border-slate-700 bg-slate-800/80 p-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Surfaces</div>
          {data.profiles.map(p => {
            const pStyle = surfaceStyles.get(p.role);
            const baseColor = pStyle?.color || p.color;
            const ts = getTraceStyle(p.role, baseColor);
            const isVis = !hiddenProfiles.has(p.role);
            return (
              <div key={p.role} className="relative mb-1">
                <label
                  className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-700/50"
                >
                  <input
                    type="checkbox"
                    checked={isVis}
                    onChange={() => {
                      setHiddenProfiles(prev => {
                        const next = new Set(prev);
                        if (next.has(p.role)) next.delete(p.role);
                        else next.add(p.role);
                        return next;
                      });
                    }}
                    className="h-3 w-3 rounded border-slate-600"
                  />
                  <svg width="20" height="8" className="flex-shrink-0">
                    <line
                      x1="0" y1="4" x2="20" y2="4"
                      stroke={ts.color}
                      strokeWidth={ts.width}
                      strokeDasharray={ts.dash.join(',')}
                    />
                  </svg>
                  <span className={`truncate text-[10px] ${isVis ? 'text-slate-300' : 'text-slate-500'}`}>
                    {p.label}
                  </span>
                  {/* Item 2: Style edit button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.target as HTMLElement).getBoundingClientRect();
                      setStylePopover(prev =>
                        prev?.role === p.role ? null : { role: p.role, x: rect.left, y: rect.bottom + 4 }
                      );
                    }}
                    className="ml-auto flex-shrink-0 rounded px-0.5 text-[9px] text-slate-500 hover:bg-slate-600 hover:text-slate-300"
                    title="Edit line style"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </label>
              </div>
            );
          })}

          {/* Item 2: Style popover */}
          {stylePopover && (() => {
            const p = data.profiles.find(pr => pr.role === stylePopover.role);
            if (!p) return null;
            const pStyle = surfaceStyles.get(p.role);
            const baseColor = pStyle?.color || p.color;
            const ts = getTraceStyle(p.role, baseColor);
            return (
              <div className="mb-2 rounded border border-slate-600 bg-slate-750 p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[9px] font-semibold text-slate-400">{p.label}</span>
                  <button
                    type="button"
                    onClick={() => setStylePopover(null)}
                    className="text-[9px] text-slate-500 hover:text-slate-300"
                  >
                    x
                  </button>
                </div>
                {/* Color */}
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-[9px] text-slate-500">Color</span>
                  <input
                    type="color"
                    value={ts.color}
                    onChange={e => updateTrace(stylePopover.role, { color: e.target.value })}
                    className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                </div>
                {/* Width */}
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-[9px] text-slate-500">Width</span>
                  <input
                    type="range"
                    min="0.5"
                    max="5"
                    step="0.5"
                    value={ts.width}
                    onChange={e => updateTrace(stylePopover.role, { width: parseFloat(e.target.value) })}
                    className="h-1 w-20"
                  />
                  <span className="text-[9px] text-slate-400">{ts.width}</span>
                </div>
                {/* Dash style */}
                <div className="flex flex-wrap gap-1">
                  {DASH_PRESETS.map(dp => {
                    const active = JSON.stringify(ts.dash) === JSON.stringify(dp.dash);
                    return (
                      <button
                        key={dp.label}
                        type="button"
                        onClick={() => updateTrace(stylePopover.role, { dash: dp.dash })}
                        className={`rounded px-1.5 py-0.5 text-[8px] ${
                          active ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                        }`}
                      >
                        {dp.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {uniqueDomains.length > 0 && (
            <>
              <div className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Domains</div>
              {uniqueDomains.map(s => {
                const style = domainStyles.get(s.domain);
                const color = style?.color || s.color;
                const isVis = !hiddenSolids.has(s.domain);
                return (
                  <label
                    key={s.domain}
                    className="mb-1 flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-700/50"
                  >
                    <input
                      type="checkbox"
                      checked={isVis}
                      onChange={() => {
                        setHiddenSolids(prev => {
                          const next = new Set(prev);
                          if (next.has(s.domain)) next.delete(s.domain);
                          else next.add(s.domain);
                          return next;
                        });
                      }}
                      className="h-3 w-3 rounded border-slate-600"
                    />
                    <span
                      className="inline-block h-2.5 w-4 flex-shrink-0 rounded-sm"
                      style={{ backgroundColor: color, opacity: 0.7 }}
                    />
                    <span className={`truncate text-[10px] ${isVis ? 'text-slate-300' : 'text-slate-500'}`}>
                      {s.label}
                    </span>
                  </label>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
