import { useState, useCallback } from 'react';
import type { PitDomainVolumes, SlideData } from './pptxReport';
import type { TemplateTheme } from './templateTheme';
import WaterfallChart from './WaterfallChart';
import DonutGauge from './DonutGauge';
import DefinitionsSchematic from './DefinitionsSchematic';
import { getDomainDefs } from './definitionsData';

interface Props {
  slides: SlideData[];
  onReorder: (slides: SlideData[]) => void;
  onRemove: (id: string) => void;
  /** Extracted from an uploaded PPTX template — see templateTheme.ts (Priority 20). Null when no template is uploaded (or it couldn't be read), in which case every slide renders exactly as it did before this feature existed. */
  templateTheme?: TemplateTheme | null;
}

function formatVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}

// Priority R4: compact per-domain volume table shown alongside the
// existing gauges/KPIs on a pit-viewer slide's live preview — reads
// exclusively from slide.domainVolumes (the exact confVol/pnmVol/etc.
// buildSlides already computed to derive plannedVol/actualVol/
// conformancePct/productionPct) so it can never disagree with the gauges
// or KPI numbers on the same slide. Uses abbreviations (getDomainDefs'
// own `.abbrev`, the same set the Definitions slide's legend already
// shows) rather than full names — this preview column is only ~176px
// wide, nowhere near the ~5.6" this table gets in the actual exported
// slide (addViewerSlide/buildDomainTableRows), so it's a compact
// adaptation for the space available, not a different set of numbers.
function DomainVolumeRow({ label, color, vol }: { label: string; color?: string; vol: number }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="flex min-w-0 items-center gap-1">
        {color && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: color }} />}
        <span className="truncate text-[7px] text-slate-600">{label}</span>
      </span>
      <span className="flex-shrink-0 text-[7px] font-medium text-slate-700">{formatVol(vol)}</span>
    </div>
  );
}

