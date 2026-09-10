import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Renders an existing React component off-screen and rasterizes the <svg>
 * it produces to a PNG data URL.
 *
 * Priority R1 (PPTX & Reporting action list): `pptxReport.ts` used to
 * reimplement the waterfall chart and the definitions diagram from scratch
 * with PptxGenJS's native chart/shape primitives, as a second, independent
 * implementation of visuals the app already renders correctly in
 * `WaterfallChart.tsx`/`DefinitionsSchematic.tsx`. Two implementations of
 * the same visual can silently drift apart — this was literally the same
 * class of bug as the original waterfall-totals mismatch (see CLAUDE.md's
 * Priority 4). This utility lets the PPTX export reuse the real components
 * directly instead: render the real component, capture exactly what it
 * drew, embed that as an image. There was no existing screenshot/capture
 * utility for arbitrary React components before this (checked — only a
 * plain `canvas.toDataURL()` call for the 3D viewer's own WebGL canvas
 * existed, which doesn't apply to SVG-based DOM components).
 *
 * Deliberately captures only the <svg> element itself, not any sibling
 * DOM (e.g. WaterfallChart.tsx renders its own <h3> heading above the
 * chart) — the caller already places its own PptxGenJS title/subtitle text
 * on the slide, so a second, redundant heading baked into the image isn't
 * needed, and this keeps the rasterization step simple and exact (an SVG
 * document loaded into an <img> rasterizes losslessly; capturing arbitrary
 * sibling HTML alongside it would need a much heavier DOM-to-canvas
 * approach for comparatively little benefit here).
 *
 * How it works: mounts `element` into a hidden, off-screen container sized
 * to `cssWidth` (letting the component's own responsive/percentage-width
 * layout resolve against that, the same way it would in its normal on-
 * screen container), waits for a non-zero-sized <svg> to appear (handles
 * Recharts' `ResponsiveContainer`, which measures itself asynchronously via
 * ResizeObserver rather than rendering its final size synchronously on
 * mount), then serializes that <svg> and draws it onto a canvas at
 * `scale`x pixel density for crisp embedding in the exported deck.
 *
 * Returns the rendered pixel dimensions (in un-scaled CSS px) alongside the
 * data URL so the caller can preserve aspect ratio when placing the image
 * on a slide, rather than guessing or hard-coding it.
 */
export interface RenderedImage {
  dataUrl: string;
  width: number;
  height: number;
}

const MEASURE_TIMEOUT_MS = 2000;
const MEASURE_POLL_MS = 16;

function waitForRenderedSvg(container: HTMLElement): Promise<SVGSVGElement> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const poll = () => {
      const svg = container.querySelector('svg');
      if (svg) {
        const rect = svg.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          resolve(svg);
          return;
        }
      }
      if (performance.now() - start > MEASURE_TIMEOUT_MS) {
        reject(new Error('renderComponentToImage: timed out waiting for a rendered <svg> with non-zero size'));
        return;
      }
      setTimeout(poll, MEASURE_POLL_MS);
    };
    poll();
  });
}

export async function renderComponentToImage(
  element: ReactElement,
  cssWidth: number,
  scale = 3,
): Promise<RenderedImage> {
  const container = document.createElement('div');
  // Off-screen, not display:none — Recharts' ResponsiveContainer needs a
  // real (non-zero, laid-out) box to measure against; display:none never
  // gets a layout box at all, so it would never resolve a width/height.
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = `${cssWidth}px`;
  container.style.background = '#ffffff';
  document.body.appendChild(container);

  const root = createRoot(container);

  try {
    root.render(element);

    const svg = await waitForRenderedSvg(container);
    if (!svg.getAttribute('xmlns')) {
      // Recharts' and this app's hand-authored SVGs both normally include
      // this, but a data: URL loaded into an <img> requires a well-formed,
      // namespaced SVG document to rasterize — cheap to guarantee here
      // rather than trust every possible source component to include it.
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    const rect = svg.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    const svgString = new XMLSerializer().serializeToString(svg);
    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('renderComponentToImage: failed to rasterize the rendered SVG'));
      img.src = svgDataUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('renderComponentToImage: could not acquire a 2D canvas context');

    // White background: PptxGenJS slides default to white, and a
    // transparent PNG would otherwise composite unpredictably depending on
    // the viewer/renderer that later opens the deck.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  } finally {
    root.unmount();
    container.remove();
  }
}
