import JSZip from 'jszip';

/**
 * Extracts a minimal, best-effort "theme" from an uploaded .pptx template
 * file: its accent1 color (from the OOXML theme XML) and, if present, the
 * first embedded image under ppt/media/ as a logo candidate.
 *
 * This is deliberately narrow in scope. A .pptx's real layout (slide
 * masters, placeholders, exact fonts/positions) is a large, intricate part
 * of the OOXML spec — reproducing it faithfully in a browser-side live
 * preview is a much bigger undertaking than "read one color and one
 * image". What this DOES give the user: their uploaded template's brand
 * color and (if there's an obvious embedded image) a logo actually show up
 * in both the live HTML preview and the generated .pptx — a real, visible
 * connection between "I uploaded a template" and "the output reflects it",
 * rather than the previous silent no-op (templateFile was accepted, read
 * into a base64 string, and then never used at all — see pptxReport.ts's
 * git history / CLAUDE.md's Priority 20 notes).
 */
export interface TemplateTheme {
  /** Hex color, no leading '#', e.g. "2A78D6". */
  accentColor: string;
  /** data: URL, or null if no embedded image was found. */
  logoDataUrl: string | null;
}

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

function extractAccentColor(themeXml: string): string | null {
  const doc = new DOMParser().parseFromString(themeXml, 'application/xml');
  if (doc.querySelector('parsererror')) return null;

  // OOXML theme color scheme: <a:clrScheme><a:accent1><a:srgbClr val="RRGGBB"/></a:accent1>...
  // Namespaced tag names don't match via plain CSS selectors reliably
  // across browsers' XML DOMParser implementations, so walk by local name
  // instead of using querySelector('a\\:accent1') (fragile with namespace
  // prefixes that can legally vary between files).
  const accent1 = Array.from(doc.getElementsByTagName('*')).find(
    (el) => el.localName === 'accent1',
  );
  if (!accent1) return null;

  const srgb = Array.from(accent1.getElementsByTagName('*')).find(
    (el) => el.localName === 'srgbClr',
  );
  const val = srgb?.getAttribute('val');
  if (val && /^[0-9a-fA-F]{6}$/.test(val)) return val.toUpperCase();

  return null;
}

export async function extractTemplateTheme(file: File): Promise<TemplateTheme | null> {
  try {
    const zip = await JSZip.loadAsync(file);

    let accentColor = '2A78D6'; // fallback: the app's own existing default accent
    const themeEntry = zip.file('ppt/theme/theme1.xml');
    if (themeEntry) {
      const xml = await themeEntry.async('text');
      const found = extractAccentColor(xml);
      if (found) accentColor = found;
    }

    let logoDataUrl: string | null = null;
    const mediaFiles = Object.keys(zip.files)
      .filter((path) => path.startsWith('ppt/media/') && !zip.files[path].dir)
      .sort(); // deterministic: image1.* before image2.*, etc.
    for (const path of mediaFiles) {
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const mime = IMAGE_EXT_TO_MIME[ext];
      if (!mime) continue; // skip non-image media (e.g. embedded video/audio)
      const base64 = await zip.files[path].async('base64');
      logoDataUrl = `data:${mime};base64,${base64}`;
      break; // first image found — no reliable way to identify "the logo" specifically
    }

    return { accentColor, logoDataUrl };
  } catch {
    // Not a valid .pptx/zip, or something inside it couldn't be read —
    // treat identically to "no template uploaded" rather than surfacing a
    // hard error, matching this feature's existing non-fatal philosophy
    // (a bad template should degrade to default styling, never block the
    // report). The caller (ReportPanel) shows a small non-blocking notice.
    return null;
  }
}
