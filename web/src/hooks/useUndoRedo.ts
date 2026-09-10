import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoundaryRegion, Settings, ViewerBackground } from '../types';

// Split out of App.tsx (Priority 19: behavior-preserving file breakup — no
// logic changes; every line here is moved verbatim from App.tsx's original
// "General undo/redo" section). See that section's original comments,
// reproduced below, for the design rationale.
//
// General undo/redo — scoped to settings, boundary region definitions,
// and the background toggle. Deliberately does NOT cover surface
// upload/removal (re-parsing large files as part of an undo stack would
// be expensive, and Priority 11's remove action is already a deliberate,
// confirmed action) or conformance results (recomputing on every undo
// step would be surprising and slow). `mode` is excluded too — there's
// no in-workspace control that changes it once a comparison is created,
// so there's nothing for a user to undo there. This is a single combined
// history (one snapshot per meaningfully-different state), not
// independent per-field stacks, matching how a person actually thinks
// about "undo my last change".
interface UndoSnapshot {
  settings: Settings;
  boundaries: BoundaryRegion[];
  background: ViewerBackground;
}

const UNDO_HISTORY_LIMIT = 50;

export function useUndoRedo(
  settings: Settings,
  boundaries: BoundaryRegion[],
  background: ViewerBackground,
  setSettings: (s: Settings) => void,
  setBoundaries: (b: BoundaryRegion[]) => void,
  setBackground: (bg: ViewerBackground) => void,
) {
  const undoRedoInFlight = useRef(false);
  const lastSnapshotRef = useRef<UndoSnapshot>({ settings, boundaries, background });
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<UndoSnapshot[]>([]);

  useEffect(() => {
    const snapshot: UndoSnapshot = { settings, boundaries, background };
    if (undoRedoInFlight.current) {
      undoRedoInFlight.current = false;
      lastSnapshotRef.current = snapshot;
      return;
    }
    const prev = lastSnapshotRef.current;
    if (JSON.stringify(prev) === JSON.stringify(snapshot)) return; // no real change (e.g. initial mount)
    setUndoStack((s) => [...s, prev].slice(-UNDO_HISTORY_LIMIT));
    setRedoStack([]);
    lastSnapshotRef.current = snapshot;
  }, [settings, boundaries, background]);

  const applySnapshot = useCallback((s: UndoSnapshot) => {
    undoRedoInFlight.current = true;
    setSettings(s.settings);
    setBoundaries(s.boundaries);
    setBackground(s.background);
  }, [setSettings, setBoundaries, setBackground]);

  // NOTE: deliberately not using a functional setState updater to decide
  // *whether* to act (e.g. `setUndoStack(stack => { ...side effects...})`)
  // — React does not guarantee an updater function runs exactly once (it
  // can re-invoke it, e.g. under StrictMode's double-invoke checks), so
  // side effects like applySnapshot()/other setState calls inside one can
  // silently fire more than once. Reading `undoStack`/`redoStack` from the
  // closure instead (always current, since this callback is recreated
  // whenever they change) and keeping the actual updater calls pure.
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const target = undoStack[undoStack.length - 1];
    setRedoStack((r) => [lastSnapshotRef.current, ...r]);
    setUndoStack((s) => s.slice(0, -1));
    applySnapshot(target);
  }, [undoStack, applySnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const target = redoStack[0];
    setUndoStack((s) => [...s, lastSnapshotRef.current]);
    setRedoStack((r) => r.slice(1));
    applySnapshot(target);
  }, [redoStack, applySnapshot]);

  return { undoStack, redoStack, handleUndo, handleRedo };
}
