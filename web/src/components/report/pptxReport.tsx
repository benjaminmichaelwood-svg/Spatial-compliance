import PptxGenJS from 'pptxgenjs';
import type { DomainSolid, BlockSummary, Mode, BoundaryRegion } from '../../types';
import WaterfallChart from './WaterfallChart';
import DefinitionsSchematic from './DefinitionsSchematic';
import { getDomainDefs } from './definitionsData';
import type { TemplateTheme } from './templateTheme';
import { renderComponentToImage } from './renderComponentToImage';

export interface SlideData {
  id: string;
  type: 'definitions' | 'pit-viewer' | 'pit-waterfall' | 'pit-section' | 'summary-viewer' | 'summary-waterfall';
  title: string;
  subtitle: string;
  pitName?: string;
  domains: DomainSolid[];
  mode: Mode;
  conformancePct: number;
  productionPct: number;
  plannedVol: number;
  actualVol: number;
  viewerScreenshot: string | null;
  // Priority R3: set only on 'pit-section' slides, from ReportPanel.tsx's
  // capture pass over each pit's saved cross-section (Priority R2). null
  // means no saved cross-section exists for this pit — addCrossSectionSlide
  // renders a graceful placeholder rather than leaving the slide blank.
  crossSectionImage: string | null;
}

function formatVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}

function statusColor(pct: number): string {
  if (pct >= 80) return '0ca30c';
  if (pct >= 60) return 'fab219';
  return 'd03b3b';
}

function addDonutToSlide(
  slide: PptxGenJS.Slide,
  value: number,
  label: string,
  color: string,
  x: number,
  y: number,
  size: number,
) {
  const clamped = Math.min(Math.max(value, 0), 100);
  slide.addChart('doughnut' as any, [
    {
      name: label,
      labels: [label, ''],
      values: [clamped, 100 - clamped],
    },
  ], {
    x, y, w: size, h: size,
    showLegend: false,
    showTitle: false,
    showValue: false,
    showLabel: false,
    showPercent: false,
    dataLabelPosition: 'none' as any,
    chartColors: [color, 'E1E0D9'],
    holeSize: 65,
  } as any);

  slide.addText(`${clamped.toFixed(1)}%`, {
    x, y: y + size * 0.32, w: size, h: size * 0.36,
    fontSize: 11,
    bold: true,
    color: '333333',
    align: 'center',
    valign: 'middle',
  });

  slide.addText(label, {
    x, y: y + size, w: size, h: 0.25,
    fontSize: 7,
    color: '666666',
    align: 'center',
    valign: 'top',
  });
}

// Waterfall slide box (unchanged from before this Priority R1 rewrite):
// x: 0.4, y: 0.8, w: 9.2, h: 4.3. WaterfallChart.tsx's own chart height is
// fixed at 320px (its `<ResponsiveContainer height={320}>`), so the
// off-screen render width is chosen to make the rendered aspect ratio
// (renderWidth / 320) match this box's aspect ratio (9.2 / 4.3) exactly —
// that way the captured image fills the box with no stretching or
// letterboxing, without needing a separate generic fit-within-box helper.
const WATERFALL_X = 0.4;
const WATERFALL_Y = 0.8;
const WATERFALL_W = 9.2;
const WATERFALL_H = 4.3;
const WATERFALL_RENDER_W = Math.round(320 * (WATERFALL_W / WATERFALL_H));

// Priority R1: renders the real WaterfallChart.tsx component (the same one
// SlidePreview.tsx already shows in the live preview) to an image and
// embeds it, instead of the old second, independent implementation using
// PptxGenJS's native bar chart plus manually-positioned overlay rectangles
// (removed — it duplicated buildWaterfallData's bar-position math by hand
// instead of just capturing what the real chart draws, which is exactly
// the class of bug that caused the original waterfall-totals mismatch —
// see CLAUDE.md's Priority 4).
async function addWaterfallImageToSlide(
  slide: PptxGenJS.Slide,
  domains: DomainSolid[],
  mode: Mode,
) {
  const { dataUrl } = await renderComponentToImage(
    <WaterfallChart domains={domains} mode={mode} />,
    WATERFALL_RENDER_W,
  );
  slide.addImage({ data: dataUrl, x: WATERFALL_X, y: WATERFALL_Y, w: WATERFALL_W, h: WATERFALL_H });
}

