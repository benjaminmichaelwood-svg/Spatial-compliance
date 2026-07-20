import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  Mode,
  SurfaceRole,
  UploadedSurface,
  Settings,
  ConformanceResult,
  TriSurface,
  Vec3,
  DomainSolid,
  BoundaryRegion,
  ObjectStyle,
  MeasureTool,
  ViewerBackground,
  SolidMesh,
} from './types';
import { DEFAULT_SETTINGS, SURFACE_ROLES } from './types';
import { initWasm, runConformance, runConformanceWithBoundaries, parseSurfaces } from './wasm';
import {
  initWorker,
  workerParseSurface,
  workerParseSurfaceJson,
  workerRunConformance,
  workerClearSurfaces,
  workerRemoveSurface,
  type FlatDomainSolid,
  type FlatSurface,
  type FlatConformanceResult,
} from './workers/engineClient';
import LandingPage from './components/LandingPage';
import UploadZone from './components/UploadZone';
import SettingsPanel from './components/SettingsPanel';
import BoundaryPanel from './components/BoundaryPanel';
import LayerPanel from './components/LayerPanel';
import Viewer from './components/Viewer';
import type { ViewerHandle, SelectionInfo, MeasurePoint, SavedMeasurement } from './components/Viewer';
import CrossSectionPanel from './components/CrossSectionPanel';
import ReportPanel from './components/report/ReportPanel';
import { computeCrossSection } from './utils/crossSection';
import DomainLegend from './components/DomainLegend';


function makeSampleUpload(z: number, name: string, role: SurfaceRole, fileName: string, size = 20): UploadedSurface {
  const positions = new Float32Array([0, 0, z, size, 0, z, size, size, z, 0, size, z]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { role, fileName, name, positions, indices, vertexCount: 4, triangleCount: 2 };
}

function flatDomainToLightDomainSolid(d: FlatDomainSolid): DomainSolid {
  return {
    domain: d.domain,
    label: d.label,
    color: d.color,
    volume: d.volume,
    block_name: d.block_name,
    solid: { label: d.label, vertices: [], indices: [], volume: d.volume, surface_area: d.surface_area },
  };
}

function triSurfaceToUpload(surface: TriSurface, role: SurfaceRole, fileName: string): UploadedSurface {
  const positions = new Float32Array(surface.vertices.length * 3);
  for (let i = 0; i < surface.vertices.length; i++) {
    positions[i * 3] = surface.vertices[i].x;
    positions[i * 3 + 1] = surface.vertices[i].y;
    positions[i * 3 + 2] = surface.vertices[i].z;
  }
  const indices = new Uint32Array(surface.indices.length * 3);
  for (let i = 0; i < surface.indices.length; i++) {
    indices[i * 3] = surface.indices[i][0];
    indices[i * 3 + 1] = surface.indices[i][1];
    indices[i * 3 + 2] = surface.indices[i][2];
  }
  return { name: surface.name, role, fileName, positions, indices, vertexCount: surface.vertices.length, triangleCount: surface.indices.length };
}

type MainTab = 'viewer' | 'reports';


function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}

