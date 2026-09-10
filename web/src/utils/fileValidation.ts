import type { ClassifiedError } from './errorClassification';

/**
 * Fast, cheap pre-parse validation for a surface file, run before
 * handleFileSelected commits to a full parse (which can be a long-running
 * operation on a 250MB file). Everything here reads at most the first 128
 * bytes of the file plus its already-known `file.size` — never the whole
 * file — so it must stay well under a second even for the largest
 * supported surfaces.
 *
 * Deliberately NOT exhaustive: this catches the common, cheap-to-detect
 * mistakes (wrong file entirely, obviously truncated/corrupt header,
 * wildly oversized upload) — it is not a substitute for the real parser's
 * own validation (format.rs::decode_surfaces, TriSurface::validate), which
 * still runs afterward and remains the source of truth.
 */

// Mirrors format.rs's format spec exactly (see CLAUDE.md's "Vulcan .00t
// Format Specification"): header is 128 bytes, vertex_count at 0x48,
// triangle_count at 0x60, vertex data starts at 0x78 with 24 bytes/vertex,
// triangle data is 24 bytes/triangle with an 8-byte overlap.
const HEADER_SIZE = 0x78;
const VERTEX_COUNT_OFFSET = 0x48;
const TRIANGLE_COUNT_OFFSET = 0x60;
const VERTEX_START = 0x78;
const BYTES_PER_VERTEX = 24;
const BYTES_PER_TRIANGLE = 24;

// CLAUDE.md documents 250MB as the target ceiling for a single surface.
// Sites do occasionally run larger, so this WARNS rather than blocks — see
// the task's own instruction to flag rather than hard-cap since the exact
// ceiling may need tuning. 2x the documented target was chosen as "well
// beyond" without being so close to the target that ordinary large real
// surfaces trigger a warning for no reason; revisit if that turns out
// wrong in practice.
const SIZE_WARNING_BYTES = 500 * 1024 * 1024;

export type FileValidationResult =
  | { ok: true; warning?: ClassifiedError }
  | { ok: false; error: ClassifiedError };

function readU32BE(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function sizeWarning(file: File): ClassifiedError | undefined {
  if (file.size <= SIZE_WARNING_BYTES) return undefined;
  const mb = (file.size / (1024 * 1024)).toFixed(0);
  return {
    title: 'This is a large file',
    message: `${file.name} is ${mb} MB — well beyond the ~250MB target for a single surface. It may take a while to parse, or your browser may run low on memory. Continuing automatically.`,
    raw: `file.size = ${file.size} bytes`,
  };
}

async function validateOot(file: File): Promise<FileValidationResult> {
  if (file.size < HEADER_SIZE) {
    return {
      ok: false,
      error: {
        title: 'This file is too small to be a surface',
        message: `${file.name} is only ${file.size} bytes — a valid .00t file needs at least ${HEADER_SIZE} bytes for its header alone. Check you picked the right file.`,
        raw: `file.size (${file.size}) < HEADER_SIZE (${HEADER_SIZE})`,
      },
    };
  }

  const headerBytes = await file.slice(0, HEADER_SIZE).arrayBuffer();
  const view = new DataView(headerBytes);
  const vertexCount = readU32BE(view, VERTEX_COUNT_OFFSET);
  const triangleCount = readU32BE(view, TRIANGLE_COUNT_OFFSET);

  // A real .00t's declared counts must produce an expected file size that
  // matches (or is smaller than, for a truncated download) the actual
  // file — we know file.size already, no need to read further. Garbage
  // bytes (e.g. a renamed unrelated file) will almost always produce a
  // wildly mismatched or absurd count here.
  const MAX_PLAUSIBLE_COUNT = 200_000_000; // ~200M vertices/triangles: far beyond any real site, catches misread garbage
  if (vertexCount === 0 || vertexCount > MAX_PLAUSIBLE_COUNT || triangleCount > MAX_PLAUSIBLE_COUNT) {
    return {
      ok: false,
      error: {
        title: "This doesn't look like a valid .00t file",
        message: `${file.name}'s header doesn't contain a plausible vertex/triangle count. It may be corrupt, or not actually a Vulcan .00t triangulation file.`,
        raw: `header vertex_count=${vertexCount}, triangle_count=${triangleCount}`,
      },
    };
  }

  const expectedSize = VERTEX_START + vertexCount * BYTES_PER_VERTEX + triangleCount * BYTES_PER_TRIANGLE;
  if (file.size < expectedSize) {
    return {
      ok: false,
      error: {
        title: 'This file appears truncated',
        message: `${file.name}'s header declares ${vertexCount} vertices and ${triangleCount} triangles, which needs ${expectedSize} bytes, but the file is only ${file.size} bytes. It may be a partial or corrupted download — try re-exporting or re-downloading it.`,
        raw: `expected >= ${expectedSize} bytes (vertex_count=${vertexCount}, triangle_count=${triangleCount}), got ${file.size} bytes`,
      },
    };
  }

  return { ok: true, warning: sizeWarning(file) };
}

async function validateJson(file: File): Promise<FileValidationResult> {
  // Cheap sanity check only — read a small prefix rather than the whole
  // file, and only confirm it looks like the start of a JSON object.
  // json.parse() on the real content (already fast even at scale) remains
  // the actual validation; this just catches "obviously not JSON" (e.g. a
  // renamed .00t) before spending time reading + decoding the whole file.
  const prefixBytes = await file.slice(0, 64).text();
  const trimmed = prefixBytes.trimStart();
  if (trimmed.length > 0 && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return {
      ok: false,
      error: {
        title: "This doesn't look like a supported surface file",
        message: `${file.name} has a .json extension but doesn't start with valid JSON. Check the file and try again.`,
        raw: `first bytes: ${JSON.stringify(trimmed.slice(0, 40))}`,
      },
    };
  }
  return { ok: true, warning: sizeWarning(file) };
}

/** Supported primary-surface extensions, matching handleFileSelected's own branching in App.tsx. */
const SUPPORTED_EXTENSIONS = ['.00t', '.json'];

export async function validateSurfaceFile(file: File): Promise<FileValidationResult> {
  const name = file.name.toLowerCase();
  const isJson = name.endsWith('.json');
  const isOot = name.endsWith('.00t');

  if (!isJson && !isOot) {
    return {
      ok: false,
      error: {
        title: 'Unsupported file type',
        message: `${file.name} isn't a supported surface file. Upload a Vulcan .00t triangulation or a .json surface (supported: ${SUPPORTED_EXTENSIONS.join(', ')}).`,
        raw: `unrecognized extension on "${file.name}"`,
      },
    };
  }

  return isJson ? validateJson(file) : validateOot(file);
}
