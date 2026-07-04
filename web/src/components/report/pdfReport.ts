import jsPDF from 'jspdf';
import 'jspdf-autotable';
import type { DomainSolid, BlockSummary, Mode } from '../../types';

function formatVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(1);
}

async function captureElement(id: string): Promise<string | null> {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2 });
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

export async function generatePDF(
  domains: DomainSolid[],
  blockSummaries: BlockSummary[],
  mode: Mode,
  scopeLabel: string,
  comparisonName: string,
  conformancePct: number,
  plannedVol: number,
  actualVol: number,
  viewerScreenshot: string | null,
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 15;

  doc.setFontSize(18);
  doc.setTextColor(11, 11, 11);
  doc.text(comparisonName, 15, y);
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor(82, 81, 78);
  doc.text(`Mode: ${mode.toUpperCase()} · Scope: ${scopeLabel} · ${new Date().toLocaleDateString()}`, 15, y);
  y += 4;

  doc.setDrawColor(193, 194, 183);
  doc.line(15, y, pageW - 15, y);
  y += 8;

  doc.setFontSize(11);
  doc.setTextColor(11, 11, 11);
  doc.text(`Conformance: ${conformancePct.toFixed(1)}%`, 15, y);
  doc.text(`Planned: ${formatVol(plannedVol)} m³`, 80, y);
  doc.text(`Actual: ${formatVol(actualVol)} m³`, 145, y);
  doc.text(`Net: ${formatVol(plannedVol - actualVol)} m³`, 210, y);
  y += 10;

  const waterfallImg = await captureElement('waterfall-chart');
  if (waterfallImg) {
    doc.addImage(waterfallImg, 'PNG', 15, y, pageW - 30, 60);
    y += 65;
  }

  const donutConf = await captureElement('donut-conformance');
  const donutProd = await captureElement('donut-production');
  if (donutConf) {
    doc.addImage(donutConf, 'PNG', 15, y, 40, 40);
  }
  if (donutProd) {
    doc.addImage(donutProd, 'PNG', 60, y, 40, 40);
  }

  if (viewerScreenshot) {
    doc.addImage(viewerScreenshot, 'PNG', 110, y, 80, 50);
  }
  y += 55;

  if (y > 160) {
    doc.addPage();
    y = 15;
  }

  const grouped = new Map<string, { label: string; volume: number }>();
  for (const d of domains) {
    const existing = grouped.get(d.domain);
    if (existing) {
      existing.volume += d.volume;
    } else {
      grouped.set(d.domain, { label: d.label, volume: d.volume });
    }
  }
  const totalVolume = domains.reduce((s, d) => s + d.volume, 0);

  const tableBody = [...grouped.entries()].map(([, info]) => [
    info.label,
    formatVol(info.volume) + ' m³',
    totalVolume > 0 ? ((info.volume / totalVolume) * 100).toFixed(1) + '%' : '0%',
  ]);
  tableBody.push(['Total', formatVol(totalVolume) + ' m³', '100%']);

  (doc as any).autoTable({
    startY: y,
    head: [['Domain', 'Volume', 'Share']],
    body: tableBody,
    margin: { left: 15, right: 15 },
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [82, 81, 78], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [249, 249, 247] },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  if (blockSummaries.length > 0) {
    if (y > 160) {
      doc.addPage();
      y = 15;
    }

    for (const block of blockSummaries) {
      doc.setFontSize(10);
      doc.setTextColor(11, 11, 11);
      doc.text(`${block.block_name} — ${formatVol(block.total_volume)} m³`, 15, y);
      y += 5;

      const blockBody = block.domain_volumes.map(([label, vol]) => [
        label,
        formatVol(vol) + ' m³',
      ]);

      (doc as any).autoTable({
        startY: y,
        head: [['Domain', 'Volume']],
        body: blockBody,
        margin: { left: 15, right: 15 },
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [137, 135, 129], textColor: [255, 255, 255] },
      });

      y = (doc as any).lastAutoTable.finalY + 6;
      if (y > 175) {
        doc.addPage();
        y = 15;
      }
    }
  }

  doc.save(`${comparisonName.replace(/\s+/g, '_')}_report.pdf`);
}
