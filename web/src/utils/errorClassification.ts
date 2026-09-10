/**
 * Plain-language error classification for the frontend.
 *
 * This maps raw error text (Rust/WASM Result errors, JS parse exceptions,
 * or anything else caught in App.tsx) to a short, actionable message a
 * mining engineer can act on without needing to read a stack trace. The
 * raw technical detail is never deleted — it's always available behind
 * "Show details" — this only changes what's shown *first*.
 *
 * To add a new pattern: add an entry to PATTERNS below. Patterns are
 * checked in order; the first match wins, so put more specific patterns
 * before more general ones. Known real messages this maps against come
 * from: format.rs (decode_surfaces), types.rs (TriSurface::validate),
 * dxf.rs (parse_dxf_polygons), and standard JS/browser exceptions
 * (JSON.parse, out-of-memory).
 */

export interface ClassifiedError {
  /** Short plain-language title, e.g. "Unsupported file". */
  title: string;
  /** One or two sentences: what happened + what to do next. */
  message: string;
  /** The original, unmodified error text — always shown behind "Show details". */
  raw: string;
}

interface Pattern {
  test: RegExp;
  title: string;
  message: string;
}

const PATTERNS: Pattern[] = [
  {
    // format.rs: "Vertex count is zero", "File too small: N bytes...",
    // "File truncated: ...", "Triangle N has out-of-bounds index...".
    // types.rs::validate(): "vertex N has a non-finite coordinate...",
    // "triangle N references vertex index N but only N vertices exist".
    test: /non-finite coordinate|out-of-bounds index|vertex count is zero|file (is )?truncated|file too small|references vertex index/i,
    title: 'This file looks corrupt',
    message: 'The surface data is malformed or incomplete (a bad byte offset, a missing vertex, or a truncated download). Try re-exporting or re-downloading the file.',
  },
  {
    // wasm.rs::parse_surface_flat / decode_surfaces on an empty file.
    test: /no surfaces found/i,
    title: 'No surface data in this file',
    message: "This doesn't look like a supported surface file (.00t or .json), or it's empty. Check the file and try again.",
  },
  {
    // dxf.rs::parse_dxf_polygons.
    test: /no entities found in dxf|no polygon boundaries found/i,
    title: 'No boundary data in this DXF',
    message: 'This DXF file has no LWPOLYLINE, POLYLINE, or LINE entities that form a closed boundary. Check the file was exported with the boundary layer included.',
  },
  {
    // JSON.parse throws things like "Unexpected token < in JSON at position 0".
    test: /unexpected token|is not valid json|json\.parse/i,
    title: 'This doesn’t look like a supported surface file',
    message: 'The file could not be read as .00t or .json. Check the file and try again.',
  },
  {
    // Browser/WASM memory exhaustion. WASM linear memory growth failures
    // and JS typed-array allocation failures both surface as some variant
    // of these.
    test: /out of memory|allocation failed|array buffer allocation|maximum call stack/i,
    title: 'This file may be too large',
    message: 'The browser ran out of memory processing this file. Try a smaller extract, close other tabs, or contact support if this is a normal-sized surface for your site.',
  },
  {
    // A panic that still slips through despite the Result-based error
    // handling (see the panic-safety pass in CLAUDE.md) surfaces as some
    // variant of a WASM runtime trap.
    test: /unreachable|runtimeerror|webassembly\.(runtimeerror|compileerror|linkerror)/i,
    title: 'Something went wrong in the compute engine',
    message: 'An internal error occurred while processing this data. Try the operation again — if it keeps happening, the details below will help diagnose it.',
  },
  {
    test: /mode must be 'dig' or 'dump'/i,
    title: 'Internal error',
    message: 'An unexpected internal error occurred. Please try again.',
  },
];

const GENERIC: Omit<ClassifiedError, 'raw'> = {
  title: 'Something went wrong',
  message: 'An unexpected error occurred. The technical details below may help diagnose it.',
};

/**
 * Classify a raw error (a caught exception, or a plain string already
 * extracted via `e.message`/`String(e)`) into a plain-language message.
 * Never returns null/undefined — an unrecognized error always falls back
 * to the generic "Something went wrong" bucket with its raw text preserved.
 */
export function classifyError(raw: unknown): ClassifiedError {
  const text = raw instanceof Error ? raw.message : String(raw ?? 'Unknown error');
  for (const p of PATTERNS) {
    if (p.test.test(text)) {
      return { title: p.title, message: p.message, raw: text };
    }
  }
  return { ...GENERIC, raw: text };
}

/**
 * Special-case classification for a *successful* run that produced no
 * meaningful result — e.g. two surfaces that don't spatially overlap at
 * all. This isn't an exception (compute_cut_fill/classify_conformance
 * return an empty-but-valid result in that case, they don't throw), so it
 * can't be caught by classifyError() — call this after a successful run
 * with the resulting domain list instead.
 */
export function classifyEmptyResult(totalVolume: number, domainCount: number): ClassifiedError | null {
  if (domainCount > 0 || totalVolume > 1e-6) return null;
  return {
    title: 'No overlap found',
    message: "These surfaces don't appear to overlap — check they cover the same area and use the same coordinate system.",
    raw: 'run_conformance completed with 0 domains and ~0 total volume',
  };
}
