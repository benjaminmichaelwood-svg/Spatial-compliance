import { useState } from 'react';
import { classifyError, type ClassifiedError } from '../utils/errorClassification';

interface Props {
  /**
   * Either a raw error string (from a caught exception — classified here)
   * or an already-classified error (e.g. classifyEmptyResult()'s "these
   * surfaces don't overlap" case, which isn't an exception so App.tsx
   * classifies it itself before calling setError).
   */
  error: string | ClassifiedError | null;
  onDismiss: () => void;
}

/**
 * Replaces the old single-line `<p className="text-red-400">{error}</p>`
 * (easy to miss under the Run Conformance button in a 240px sidebar) and
 * the native `alert()` call in handleFileSelected's "no surfaces found"
 * branch — both now route through this one classified, dismissible
 * banner. Positioned as a fixed overlay (matching the existing pattern
 * used by the drawing-tool controls overlay elsewhere in App.tsx) so it's
 * visible regardless of sidebar scroll position or which panel is open.
 */
export default function ErrorBanner({ error, onDismiss }: Props) {
  const [showDetails, setShowDetails] = useState(false);

  if (!error) return null;
  const classified = typeof error === 'string' ? classifyError(error) : error;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-lg rounded-lg border border-red-500/40 bg-slate-900 shadow-2xl">
        <div className="flex items-start gap-3 px-4 py-3">
          <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-100">{classified.title}</div>
            <div className="mt-0.5 text-xs text-slate-300">{classified.message}</div>
            <button
              type="button"
              onClick={() => setShowDetails((s) => !s)}
              className="mt-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-300"
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
            {showDetails && (
              <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 font-mono text-[10px] text-slate-400">
                {classified.raw}
              </pre>
            )}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex-shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
