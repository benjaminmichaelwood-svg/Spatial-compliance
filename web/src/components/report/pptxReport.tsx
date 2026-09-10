import PptxGenJS from 'pptxgenjs';
import type { DomainSolid, BlockSummary, Mode, BoundaryRegion } from '../../types';
import WaterfallChart from './WaterfallChart';
import DefinitionsSchematic from './DefinitionsSchematic';
import { getDomainDefs } from './definitionsData';
import type { TemplateTheme } from './templateTheme';
import { renderComponentToImage } from './renderComponentToImage';

// Priority R4: the exact per-domain volumes buildSlides already computes
// (via the sumOf/confVol/pnmVol/etc. pattern) to derive plannedVol/
// actualVol/conformancePct/productionPct — captured here instead of
// discarded, so the data table can show the same numbers those other
// fields are built from rather than recomputing anything. confVol
// ("Planned and Mined"/"Planned and Dumped") deliberately appears in both
// the Plan and Mined/Dumped subtotals below, matching classify.rs's own
// total_planned_volume/total_actual_volume formulas exactly — it
// genuinely belongs to both totals, not a double-count bug.
export interface PitDomainVolumes {
  confVol: number;
  pnmVol: number;
  mbsVol: number;
  mnpVol: number;
  psdVol: number;
  aopVol: number;
  planned: number;
  actual: number;
}

