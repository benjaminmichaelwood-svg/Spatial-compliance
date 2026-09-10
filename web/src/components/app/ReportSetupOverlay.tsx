// Priority R7 (PPTX & Reporting action list, depends on R2): guided
// "Report Setup" mode — steps through every capture target (site-wide +
// each pit) so a user can review or compose a saved camera view for each
// one in sequence, rather than hunting for each pit's row in the header's
// target selector one at a time. Presentational only, mirroring
// DrawingControlsOverlay.tsx's pattern (all state/logic lives in App.tsx);
// rendered as a sibling of it so it gets the same fixed bottom-center
// placement for free.
interface Props {
  active: boolean;
  targetLabel: string;
  index: number;
  total: number;
  hasSavedView: boolean;
  onBack: () => void;
  onSkip: () => void;
  onCaptureAndNext: () => void;
  onClose: () => void;
}

export default function ReportSetupOverlay({
  active, targetLabel, index, total, hasSavedView, onBack, onSkip, onCaptureAndNext, onClose,
}: Props) {
  if (!active) return null;
  const isLast = index === total - 1;

  return (
    <div className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-slate-900/90 px-4 py-2 shadow-xl">
      <span className="text-xs font-semibold text-slate-200">Report Setup</span>
      <span className="text-xs text-slate-400">{targetLabel} — {index + 1} of {total}</span>
      <span
        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${hasSavedView ? 'bg-emerald-400' : 'bg-slate-600'}`}
        title={hasSavedView ? 'This target already has a saved view' : 'No saved view yet — currently auto-fit'}
      />
      <button
        type="button"
        onClick={onBack}
        disabled={index === 0}
        className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-40"
      >
        Back
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-600"
      >
        Skip
      </button>
      <button
        type="button"
        onClick={onCaptureAndNext}
        className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500"
      >
        {isLast ? 'Capture & Finish' : 'Capture & Next'}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded bg-red-600/80 px-3 py-1 text-xs text-white hover:bg-red-500"
      >
        Close
      </button>
    </div>
  );
}
