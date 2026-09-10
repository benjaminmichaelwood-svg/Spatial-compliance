import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Priority R3 (PPTX & Reporting action list): renders an existing
 * CrossSectionPanel instance off-screen and rasterizes its own internal
 * plot <canvas> to a PNG data URL — the cross-section equivalent of
 * renderComponentToImage.tsx's approach for the waterfall chart/definitions
 * diagram (Priority R1). CrossSectionPanel's rendering/calculation logic is
 * explicitly out of scope for this item, so this drives a second, real
 * instance of it rather than reimplementing any of its canvas drawing —
 * the same "capture what the real thing draws" principle R1 already
 * established for the waterfall chart, applied to a canvas-2D component
 * instead of an SVG one.
 *
 * CrossSectionPanel sizes its plot canvas from a ResizeObserver on an
 * internal wrapper div (`wrapRef`), so — like renderComponentToImage.tsx's
 * handling of Recharts' ResponsiveContainer — this needs a real, laid-out
 * off-screen box (not display:none) and a poll rather than a fixed delay,
 * since there's no way to know from the outside how many render passes its
 * internal effects need.
 */
export interface RenderedCrossSectionImage {
  dataUrl: string;
  width: number;
  height: number;
}

const MEASURE_TIMEOUT_MS = 3000;
const MEASURE_POLL_MS = 32;

function waitForDrawnCanvas(container: HTMLElement): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const poll = () => {
      const canvas = container.querySelector('canvas');
      // A plain <canvas> defaults to exactly 300x150 device pixels until
      // JS explicitly sets .width/.height — CrossSectionPanel's own draw
      // effect only does that once its ResizeObserver has measured a real
      // box and it has actually painted. A real off-screen layout (sized
      // well above 300x150 by this file's caller) will essentially never
      // legitimately resolve to exactly the default, so treating "still
      // exactly 300x150" as "hasn't painted yet" is a safe, simple signal
      // — cheaper than reaching into the component's internal state.
      if (canvas && canvas.width > 0 && canvas.height > 0 && !(canvas.width === 300 && canvas.height === 150)) {
        resolve(canvas);
        return;
      }
      if (performance.now() - start > MEASURE_TIMEOUT_MS) {
        reject(new Error('renderCrossSectionToImage: timed out waiting for the cross-section canvas to render'));
        return;
      }
      setTimeout(poll, MEASURE_POLL_MS);
    };
    poll();
  });
}

export async function renderCrossSectionToImage(
  element: ReactElement,
  cssWidth: number,
  cssHeight: number,
): Promise<RenderedCrossSectionImage> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = `${cssWidth}px`;
  container.style.height = `${cssHeight}px`;
  document.body.appendChild(container);

  const root = createRoot(container);
  try {
    root.render(element);
    const canvas = await waitForDrawnCanvas(container);
    // One more repaint cycle — the size-driven draw effect can still be
    // mid-flight the instant its dimensions first stop looking like the
    // unset default (e.g. between setting canvas.width and finishing the
    // fill/stroke calls that follow it in the same effect).
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } finally {
    root.unmount();
    container.remove();
  }
}