export default function App() {
  const [wasmReady, setWasmReady] = useState(false);
  const [useWorker, setUseWorker] = useState(false);
  const [step, setStep] = useState<'landing' | 'workspace'>('landing');
  const [comparisonName, setComparisonName] = useState('');
  const [mode, setMode] = useState<Mode>('dig');
  const [uploads, setUploads] = useState<Map<SurfaceRole, UploadedSurface>>(new Map());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<ConformanceResult | null>(null);
  const [flatDomains, setFlatDomains] = useState<FlatDomainSolid[]>([]);
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
  const viewerRef = useRef<ViewerHandle>(null);

  const [background, setBackground] = useState<ViewerBackground>('light');
  const [domainStyles, setDomainStyles] = useState<Map<string, ObjectStyle>>(new Map());
  const [surfaceStyles, setSurfaceStyles] = useState<Map<SurfaceRole, ObjectStyle>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [measureTool, setMeasureTool] = useState<MeasureTool>('none');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [savedMeasurements, setSavedMeasurements] = useState<SavedMeasurement[]>([]);
  const measureIdRef = useRef(0);

  const [showPerf, setShowPerf] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; value: number } | null>(null);
  const [domainMaps, setDomainMaps] = useState<Map<SurfaceRole, Uint8Array>>(new Map());
  const [thicknessMaps, setThicknessMaps] = useState<Map<SurfaceRole, Float32Array>>(new Map());

  const [thicknessMode, setThicknessMode] = useState<{
    domain: string;
    scaleMin: number;
    scaleMax: number;
    hideBelow: number | null;
  } | null>(null);


  useEffect(() => {
    const base = import.meta.env.BASE_URL ?? '/';
    const wasmUrl = `${base}spatial_engine_bg.wasm`;

    initWorker(wasmUrl)
      .then(() => {
        setUseWorker(true);
        setWasmReady(true);
      })
      .catch(() => {
        console.warn('Worker init failed, falling back to main thread');
        initWasm().then(() => setWasmReady(true));
      });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (measureTool !== 'none') {
          setMeasureTool('none');
          setMeasurePoints([]);
          return;
        }
        if (isDrawingSection) {
          setIsDrawingSection(false);
          return;
        }
        if (isDrawing) {
          cancelDrawing();
          return;
        }
        if (selectedId) {
          setSelectedId(null);
          setSelectionInfo(null);
          return;
        }
      }
      if (!isDrawing) return;
      if (e.key === 'Enter') {
        if (measureTool === 'area' && measurePoints.length >= 3) {
          return;
        }
        finishDrawing();
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        setDrawPoints((p) => p.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDrawing, isDrawingSection, drawPoints, measureTool, selectedId, measurePoints.length]);

  const finishDrawing = useCallback(() => {
    if (drawPoints.length >= 3) {
      const defaultName = `Region ${boundaries.length + 1}`;
      const name = window.prompt('Name this boundary region:', defaultName);
      if (name !== null) {
        setBoundaries((prev) => [...prev, { name: name || defaultName, polygon: drawPoints }]);
      }
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
    setMeasureTool('none');
    setMeasurePoints([]);
  }, []);

  const snapDist = useMemo(() => {
    let maxDim = 100;
    for (const d of flatDomains) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < d.vertexCount; i++) {
        const x = d.positions[i * 3], y = d.positions[i * 3 + 1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      maxDim = Math.max(maxDim, maxX - minX, maxY - minY);
    }
    return maxDim * 0.01;
  }, [flatDomains]);

  const handleAddDrawPoint = useCallback(
    (x: number, y: number) => {
      if (!isDrawing) return;
      setDrawPoints((prev) => {
        if (prev.length >= 3) {
          const [fx, fy] = prev[0];
          const dist = Math.sqrt((x - fx) ** 2 + (y - fy) ** 2);
          if (dist < snapDist) {
            setTimeout(() => finishDrawing(), 0);
            return prev;
          }
        }
        return [...prev, [x, y]];
      });
    },
    [isDrawing, finishDrawing, snapDist],
  );

  const handleStart = useCallback((name: string, m: Mode) => {
    setComparisonName(name);
    setMode(m);
    setStep('workspace');
  }, []);

  const handleFileSelected = useCallback(
    async (role: SurfaceRole, file: File) => {
      try {
        setProgress({ phase: 'parsing', value: 0.1 });

        let upload: UploadedSurface;

        if (file.name.endsWith('.json')) {
          const text = await file.text();
          if (useWorker) {
            const flat = await workerParseSurfaceJson(role, text, file.name);
            upload = { role, fileName: file.name, name: flat.name, positions: flat.positions, indices: flat.indices, vertexCount: flat.vertexCount, triangleCount: flat.triangleCount };
          } else {
            const surface = JSON.parse(text) as TriSurface;
            surface.name = surface.name || file.name.replace(/\.[^.]+$/, '');
            upload = triSurfaceToUpload(surface, role, file.name);
          }
        } else {
          const buffer = await file.arrayBuffer();
          if (useWorker) {
            const flat = await workerParseSurface(
              role, buffer, file.name,
              (phase, value) => setProgress({ phase, value }),
            );
            upload = { role, fileName: file.name, name: flat.name, positions: flat.positions, indices: flat.indices, vertexCount: flat.vertexCount, triangleCount: flat.triangleCount };
          } else {
            const data = new Uint8Array(buffer);
            const surfaces = parseSurfaces(data);
            if (surfaces.length === 0) {
              setProgress(null);
              alert(`No surfaces found in ${file.name}`);
              return;
            }
            const surface = surfaces[0];
            surface.name = surface.name || file.name.replace(/\.[^.]+$/, '');
            upload = triSurfaceToUpload(surface, role, file.name);
          }
        }

        const next = new Map(uploads);
        next.set(role, upload);
        setUploads(next);
        setSurfaceVisible(prev => new Set([...prev, role]));

      } catch (e: any) {
        setError(e.message || String(e));
      } finally {
        setProgress(null);
      }
    },
    [useWorker, uploads],
  );

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
      const fn = `${cfg.label.toLowerCase().replace(/ /g, '_')}_sample.json`;
      next.set(key, makeSampleUpload(cfg.z, cfg.label, key, fn));

      if (useWorker) {
        const surface: TriSurface = {
          name: cfg.label,
          vertices: [
            { x: 0, y: 0, z: cfg.z }, { x: 20, y: 0, z: cfg.z },
            { x: 20, y: 20, z: cfg.z }, { x: 0, y: 20, z: cfg.z },
          ],
          indices: [[0, 1, 2], [0, 2, 3]],
        };
        workerParseSurfaceJson(key, JSON.stringify(surface), fn).catch(() => {});
      }
    }
    setUploads(next);
    setSurfaceVisible(new Set(SURFACE_ROLES.map(r => r.key)));
  }, [mode, useWorker]);

  const handleRun = useCallback(async () => {
    setError(null);
    setIsRunning(true);
    setResult(null);
    setFlatDomains([]);

    try {
      if (useWorker) {
        setProgress({ phase: 'conformance', value: 0.1 });

        const flatResult = await workerRunConformance(
          mode,
          settings.minVolume,
          settings.minThickness,
          boundaries,
          (phase, value) => setProgress({ phase, value }),
        );

        const domainSolids = flatResult.flatDomains.map(flatDomainToLightDomainSolid);
        const conformanceResult: ConformanceResult = {
          mode: flatResult.mode,
          domains: domainSolids,
          summary: flatResult.summary,
        };

        setFlatDomains(flatResult.flatDomains);
        setResult(conformanceResult);
        setVisible(new Set<string>());
        setSurfaceVisible(new Set<SurfaceRole>());

        if (flatResult.domainMaps) {
          const maps = new Map<SurfaceRole, Uint8Array>();
          for (const [role, arr] of Object.entries(flatResult.domainMaps)) {
            if (arr && arr.length > 0) {
              maps.set(role as SurfaceRole, arr);
            }
          }
          setDomainMaps(maps);
        }
        if (flatResult.thicknessMaps) {
          const maps = new Map<SurfaceRole, Float32Array>();
          for (const [role, arr] of Object.entries(flatResult.thicknessMaps)) {
            if (arr && arr.length > 0) {
              maps.set(role as SurfaceRole, arr);
            }
          }
          setThicknessMaps(maps);
        }
      } else {
        await new Promise((r) => requestAnimationFrame(r));

        const surfaces: Partial<Record<string, TriSurface>> = {};
        for (const { key } of SURFACE_ROLES) {
          const entry = uploads.get(key);
          if (entry) {
            const verts: Vec3[] = [];
            for (let i = 0; i < entry.vertexCount; i++) {
              verts.push({ x: entry.positions[i * 3], y: entry.positions[i * 3 + 1], z: entry.positions[i * 3 + 2] });
            }
            const idxs: [number, number, number][] = [];
            for (let i = 0; i < entry.triangleCount; i++) {
              idxs.push([entry.indices[i * 3], entry.indices[i * 3 + 1], entry.indices[i * 3 + 2]]);
            }
            surfaces[key] = { name: entry.name, vertices: verts, indices: idxs };
          }
        }

        const res =
          boundaries.length > 0
            ? runConformanceWithBoundaries(surfaces, mode, settings.minVolume, settings.minThickness, boundaries)
            : runConformance(surfaces, mode, settings.minVolume, settings.minThickness);

        const flat: FlatDomainSolid[] = res.domains.map(d => {
          const positions = new Float32Array(d.solid.vertices.length * 3);
          for (let i = 0; i < d.solid.vertices.length; i++) {
            positions[i * 3] = d.solid.vertices[i].x;
            positions[i * 3 + 1] = d.solid.vertices[i].y;
            positions[i * 3 + 2] = d.solid.vertices[i].z;
          }
          const indices = new Uint32Array(d.solid.indices.length * 3);
          for (let i = 0; i < d.solid.indices.length; i++) {
            indices[i * 3] = d.solid.indices[i][0];
            indices[i * 3 + 1] = d.solid.indices[i][1];
            indices[i * 3 + 2] = d.solid.indices[i][2];
          }
          return {
            domain: d.domain,
            label: d.label,
            color: d.color,
            volume: d.volume,
            block_name: d.block_name,
            positions,
            indices,
            vertexCount: d.solid.vertices.length,
            triangleCount: d.solid.indices.length,
            surface_area: d.solid.surface_area,
          };
        });

        setFlatDomains(flat);
        setResult(res);
        setVisible(new Set(res.domains.map((d) => d.domain)));
        setSurfaceVisible(new Set<SurfaceRole>());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
      setProgress(null);
    }
  }, [uploads, mode, settings, boundaries, useWorker]);

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

  const handleDomainStyleChange = useCallback((domain: string, style: ObjectStyle) => {
    setDomainStyles((prev) => {
      const next = new Map(prev);
      next.set(domain, style);
      return next;
    });
  }, []);

  const handleSurfaceStyleChange = useCallback((role: SurfaceRole, style: ObjectStyle) => {
    setSurfaceStyles((prev) => {
      const next = new Map(prev);
      next.set(role, style);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string | null, info: SelectionInfo | null) => {
    setSelectedId(id);
    setSelectionInfo(info);
  }, []);

  const handleAddMeasurePoint = useCallback((point: MeasurePoint) => {
    setMeasurePoints((prev) => {
      if (measureTool === 'distance') {
        if (prev.length === 1) {
          const p1 = prev[0].position;
          const p2 = point.position;
          const dist = p1.distanceTo(p2);
          setSavedMeasurements((sm) => [
            ...sm,
            { id: ++measureIdRef.current, p1: p1.clone(), p2: p2.clone(), distance: dist },
          ]);
          return [];
        }
        return [point];
      }
      if (measureTool === 'elevation') return [point];
      return [...prev, point];
    });
  }, [measureTool]);

  const handleMeasureToolChange = useCallback((tool: MeasureTool) => {
    setMeasureTool(tool);
    setMeasurePoints([]);
    if (tool !== 'none') {
      setIsDrawing(false);
      setIsDrawingSection(false);
      setSelectedId(null);
      setSelectionInfo(null);
    }
  }, []);

  const handleStartSection = useCallback(() => {
    setIsDrawingSection(true);
    setIsDrawing(false);
    setDrawPoints([]);
    setMeasureTool('none');
    setMeasurePoints([]);
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

  const pitBounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let found = false;
    for (const upload of uploads.values()) {
      for (let i = 0; i < upload.vertexCount; i++) {
        const x = upload.positions[i * 3];
        const y = upload.positions[i * 3 + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
    return found ? { minX, maxX, minY, maxY } : null;
  }, [uploads]);

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

  const canRun = uploads.size >= 2;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* Progress bar */}
      {(progress || isRunning) && (
        <div className="absolute left-0 right-0 top-11 z-50 h-1 bg-slate-800">
          <div
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: progress ? `${Math.max(progress.value * 100, 5)}%` : '100%' }}
          />
          {progress && (
            <div className="absolute left-1/2 top-1.5 -translate-x-1/2 rounded bg-slate-900/90 px-2 py-0.5 text-[10px] text-slate-300">
              {progress.phase === 'parsing' && 'Parsing surface...'}
              {progress.phase === 'converting' && 'Preparing data...'}
              {progress.phase === 'conformance' && 'Running conformance...'}
              {progress.phase === 'transferring' && 'Transferring results...'}
              {progress.phase === 'Preparing surfaces' && 'Preparing surfaces...'}
              {progress.phase === 'Computing conformance' && 'Computing conformance...'}
              {progress.phase === 'Transferring results' && 'Transferring results...'}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <header className="flex h-11 flex-shrink-0 items-center justify-between border-b border-slate-700 bg-slate-900 px-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setStep('landing');
              setResult(null);
              setFlatDomains([]);
              setDomainMaps(new Map());
              setThicknessMaps(new Map());
              setThicknessMode(null);
              setUploads(new Map());
              setBoundaries([]);
              setMainTab('viewer');
              setSectionLine(null);
              setIsDrawingSection(false);
              setMeasureTool('none');
              setMeasurePoints([]);
              setSelectedId(null);
              setSelectionInfo(null);
              if (useWorker) workerClearSurfaces();
            }}
            className="text-sm text-slate-500 transition-colors hover:text-slate-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-sm font-semibold text-slate-200">{comparisonName}</h1>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              mode === 'dig'
                ? 'bg-amber-900/50 text-amber-400'
                : 'bg-emerald-900/50 text-emerald-400'
            }`}
          >
            {mode}
          </span>
        </div>

        {/* Toolbar */}
        {result && mainTab === 'viewer' && (
          <div className="flex items-center gap-1">
            {/* Background toggle */}
            <button
              type="button"
              onClick={() => setBackground(b => b === 'dark' ? 'light' : 'dark')}
              className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
              title={`Background: ${background}`}
            >
              {background === 'dark' ? (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              )}
            </button>

            <div className="mx-1 h-4 w-px bg-slate-700" />

            {/* Measure tools */}
            <div className="flex items-center gap-0.5 rounded bg-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => handleMeasureToolChange(measureTool === 'distance' ? 'none' : 'distance')}
                className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                  measureTool === 'distance' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
                title="Measure distance"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => handleMeasureToolChange(measureTool === 'area' ? 'none' : 'area')}
                className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                  measureTool === 'area' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
                title="Measure area"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
                </svg>
              </button>
              {savedMeasurements.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSavedMeasurements([]); setMeasurePoints([]); }}
                  className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                  title="Clear all measurements"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>

            <div className="mx-1 h-4 w-px bg-slate-700" />

            {/* Section tools */}
            {isDrawingSection ? (
              <button
                type="button"
                onClick={() => setIsDrawingSection(false)}
                className="rounded bg-amber-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-500"
              >
                Cancel
              </button>
            ) : sectionLine ? (
              <button
                type="button"
                onClick={handleClearSection}
                className="rounded px-2 py-1 text-[10px] font-medium text-amber-400 hover:bg-slate-700"
              >
                ✂ Clear Section
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartSection}
                className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 hover:bg-slate-700 hover:text-white"
                title="Cross Section"
              >
                ✂ Section
              </button>
            )}

            <button
              type="button"
              onClick={handleCapture}
              className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 hover:bg-slate-700 hover:text-white"
              title="Capture View"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>


          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-64 flex-shrink-0 flex-col overflow-y-auto bg-sidebar text-slate-200 scrollbar-thin">
          <UploadZone
            uploads={uploads}
            onFileSelected={handleFileSelected}
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
              disabled={!canRun || isRunning || !wasmReady}
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
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </div>

          {/* Tab switcher */}
          {result && (
            <div className="sidebar-section">
              <div className="flex rounded-lg bg-slate-800/50 p-0.5">
                <button
                  type="button"
                  onClick={() => setMainTab('viewer')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mainTab === 'viewer' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  3D View
                </button>
                <button
                  type="button"
                  onClick={() => setMainTab('reports')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mainTab === 'reports' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
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
              domainStyles={domainStyles}
              surfaceStyles={surfaceStyles}
              onDomainStyleChange={handleDomainStyleChange}
              onSurfaceStyleChange={handleSurfaceStyleChange}
              thicknessMode={thicknessMode}
              onThicknessModeChange={setThicknessMode}
              domainMaps={domainMaps}
              thicknessMaps={thicknessMaps}
            />
          )}
        </aside>

        {/* Main content */}
        <main className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {result ? (
              <>
                <div
                  style={{ display: mainTab === 'reports' ? 'block' : 'none' }}
                  className="h-full overflow-hidden"
                >
                  <ReportPanel
                    result={result}
                    mode={mode}
                    boundaries={boundaries}
                    comparisonName={comparisonName}
                    canvasRef={canvasRef}
                  />
                </div>
                <div
                  style={{ display: mainTab === 'viewer' ? 'flex' : 'none' }}
                  className="h-full flex-col"
                >
                  {crossSectionData && sectionLine ? (
                    <div className="relative h-full" style={{ minHeight: 0 }}>
                      <CrossSectionPanel
                        data={crossSectionData}
                        onClose={handleClearSection}
                        surfaceVisible={surfaceVisible}
                        domainVisible={visible}
                        domainStyles={domainStyles}
                        surfaceStyles={surfaceStyles}
                        sectionLine={sectionLine}
                        pitBounds={pitBounds}
                        onSelectProfile={(role) => setSelectedId(`surface:${role}`)}
                        onSelectSolid={(domain) => setSelectedId(`domain:${domain}`)}
                      />
                    </div>
                  ) : (
                    <div className="relative h-full" style={{ minHeight: 0 }}>
                      <DomainLegend
                        domains={[...(() => {
                          const grouped = new Map<string, { name: string; color: string; volume: number }>();
                          for (const d of result.domains) {
                            const existing = grouped.get(d.domain);
                            if (existing) {
                              existing.volume += d.volume;
                            } else {
                              grouped.set(d.domain, { name: d.label, color: d.color, volume: d.volume });
                            }
                          }
                          return grouped.values();
                        })()]}
                        isDark={background === 'dark'}
                      />
                      <Viewer
                        ref={viewerRef}
                        flatDomains={flatDomains}
                        visible={visible}
                        canvasRef={canvasRef}
                        boundaries={boundaries}
                        isDrawing={isDrawing}
                        drawPoints={drawPoints}
                        onAddDrawPoint={handleAddDrawPoint}
                        onFinishDrawing={finishDrawing}
                        uploads={uploads}
                        surfaceVisible={surfaceVisible}
                        isDrawingSection={isDrawingSection}
                        sectionLine={sectionLine}
                        onSectionLineChange={setSectionLine}
                        onSectionDrawComplete={handleSectionDrawComplete}
                        background={background}
                        domainStyles={domainStyles}
                        surfaceStyles={surfaceStyles}
                        selectedId={selectedId}
                        onSelect={handleSelect}
                        measureTool={measureTool}
                        measurePoints={measurePoints}
                        onAddMeasurePoint={handleAddMeasurePoint}
                        savedMeasurements={savedMeasurements}
                        showPerf={showPerf}
                        domainMaps={domainMaps}
                        thicknessMaps={thicknessMaps}

                        thicknessMode={thicknessMode}
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center bg-slate-900">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800">
                    <svg className="h-8 w-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V15m0 0l-2.25 1.313M3 16.5v-2.25m0 0l2.25 1.313M3 14.25l2.25-1.313m11.25 1.313l2.25-1.313m0 0V16.5m0-2.25l2.25 1.313M21 14.25v2.25" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-slate-400">
                    {canRun ? 'Ready to run — click "Run Conformance"' : 'Upload surfaces to get started'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Assign at least 2 surfaces, then run the conformance analysis
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Properties panel */}
          {selectionInfo && mainTab === 'viewer' && (
            <div className="flex w-56 flex-shrink-0 flex-col border-l border-slate-700 bg-slate-900 text-slate-200">
              <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Properties</span>
                <button
                  type="button"
                  onClick={() => { setSelectedId(null); setSelectionInfo(null); }}
                  className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">Type</div>
                  <div className="text-xs font-medium">{selectionInfo.type === 'domain' ? 'Conformance Solid' : 'Input Surface'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">Name</div>
                  <div className="text-xs font-medium">{selectionInfo.label}</div>
                </div>
                {selectionInfo.volume !== undefined && selectionInfo.volume > 0 && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Volume</div>
                    <div className="text-xs font-mono">{formatVolume(selectionInfo.volume)} m³</div>
                  </div>
                )}
                {selectionInfo.blockName && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Block</div>
                    <div className="text-xs font-medium">{selectionInfo.blockName}</div>
                  </div>
                )}
                {selectionInfo.domain && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Domain</div>
                    <div className="text-xs font-medium">{selectionInfo.domain}</div>
                  </div>
                )}
                {selectionInfo.surfaceFileName && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">File</div>
                    <div className="text-xs font-mono truncate">{selectionInfo.surfaceFileName}</div>
                  </div>
                )}
                {selectionInfo.surfaceRole && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Role</div>
                    <div className="text-xs font-medium">
                      {SURFACE_ROLES.find((r) => r.key === selectionInfo.surfaceRole)?.label ?? selectionInfo.surfaceRole}
                    </div>
                  </div>
                )}
                {selectionInfo.vertexCount !== undefined && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Vertices</div>
                    <div className="text-xs font-mono">{selectionInfo.vertexCount.toLocaleString()}</div>
                  </div>
                )}
                {selectionInfo.triangleCount !== undefined && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Triangles</div>
                    <div className="text-xs font-mono">{selectionInfo.triangleCount.toLocaleString()}</div>
                  </div>
                )}
                {selectionInfo.bbox && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Bounding Box</div>
                    <div className="grid grid-cols-[auto_1fr_1fr] gap-x-1.5 gap-y-0.5 text-[10px] font-mono">
                      <span className="text-slate-500">E</span>
                      <span className="text-slate-300">{selectionInfo.bbox.minX.toFixed(1)}</span>
                      <span className="text-slate-300">{selectionInfo.bbox.maxX.toFixed(1)}</span>
                      <span className="text-slate-500">N</span>
                      <span className="text-slate-300">{selectionInfo.bbox.minY.toFixed(1)}</span>
                      <span className="text-slate-300">{selectionInfo.bbox.maxY.toFixed(1)}</span>
                      <span className="text-slate-500">RL</span>
                      <span className="text-slate-300">{selectionInfo.bbox.minZ.toFixed(1)}</span>
                      <span className="text-slate-300">{selectionInfo.bbox.maxZ.toFixed(1)}</span>
                    </div>
                  </div>
                )}
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