// The diagram's own vertical footprint on the slide (unchanged from the
// old hand-drawn version's topY..topY+colH band, so the table below still
// starts exactly where it always has). DefinitionsSchematic.tsx is
// rendered at its native viewBox size (660x230 — see DIAGRAM_RENDER_W's
// comment) and then placed here preserving that aspect ratio, centered
// horizontally, rather than stretched to a fixed box.
const DIAGRAM_Y = 0.85;
const DIAGRAM_H = 2.8;
// DefinitionsSchematic's <svg viewBox="0 0 660 230"> has an inline
// `style={{ maxHeight: 230 }}` — rendering it at any CSS width above 660px
// would make its natural (aspect-correct) height exceed that cap, at which
// point the max-height clamp and the width:100% rule fight each other in a
// way that's not worth relying on. Rendering at exactly its native 660px
// width keeps the natural height at exactly 230px (right at, not over,
// the cap), sidestepping that entirely; renderComponentToImage's `scale`
// parameter (default 3x) still gives a crisp 1980x690 rasterization.
const DIAGRAM_RENDER_W = 660;

async function addDefinitionsSlide(
  pptx: PptxGenJS,
  mode: Mode,
  subtitle: string,
  templateLayout?: string,
) {
  const opts: any = templateLayout ? { masterName: templateLayout } : {};
  const slide = pptx.addSlide(opts);

  slide.addText('Conformance Domain Definitions', {
    x: 0.4, y: 0.15, w: 12, h: 0.35,
    fontSize: 18, bold: true, color: '1a1a19',
  });
  slide.addText(subtitle, {
    x: 0.4, y: 0.45, w: 12, h: 0.25,
    fontSize: 10, color: '898781',
  });

  // Priority R1: renders the real DefinitionsSchematic.tsx component (the
  // same one SlidePreview.tsx already shows in the live preview) instead of
  // the old hand-drawn column diagram (removed — it computed label
  // positions from magic-number fractions of the column height by hand, a
  // second independent implementation of the same visual).
  const { dataUrl, width, height } = await renderComponentToImage(
    <DefinitionsSchematic mode={mode} />,
    DIAGRAM_RENDER_W,
  );
  const diagramW = DIAGRAM_H * (width / height);
  const diagramX = (13.33 - diagramW) / 2;
  slide.addImage({ data: dataUrl, x: diagramX, y: DIAGRAM_Y, w: diagramW, h: DIAGRAM_H });

  const defs = getDomainDefs(mode);
  const tableRows: any[][] = [
    [
      { text: '', options: { fill: { color: 'E8E8E8' }, fontSize: 1 } },
      { text: 'Domain', options: { bold: true, fontSize: 8, fill: { color: 'E8E8E8' }, color: '333333' } },
      { text: 'Abbrev.', options: { bold: true, fontSize: 8, fill: { color: 'E8E8E8' }, color: '333333' } },
      { text: 'Description', options: { bold: true, fontSize: 8, fill: { color: 'E8E8E8' }, color: '333333' } },
    ],
  ];

  for (const d of defs) {
    tableRows.push([
      { text: '', options: { fill: { color: d.color.replace('#', '') } } },
      { text: d.name, options: { fontSize: 7.5, color: '333333' } },
      { text: d.abbrev, options: { fontSize: 7.5, bold: true, color: '333333' } },
      { text: d.description, options: { fontSize: 7, color: '555555' } },
    ]);
  }

  slide.addTable(tableRows, {
    x: 0.5, y: 4.05, w: 12.3,
    colW: [0.25, 2.2, 0.8, 9.05],
    border: { type: 'solid', pt: 0.5, color: 'CCCCCC' },
    rowH: 0.28,
    margin: [2, 4, 2, 4],
    autoPage: false,
  } as any);

  return slide;
}

