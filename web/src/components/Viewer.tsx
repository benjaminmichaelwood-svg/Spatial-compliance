import { useRef, useMemo, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, type CanvasProps } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { SurfaceRole, ObjectStyle, ViewPreset, ViewerBackground } from '../types';
import PerformanceOverlay from './PerformanceOverlay';
import ThicknessLegend from './ThicknessLegend';
import { computeMeasureMetrics, computePerVertexThickness } from './viewer/geometryHelpers';
import { SurfaceMesh, BatchedDomainGroup } from './viewer/MeshRenderers';
import {
  AutoFit,
  BoundaryLines,
  ControlsBinder,
  CursorElevation,
  DrawingLayer,
  KeyboardShortcuts,
  MeasureClickHandler,
  MeasureCursorTracker,
  MeasureLabelsProjector,
  MeasureOverlay3D,
  RefPolylinesMesh,
  RefSurfaceMesh,
  SectionLineOverlay,
  SetPivotMode,
  ViewPresetController,
  ZUpEnforcer,
} from './viewer/SceneOverlays';
import type { SelectionInfo, TooltipInfo, ViewerHandle, ViewerProps } from './viewer/types';

// Priority 19 (behavior-preserving file breakup): Viewer.tsx used to define
// every scene component in this one 2100+ line file. It's now split into
// components/viewer/{types,geometryHelpers,MeshRenderers,SceneOverlays}.tsx
// and this file is the orchestrator — the exported <Viewer> component's own
// state/layout/JSX tree, plus the handful of constants and effects that only
// it needs (background colors, default surface colors, drag-and-drop of
// reference files). See CLAUDE.md's Priority 19 session notes for the exact
// module boundaries and why each thing landed where it did. No rendering
// logic, classification logic, or computed output changed in this pass.
//
// TooltipInfo/SelectionInfo/MeasurePoint/SavedMeasurement/ViewerHandle used
// to be defined directly in this file; App.tsx imports them via
// `import type { ... } from './components/Viewer'`, so they're re-exported
// here from their new home (components/viewer/types.ts) to keep that import
// path working unchanged.
export type { TooltipInfo, SelectionInfo, MeasurePoint, SavedMeasurement, ViewerHandle } from './viewer/types';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const DEFAULT_SURFACE_COLORS: Record<SurfaceRole, string> = {
  production_start: '#94a3b8',
  production_end: '#64748b',
  schedule_start: '#7dd3fc',
  schedule_end: '#38bdf8',
  schedule_future: '#a78bfa',
};

const BG_COLORS: Record<ViewerBackground, string> = {
  dark: '#1a1a1a',
  light: '#ffffff',
};

