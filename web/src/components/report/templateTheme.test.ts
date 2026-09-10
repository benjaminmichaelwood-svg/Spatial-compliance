import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractTemplateTheme } from './templateTheme';

/** A minimal but well-formed OOXML theme1.xml with a given accent1 color. */
function themeXml(accent1Hex: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test Theme">
  <a:themeElements>
    <a:clrScheme name="Test">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="${accent1Hex}"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
    </a:clrScheme>
  </a:themeElements>
</a:theme>`;
}

async function buildFakePptx(opts: { accent1?: string; logo?: { name: string; bytes: Uint8Array } }): Promise<File> {
  const zip = new JSZip();
  if (opts.accent1) {
    zip.file('ppt/theme/theme1.xml', themeXml(opts.accent1));
  }
  if (opts.logo) {
    zip.file(`ppt/media/${opts.logo.name}`, opts.logo.bytes);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'template.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

describe('extractTemplateTheme', () => {
  it('extracts the accent1 color from a well-formed theme', async () => {
    const file = await buildFakePptx({ accent1: 'FF6600' });
    const theme = await extractTemplateTheme(file);
    expect(theme).not.toBeNull();
    expect(theme!.accentColor).toBe('FF6600');
  });

  it('falls back to the default accent when theme1.xml is missing', async () => {
    const file = await buildFakePptx({});
    const theme = await extractTemplateTheme(file);
    expect(theme).not.toBeNull();
    expect(theme!.accentColor).toBe('2A78D6');
  });

  it('extracts the first embedded image under ppt/media/ as a logo', async () => {
    // A 1x1 transparent PNG — real bytes, not a placeholder, so the data:
    // URL round-trips through base64 correctly.
    const pngBytes = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ), c => c.charCodeAt(0));
    const file = await buildFakePptx({ accent1: '112233', logo: { name: 'image1.png', bytes: pngBytes } });
    const theme = await extractTemplateTheme(file);
    expect(theme).not.toBeNull();
    expect(theme!.logoDataUrl).not.toBeNull();
    expect(theme!.logoDataUrl!.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('returns logoDataUrl null when no media is embedded', async () => {
    const file = await buildFakePptx({ accent1: '112233' });
    const theme = await extractTemplateTheme(file);
    expect(theme!.logoDataUrl).toBeNull();
  });

  it('ignores non-image media files (e.g. embedded video)', async () => {
    const file = await buildFakePptx({
      accent1: '112233',
      logo: { name: 'media1.mp4', bytes: new Uint8Array([0, 1, 2, 3]) },
    });
    const theme = await extractTemplateTheme(file);
    expect(theme!.logoDataUrl).toBeNull();
  });

  it('returns null for a file that is not a valid zip at all', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'not-a-pptx.pptx');
    const theme = await extractTemplateTheme(file);
    expect(theme).toBeNull();
  });
});
