import PptxGenJS from 'pptxgenjs';
import type { DomainSolid, BlockSummary, Mode, BoundaryRegion } from '../../types';
import { buildWaterfallData } from './WaterfallChart';
import { getColumns, getDomainDefs } from './definitionsData';

export interface SlideData {
  id: string;
  type: 'definitions' | 'pit-viewer' | 'pit-waterfall' | 'summary-viewer' | 'summary-waterfall';
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

const CHART_COLORS: Record<string, string> = {
  PlannedAndMined: '2a78d6',
  PlannedNotMined: 'eda100',
  MinedNotPlanned: 'e34948',
  MinedBeforeStart: '4a3aa7',
  PrescheduleDelay: 'eb6834',
  AheadOfPlan: '1baf7a',
  PlannedAndDumped: '2a78d6',
  PlannedNotDumped: 'eda100',
  DumpedNotPlanned: 'e34948',
  DumpedBeforeStart: '4a3aa7',
  DumpPrescheduleDelay: 'eb6834',
  DumpedAheadOfPlan: '1baf7a',
};

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

function addWaterfallToSlide(
  slide: PptxGenJS.Slide,
  domains: DomainSolid[],
  mode: Mode,
) {
  const items = buildWaterfallData(domains, mode);
  const maxVal = Math.max(...items.map(d => d.base + d.value)) * 1.15;

  const labels = items.map(d => d.name);
  const bases = items.map(d => d.base);
  const values = items.map(d => d.value);
  const colors = items.map(d => d.color.replace('#', ''));

  slide.addChart('bar' as any, [
    { name: 'Base', labels, values: bases },
    { name: 'Value', labels, values },
  ], {
    x: 0.4, y: 0.8, w: 9.2, h: 4.3,
    barDir: 'col',
    barGrouping: 'stacked',
    showLegend: false,
    showTitle: false,
    showValue: false,
    catAxisOrientation: 'minMax',
    valAxisOrientation: 'minMax',
    valAxisMaxVal: maxVal,
    valAxisNumFmt: '#,##0',
    catAxisLabelFontSize: 8,
    valAxisLabelFontSize: 8,
    catAxisLabelColor: '898781',
    valAxisLabelColor: '898781',
    chartColors: ['FFFFFF', '52514E'],
    chartColorsOpacity: 0,
  } as any);

  const barWidth = 9.2 / items.length;
  items.forEach((item, i) => {
    if (item.color === '#52514e' || item.color === CHART_COLORS[item.name]) return;
    const cx = 0.4 + (i + 0.5) * barWidth;
    const barH = (item.value / maxVal) * 4.3;
    const barY = 0.8 + 4.3 - ((item.base + item.value) / maxVal) * 4.3;
    slide.addShape('rect' as any, {
      x: cx - barWidth * 0.3,
      y: barY,
      w: barWidth * 0.6,
      h: Math.max(barH, 0.05),
      fill: { color: item.color.replace('#', '') },
      line: { color: item.color.replace('#', ''), width: 0 },
    } as any);
  });
}

function addDefinitionsSlide(
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

  const [leftCol, rightCol] = getColumns(mode);

  const colW = 3.2;
  const colH = 2.8;
  const leftX = 1.8;
  const rightX = 7.3;
  const topY = 0.85;
  const bandH = colH / 4;

  function drawColumn(col: typeof leftCol, cx: number) {
    slide.addText(col.title, {
      x: cx, y: topY - 0.22, w: colW, h: 0.2,
      fontSize: 9, bold: true, color: '444444', align: 'center',
    });

    for (let i = 0; i < col.bands.length; i++) {
      const band = col.bands[i];
      const by = topY + i * bandH;
      slide.addShape('rect' as any, {
        x: cx, y: by, w: colW, h: bandH,
        fill: { color: band.color.replace('#', '') },
        line: { color: '555555', width: 0.5 },
      } as any);
      if (band.label) {
        slide.addText(band.label, {
          x: cx, y: by, w: colW, h: bandH,
          fontSize: 8, bold: true, color: 'FFFFFF',
          align: 'center', valign: 'middle',
        });
      }
    }

    slide.addShape('rect' as any, {
      x: cx, y: topY, w: colW, h: colH,
      fill: { type: 'none' as any },
      line: { color: '444444', width: 1 },
    } as any);

    const labels = col.leftLabels.length > 0 ? col.leftLabels : col.rightLabels;
    const isLeft = col.leftLabels.length > 0;

    for (const sl of labels) {
      const fraction = (sl.y - 34) / 180;
      const ly = topY + fraction * colH;
      if (isLeft) {
        slide.addText(`${sl.label}  ${sl.fullName}`, {
          x: cx - 2.0, y: ly - 0.1, w: 1.9, h: 0.2,
          fontSize: 7, color: '555555', align: 'right', bold: false,
        });
        slide.addShape('line' as any, {
          x: cx - 0.05, y: ly, w: 0.1, h: 0,
          line: { color: '888888', width: 0.5 },
        } as any);
      } else {
        slide.addText(`${sl.label}  ${sl.fullName}`, {
          x: cx + colW + 0.1, y: ly - 0.1, w: 1.9, h: 0.2,
          fontSize: 7, color: '555555', align: 'left', bold: false,
        });
        slide.addShape('line' as any, {
          x: cx + colW - 0.05, y: ly, w: 0.1, h: 0,
          line: { color: '888888', width: 0.5 },
        } as any);
      }
    }
  }

  drawColumn(leftCol, leftX);
  drawColumn(rightCol, rightX);

  const depthLabel = mode === 'dig' ? 'Increasing Depth  ↓' : 'Increasing Height  ↑';
  slide.addText(depthLabel, {
    x: 0.3, y: topY + colH / 2 - 0.15, w: 1.2, h: 0.3,
    fontSize: 7, color: 'AAAAAA', align: 'center',
    rotate: mode === 'dig' ? 0 : 0,
  });

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
  addDonutToSlide(slide, data.productionPct, 'Production', '2a78d6', 8.7, 0.9, 1.3);

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

function addWaterfallSlide(
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

  addWaterfallToSlide(slide, data.domains, data.mode);

  return slide;
}

export function buildSlides(
  result: { domains: DomainSolid[]; summary: any },
  mode: Mode,
  boundaries: BoundaryRegion[],
  comparisonName: string,
  viewerScreenshot: string | null,
  pitScreenshots: Map<string, string>,
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
  });