const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer({
  flatDomains, visible, canvasRef, boundaries, isDrawing, drawPoints, onAddDrawPoint, onFinishDrawing,
  uploads, surfaceVisible, isDrawingSection, sectionLine, onSectionLineChange,
  onSectionDrawComplete, background, domainStyles, surfaceStyles, selectedId,
  onSelect, measureTool, measurePoints, onAddMeasurePoint, savedMeasurements, showPerf,
  domainMaps, heatmapMode, refLayers, onRefDrop,
}, ref) {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [isDraggingEndpoint, setIsDraggingEndpoint] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cursorElev, setCursorElev] = useState<{ x: number; y: number; z: number } | null>(null);
  const [liveMeasurePos, setLiveMeasurePos] = useState<{ world: THREE.Vector3; screenX: number; screenY: number } | null>(null);
  const [viewPreset, setViewPreset] = useState<ViewPreset | null>(null);
  const [measureLabels, setMeasureLabels] = useState<{ id: number; x: number; y: number; text: string; dz: string }[]>([]);
  const [pivotMode, setPivotMode] = useState(false);
  const controlsRef = useRef<any>(null);

  const togglePivot = useCallback(() => setPivotMode((v) => !v), []);
  const exitPivot = useCallback(() => setPivotMode(false), []);

  useImperativeHandle(ref, () => ({
    applyPreset: (preset: ViewPreset) => setViewPreset(preset),
    // Priority R2: controlsRef.current is drei's OrbitControls instance
    // (bound via ControlsBinder's `camera.__controls` pattern used
    // elsewhere in this file) — `.object` is the camera it drives,
    // `.target` is the orbit pivot point. Reading/writing both together
    // is the complete camera state for this app's perspective-only,
    // Z-up-enforced camera (no orthographic zoom is used anywhere else
    // in this codebase, so it's deliberately not part of this state).
    getCameraState: () => {
      const controls = controlsRef.current;
      if (!controls) return null;
      const cam = controls.object as THREE.PerspectiveCamera;
      return {
        position: [cam.position.x, cam.position.y, cam.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
    },
    applyCameraState: (state) => {
      const controls = controlsRef.current;
      if (!controls) return;
      controls.object.position.set(...state.position);
      controls.target.set(...state.target);
      controls.update();
    },
  }), []);

  const heatmapThickness = useMemo(() => {
    if (!heatmapMode) return null;
    const paintUpload = uploads.get(heatmapMode.paintRole);
    const refUpload = uploads.get(heatmapMode.refRole);
    if (!paintUpload || !refUpload) return null;
    return computePerVertexThickness(
      paintUpload.positions, paintUpload.vertexCount,
      refUpload.positions, refUpload.indices,
    );
  }, [heatmapMode?.paintRole, heatmapMode?.refRole, uploads]);

  const domainGroups = useMemo(() => {
    const groups = new Map<string, typeof flatDomains>();
    for (const d of flatDomains) {
      if (!groups.has(d.domain)) groups.set(d.domain, []);
      groups.get(d.domain)!.push(d);
    }
    return groups;
  }, [flatDomains]);

  const { displayZ, sphereRadius } = useMemo(() => {
    const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const d of flatDomains) {
      for (let i = 0; i < d.vertexCount; i++) {
        const x = d.positions[i * 3], y = d.positions[i * 3 + 1], z = d.positions[i * 3 + 2];
        if (x < box.minX) box.minX = x;
        if (x > box.maxX) box.maxX = x;
        if (y < box.minY) box.minY = y;
        if (y > box.maxY) box.maxY = y;
        if (z < box.minZ) box.minZ = z;
        if (z > box.maxZ) box.maxZ = z;
      }
    }
    if (!isFinite(box.minX)) return { displayZ: 0, sphereRadius: 1 };
    const maxDim = Math.max(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ);
    return { displayZ: (box.minZ + box.maxZ) / 2, sphereRadius: maxDim * 0.008 };
  }, [flatDomains]);

  const handleCreated = useCallback(
    (state: { gl: THREE.WebGLRenderer }) => {
      (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = state.gl.domElement;
    },
    [canvasRef],
  );

  const handleHover = useCallback((info: TooltipInfo | null) => {
    setTooltip(info);
    if (info) {
      const hId = info.surfaceFileName
        ? `surface-${uploads.entries().next()?.value?.[0] ?? ''}`
        : `domain-${info.domain}-${info.blockName ?? ''}`;
      setHoveredId(hId);
    } else {
      setHoveredId(null);
    }
  }, [uploads]);

  const handleMeshClick = useCallback((id: string, info: SelectionInfo) => {
    if (measureTool !== 'none') return;
    onSelect(id, info);
  }, [measureTool, onSelect]);

  const handleBgClick = useCallback(() => {
    if (measureTool === 'none') {
      onSelect(null, null);
    }
  }, [measureTool, onSelect]);

  const isDark = background === 'dark';

  const [dragOver, setDragOver] = useState(false);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const hasRef = Array.from(e.dataTransfer.items).some(item => {
      if (item.kind !== 'file') return false;
      const name = (item as any).name ?? item.type ?? '';
      return /\.(00t|dxf|arch_d)$/i.test(name);
    });
    if (hasRef || e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      const refFiles: File[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i];
        if (/\.(00t|dxf|arch_d)$/i.test(f.name)) refFiles.push(f);
      }
      if (refFiles.length > 0) {
        const dt = new DataTransfer();
        for (const f of refFiles) dt.items.add(f);
        onRefDrop(dt.files);
      }
    }
  }, [onRefDrop]);

  return (
    <div
      className={`relative h-full w-full ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-indigo-900/30 border-2 border-dashed border-indigo-400 rounded">
          <span className="rounded-lg bg-slate-900/80 px-4 py-2 text-sm font-medium text-indigo-300">
            Drop reference files (.00t, .dxf, .arch_d)
          </span>
        </div>
      )}
      <PerformanceOverlay visible={showPerf} isDark={isDark} />

      {/* View preset buttons */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0.5 rounded-lg bg-black/40 backdrop-blur-sm px-1 py-0.5">
        {([
          { key: 'plan' as ViewPreset, label: 'Plan' },
          { key: 'north' as ViewPreset, label: 'North' },
          { key: 'east' as ViewPreset, label: 'East' },
          { key: 'isometric' as ViewPreset, label: 'Iso' },
          { key: 'fit' as ViewPreset, label: 'Fit All' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setViewPreset(key)}
            className="rounded px-2.5 py-1 text-[10px] font-medium text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            title={label}
          >
            {label}
          </button>
        ))}
      </div>

      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.NoToneMapping }}
        camera={{ fov: 50, near: 0.1, far: 100000, up: [0, 0, 1] } as CanvasProps['camera']}
        onCreated={(state) => {
          state.camera.up.set(0, 0, 1);
          state.camera.updateProjectionMatrix();
          handleCreated(state);
        }}
        onPointerMissed={handleBgClick}
      >
        <color attach="background" args={[BG_COLORS[background]]} />

        <ambientLight intensity={isDark ? 0.3 : 0.45} />
        <directionalLight position={[1, -0.8, 0.4]} intensity={isDark ? 1.0 : 1.1} />
        <directionalLight position={[-0.5, 0.6, 0.2]} intensity={isDark ? 0.3 : 0.4} />
        <directionalLight position={[0.2, 0.3, 1.0]} intensity={isDark ? 0.15 : 0.2} />
        <hemisphereLight
          args={[isDark ? '#334155' : '#d4e5f7', isDark ? '#0f172a' : '#f5f0e6', isDark ? 0.2 : 0.25]}
        />

        {[...domainGroups.entries()].map(([domain, solids]) => {
          const id = `domain-${domain}`;
          const defaultStyle: ObjectStyle = { color: solids[0].color, opacity: 0.85, wireframe: true };
          const style = domainStyles.get(domain) ?? defaultStyle;
          return (
            <BatchedDomainGroup
              key={domain}
              domain={domain}
              solids={solids}
              visible={visible.has(domain)}
              style={style}
              selected={selectedId?.startsWith(id) ?? false}
              highlighted={hoveredId?.startsWith(id) ?? false}
              isDark={isDark}
              onHover={handleHover}
              onSelect={handleMeshClick}
            />
          );
        })}

        {[...uploads.entries()].map(([role, upload]) => {
          if (!surfaceVisible.has(role)) return null;
          const id = `surface-${role}`;
          const hasDomainMap = domainMaps.has(role);
          const defaultStyle: ObjectStyle = {
            color: DEFAULT_SURFACE_COLORS[role],
            opacity: hasDomainMap ? 0.92 : 0.3,
            wireframe: true,
          };
          const style = surfaceStyles.get(role) ?? defaultStyle;
          return (
            <SurfaceMesh
              key={role}
              upload={upload}
              style={style}
              selected={selectedId === id}
              highlighted={hoveredId === id}
              isDark={isDark}
              onHover={handleHover}
              onSelect={handleMeshClick}
              domainMap={domainMaps.get(role)}
              domainVisible={visible}
              heatmapVertexThickness={heatmapThickness}
              heatmapMode={heatmapMode}
            />
          );
        })}

        {refLayers.map(layer => (
          layer.kind === 'surface' && layer.surface ? (
            <RefSurfaceMesh key={layer.id} layer={layer} isDark={isDark} />
          ) : layer.kind === 'lines' && layer.polylines ? (
            <RefPolylinesMesh key={layer.id} layer={layer} />
          ) : null
        ))}

        <SectionLineOverlay
          sectionLine={sectionLine}
          onChange={onSectionLineChange}
          isDrawing={isDrawingSection}
          onDrawComplete={onSectionDrawComplete}
          onDragChange={setIsDraggingEndpoint}
          displayZ={displayZ}
          sphereRadius={sphereRadius}
        />

        <BoundaryLines boundaries={boundaries} displayZ={displayZ} />
        <DrawingLayer points={drawPoints} isDrawing={isDrawing} onAddPoint={onAddDrawPoint} onFinish={onFinishDrawing} displayZ={displayZ} sphereRadius={sphereRadius} />

        <MeasureOverlay3D points={measurePoints} tool={measureTool} savedMeasurements={savedMeasurements} sphereRadius={sphereRadius} liveCursorPos={liveMeasurePos?.world} />
        <MeasureCursorTracker active={measureTool === 'distance' && measurePoints.length === 1} onMove={setLiveMeasurePos} />
        <MeasureClickHandler active={measureTool !== 'none'} onMeasureClick={onAddMeasurePoint} />

        <AutoFit flatDomains={flatDomains} visible={visible} uploads={uploads} />
        <ViewPresetController
          preset={viewPreset}
          flatDomains={flatDomains}
          uploads={uploads}
          onDone={() => setViewPreset(null)}
        />
        <CursorElevation onUpdate={setCursorElev} />
        <MeasureLabelsProjector savedMeasurements={savedMeasurements} onUpdate={setMeasureLabels} />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.1}
          enabled={!isDrawing && !isDrawingSection && !isDraggingEndpoint && measureTool === 'none' && !pivotMode}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          }}
          enableZoom
          zoomSpeed={1.2}
          zoomToCursor
          maxPolarAngle={Math.PI * 0.47}
          minPolarAngle={0.05}
          rotateSpeed={0.8}
          panSpeed={0.8}
        />
        <ControlsBinder controlsRef={controlsRef} />
        <ZUpEnforcer />
        <SetPivotMode controlsRef={controlsRef} active={pivotMode} onDone={exitPivot} />
        <KeyboardShortcuts controlsRef={controlsRef} flatDomains={flatDomains} uploads={uploads} onTogglePivot={togglePivot} />
      </Canvas>

      {heatmapMode && (
        <ThicknessLegend
          scaleMin={heatmapMode.scaleMin}
          scaleMax={heatmapMode.scaleMax}
          isDark={isDark}
          deadband={heatmapMode.deadband}
          surfaceColor={surfaceStyles.get(heatmapMode.paintRole)?.color}
        />
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded bg-black/85 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          {tooltip.surfaceFileName ? (
            <>
              <div className="font-medium">
                {tooltip.surfaceFileName} &mdash; {tooltip.surfaceRoleLabel}
              </div>
              {tooltip.thickness !== undefined && !isNaN(tooltip.thickness) && (
                <div className="text-cyan-300">
                  dZ: {tooltip.thickness > 0 ? '+' : ''}{tooltip.thickness.toFixed(2)}m
                  {tooltip.thickness > 0 ? ' (underdig)' : tooltip.thickness < 0 ? ' (overdig)' : ''}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="font-semibold">{tooltip.domain}</div>
              <div className="text-slate-300">{tooltip.volume.toFixed(1)} m³</div>
              {tooltip.blockName && <div className="text-slate-400">{tooltip.blockName}</div>}
            </>
          )}
        </div>
      )}

      {/* Saved measurement labels */}
      {measureLabels.map((l) => (
        <div
          key={l.id}
          className="pointer-events-none absolute z-40 rounded bg-cyan-900/90 px-2 py-1 text-[10px] font-mono text-cyan-100 shadow -translate-x-1/2 -translate-y-full"
          style={{ left: l.x, top: l.y - 8 }}
        >
          {l.text} | {l.dz}
        </div>
      ))}

      {/* Elevation readout */}
      {cursorElev && (
        <div className={`absolute bottom-2 left-2 rounded px-2 py-1 text-[11px] font-mono ${isDark ? 'bg-black/70 text-slate-300' : 'bg-white/90 text-slate-600'} shadow`}>
          RL: {cursorElev.z.toFixed(2)}m
        </div>
      )}

      {/* Measure result overlay */}
      {measureTool === 'area' && measurePoints.length >= 3 && (() => {
        let area = 0;
        const pts = measurePoints.map(p => p.position);
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
        }
        area = Math.abs(area) / 2;
        return (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded bg-cyan-900/90 px-3 py-1.5 text-xs font-medium text-cyan-100 shadow">
            Area: {area.toFixed(1)} m²
          </div>
        );
      })()}

      {/* Drawing mode indicators */}
      {isDrawing && (
        <div className="absolute left-3 top-3 rounded bg-orange-500/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          Click to place points · Double-click or press Enter to close
        </div>
      )}
      {pivotMode && (
        <div className="absolute left-3 top-3 rounded bg-violet-600/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          Click a surface to set orbit pivot · Escape to cancel
        </div>
      )}
      {isDrawingSection && (
        <div className="absolute left-3 top-3 rounded bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          Click two points to define section line
        </div>
      )}
      {measureTool !== 'none' && (
        <div className="absolute left-3 top-3 rounded bg-cyan-600/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          {measureTool === 'distance' && measurePoints.length === 0 && 'Click first point to measure distance'}
          {measureTool === 'distance' && measurePoints.length === 1 && !liveMeasurePos && 'Move cursor over surface...'}
          {measureTool === 'elevation' && 'Hover over surfaces to read elevation'}
          {measureTool === 'area' && `Click points to define area · ${measurePoints.length} placed · Press Enter to close`}
        </div>
      )}
      {measureTool === 'distance' && measurePoints.length === 1 && liveMeasurePos && (() => {
        const m = computeMeasureMetrics(measurePoints[0].position, liveMeasurePos.world);
        return (
          <div
            className="pointer-events-none absolute z-50 rounded bg-slate-900/95 px-3 py-2 text-[11px] text-white shadow-lg border border-cyan-500/40"
            style={{ left: liveMeasurePos.screenX + 16, top: liveMeasurePos.screenY - 80 }}
          >
            <div className="mb-1 text-[10px] text-slate-400 font-mono">
              ({liveMeasurePos.world.x.toFixed(2)}; {liveMeasurePos.world.y.toFixed(2)}; {liveMeasurePos.world.z.toFixed(2)})
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <span className="text-cyan-300">Length:</span><span className="font-mono">{m.dist3d.toFixed(2)}</span>
              <span className="text-cyan-300">Plan Length:</span><span className="font-mono">{m.planLen.toFixed(2)}</span>
              <span className="text-cyan-300">dZ:</span><span className="font-mono">{m.dz >= 0 ? '+' : ''}{m.dz.toFixed(2)}</span>
              <span className="text-cyan-300">Bearing:</span><span className="font-mono">{m.bearingDeg.toFixed(1)}°</span>
              <span className="text-cyan-300">Grade:</span><span className="font-mono">{m.gradeDeg.toFixed(1)}° ({Math.abs(m.gradePercent).toFixed(1)}%)</span>
            </div>
            <div className="mt-0.5 text-[9px] text-cyan-400">Click to lock measurement</div>
          </div>
        );
      })()}
    </div>
  );
});

export default Viewer;