function addViewerSlide(
  pptx: PptxGenJS,
  data: SlideData,
  templateLayout?: string,
  templateTheme?: TemplateTheme | null,
) {
  const opts: any = templateLayout ? { masterName: templateLayout } : {};
  const slide = pptx.addSlide(opts);

  slide.addText(data.title, {
    x: 0.4, y: 0.2, w: 7, h: 0.4,
    fontSize: 18, bold: true, color: '1a1a19',
  });
  slide.addText(data.subtitle, {
    x: 0.4, y: 0.55, w: 7, h: 0.3,
    fontSize: 10, color: '898781',
  });

  if (data.viewerScreenshot) {
    slide.addImage({
      data: data.viewerScreenshot,
      x: 0.3, y: 0.9, w: 6.8, h: 4.3,
    });
  } else {
    slide.addShape('rect' as any, {
      x: 0.3, y: 0.9, w: 6.8, h: 4.3,
      fill: { color: 'F1F5F9' },
    } as any);
    slide.addText('3D Viewer Screenshot', {
      x: 0.3, y: 2.5, w: 6.8, h: 1,
      fontSize: 14, color: '94A3B8', align: 'center',
    });
  }

  addDonutToSlide(slide, data.conformancePct, 'Conformance', statusColor(data.conformancePct), 7.3, 0.9, 1.3);
  addDonutToSlide(slide, data.productionPct, 'Production', templateTheme?.accentColor ?? '2a78d6', 8.7, 0.9, 1.3);

  const kpiY = 3.5;
  const kpis = [
    { label: 'Planned', value: `${formatVol(data.plannedVol)} m³` },
    { label: 'Actual', value: `${formatVol(data.actualVol)} m³` },
    { label: 'Net', value: `${formatVol(data.plannedVol - data.actualVol)} m³` },
  ];
  kpis.forEach((kpi, i) => {
    const kx = 7.3 + i * 1.15;
    slide.addText(kpi.label, {
      x: kx, y: kpiY, w: 1.1, h: 0.2,
      fontSize: 7, color: '898781',
    });
    slide.addText(kpi.value, {
      x: kx, y: kpiY + 0.2, w: 1.1, h: 0.25,
      fontSize: 10, bold: true, color: '333333',
    });
  });

  return slide;
}

async function addWaterfallSlide(
  pptx: PptxGenJS,
  data: SlideData,
  templateLayout?: string,
) {
  const opts: any = templateLayout ? { masterName: templateLayout } : {};
  const slide = pptx.addSlide(opts);

  slide.addText(data.title, {
    x: 0.4, y: 0.2, w: 9, h: 0.4,
    fontSize: 18, bold: true, color: '1a1a19',
  });
  slide.addText(data.subtitle + ' — Volume Waterfall', {
    x: 0.4, y: 0.55, w: 9, h: 0.3,
    fontSize: 10, color: '898781',
  });

  await addWaterfallImageToSlide(slide, data.domains, data.mode);

  return slide;
}

// Priority R3: cross-section slide for a pit — image-or-placeholder,
// mirroring addViewerSlide's exact same pattern for its own screenshot
// (same box proportions, same placeholder styling) rather than inventing a
// new visual convention for "we don't have an image for this yet".
function addCrossSectionSlide(
  pptx: PptxGenJS,
  data: SlideData,
  templateLayout?: string,
) {
  const opts: any = templateLayout ? { masterName: templateLayout } : {};
  const slide = pptx.addSlide(opts);

  slide.addText(data.title, {
    x: 0.4, y: 0.2, w: 12, h: 0.4,
    fontSize: 18, bold: true, color: '1a1a19',
  });
  slide.addText(data.subtitle, {
    x: 0.4, y: 0.55, w: 12, h: 0.3,
    fontSize: 10, color: '898781',
  });

  if (data.crossSectionImage) {
    slide.addImage({
      data: data.crossSectionImage,
      x: 0.5, y: 1.0, w: 12.3, h: 5.8,
    });
  } else {
    slide.addShape('rect' as any, {
      x: 0.5, y: 1.0, w: 12.3, h: 5.8,
      fill: { color: 'F1F5F9' },
    } as any);
    slide.addText('No cross-section defined for this area', {
      x: 0.5, y: 3.6, w: 12.3, h: 1,
      fontSize: 14, color: '94A3B8', align: 'center',
    });
  }

  return slide;
}

