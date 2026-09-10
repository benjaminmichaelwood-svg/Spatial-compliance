// Split out of App.tsx (Priority 19: behavior-preserving file breakup — no
// logic changes; JSX moved verbatim).
interface Props {
  isDrawing: boolean;
  drawPointCount: number;
  onUndoLastPoint: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

export default function DrawingControlsOverlay({ isDrawing, drawPointCount, onUndoLastPoint, onFinish, onCancel }: Props) {
  if (!isDrawing) return null;

  return (
    <div className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 gap-2 rounded-lg bg-slate-900/90 px-4 py-2 shadow-xl">
      <button
        type="button"
        onClick={onUndoLastPoint}
        disabled={drawPointCount === 0}
        className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-40"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onFinish}
        disabled={drawPointCount < 3}
        className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500 disabled:opacity-40"
      >
        Close Polygon
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded bg-red-600/80 px-3 py-1 text-xs text-white hover:bg-red-500"
      >
        Cancel
      </button>
    </div>
  );
}