  const conformKey = mode === 'dig' ? 'PlannedAndMined' : 'PlannedAndDumped';
  const pnmKey = mode === 'dig' ? 'PlannedNotMined' : 'PlannedNotDumped';
  const mnpKey = mode === 'dig' ? 'MinedNotPlanned' : 'DumpedNotPlanned';

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const pitDomains = result.domains.filter(d => d.block_name === b.name);
    if (pitDomains.length === 0) continue;

    const confVol = pitDomains.filter(d => d.domain === conformKey).reduce((s, d) => s + d.volume, 0);
    const pnmVol = pitDomains.filter(d => d.domain === pnmKey).reduce((s, d) => s + d.volume, 0);
    const mnpVol = pitDomains.filter(d => d.domain === mnpKey).reduce((s, d) => s + d.volume, 0);
    const planned = confVol + pnmVol;
    const actual = confVol + mnpVol;
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
  });

  return slides;
}

export async function generatePPTX(
  slides: SlideData[],
  comparisonName: string,
  templateFile?: File | null,
): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Spatial Compliance';
  pptx.title = comparisonName;

  let templateLayout: string | undefined;

  if (templateFile) {
    try {
      const buf = await templateFile.arrayBuffer();
      const templateBase64 = btoa(
        new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), ''),
      );
      // PptxGenJS doesn't natively support loading templates as masters,
      // but we store the file for future integration. For now, we proceed
      // with default styling.
    } catch {
      // template load failed, continue with defaults
    }
  }

  for (const data of slides) {
    if (data.type === 'definitions') {
      addDefinitionsSlide(pptx, data.mode, data.subtitle, templateLayout);
    } else if (data.type === 'pit-viewer' || data.type === 'summary-viewer') {
      addViewerSlide(pptx, data, templateLayout);
    } else {
      addWaterfallSlide(pptx, data, templateLayout);
    }
  }

  await pptx.writeFile({ fileName: `${comparisonName.replace(/\s+/g, '_')}_report.pptx` });
}
