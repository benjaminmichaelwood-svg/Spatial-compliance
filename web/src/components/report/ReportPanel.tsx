import { useMemo, useState, useCallback, useRef } from 'react';
import type { BoundaryRegion, ConformanceResult, Mode } from '../../types';
import { exportCSV, exportOOT } from './exports';
import { buildSlides, generatePPTX, type SlideData } from './pptxReport';
import SlidePreview from './SlidePreview';

interface Props {
  result: ConformanceResult;
  mode: Mode;
  boundaries: BoundaryRegion[];
  comparisonName: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export default function ReportPanel({ result, mode, boundaries, comparisonName, canvasRef }: Props) {
  const [generating, setGenerating] = useState(false);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);

  const viewerScreenshot = useMemo(
    () => canvasRef.current?.toDataURL('image/png') ?? null,
    [canvasRef.current],
  );

  const initialSlides = useMemo(
    () => buildSlides(result, mode, boundaries, comparisonName, viewerScreenshot, new Map()),
    [result, mode, boundaries, comparisonName, viewerScreenshot],
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
      await generatePPTX(slides, comparisonName, templateFile);
    } finally {
      setGenerating(false);
    }
  }, [slides, comparisonName, templateFile]);

  const handleExportCSV = useCallback(() => {
    exportCSV(result.domains, result.summary.block_summaries ?? [], `${comparisonName.replace(/\s+/g, '_')}_volumes.csv`);
  }, [result, comparisonName]);

  const handleExportOOT = useCallback(() => {
    exportOOT(result.domains, `${comparisonName.replace(/\s+/g, '_')}_solids.00t`);
  }, [result.domains, comparisonName]);

  const handleTemplateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setTemplateFile(file);
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
        </div>
        <div className="flex items-center gap-2">
          {/* Template upload */}
          <input
            ref={templateInputRef}
            type="file"
            accept="*/*"
            onChange={handleTemplateChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => templateInputRef.current?.click()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            {templateFile ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-3 w-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
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
        />
      </div>
    </div>
  );
}
