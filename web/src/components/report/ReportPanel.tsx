import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { BoundaryRegion, ConformanceResult, Mode, SavedCameraView } from '../../types';
import { SITE_WIDE_KEY } from '../../types';
import type { ViewerHandle } from '../Viewer';
import { exportCSV, exportOOT } from './exports';
import { buildSlides, generatePPTX, type SlideData } from './pptxReport';
import { extractTemplateTheme, type TemplateTheme } from './templateTheme';
import SlidePreview from './SlidePreview';

interface Props {
  result: ConformanceResult;
  mode: Mode;
  boundaries: BoundaryRegion[];
  comparisonName: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  // Priority R2: the always-mounted (CSS-hidden while Reports is active)
  // Viewer is driven through this ref to reproduce a saved camera angle
  // before each screenshot is taken, then restored to what the user had —
  // this capture pass must be invisible to the live 3D view.
  viewerRef: React.RefObject<ViewerHandle | null>;
  savedCameraViews: Map<string, SavedCameraView>;
}

export default function ReportPanel({ result, mode, boundaries, comparisonName, canvasRef, viewerRef, savedCameraViews }: Props) {
  const [generating, setGenerating] = useState(false);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateTheme, setTemplateTheme] = useState<TemplateTheme | null>(null);
  const [templateError, setTemplateError] = useState(false);
  const templateInputRef = useRef<HTMLInputElement>(null);

  const [viewerScreenshot, setViewerScreenshot] = useState<string | null>(null);
  const [pitScreenshots, setPitScreenshots] = useState<Map<string, string>>(new Map());

  // Priority R2: for every target (site-wide, and each pit) that has a
  // saved camera view, apply it and capture a fresh screenshot instead of
  // whatever the live 3D view happens to be showing — reproducing a
  // deliberately-composed angle on every report (re)generation rather than
  // falling back to auto-fit. A target with no saved view keeps this
  // component's prior behavior exactly: site-wide grabs whatever's
  // currently on the canvas (unchanged); a pit with no saved view is left
  // out of pitScreenshots, so addViewerSlide's existing "3D Viewer
  // Screenshot" placeholder still shows for it, same as before this item.
  useEffect(() => {
    let cancelled = false;

    const waitForRepaint = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

    async function captureAll() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const viewer = viewerRef.current;
      const originalState = viewer?.getCameraState() ?? null;

      const siteWideView = savedCameraViews.get(SITE_WIDE_KEY);
      if (siteWideView && viewer) {
        viewer.applyCameraState(siteWideView);
        await waitForRepaint();
      }
      if (cancelled) return;
      setViewerScreenshot(canvas.toDataURL('image/png'));

      const nextPitShots = new Map<string, string>();
      for (const b of boundaries) {
        const view = savedCameraViews.get(b.name);
        if (!view || !viewer) continue;
        viewer.applyCameraState(view);
        await waitForRepaint();
        if (cancelled) return;
        nextPitShots.set(b.name, canvas.toDataURL('image/png'));
      }
      if (!cancelled) {
        setPitScreenshots(nextPitShots);
      }

      if (originalState && viewer) {
        viewer.applyCameraState(originalState);
      }
    }

    captureAll();
    return () => { cancelled = true; };
  }, [result, boundaries, savedCameraViews, canvasRef, viewerRef]);

  const initialSlides = useMemo(
    () => buildSlides(result, mode, boundaries, comparisonName, viewerScreenshot, pitScreenshots),
    [result, mode, boundaries, comparisonName, viewerScreenshot, pitScreenshots],
  );

  const [slides, setSlides] = useState<SlideData[]>(initialSlides);

  const prevSlidesRef = useRef(initialSlides);
  if (prevSlidesRef.current !== initialSlides) {
    prevSlidesRef.current = initialSlides;
    setSlides(initialSlides);
  }

  const handleRemoveSlide = useCallback((id: string) => {
    setSlides(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleDownload = useCallback(async () => {
    setGenerating(true);
    try {
      await generatePPTX(slides, comparisonName, templateTheme);
    } finally {
      setGenerating(false);
    }
  }, [slides, comparisonName, templateTheme]);

  const handleExportCSV = useCallback(() => {
    exportCSV(result.domains, result.summary.block_summaries ?? [], `${comparisonName.replace(/\s+/g, '_')}_volumes.csv`);
  }, [result, comparisonName]);

  const handleExportOOT = useCallback(() => {
    exportOOT(result.domains, `${comparisonName.replace(/\s+/g, '_')}_solids.00t`);
  }, [result.domains, comparisonName]);

  const handleTemplateChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setTemplateFile(file);
    setTemplateTheme(null);
    setTemplateError(false);
    if (!file) return;
    const theme = await extractTemplateTheme(file);
    if (theme) {
      setTemplateTheme(theme);
    } else {
      // Non-fatal by design (matches this feature's existing philosophy —
      // see templateTheme.ts and pptxReport.ts's Priority 20 comments): a
      // template that can't be read falls back to default styling rather
      // than blocking the report, with a small notice so the user knows
      // their upload didn't take effect rather than silently ignoring it.
      setTemplateError(true);
    }
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">{comparisonName} — Report</h2>
          <p className="text-xs text-slate-400">
            {mode.toUpperCase()} mode · {slides.length} slides
          </p>
          {templateError && (
            <p className="text-xs text-amber-600">
              Couldn't read {templateFile?.name} as a PPTX template — using default styling.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Template upload — see templateTheme.ts (Priority 20): extracts
              the template's accent color and, if present, an embedded
              logo, both reflected live in the preview below and in the
              downloaded PPTX. */}
          <input
            ref={templateInputRef}
            type="file"
            accept=".pptx"
            onChange={handleTemplateChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => templateInputRef.current?.click()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            {templateTheme ? (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-sm border border-black/10"
                  style={{ backgroundColor: `#${templateTheme.accentColor}` }}
                  title="Extracted accent color"
                />
                {templateFile?.name}
              </span>
            ) : templateFile ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-3 w-3 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                {templateFile.name}
              </span>
            ) : (
              'Upload Template'
            )}
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportOOT}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Export .00t
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={generating || slides.length === 0}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5">
              {generating ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download PPTX
                </>
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Slide preview */}
      <div className="flex-1 overflow-hidden">
        <SlidePreview
          slides={slides}
          onReorder={setSlides}
          onRemove={handleRemoveSlide}
          templateTheme={templateTheme}
        />
      </div>
    </div>
  );
}