function DomainVolumeTable({ slide, dv }: { slide: SlideData; dv: PitDomainVolumes }) {
  const defs = getDomainDefs(slide.mode);
  const byKey = new Map(defs.map(d => [d.key, d]));
  const conformKey = slide.mode === 'dig' ? 'PlannedAndMined' : 'PlannedAndDumped';
  const pnmKey = slide.mode === 'dig' ? 'PlannedNotMined' : 'PlannedNotDumped';
  const mbsKey = slide.mode === 'dig' ? 'MinedBeforeStart' : 'DumpedBeforeStart';
  const mnpKey = slide.mode === 'dig' ? 'MinedNotPlanned' : 'DumpedNotPlanned';
  const psdKey = slide.mode === 'dig' ? 'PrescheduleDelay' : 'DumpPrescheduleDelay';
  const aopKey = slide.mode === 'dig' ? 'AheadOfPlan' : 'DumpedAheadOfPlan';
  const actionLabel = slide.mode === 'dig' ? 'Mined' : 'Dumped';

  return (
    <div className="w-full space-y-1.5 border-t border-slate-200 pt-2">
      <div>
        <div className="mb-0.5 text-[7px] font-semibold uppercase tracking-wide text-slate-400">Plan</div>
        <DomainVolumeRow label={byKey.get(conformKey)?.abbrev ?? conformKey} color={byKey.get(conformKey)?.color} vol={dv.confVol} />
        <DomainVolumeRow label={byKey.get(pnmKey)?.abbrev ?? pnmKey} color={byKey.get(pnmKey)?.color} vol={dv.pnmVol} />
        <DomainVolumeRow label={byKey.get(mbsKey)?.abbrev ?? mbsKey} color={byKey.get(mbsKey)?.color} vol={dv.mbsVol} />
        <div className="flex items-center justify-between border-t border-slate-100 pt-0.5 text-[7px] font-semibold text-slate-700">
          <span>Subtotal</span>
          <span>{formatVol(dv.planned)}</span>
        </div>
      </div>
      <div>
        <div className="mb-0.5 text-[7px] font-semibold uppercase tracking-wide text-slate-400">{actionLabel}</div>
        <DomainVolumeRow label={byKey.get(conformKey)?.abbrev ?? conformKey} color={byKey.get(conformKey)?.color} vol={dv.confVol} />
        <DomainVolumeRow label={byKey.get(mnpKey)?.abbrev ?? mnpKey} color={byKey.get(mnpKey)?.color} vol={dv.mnpVol} />
        <DomainVolumeRow label={byKey.get(psdKey)?.abbrev ?? psdKey} color={byKey.get(psdKey)?.color} vol={dv.psdVol} />
        <DomainVolumeRow label={byKey.get(aopKey)?.abbrev ?? aopKey} color={byKey.get(aopKey)?.color} vol={dv.aopVol} />
        <div className="flex items-center justify-between border-t border-slate-100 pt-0.5 text-[7px] font-semibold text-slate-700">
          <span>Subtotal</span>
          <span>{formatVol(dv.actual)}</span>
        </div>
      </div>
      <div className="space-y-0.5 border-t border-slate-200 pt-1">
        <div className="flex items-center justify-between text-[7px]">
          <span className="text-slate-400">Plan Compliance %</span>
          <span className="font-semibold text-slate-700">{slide.conformancePct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between text-[7px]">
          <span className="text-slate-400">Plan Performance %</span>
          <span className="font-semibold text-slate-700">{slide.productionPct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

// Priority R5: shared image-or-placeholder box, used by both the viewer
// pane and the cross-section pane of PitReportSlideContent below — one
// visual convention for "no image yet" in the live preview, matching
// addImageOrPlaceholder's equivalent role in the exported deck.
function ImageOrPlaceholderBox({ src, alt, placeholder, children }: { src: string | null; alt: string; placeholder: string; children?: React.ReactNode }) {
  return (
    <div className="relative flex-1 overflow-hidden rounded-lg bg-slate-100">
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-slate-400">
          {placeholder}
        </div>
      )}
      {children}
    </div>
  );
}

// Priority R5: still used for the site-wide 'summary-viewer' slide, which
// keeps its own existing two-slide (viewer + waterfall) pattern — per-pit
// slides moved to PitReportSlideContent below.
function ViewerSlideContent({ slide, templateTheme }: { slide: SlideData; templateTheme?: TemplateTheme | null }) {
  return (
    <div className="flex h-full w-full gap-3 overflow-y-auto p-4">
      <ImageOrPlaceholderBox src={slide.viewerScreenshot} alt="3D View" placeholder="3D Viewer Screenshot">
        {templateTheme?.logoDataUrl && (
          <img
            src={templateTheme.logoDataUrl}
            alt="Template logo"
            className="absolute right-2 top-2 h-8 max-w-[35%] object-contain drop-shadow"
          />
        )}
      </ImageOrPlaceholderBox>
      <div className="flex w-44 flex-shrink-0 flex-col items-center gap-3">
        <DonutGauge value={slide.conformancePct} label="Conformance" mode="conformance" />
        <DonutGauge
          value={slide.productionPct}
          label="Production"
          mode="production"
          accentColor={templateTheme ? `#${templateTheme.accentColor}` : undefined}
        />
        <div className="grid w-full grid-cols-3 gap-1 text-center">
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

// Priority R5: consolidated per-pit slide, live-preview equivalent of
// addPitReportSlide in pptxReport.tsx — same reference layout named in the
// task (viewer+gauges share the top, waterfall a prominent middle band,
// cross-section+table share the bottom), same source data
// (slide.viewerScreenshot/domains/crossSectionImage/domainVolumes), so it
// cannot show different numbers or images than the exported deck. The
// container scrolls (overflow-y-auto) since stacking five pieces of
// content vertically can exceed the panel's fixed height at some viewport
// sizes — unlike the export, where positions are fixed inches on a fixed
// page size, the live preview has no such hard ceiling to design around.
function PitReportSlideContent({ slide, templateTheme }: { slide: SlideData; templateTheme?: TemplateTheme | null }) {
  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-4">
      {/* Top: viewer image + gauges/KPIs. No fixed row height — the two
          160px DonutGauges plus KPI text need ~400px, so the row (and the
          image box beside it, via flex's default align-items:stretch)
          sizes to whatever that column naturally needs rather than a
          guessed height that clips or leaves gaps. */}
      <div className="flex flex-shrink-0 gap-3">
        <ImageOrPlaceholderBox src={slide.viewerScreenshot} alt="3D View" placeholder="3D Viewer Screenshot">
          {templateTheme?.logoDataUrl && (
            <img
              src={templateTheme.logoDataUrl}
              alt="Template logo"
              className="absolute right-2 top-2 h-8 max-w-[35%] object-contain drop-shadow"
            />
          )}
        </ImageOrPlaceholderBox>
        <div className="flex w-44 flex-shrink-0 flex-col items-center gap-3">
          <DonutGauge value={slide.conformancePct} label="Conformance" mode="conformance" />
          <DonutGauge
            value={slide.productionPct}
            label="Production"
            mode="production"
            accentColor={templateTheme ? `#${templateTheme.accentColor}` : undefined}
          />
          <div className="grid w-full grid-cols-3 gap-1 text-center">
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

      {/* Middle: waterfall, prominent */}
      <div className="flex-shrink-0 rounded-lg border border-slate-100 p-2">
        <WaterfallChart domains={slide.domains} mode={slide.mode} />
      </div>

      {/* Bottom: cross-section + data table. Same natural-height reasoning
          as the top row — the table's own row count (11 domain rows + 2
          percentage rows) determines the height, and the image box
          stretches to match it. */}
      <div className="flex flex-shrink-0 gap-3">
        <ImageOrPlaceholderBox src={slide.crossSectionImage} alt="Cross Section" placeholder="No cross-section defined for this area" />
        <div className="w-52 flex-shrink-0">
          {slide.domainVolumes && <DomainVolumeTable slide={slide} dv={slide.domainVolumes} />}
        </div>
      </div>
    </div>
  );
}

// Priority R6: plain, title-only divider slide — live-preview equivalent
// of addDividerSlide in pptxReport.tsx.
function DividerSlideContent({ slide }: { slide: SlideData }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <h2 className="text-3xl font-bold text-slate-800">{slide.title}</h2>
    </div>
  );
}

function DefinitionsSlideContent({ slide }: { slide: SlideData }) {
  const defs = getDomainDefs(slide.mode);
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-[600px]">
        <DefinitionsSchematic mode={slide.mode} />
      </div>
      <table className="mt-3 w-full border-collapse text-left">
        <thead>
          <tr className="bg-slate-100">
            <th className="w-5 px-1 py-1" />
            <th className="px-2 py-1 text-[9px] font-semibold text-slate-600">Domain</th>
            <th className="px-2 py-1 text-[9px] font-semibold text-slate-600">Abbrev.</th>
            <th className="px-2 py-1 text-[9px] font-semibold text-slate-600">Description</th>
          </tr>
        </thead>
        <tbody>
          {defs.map((d) => (
            <tr key={d.key} className="border-t border-slate-100">
              <td className="px-1 py-1">
                <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: d.color }} />
              </td>
              <td className="px-2 py-1 text-[9px] font-medium text-slate-700">{d.name}</td>
              <td className="px-2 py-1 text-[9px] font-bold text-slate-700">{d.abbrev}</td>
              <td className="px-2 py-1 text-[8px] text-slate-500">{d.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SlidePreview({ slides, onReorder, onRemove, templateTheme }: Props) {
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
            activeSlide.type === 'definitions'
              ? <DefinitionsSlideContent slide={activeSlide} />
              : activeSlide.type === 'divider'
                ? <DividerSlideContent slide={activeSlide} />
                : activeSlide.type === 'pit-report'
                  ? <PitReportSlideContent slide={activeSlide} templateTheme={templateTheme} />
                  : activeSlide.type === 'summary-viewer'
                    ? <ViewerSlideContent slide={activeSlide} templateTheme={templateTheme} />
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
                  {slide.type === 'definitions'
                    ? 'Definitions'
                    : slide.type === 'divider'
                      ? 'Divider'
                      : slide.type === 'pit-report'
                        ? 'Pit Report'
                        : slide.type === 'summary-viewer'
                          ? '3D View'
                          : 'Waterfall'}
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
