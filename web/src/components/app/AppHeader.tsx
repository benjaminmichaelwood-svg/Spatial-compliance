import { useRef } from 'react';
import type { BoundaryRegion, MeasureTool, Mode, ViewerBackground } from '../../types';
import { SITE_WIDE_KEY } from '../../types';

// Split out of App.tsx (Priority 19: behavior-preserving file breakup — no
// logic changes; JSX moved verbatim). All state stays owned by App.tsx —
// this is a pure prop-driven presentational split, not a state migration.
interface Props {
  comparisonName: string;
  mode: Mode;
  onBack: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSaveProject: () => void;
  onLoadProjectFile: (file: File) => void;

  // Toolbar (only rendered when a result exists and the 3D view tab is active)
  showToolbar: boolean;
  background: ViewerBackground;
  onToggleBackground: () => void;
  measureTool: MeasureTool;
  onMeasureToolChange: (tool: MeasureTool) => void;
  savedMeasurementCount: number;
  onClearMeasurements: () => void;
  isDrawingSection: boolean;
  onCancelSection: () => void;
  sectionLineActive: boolean;
  onClearSection: () => void;
  onStartSection: () => void;
  onCapture: () => void;

  // Priority R2 (PPTX & Reporting action list): a lightweight "which pit
  // is this capture for" selector shared by the camera-view capture here
  // and the cross-section capture in CrossSectionPanel — see App.tsx's
  // captureTarget state for why this exists rather than inferring an
  // "active pit" some other way (nothing else in the app tracks one).
  boundaries: BoundaryRegion[];
  captureTarget: string;
  onCaptureTargetChange: (target: string) => void;
  hasSavedCameraView: boolean;
  onSaveCameraView: () => void;
  onResetCameraView: () => void;

  // Priority R7: guided "Report Setup" mode drives captureTarget itself as
  // it steps through targets, so the manual selector/Save/Reset controls
  // are disabled while it's running to avoid two things fighting over the
  // same target at once — the wizard's own overlay (ReportSetupOverlay)
  // is the only capture control while active.
  wizardActive: boolean;
  onStartReportSetup: () => void;
}

export default function AppHeader({
  comparisonName, mode, onBack, canUndo, canRedo, onUndo, onRedo, onSaveProject, onLoadProjectFile,
  showToolbar, background, onToggleBackground, measureTool, onMeasureToolChange,
  savedMeasurementCount, onClearMeasurements, isDrawingSection, onCancelSection,
  sectionLineActive, onClearSection, onStartSection, onCapture,
  boundaries, captureTarget, onCaptureTargetChange, hasSavedCameraView, onSaveCameraView, onResetCameraView,
  wizardActive, onStartReportSetup,
}: Props) {
  const loadProjectInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="flex h-11 flex-shrink-0 items-center justify-between border-b border-slate-700 bg-slate-900 px-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
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
        <div className="ml-2 flex items-center gap-1 border-l border-slate-700 pl-2">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl/Cmd+Z) — settings, boundaries, background"
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white disabled:pointer-events-none disabled:opacity-30"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L4 10m0 0l5-5m-5 5h11a4 4 0 010 8h-1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl/Cmd+Shift+Z)"
            className="mr-1 rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white disabled:pointer-events-none disabled:opacity-30"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l5-5m0 0l-5-5m5 5H9a4 4 0 000 8h1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onSaveProject}
            title="Save Project — download a file capturing settings, roles, and boundaries (not the surface data itself)"
            className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
          >
            Save Project
          </button>
          <button
            type="button"
            onClick={() => loadProjectInputRef.current?.click()}
            title="Load Project — restore settings/roles/boundaries from a saved project file, then re-attach surface files"
            className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
          >
            Load Project
          </button>
          <input
            ref={loadProjectInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onLoadProjectFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center gap-1">
          {/* Background toggle */}
          <button
            type="button"
            onClick={onToggleBackground}
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
              onClick={() => onMeasureToolChange(measureTool === 'distance' ? 'none' : 'distance')}
              className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                measureTool === 'distance' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
              title="Measure distance (click two points)"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2 17l3-3 2 2 3-3 2 2 3-3 2 2 3-3 2 2 1-1V7L20 5 5 20H2v-3z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onMeasureToolChange(measureTool === 'area' ? 'none' : 'area')}
              className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                measureTool === 'area' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
              title="Measure area"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
              </svg>
            </button>
            {savedMeasurementCount > 0 && (
              <button
                type="button"
                onClick={onClearMeasurements}
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
              onClick={onCancelSection}
              className="rounded bg-amber-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-500"
            >
              Cancel
            </button>
          ) : sectionLineActive ? (
            <button
              type="button"
              onClick={onClearSection}
              className="rounded px-2 py-1 text-[10px] font-medium text-amber-400 hover:bg-slate-700"
            >
              ✂ Clear Section
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartSection}
              className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 hover:bg-slate-700 hover:text-white"
              title="Cross Section"
            >
              ✂ Section
            </button>
          )}

          <button
            type="button"
            onClick={onCapture}
            className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 hover:bg-slate-700 hover:text-white"
            title="Capture View"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          <div className="mx-1 h-4 w-px bg-slate-700" />

          {/* Priority R2: saved report view for a pit — distinct from the
              plain PNG "Capture View" button above. This one saves the
              camera's position/orbit target so a regenerated report can
              reproduce this exact angle for `captureTarget` automatically,
              rather than downloading an image right now. */}
          <select
            value={captureTarget}
            onChange={(e) => onCaptureTargetChange(e.target.value)}
            disabled={wizardActive}
            title="Report target — which pit this saved view applies to"
            className="rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-[10px] font-medium text-slate-300 outline-none hover:border-slate-600 disabled:opacity-40"
          >
            <option value={SITE_WIDE_KEY}>Site-wide</option>
            {boundaries.map((b) => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </select>
          <span
            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${hasSavedCameraView ? 'bg-emerald-400' : 'bg-slate-600'}`}
            title={hasSavedCameraView ? 'This target has a saved report view' : 'No saved view — reports auto-fit this target'}
          />
          <button
            type="button"
            onClick={onSaveCameraView}
            disabled={wizardActive}
            className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 hover:bg-slate-700 hover:text-white disabled:pointer-events-none disabled:opacity-40"
            title={`Save current camera view for report — ${captureTarget === SITE_WIDE_KEY ? 'Site-wide' : captureTarget}`}
          >
            Save View
          </button>
          {hasSavedCameraView && (
            <button
              type="button"
              onClick={onResetCameraView}
              disabled={wizardActive}
              className="rounded px-2 py-1 text-[10px] font-medium text-amber-400 hover:bg-slate-700 disabled:pointer-events-none disabled:opacity-40"
              title="Reset to auto-fit for this target"
            >
              Reset
            </button>
          )}

          <div className="mx-1 h-4 w-px bg-slate-700" />

          {/* Priority R7: guided sequencing on top of R2's existing save
              mechanism — steps through every target (site-wide + each
              pit) in one flow instead of picking each one from the
              selector above individually. */}
          <button
            type="button"
            onClick={onStartReportSetup}
            disabled={wizardActive}
            className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 hover:bg-slate-700 hover:text-white disabled:pointer-events-none disabled:opacity-40"
            title="Guided Report Setup — step through every pit and capture a view for each"
          >
            Report Setup
          </button>
        </div>
      )}
    </header>
  );
}
