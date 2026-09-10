// Split out of App.tsx (Priority 19: behavior-preserving file breakup — no
// logic changes; JSX moved verbatim).
interface Props {
  progress: { phase: string; value: number } | null;
  isRunning: boolean;
}

export default function ProgressBar({ progress, isRunning }: Props) {
  if (!progress && !isRunning) return null;

  return (
    <div className="absolute left-0 right-0 top-11 z-50 h-1 bg-slate-800">
      <div
        className="h-full bg-indigo-500 transition-all duration-300"
        style={{ width: progress ? `${Math.max(progress.value * 100, 5)}%` : '100%' }}
      />
      {progress && (
        <div className="absolute left-1/2 top-1.5 -translate-x-1/2 rounded bg-slate-900/90 px-2 py-0.5 text-[10px] text-slate-300">
          {progress.phase === 'parsing' && 'Parsing surface...'}
          {progress.phase === 'converting' && 'Preparing data...'}
          {progress.phase === 'conformance' && 'Running conformance...'}
          {progress.phase === 'transferring' && 'Transferring results...'}
          {progress.phase === 'Preparing surfaces' && 'Preparing surfaces...'}
          {progress.phase === 'Computing conformance' && 'Computing conformance...'}
          {progress.phase === 'Transferring results' && 'Transferring results...'}
        </div>
      )}
    </div>
  );
}