export interface SlideData {
  id: string;
  // Priority R5: per-pit slides consolidated from three separate types
  // ('pit-viewer' + 'pit-waterfall' + 'pit-section', one per boundary) into
  // one dense 'pit-report' type carrying everything those three used to
  // split across separate slides. Site-summary slides are explicitly left
  // as the existing two-slide ('summary-viewer' + 'summary-waterfall')
  // pattern for now, per this item's own scope.
  // Priority R6: 'divider' is a plain, template-styled title-only slide —
  // see buildSlides for why only one is ever inserted (no grouping
  // structure exists for boundaries/pits to divide by more finely).
  type: 'definitions' | 'divider' | 'pit-report' | 'summary-viewer' | 'summary-waterfall';
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
  // Priority R3: from ReportPanel.tsx's capture pass over each pit's saved
  // cross-section (Priority R2). null means no saved cross-section exists
  // for this pit — addPitReportSlide renders a graceful placeholder rather
  // than leaving that part of the slide blank.
  crossSectionImage: string | null;
  // Priority R4: set only on 'pit-report' slides — the data table renders
  // alongside the gauges/KPIs there. null everywhere else.
  domainVolumes: PitDomainVolumes | null;
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

// Priority R4: compact Plan / Mined-or-Dumped domain-volume table for a
// pit-viewer slide. Pulls every number from `dv` (PitDomainVolumes) — the
// exact same confVol/pnmVol/mbsVol/mnpVol/psdVol/aopVol/planned/actual
// values buildSlides already computed via its sumOf(...) pattern to derive
// plannedVol/actualVol — never recomputed here. Domain names/colors come
// from getDomainDefs(mode), the same source the Definitions slide's own
// legend table uses, so labels can't drift between the two slides either.
function buildDomainTableRows(mode: Mode, dv: PitDomainVolumes): any[][] {
  const defs = getDomainDefs(mode);
  const byKey = new Map(defs.map(d => [d.key, d]));
  const conformKey = mode === 'dig' ? 'PlannedAndMined' : 'PlannedAndDumped';
  const pnmKey = mode === 'dig' ? 'PlannedNotMined' : 'PlannedNotDumped';
  const mbsKey = mode === 'dig' ? 'MinedBeforeStart' : 'DumpedBeforeStart';
  const mnpKey = mode === 'dig' ? 'MinedNotPlanned' : 'DumpedNotPlanned';
  const psdKey = mode === 'dig' ? 'PrescheduleDelay' : 'DumpPrescheduleDelay';
  const aopKey = mode === 'dig' ? 'AheadOfPlan' : 'DumpedAheadOfPlan';
  const actionLabel = mode === 'dig' ? 'Mined' : 'Dumped';

  const rowOpts = { fontSize: 7, color: '333333' };
  const valueOpts = { ...rowOpts, align: 'right' as const };
  const headerOpts = { bold: true, fontSize: 7.5, fill: { color: 'E8E8E8' }, color: '333333' };
  const subtotalOpts = { bold: true, fontSize: 7.5, color: '1a1a19', fill: { color: 'F1F5F9' } };
  const subtotalValueOpts = { ...subtotalOpts, align: 'right' as const };

  const row = (key: string, vol: number) => [
    { text: '', options: { fill: { color: (byKey.get(key)?.color ?? '#CCCCCC').replace('#', '') } } },
    { text: byKey.get(key)?.name ?? key, options: rowOpts },
    { text: `${formatVol(vol)} m³`, options: valueOpts },
  ];
  const sectionHeader = (label: string) => [
    { text: label, options: { ...headerOpts, colspan: 3 } },
  ];
  const subtotalRow = (label: string, vol: number) => [
    { text: '', options: { fill: { color: 'F1F5F9' } } },
    { text: label, options: subtotalOpts },
    { text: `${formatVol(vol)} m³`, options: subtotalValueOpts },
  ];

  return [
    sectionHeader('Plan'),
    row(conformKey, dv.confVol),
    row(pnmKey, dv.pnmVol),
    row(mbsKey, dv.mbsVol),
    subtotalRow('Subtotal', dv.planned),
    sectionHeader(actionLabel),
    row(conformKey, dv.confVol),
    row(mnpKey, dv.mnpVol),
    row(psdKey, dv.psdVol),
    row(aopKey, dv.aopVol),
    subtotalRow('Subtotal', dv.actual),
  ];
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

  // Priority R5: this function is now only used for the site-wide
  // 'summary-viewer' slide (per-pit slides moved to the consolidated
  // addPitReportSlide below) — summary-viewer's domainVolumes is always
  // null (Priority R4 only populates it for per-pit data), so the
  // domain-volume table this function used to conditionally add here has
  // been removed as dead code for this caller, not silently dropped
  // functionality: see addPitReportSlide for where that table now lives.
  return slide;
}

// Priority R4/R5: adds the Plan Compliance %/Plan Performance % text rows
// directly below a just-added domain-volume table, reused by
// addPitReportSlide. `tableRows` is the exact array passed to addTable so
// the vertical offset always matches the table's real row count. `x`/`w`
// describe the same horizontal span the table itself occupies — the label
// takes the left ~65% of it, the value right-aligned in the remainder.
function addComplianceRows(
  slide: PptxGenJS.Slide,
  data: SlideData,
  tableRows: any[][],
  tableY: number,
  rowH: number,
  x: number,
  w: number,
) {
  const labelW = w * 0.65;
  const pctY = tableY + tableRows.length * rowH + 0.08;
  const pctRows = [
    { label: 'Plan Compliance %', value: data.conformancePct },
    { label: 'Plan Performance %', value: data.productionPct },
  ];
  pctRows.forEach((r, i) => {
    const ry = pctY + i * 0.26;
    slide.addText(r.label, {
      x, y: ry, w: labelW, h: 0.22,
      fontSize: 7.5, color: '898781',
    });
    slide.addText(`${r.value.toFixed(1)}%`, {
      x: x + labelW, y: ry, w: w - labelW, h: 0.22,
      fontSize: 7.5, bold: true, color: '333333', align: 'right',
    });
  });
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

// Priority R5: image-or-placeholder helper shared by the viewer and
// cross-section panes of addPitReportSlide (and, before this item, by
// addViewerSlide's own screenshot and the old standalone
// addCrossSectionSlide) — one visual convention for "we don't have an
// image for this yet" everywhere it's needed, not a new one per pane.
function addImageOrPlaceholder(
  slide: PptxGenJS.Slide,
  imageData: string | null,
  placeholderText: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (imageData) {
    slide.addImage({ data: imageData, x, y, w, h });
  } else {
    slide.addShape('rect' as any, { x, y, w, h, fill: { color: 'F1F5F9' } } as any);
    slide.addText(placeholderText, {
      x, y: y + h / 2 - 0.4, w, h: 0.8,
      fontSize: 12, color: '94A3B8', align: 'center', valign: 'middle',
    });
  }
}

// Priority R5: consolidates the three previous per-pit slides
// (pit-viewer, pit-waterfall, pit-section) into one dense slide — the
// reference layout named in the task: viewer+gauges share the top, the
// waterfall takes a prominent middle band, cross-section+data table share
// the bottom. Per-domain volume/percentage calculations are completely
// untouched (still `data.conformancePct`/`productionPct`/`plannedVol`/
// `actualVol`/`domainVolumes`, exactly as buildSlides already computed
// them) — this function only rearranges how the same numbers/images are
// laid out on the page. Site-summary slides are deliberately NOT
// consolidated here (see buildSlides/generatePPTX) — they stay on the
// existing addViewerSlide/addWaterfallSlide two-slide pattern, per this
// item's own scope.
async function addPitReportSlide(
  pptx: PptxGenJS,
  data: SlideData,
  templateLayout?: string,
  templateTheme?: TemplateTheme | null,
) {
  const opts: any = templateLayout ? { masterName: templateLayout } : {};
  const slide = pptx.addSlide(opts);

  slide.addText(data.title, {
    x: 0.4, y: 0.08, w: 9, h: 0.32,
    fontSize: 16, bold: true, color: '1a1a19',
  });
  slide.addText(data.subtitle, {
    x: 0.4, y: 0.38, w: 9, h: 0.22,
    fontSize: 9, color: '898781',
  });

  // --- Top band: viewer image + gauges + KPIs ---
  const topY = 0.62;
  const topH = 1.93;
  addImageOrPlaceholder(slide, data.viewerScreenshot, '3D Viewer Screenshot', 0.3, topY, 6.6, topH);

  const donutSize = 0.85;
  addDonutToSlide(slide, data.conformancePct, 'Conformance', statusColor(data.conformancePct), 7.1, topY, donutSize);
  addDonutToSlide(slide, data.productionPct, 'Production', templateTheme?.accentColor ?? '2a78d6', 8.15, topY, donutSize);

  const kpiY = topY + donutSize + 0.3;
  const kpis = [
    { label: 'Planned', value: `${formatVol(data.plannedVol)} m³` },
    { label: 'Actual', value: `${formatVol(data.actualVol)} m³` },
    { label: 'Net', value: `${formatVol(data.plannedVol - data.actualVol)} m³` },
  ];
  kpis.forEach((kpi, i) => {
    const kx = 9.3 + i * 1.25;
    slide.addText(kpi.label, {
      x: kx, y: kpiY, w: 1.2, h: 0.2,
      fontSize: 7, color: '898781',
    });
    slide.addText(kpi.value, {
      x: kx, y: kpiY + 0.2, w: 1.2, h: 0.25,
      fontSize: 9, bold: true, color: '333333',
    });
  });

  // --- Middle band: waterfall, prominent and full-width ---
  const midY = 2.65;
  const midH = 2.2;
  const midX = 0.3;
  const midW = 12.7;
  const midRenderW = Math.round(320 * (midW / midH));
  const { dataUrl: waterfallUrl } = await renderComponentToImage(
    <WaterfallChart domains={data.domains} mode={data.mode} />,
    midRenderW,
  );
  slide.addImage({ data: waterfallUrl, x: midX, y: midY, w: midW, h: midH });

  // --- Bottom band: cross-section + data table ---
  const botY = 4.95;
  const botH = 2.4;
  addImageOrPlaceholder(slide, data.crossSectionImage, 'No cross-section defined for this area', 0.3, botY, 7.0, botH);

  if (data.domainVolumes) {
    const tableX = 7.5;
    const tableW = 5.5;
    const rowH = 0.17;
    const tableRows = buildDomainTableRows(data.mode, data.domainVolumes);
    slide.addTable(tableRows, {
      x: tableX, y: botY, w: tableW,
      colW: [0.18, tableW - 0.18 - 1.7, 1.7],
      border: { type: 'solid', pt: 0.5, color: 'E2E2DD' },
      rowH,
      margin: [1, 3, 1, 3],
      autoPage: false,
    } as any);

    addComplianceRows(slide, data, tableRows, botY, rowH, tableX, tableW);
  }

  return slide;
}

// Priority R6: a plain, template-styled title-only divider slide. Confirmed
// before implementing (grepped types.ts/BoundaryPanel.tsx/App.tsx) that
// BoundaryRegion is a flat `{name, polygon}[]` with no grouping/category
// field anywhere, and nothing else in the app groups boundaries/pits either
// — so there is no natural structure to divide the pit slides *by*.
// Per the task's own explicit fallback for exactly this case ("implement a
// minimal fallback... rather than guessing"), buildSlides inserts exactly
// one divider ahead of the whole undifferentiated block of pit-report
// slides, not one per invented sub-group.
function addDividerSlide(
  pptx: PptxGenJS,
  title: string,
  templateLayout?: string,
) {
  const opts: any = templateLayout ? { masterName: templateLayout } : {};
  const slide = pptx.addSlide(opts);

  slide.addText(title, {
    x: 0.5, y: 3.0, w: 12.33, h: 1.5,
    fontSize: 32, bold: true, color: '1a1a19', align: 'center', valign: 'middle',
  });

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
  // (Priority R2); a pit with no entry gets addPitReportSlide's graceful
  // placeholder instead of being skipped or left blank.
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
    domainVolumes: null,
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

  // Priority R6: pit-report slides are collected separately and only
  // spliced in (behind one divider) once we know at least one will
  // actually exist — a boundary with no matching domains (pitDomains
  // empty, see the `continue` below) produces no slide at all, and a
  // divider with nothing after it would be worse than no divider.
  const pitSlides: SlideData[] = [];

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

    // Priority R5: one consolidated 'pit-report' slide per pit, replacing
    // the previous pit-viewer/pit-waterfall/pit-section trio — carries
    // everything those three used to split across separate slides.
    // Per-domain volume/percentage values are exactly what they always
    // were (confPct/prodPct/planned/actual computed above, untouched by
    // this item).
    pitSlides.push({
      id: `pit-report-${i}`,
      type: 'pit-report',
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
      crossSectionImage: pitCrossSectionImages.get(b.name) ?? null,
      // Priority R4: the exact per-domain volumes already computed above
      // to derive planned/actual/confPct/prodPct — captured instead of
      // discarded so the data table shows the same numbers those fields
      // are built from, not a re-derivation.
      domainVolumes: { confVol, pnmVol, mbsVol, mnpVol, psdVol, aopVol, planned, actual },
    });
  }

  // Priority R6: exactly one divider ahead of the whole block of pit
  // slides, only when there's at least one to divide from what comes
  // before it (Definitions) — see this function's own comment above
  // pitSlides for why a boundary can legitimately produce zero slides.
  if (pitSlides.length > 0) {
    slides.push({
      id: 'divider-pit-reports',
      type: 'divider',
      title: 'Pit Reports',
      subtitle: '',
      domains: [],
      mode,
      conformancePct: 0,
      productionPct: 0,
      plannedVol: 0,
      actualVol: 0,
      viewerScreenshot: null,
      crossSectionImage: null,
      domainVolumes: null,
    });
    slides.push(...pitSlides);
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
    domainVolumes: null,
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
    domainVolumes: null,
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
    } else if (data.type === 'divider') {
      addDividerSlide(pptx, data.title, templateLayout);
    } else if (data.type === 'pit-report') {
      await addPitReportSlide(pptx, data, templateLayout, templateTheme);
    } else if (data.type === 'summary-viewer') {
      addViewerSlide(pptx, data, templateLayout, templateTheme);
    } else {
      await addWaterfallSlide(pptx, data, templateLayout);
    }
  }

  await pptx.writeFile({ fileName: `${comparisonName.replace(/\s+/g, '_')}_report.pptx` });
}
