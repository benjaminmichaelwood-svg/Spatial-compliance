import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  Mode,
  SurfaceRole,
  UploadedSurface,
  Settings,
  ConformanceResult,
  TriSurface,
  Vec3,
  BoundaryRegion,
} from './types';
import { DEFAULT_SETTINGS, SURFACE_ROLES } from './types';
import { initWasm, runConformance, runConformanceWithBoundaries } from './wasm';
import LandingPage from './components/LandingPage';
import UploadZone from './components/UploadZone';
import SettingsPanel from './components/SettingsPanel';
import BoundaryPanel from './components/BoundaryPanel';
import LayerPanel from './components/LayerPanel';
import Viewer from './components/Viewer';
import CrossSectionPanel from './components/CrossSectionPanel';
import ReportPanel from './components/report/ReportPanel';
import { computeCrossSection } from './utils/crossSection';

function makeFlatSurface(z: number, name: string, size = 20): TriSurface {
  const vertices: Vec3[] = [
    { x: 0, y: 0, z },
    { x: size, y: 0, z },
    { x: size, y: size, z },
    { x: 0, y: size, z },
  ];
  return { name, vertices, indices: [[0, 1, 2], [0, 2, 3]] };
}

type MainTab = 'viewer' | 'reports';

export default function App() {
  const [wasmReady, setWasmReady] = useState(false);
  const [step, setStep] = useState<'landing' | 'workspace'>('landing');
  const [comparisonName, setComparisonName] = useState('');
  const [mode, setMode] = useState<Mode>('dig');
  const [uploads, setUploads] = useState<Map<SurfaceRole, UploadedSurface>>(new Map());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<ConformanceResult | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boundaries, setBoundaries] = useState<BoundaryRegion[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [mainTab, setMainTab] = useState<MainTab>('viewer');
  const [surfaceVisible, setSurfaceVisible] = useState<Set<SurfaceRole>>(new Set());
  const [sectionLine, setSectionLine] = useState<[[number, number], [number, number]] | null>(null);
  const [isDrawingSection, setIsDrawingSection] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    initWasm().then(() => setWasmReady(true));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDrawingSection) {
        setIsDrawingSection(false);
        return;
      }
      if (!isDrawing) return;
      if (e.key === 'Enter') {
        finishDrawing();
      } else if (e.key === 'Escape') {
        cancelDrawing();
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        setDrawPoints((p) => p.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDrawing, isDrawingSection, drawPoints]);

  const finishDrawing = useCallback(() => {
    if (drawPoints.length >= 3) {
      const name = `Region ${boundaries.length + 1}`;
      setBoundaries((prev) => [...prev, { name, polygon: drawPoints }]);
    }
    setIsDrawing(false);
    setDrawPoints([]);
  }, [drawPoints, boundaries.length]);

  const cancelDrawing = useCallback(() => {
    setIsDrawing(false);
    setDrawPoints([]);
  }, []);

  const handleStartDraw = useCallback(() => {
    setIsDrawing(true);
    setDrawPoints([]);
    setIsDrawingSection(false);
  }, []);

  const handleAddDrawPoint = useCallback(
    (x: number, y: number) => {
      if (!isDrawing) return;
      setDrawPoints((prev) => {
        if (prev.length >= 3) {
          const [fx, fy] = prev[0];
          const dist = Math.sqrt((x - fx) ** 2 + (y - fy) ** 2);
          if (dist < 1.0) {
            setTimeout(() => finishDrawing(), 0);
            return prev;
          }
        }
        return [...prev, [x, y]];
      });
    },
    [isDrawing, finishDrawing],
  );

  const handleStart = useCallback((name: string, m: Mode) => {
    setComparisonName(name);
    setMode(m);
    setStep('workspace');
  }, []);

  const handleLoadSample = useCallback(() => {
    const sampleSurfaces: Record<SurfaceRole, { z: number; label: string }> =
      mode === 'dig'
        ? {
            production_start: { z: 100, label: 'Production Start' },
            production_end: { z: 85, label: 'Production End' },
            schedule_start: { z: 95, label: 'Schedule Start' },
            schedule_end: { z: 80, label: 'Schedule End' },
            schedule_future: { z: 70, label: 'Schedule Future' },
          }
        : {
            production_start: { z: 0, label: 'Production Start' },
            production_end: { z: 15, label: 'Production End' },
            schedule_start: { z: 5, label: 'Schedule Start' },
            schedule_end: { z: 20, label: 'Schedule End' },
            schedule_future: { z: 30, label: 'Schedule Future' },
          };

    const next = new Map<SurfaceRole, UploadedSurface>();
    for (const { key } of SURFACE_ROLES) {
      const cfg = sampleSurfaces[key];
      next.set(key, {
        role: key,
        surface: makeFlatSurface(cfg.z, cfg.label),
        fileName: `${cfg.label.toLowerCase().replace(/ /g, '_')}_sample.json`,
      });
    }
    setUploads(next);
  }, [mode]);

  const handleRun = useCallback(async () => {
    setError(null);
    setIsRunning(true);
    setResult(null);

    await new Promise((r) => requestAnimationFrame(r));

    try {
      const surfaces: Record<string, TriSurface> = {};
      for (const { key } of SURFACE_ROLES) {
        const entry = uploads.get(key);
        if (!entry) throw new Error(`Missing surface: ${key}`);
        surfaces[key] = entry.surface;
      }

      const res =
        boundaries.length > 0
          ? runConformanceWithBoundaries(
              surfaces,
              mode,
              settings.resolution,
              settings.minVolume,
              settings.minThickness,
              boundaries,
            )
          : runConformance(
              surfaces,
              mode,
              settings.resolution,
              settings.minVolume,
              settings.minThickness,
            );

      setResult(res);
      setVisible(new Set(res.domains.map((d) => d.domain)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
    }
  }, [uploads, mode, settings, boundaries]);

  const handleToggle = useCallback((domain: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }, []);

  const handleToggleSurface = useCallback((role: SurfaceRole) => {
    setSurfaceVisible((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }, []);

  const handleStartSection = useCallback(() => {
    setIsDrawingSection(true);
    setIsDrawing(false);
    setDrawPoints([]);
  }, []);

  const handleClearSection = useCallback(() => {
    setSectionLine(null);
    setIsDrawingSection(false);
  }, []);

  const handleSectionDrawComplete = useCallback(() => {
    setIsDrawingSection(false);
  }, []);

  const crossSectionData = useMemo(() => {
    if (!sectionLine || !result) return null;
    return computeCrossSection(uploads, result.domains, sectionLine[0], sectionLine[1]);
  }, [sectionLine, uploads, result]);

  const handleCapture = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${comparisonName.replace(/\s+/g, '_')}_capture.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [comparisonName]);

  if (step === 'landing') {
    return <LandingPage onStart={handleStart} />;
  }

  const allAssigned = SURFACE_ROLES.every((r) => uploads.has(r.key));

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setStep('landing');
              setResult(null);
              setUploads(new Map());
              setBoundaries([]);
              setMainTab('viewer');
              setSectionLine(null);
              setIsDrawingSection(false);
            }}
            className="text-sm text-slate-400 transition-colors hover:text-slate-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-sm font-semibold text-slate-800">{comparisonName}</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              mode === 'dig'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {mode}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <>
              <span className="text-xs text-slate-400">
                {result.domains.length} solids
              </span>
              {mainTab === 'viewer' && (
                isDrawingSection ? (
                  <button
                    type="button"
                    onClick={() => setIsDrawingSection(false)}
                    className="btn-secondary !py-1.5 !text-xs !border-amber-500/50 !text-amber-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel Section
                  </button>
                ) : sectionLine ? (
                  <button
                    type="button"
                    onClick={handleClearSection}
                    className="btn-secondary !py-1.5 !text-xs !border-amber-500/50 !text-amber-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Clear Section
                  </button>
                ) : (
                  <button type="button" onClick={handleStartSection} className="btn-secondary !py-1.5 !text-xs">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                    Cross Section
                  </button>
                )
              )}
              <button type="button" onClick={handleCapture} className="btn-secondary !py-1.5 !text-xs">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Capture View
              </button>
            </>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-64 flex-shrink-0 flex-col overflow-y-auto bg-sidebar text-slate-200 scrollbar-thin">
          <UploadZone
            uploads={uploads}
            onUpdate={setUploads}
            onLoadSample={handleLoadSample}
          />

          <SettingsPanel settings={settings} onChange={setSettings} />

          <BoundaryPanel
            boundaries={boundaries}
            onChange={setBoundaries}
            onStartDraw={handleStartDraw}
            isDrawing={isDrawing}
          />

          {/* Run Button */}
          <div className="sidebar-section">
            <button
              type="button"
              disabled={!allAssigned || isRunning || !wasmReady}
              onClick={handleRun}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5
                         text-sm font-medium text-white transition-colors hover:bg-indigo-700
                         disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isRunning ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processing…
                </>
              ) : !wasmReady ? (
                'Loading engine…'
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Run Conformance
                </>
              )}
            </button>
            {error && (
              <p className="mt-2 text-xs text-red-400">{error}</p>
            )}
          </div>

          {/* Tab switcher */}
          {result && (
            <div className="sidebar-section">
              <div className="flex rounded-lg bg-slate-800/50 p-0.5">
                <button
                  type="button"
                  onClick={() => setMainTab('viewer')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mainTab === 'viewer'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <svg className="mr-1.5 inline h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15" />
                  </svg>
                  3D View
                </button>
                <button
                  type="button"
                  onClick={() => setMainTab('reports')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mainTab === 'reports'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <svg className="mr-1.5 inline h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Reports
                </button>
              </div>
            </div>
          )}

          {/* Layers (only in viewer tab) */}
          {result && mainTab === 'viewer' && (
            <LayerPanel
              result={result}
              visible={visible}
              onToggle={handleToggle}
              uploads={uploads}
              surfaceVisible={surfaceVisible}
              onToggleSurface={handleToggleSurface}
            />
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          {result ? (
            mainTab === 'reports' ? (
              <ReportPanel
                result={result}
                mode={mode}
                boundaries={boundaries}
                comparisonName={comparisonName}
                canvasRef={canvasRef}
              />
            ) : (
              <div className="flex h-full flex-col">
                <div className={crossSectionData ? 'h-[60%]' : 'h-full'} style={{ minHeight: 0 }}>
                  <Viewer
                    result={result}
                    visible={visible}
                    canvasRef={canvasRef}
                    boundaries={boundaries}
                    isDrawing={isDrawing}
                    drawPoints={drawPoints}
                    onAddDrawPoint={handleAddDrawPoint}
                    uploads={uploads}
                    surfaceVisible={surfaceVisible}
                    isDrawingSection={isDrawingSection}
                    sectionLine={sectionLine}
                    onSectionLineChange={setSectionLine}
                    onSectionDrawComplete={handleSectionDrawComplete}
                  />
                </div>
                {crossSectionData && (
                  <div className="h-[40%] border-t border-slate-600" style={{ minHeight: 0 }}>
                    <CrossSectionPanel data={crossSectionData} onClose={handleClearSection} />
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="flex h-full items-center justify-center bg-slate-50">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-200/60">
                  <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V15m0 0l-2.25 1.313M3 16.5v-2.25m0 0l2.25 1.313M3 14.25l2.25-1.313m11.25 1.313l2.25-1.313m0 0V16.5m0-2.25l2.25 1.313M21 14.25v2.25" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-600">
                  {allAssigned
                    ? 'Ready to run — click "Run Conformance" to start'
                    : 'Upload surfaces to get started'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Assign all 5 surfaces, then run the conformance analysis
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Drawing controls overlay */}
      {isDrawing && (
        <div className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 gap-2 rounded-lg bg-slate-900/90 px-4 py-2 shadow-xl">
          <button
            type="button"
            onClick={() => setDrawPoints((p) => p.slice(0, -1))}
            disabled={drawPoints.length === 0}
            className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={finishDrawing}
            disabled={drawPoints.length < 3}
            className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Close Polygon
          </button>
          <button
            type="button"
            onClick={cancelDrawing}
            className="rounded bg-red-600/80 px-3 py-1 text-xs text-white hover:bg-red-500"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
