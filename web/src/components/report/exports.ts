import type { ConformanceResult, DomainSolid, BlockSummary, TriSurface } from '../../types';
import { encodeSurfaces } from '../../wasm';

export function exportCSV(
  domains: DomainSolid[],
  blockSummaries: BlockSummary[],
  filename: string,
) {
  const rows: string[] = [];
  rows.push('Domain,Block,Volume (m³)');

  for (const d of domains) {
    const block = d.block_name ?? 'All';
    rows.push(`"${d.label}","${block}",${d.volume.toFixed(2)}`);
  }

  if (blockSummaries.length > 0) {
    rows.push('');
    rows.push('Block Summary');
    rows.push('Block,Domain,Volume (m³)');
    for (const block of blockSummaries) {
      for (const [label, vol] of block.domain_volumes) {
        rows.push(`"${block.block_name}","${label}",${vol.toFixed(2)}`);
      }
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);
}

export function exportOOT(domains: DomainSolid[], filename: string) {
  const surfaces: TriSurface[] = domains.map((d) => ({
    name: `${d.label}${d.block_name ? ' - ' + d.block_name : ''}`,
    vertices: d.solid.vertices,
    indices: d.solid.indices,
  }));

  const bytes = encodeSurfaces(surfaces);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
