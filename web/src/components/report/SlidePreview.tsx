import { useState, useCallback, useMemo } from 'react';
import type { SlideData } from './pptxReport';
import WaterfallChart from './WaterfallChart';
import DonutGauge from './DonutGauge';

interface Props {
  slides: SlideData[];
  onReorder: (slides: SlideData[]) => void;
  onRemove: (id: string) => void;
}

function formatVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}

function ViewerSlideContent({ slide }: { slide: SlideData }) {
  return (
    <div className="flex h-full w-full gap-3 p-4">
      <div className="flex-1 overflow-hidden rounded-lg bg-slate-100">
        {slide.viewerScreenshot ? (
          <img
            src={slide.viewerScreenshot}
            alt="3D View"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            3D Viewer Screenshot
          </div>
        )}
      </div>
      <div className="flex w-44 flex-shrink-0 flex-col items-center gap-3">
        <DonutGauge value={slide.conformancePct} label="Conformance" mode="conformance" />
        <DonutGauge value={slide.productionPct} label="Production" mode="production" />
        <div className="mt-auto grid w-full grid-cols-3 gap-1 text-center">
          <div>
            <div className="text-[9px] text-slate-400">Planned</div>
            <div className="text-[11px] font-semibold text-slate-700">{formatVol(slide.plannedVol)}</div>
          </div>
          <div>
            <div className="text-[9px] text-slate-400">Actual</div>
            <div className="text-[11px] font-semibold text-slate-700">{formatVol(slide.actualVol)}</div>
          </div>
          <div>
            <div className="text-[9px] text-slate-400">Net</div>
            <div className="text-[11px] font-semibold text-slate-700">{formatVol(slide.plannedVol - slide.actualVol)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WaterfallSlideContent({ slide }: { slide: SlideData }) {
  return (
    <div className="flex h-full w-full flex-col p-4">
      <WaterfallChart domains={slide.domains} mode={slide.mode} />
    </div>
  );
}

export default function SlidePreview({ slides, onReorder, onRemove }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);

  const clampedIndex = Math.min(activeIndex, Math.max(slides.length - 1, 0));
  const activeSlide = slides[clampedIndex];

  const goNext = useCallback(() => {
    setActiveIndex(i => Math.min(i + 1, slides.length - 1));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setActiveIndex(i => Math.max(i - 1, 0));
  }, []);

  const moveSlide = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= slides.length) return;
      const next = [...slides];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onReorder(next);
      setActiveIndex(to);
    },
    [slides, onReorder],
  );

  const handleRemove = useCallback(
    (id: string) => {
      onRemove(id);
      setActiveIndex(i => Math.min(i, slides.length - 2));
    },
    [onRemove, slides.length],
  );

  if (slides.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        No slides to preview
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Main slide view */}
      <div className="relative flex-1 overflow-hidden bg-white">
        {/* Slide header */}
        <div className="border-b border-slate-200 px-6 py-3">
          <h3 className="text-base font-semibold text-slate-800">{activeSlide?.title}</h3>
          <p className="text-xs text-slate-400">{activeSlide?.subtitle}</p>
        </div>

        {/* Slide content */}
        <div className="h-[calc(100%-6rem)] overflow-hidden">
          {activeSlide && (
            activeSlide.type === 'pit-viewer' || activeSlide.type === 'summary-viewer'
              ? <ViewerSlideContent slide={activeSlide} />
              : <WaterfallSlideContent slide={activeSlide} />
          )}
        </div>

        {/* Navigation arrows */}
        <button
          type="button"
          onClick={goPrev}
          disabled={clampedIndex === 0}
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-slate-900/60 p-2 text-white transition-opacity hover:bg-slate-900/80 disabled:opacity-20"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={clampedIndex >= slides.length - 1}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-slate-900/60 p-2 text-white transition-opacity hover:bg-slate-900/80 disabled:opacity-20"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Slide counter */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/60 px-3 py-1 text-xs text-white">
          {clampedIndex + 1} / {slides.length}
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50">
        <div className="flex gap-2 overflow-x-auto px-3 py-2 scrollbar-thin">
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              className="group relative flex-shrink-0"
            >
              <button
                type="button"
                onClick={() => setActiveIndex(i)}
                className={`flex h-16 w-28 flex-col items-start justify-between rounded-md border-2 p-1.5 text-left transition-colors ${
                  i === clampedIndex
                    ? 'border-indigo-500 bg-white'
                    : 'border-transparent bg-white hover:border-slate-300'
                }`}
              >
                <span className="truncate text-[8px] font-semibold text-slate-700 w-full">
                  {slide.title}
                </span>
                <span className="text-[7px] text-slate-400">
                  {slide.type.includes('viewer') ? '3D View' : 'Waterfall'}
                </span>
              </button>

              {/* Reorder / remove controls */}
              <div className="absolute -right-0.5 -top-0.5 hidden gap-0.5 group-hover:flex">
                {i > 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); moveSlide(i, i - 1); }}
                    className="rounded bg-slate-700 p-0.5 text-white hover:bg-slate-600"
                    title="Move left"
                  >
                    <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                {i < slides.length - 1 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); moveSlide(i, i + 1); }}
                    className="rounded bg-slate-700 p-0.5 text-white hover:bg-slate-600"
                    title="Move right"
                  >
                    <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleRemove(slide.id); }}
                  className="rounded bg-red-600 p-0.5 text-white hover:bg-red-500"
                  title="Remove slide"
                >
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
