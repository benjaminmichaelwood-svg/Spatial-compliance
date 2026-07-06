import { useEffect, useRef, useState } from 'react';

interface Props {
  visible: boolean;
  isDark: boolean;
}

export default function PerformanceOverlay({ visible, isDark }: Props) {
  const [fps, setFps] = useState(0);
  const [memory, setMemory] = useState<{ used: number; total: number } | null>(null);
  const framesRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const tick = () => {
      framesRef.current++;
      const now = performance.now();
      const elapsed = now - lastTimeRef.current;
      if (elapsed >= 1000) {
        setFps(Math.round((framesRef.current * 1000) / elapsed));
        framesRef.current = 0;
        lastTimeRef.current = now;

        const perf = (performance as any).memory;
        if (perf) {
          setMemory({
            used: perf.usedJSHeapSize / (1024 * 1024),
            total: perf.jsHeapSizeLimit / (1024 * 1024),
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  if (!visible) return null;

  const fpsColor = fps >= 30 ? 'text-emerald-400' : fps >= 15 ? 'text-amber-400' : 'text-red-400';

  return (
    <div
      className={`absolute top-2 right-2 rounded px-2 py-1 text-[10px] font-mono ${
        isDark ? 'bg-black/70 text-slate-300' : 'bg-white/90 text-slate-600'
      } shadow z-10 pointer-events-none`}
    >
      <span className={fpsColor}>{fps} FPS</span>
      {memory && (
        <span className="ml-2">
          {memory.used.toFixed(0)} / {memory.total.toFixed(0)} MB
        </span>
      )}
    </div>
  );
}