export function buildSlides(
  result: { domains: DomainSolid[]; summary: any },
  mode: Mode,
  boundaries: BoundaryRegion[],
  comparisonName: string,
  viewerScreenshot: string | null,
  pitScreenshots: Map<string, string>,
  // Priority R3: per-pit cross-section images, keyed by boundary name —
  // populated by ReportPanel.tsx only for pits with a saved cross-section
  // (Priority R2); a pit with no entry gets addCrossSectionSlide's
  // graceful placeholder instead of being skipped or left blank.
  pitCrossSectionImages: Map<string, string>,
): SlideData[] {
  const slides: SlideData[] = [];

  slides.push({
    id: 'definitions',
    type: 'definitions',
    title: 'Conformance Domain Definitions',
    subtitle: `${mode.toUpperCase()} mode · ${comparisonName}`,
    domains: [],
    mode,
    conformancePct: 0,
    productionPct: 0,
    plannedVol: 0,
    actualVol: 0,
    viewerScreenshot: null,
    crossSectionImage: null,
  });

  // Domain sets must match classify.rs's ConformanceSummary exactly
  // (planned_domains / actual_domains in classify_conformance) — that Rust
  // formula is what result.summary.total_planned_volume/total_actual_volume
  // (used for the site-wide slides below, and for the live sidebar summary
  // in LayerPanel.tsx) already reflect. Per-pit figures need the same
  // domain sets or they silently disagree with those other totals.
  const conformKey = mode === 'dig' ? 'PlannedAndMined' : 'PlannedAndDumped';
  const pnmKey = mode === 'dig' ? 'PlannedNotMined' : 'PlannedNotDumped';
  const mnpKey = mode === 'dig' ? 'MinedNotPlanned' : 'DumpedNotPlanned';
  const mbsKey = mode === 'dig' ? 'MinedBeforeStart' : 'DumpedBeforeStart';
  const psdKey = mode === 'dig' ? 'PrescheduleDelay' : 'DumpPrescheduleDelay';
  const aopKey = mode === 'dig' ? 'AheadOfPlan' : 'DumpedAheadOfPlan';

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const pitDomains = result.domains.filter(d => d.block_name === b.name);
    if (pitDomains.length === 0) continue;

    const sumOf = (key: string) =>
      pitDomains.filter(d => d.domain === key).reduce((s, d) => s + d.volume, 0);
    const confVol = sumOf(conformKey);
    const pnmVol = sumOf(pnmKey);
    const mnpVol = sumOf(mnpKey);
    const mbsVol = sumOf(mbsKey);
    const psdVol = sumOf(psdKey);
    const aopVol = sumOf(aopKey);
    const planned = confVol + pnmVol + mbsVol;
    const actual = confVol + mnpVol + psdVol + aopVol;
    const confPct = planned > 0 ? (confVol / planned) * 100 : 0;
    const prodPct = planned > 0 ? (actual / planned) * 100 : 0;

    slides.push({
      id: `pit-viewer-${i}`,
      type: 'pit-viewer',
      title: b.name,
      subtitle: `${mode.toUpperCase()} mode · ${comparisonName}`,
      pitName: b.name,
      domains: pitDomains,
      mode,
      conformancePct: confPct,
      productionPct: prodPct,
      plannedVol: planned,
      actualVol: actual,
      viewerScreenshot: pitScreenshots.get(b.name) ?? null,
      crossSectionImage: null,
    });

    slides.push({
      id: `pit-waterfall-${i}`,
      type: 'pit-waterfall',
      title: `${b.name} — Waterfall`,
      subtitle: `${mode.toUpperCase()} mode · ${comparisonName}`,
      pitName: b.name,
      domains: pitDomains,
      mode,
      conformancePct: confPct,
      productionPct: prodPct,
      plannedVol: planned,
      actualVol: actual,
      viewerScreenshot: null,
      crossSectionImage: null,
    });

    slides.push({
      id: `pit-section-${i}`,
      type: 'pit-section',
      title: `${b.name} — Cross Section`,
      subtitle: `${mode.toUpperCase()} mode · ${comparisonName}`,
      pitName: b.name,
      domains: pitDomains,
      mode,
      conformancePct: confPct,
      productionPct: prodPct,
      plannedVol: planned,
      actualVol: actual,
      viewerScreenshot: null,
      crossSectionImage: pitCrossSectionImages.get(b.name) ?? null,
    });
  }

  const allPlanned = result.summary.total_planned_volume;
  const allActual = result.summary.total_actual_volume;
  const allConfPct = result.summary.conformance_percent;
  const allProdPct = allPlanned > 0 ? (allActual / allPlanned) * 100 : 0;

  slides.push({
    id: 'summary-viewer',
    type: 'summary-viewer',
    title: 'Site Summary',
    subtitle: `${mode.toUpperCase()} mode · ${comparisonName} · ${new Date().toLocaleDateString()}`,
    domains: result.domains,
    mode,
    conformancePct: allConfPct,
    productionPct: allProdPct,
    plannedVol: allPlanned,
    actualVol: allActual,
    viewerScreenshot,
    crossSectionImage: null,
  });

  slides.push({
    id: 'summary-waterfall',
    type: 'summary-waterfall',
    title: 'Site Summary — Waterfall',
    subtitle: `${mode.toUpperCase()} mode · ${comparisonName} · ${new Date().toLocaleDateString()}`,
    domains: result.domains,
    mode,
    conformancePct: allConfPct,
    productionPct: allProdPct,
    plannedVol: allPlanned,
    actualVol: allActual,
    viewerScreenshot: null,
    crossSectionImage: null,
  });

  return slides;
}

