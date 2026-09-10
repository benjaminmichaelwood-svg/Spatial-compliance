import type { PersistedSession } from '../utils/sessionPersistence';

interface Props {
  session: PersistedSession;
  onRestore: () => void;
  onDiscard: () => void;
}

function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/**
 * Shown at the landing page when a previous session is found in
 * IndexedDB (see sessionPersistence.ts). Neither auto-restores nor
 * auto-discards silently — the user explicitly chooses.
 */
export default function RestorePrompt({ session, onRestore, onDiscard }: Props) {
  const roleCount = session.roles.length;
  const hasTruncated = session.truncatedRoles.length > 0;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-lg rounded-lg border border-indigo-500/40 bg-slate-900 p-4 shadow-2xl">
        <div className="text-sm font-semibold text-slate-100">Restore previous session?</div>
        <div className="mt-1 text-xs text-slate-300">
          "{session.comparisonName || 'Untitled'}" — {roleCount} surface{roleCount === 1 ? '' : 's'}, saved {timeAgo(session.savedAt)}.
          {hasTruncated && (
            <span className="text-amber-400">
              {' '}
              {session.truncatedRoles.length} surface{session.truncatedRoles.length === 1 ? '' : 's'} will need to be re-attached (too large to auto-save).
            </span>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onRestore}
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Restore session
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
