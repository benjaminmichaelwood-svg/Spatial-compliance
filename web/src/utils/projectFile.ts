import type { BoundaryRegion, Mode, ObjectStyle, Settings, SurfaceRole, ViewerBackground } from '../types';

/**
 * Explicit, user-initiated Project Save/Load — a deliberate, named,
 * shareable file the user controls, distinct from Priority 12's silent
 * automatic IndexedDB crash-recovery persistence.
 *
 * Format decision: metadata-only, NOT embedding surface mesh data.
 * Embedding positions/indices would make project files up to 250MB × 5 —
 * unwieldy to save/share/load, and redundant with the original survey
 * files the user already has on disk. Loading a project instead restores
 * everything EXCEPT the surface data itself, then asks the user to
 * re-attach each named surface via the normal upload flow (which already
 * accepts any file — filename matching is a hint, not a requirement,
 * since a user might legitimately rename files between sessions).
 */

export const PROJECT_FILE_FORMAT_VERSION = 1;

export interface ProjectFileRole {
  role: SurfaceRole;
  fileName: string;
  vertexCount: number;
  triangleCount: number;
}

export interface ProjectFile {
  formatVersion: number;
  savedAt: number;
  comparisonName: string;
  mode: Mode;
  settings: Settings;
  boundaries: BoundaryRegion[];
  roles: ProjectFileRole[];
  background: ViewerBackground;
  domainStyles: [string, ObjectStyle][];
  surfaceStyles: [SurfaceRole, ObjectStyle][];
}

export interface BuildProjectFileInput {
  comparisonName: string;
  mode: Mode;
  settings: Settings;
  boundaries: BoundaryRegion[];
  uploads: Map<SurfaceRole, { fileName: string; vertexCount: number; triangleCount: number }>;
  background: ViewerBackground;
  domainStyles: Map<string, ObjectStyle>;
  surfaceStyles: Map<SurfaceRole, ObjectStyle>;
}

export function buildProjectFile(input: BuildProjectFileInput): ProjectFile {
  return {
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    savedAt: Date.now(),
    comparisonName: input.comparisonName,
    mode: input.mode,
    settings: input.settings,
    boundaries: input.boundaries,
    roles: [...input.uploads.entries()].map(([role, u]) => ({
      role,
      fileName: u.fileName,
      vertexCount: u.vertexCount,
      triangleCount: u.triangleCount,
    })),
    background: input.background,
    domainStyles: [...input.domainStyles.entries()],
    surfaceStyles: [...input.surfaceStyles.entries()],
  };
}

export function downloadProjectFile(pf: ProjectFile, suggestedName: string): void {
  const blob = new Blob([JSON.stringify(pf, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName.endsWith('.json') ? suggestedName : `${suggestedName}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export class ProjectFileParseError extends Error {}

/**
 * Parses and minimally version-checks a project file. Deliberately
 * lenient about unrecognized *extra* fields (a newer save opened by an
 * older build should still load what it recognizes) but rejects a
 * formatVersion it doesn't understand outright, rather than silently
 * misinterpreting an incompatible shape.
 */
export function parseProjectFile(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileParseError('This file is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null || !('formatVersion' in raw)) {
    throw new ProjectFileParseError("This doesn't look like a Spatial Compliance project file.");
  }
  const pf = raw as Partial<ProjectFile>;
  if (pf.formatVersion !== PROJECT_FILE_FORMAT_VERSION) {
    throw new ProjectFileParseError(
      `This project file is format version ${pf.formatVersion}, but this build only understands version ${PROJECT_FILE_FORMAT_VERSION}.`,
    );
  }
  return {
    formatVersion: pf.formatVersion,
    savedAt: pf.savedAt ?? Date.now(),
    comparisonName: pf.comparisonName ?? 'Restored Project',
    mode: pf.mode === 'dump' ? 'dump' : 'dig',
    settings: pf.settings ?? { minVolume: 100, minThickness: 0.5, minTriangles: 20 },
    boundaries: pf.boundaries ?? [],
    roles: pf.roles ?? [],
    background: pf.background === 'light' ? 'light' : 'dark',
    domainStyles: pf.domainStyles ?? [],
    surfaceStyles: pf.surfaceStyles ?? [],
  };
}