// LAYOUT_WIDE is 13.33" x 7.5" — corner coordinates for the template logo
// placed by the slide master below.
const LOGO_W = 1.2;
const LOGO_H = 0.6;
const LOGO_X = 13.33 - LOGO_W - 0.3;
const LOGO_Y = 0.15;

export async function generatePPTX(
  slides: SlideData[],
  comparisonName: string,
  templateTheme?: TemplateTheme | null,
): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Spatial Compliance';
  pptx.title = comparisonName;

  // Priority 20: previously templateTheme's predecessor (a raw File) was
  // read into a base64 string and then never used — every slide was built
  // identically regardless of what was uploaded (see this function's git
  // history / CLAUDE.md's Priority 20 notes). Now, when a template's theme
  // was successfully extracted (templateTheme.ts — accent color, and a
  // logo if the template had an embedded image), every slide uses a real
  // PptxGenJS slide master carrying that logo in the top-right corner, and
  // the "Production" donut gauge is tinted with the extracted accent
  // color. Domain-specific colors (the actual conformance domains'
  // green/red/etc.) are never touched — they must stay in sync with the
  // legend shown everywhere else in the app.
  let templateLayout: string | undefined;
  if (templateTheme) {
    const masterName = 'TemplateMaster';
    pptx.defineSlideMaster({
      title: masterName,
      background: { color: 'FFFFFF' },
      objects: templateTheme.logoDataUrl
        ? [{ image: { data: templateTheme.logoDataUrl, x: LOGO_X, y: LOGO_Y, w: LOGO_W, h: LOGO_H } }]
        : [],
    });
    templateLayout = masterName;
  }

  for (const data of slides) {
    if (data.type === 'definitions') {
      await addDefinitionsSlide(pptx, data.mode, data.subtitle, templateLayout);
    } else if (data.type === 'pit-viewer' || data.type === 'summary-viewer') {
      addViewerSlide(pptx, data, templateLayout, templateTheme);
    } else if (data.type === 'pit-section') {
      addCrossSectionSlide(pptx, data, templateLayout);
    } else {
      await addWaterfallSlide(pptx, data, templateLayout);
    }
  }

  await pptx.writeFile({ fileName: `${comparisonName.replace(/\s+/g, '_')}_report.pptx` });
}
