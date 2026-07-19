/**
 * Visual verification harness for Spatial Compliance.
 *
 * Launches headless Chromium with SwiftShader (software WebGL),
 * loads the app, uploads test surfaces, runs conformance, and
 * captures screenshots for visual inspection.
 *
 * Usage:
 *   node scripts/visual-check.mjs            # default port 5173
 *   PORT=5174 node scripts/visual-check.mjs  # custom port
 *
 * Prerequisites:
 *   - npm run dev running on localhost
 *   - playwright installed (npm i -D playwright in web/)
 *   - test-data/ directory with .00t files
 *
 * Output: screenshots saved to visual-check/
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SHOTS = resolve(ROOT, 'visual-check');
const TEST_DATA = resolve(ROOT, 'test-data');
const PORT = process.env.PORT || '5173';
const BROWSER_PATH = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

mkdirSync(SHOTS, { recursive: true });

async function main() {
  console.log(`Visual check: port=${PORT}, browser=${BROWSER_PATH}`);

  const browser = await chromium.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--disable-gpu-sandbox',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const errors = [];
  page.on('pageerror', err => {
    if (!err.message.includes('WebGL')) errors.push(err.message);
  });

  // 1. Load + auth
  console.log('1. Loading app...');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 20000 });
  const pwInput = page.locator('input[type="password"]');
  if (await pwInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await pwInput.fill('spatial2026');
    await pwInput.press('Enter');
    await page.waitForTimeout(1000);
  }

  // Verify WebGL is working
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    return { ok: !!gl, renderer: gl?.getParameter(gl.RENDERER) };
  });
  console.log(`   WebGL2: ${webgl.ok} (${webgl.renderer})`);
  if (!webgl.ok) {
    console.error('FATAL: WebGL not available');
    await browser.close();
    process.exit(1);
  }

  // 2. Create comparison
  console.log('2. Creating comparison (Dig mode)...');
  await page.locator('input[type="text"]').fill('Visual Check');
  await page.locator('button:has-text("Dig")').click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Create Comparison")').click();
  await page.waitForTimeout(2000);

  // 3. Upload test surfaces (real .00t files from test-data/)
  console.log('3. Uploading test surfaces...');
  const fileInputs = page.locator('.sidebar-section input[type="file"]');
  // Map: [filename, role index] where roles are:
  //   0=production_start, 1=production_end, 2=schedule_start, 3=schedule_end, 4=schedule_future
  const files = [];
  const available = [
    ['production_start.00t', 0],
    ['production_end.00t', 1],
    ['schedule_start.00t', 2],
    ['schedule_end.00t', 3],
    ['schedule_future.00t', 4],
  ];
  const { existsSync } = await import('fs');
  for (const [file, idx] of available) {
    if (existsSync(`${TEST_DATA}/${file}`)) {
      files.push([file, idx]);
    }
  }
  if (files.length < 2) {
    console.error(`FATAL: Need at least 2 surfaces in ${TEST_DATA}, found ${files.length}`);
    await browser.close();
    process.exit(1);
  }
  console.log(`   Found ${files.length} surfaces: ${files.map(f => f[0]).join(', ')}`);
  for (const [file, idx] of files) {
    console.log(`   Uploading ${file} to slot ${idx}...`);
    await fileInputs.nth(idx).setInputFiles(`${TEST_DATA}/${file}`);
    // Real surfaces are large — wait longer for parsing
    await page.waitForTimeout(5000);
  }
  const assigned = await page.locator('text=/\\d+\\/\\d+ assigned/').first().textContent().catch(() => '?');
  console.log(`   ${assigned}`);

  // 4. Run conformance
  console.log('4. Running conformance...');
  const runBtn = page.locator('button:has-text("Run Conformance")');
  if (!await runBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
    console.error('FATAL: Run button disabled');
    await browser.close();
    process.exit(1);
  }
  await runBtn.click();
  await page.waitForSelector('text="Conformance Domains"', { timeout: 300000 });
  await page.waitForTimeout(8000);

  // 5. Screenshots
  console.log('5. Taking screenshots...');

  // 5a. Default isometric view (after conformance, solids hidden, painted surface visible)
  await page.screenshot({ path: `${SHOTS}/01-iso-default.png` });
  console.log('   01-iso-default.png');

  // 5b. Fit all view
  await page.locator('button[title="Fit All"]').click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/02-fit-all.png` });
  console.log('   02-fit-all.png');

  // 5c. Plan view
  await page.locator('button[title="Plan"]').click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/03-plan-view.png` });
  console.log('   03-plan-view.png');

  // 5d. Back to iso for thickness test
  await page.locator('button[title="Iso"]').click();
  await page.waitForTimeout(2000);

  // 6. Enable thickness mode on a domain
  console.log('6. Testing thickness heatmap...');
  const domainLabels = ['Planned and Mined', 'Planned Not Mined'];
  let foundThickness = false;

  // Scroll sidebar to show Conformance Domains section
  const sidebar = page.locator('.sidebar-section').first();
  await sidebar.evaluate(el => el.scrollTop = el.scrollHeight);
  await page.waitForTimeout(500);

  for (const label of domainLabels) {
    // Find the domain row — the toggle button contains a div with the domain label text
    const domainToggle = page.locator(`button:has(div:text-is("${label}"))`).first();
    if (!await domainToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`   "${label}" toggle not visible, scrolling...`);
      // Try scrolling the whole page
      await page.evaluate(() => {
        const el = document.querySelector('.overflow-y-auto');
        if (el) el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(500);
      if (!await domainToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`   "${label}" still not visible, skipping`);
        continue;
      }
    }

    // Toggle domain visible first (domains default hidden after conformance)
    await domainToggle.click();
    await page.waitForTimeout(1000);
    console.log(`   Toggled "${label}" visible`);

    // Click the gear button next to this domain to expand style controls
    // The gear is the sibling button with title="Style settings"
    const domainRow = domainToggle.locator('xpath=ancestor::div[1]');
    const gear = domainRow.locator('button[title="Style settings"]');
    if (!await gear.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log(`   No gear button found for "${label}"`);
      await domainToggle.click();
      continue;
    }

    await gear.click();
    await page.waitForTimeout(500);

    const thickCheck = page.locator('text="Colour by Thickness"');
    if (!await thickCheck.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`   No thickness controls found for "${label}"`);
      await gear.click();
      await page.waitForTimeout(300);
      await domainToggle.click();
      continue;
    }

    console.log(`   Found thickness controls for "${label}"`);
    foundThickness = true;

    // Enable thickness
    const cb = page.locator('label:has-text("Colour by Thickness") input[type="checkbox"]');
    await cb.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOTS}/04-thickness-on.png` });
    console.log('   04-thickness-on.png');

    // Stats
    const stats = await page.locator('text=/Min.*Max/').first().textContent().catch(() => 'n/a');
    console.log(`   Stats: ${stats}`);

    // Preset 0-20m
    const preset = page.locator('button:has-text("0–20m")');
    if (await preset.isVisible({ timeout: 500 }).catch(() => false)) {
      await preset.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SHOTS}/05-thickness-0-20m.png` });
      console.log('   05-thickness-0-20m.png');
    }

    // Toggle off thickness and domain
    await cb.click();
    await page.waitForTimeout(500);
    await domainToggle.click();
    await page.waitForTimeout(300);
    break;
  }

  if (!foundThickness) {
    console.log('   WARNING: No thickness controls found (may need scrolling or thicknessMaps empty)');
  }

  // 7. Toggle a domain solid on and capture from multiple angles
  console.log('7. Testing domain solid from multiple angles...');
  let solidDomain = null;
  for (const label of domainLabels) {
    const domainBtn = page.locator(`button:has(div:text-is("${label}"))`).first();
    if (await domainBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await domainBtn.click();
      await page.waitForTimeout(3000);
      solidDomain = { label, btn: domainBtn };

      // Fit all with solid
      await page.locator('button[title="Fit All"]').click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SHOTS}/06-solid-fitall.png` });
      console.log(`   06-solid-fitall.png (${label})`);

      // Iso view
      await page.locator('button[title="Iso"]').click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SHOTS}/07-solid-iso.png` });
      console.log('   07-solid-iso.png');

      // North view (elevation from south looking north)
      await page.locator('button[title="North"]').click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SHOTS}/08-solid-north.png` });
      console.log('   08-solid-north.png');

      // East view
      await page.locator('button[title="East"]').click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SHOTS}/09-solid-east.png` });
      console.log('   09-solid-east.png');

      // Plan view with solid
      await page.locator('button[title="Plan"]').click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SHOTS}/10-solid-plan.png` });
      console.log('   10-solid-plan.png');

      break;
    }
  }

  // 8. Toggle input surfaces visible alongside domain solid
  console.log('8. Input surfaces overlay...');
  await page.locator('button[title="Iso"]').click();
  await page.waitForTimeout(2000);

  // Scroll to Input Surfaces section
  await page.evaluate(() => {
    const el = document.querySelector('.overflow-y-auto');
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(500);

  // Toggle each input surface visible
  for (const name of ['Schedule Start', 'Schedule End', 'Schedule Future']) {
    const btn = page.locator(`button:has(div:text-is("${name}"))`).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/11-surfaces-and-solid.png` });
  console.log('   11-surfaces-and-solid.png');

  // Done
  console.log('\nScreenshots saved to visual-check/');
  if (errors.length > 0) {
    console.log(`Page errors: ${errors.join('; ')}`);
  }
  await browser.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
