// Record assets/banner-animation.html as a 1280x720 WebM via Playwright.
// Output lands in assets/banner.webm — small enough to drop directly
// into a Discord post (Discord plays WebM inline + autoloops).
//
// Usage: node scripts/record-banner.mjs

import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rename, rm, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_HTML = resolve(REPO_ROOT, 'assets/banner-animation.html');
const OUT_DIR = resolve(REPO_ROOT, 'assets');
const TMP_DIR = resolve(REPO_ROOT, 'assets/.banner-recording-tmp');
const FINAL = resolve(REPO_ROOT, 'assets/banner.webm');

// Total recording time. The HTML loops the animation every 6500ms via
// JS-driven element cloning, so we capture two full cycles plus a tiny
// tail to ensure the second cycle's stable hold is visible. Players
// that auto-loop short videos will splice cycle 2 directly back into
// cycle 1 — players that don't will still get two iterations baked in.
const LOOP_MS = 6500;
const RECORD_MS = LOOP_MS * 2 + 200;

const VIEWPORT = { width: 1280, height: 720 };

async function main() {
  if (!existsSync(SRC_HTML)) {
    throw new Error(`Source HTML not found: ${SRC_HTML}`);
  }
  // Clean and recreate the temp recording dir so we know exactly which
  // file we'll find afterwards.
  if (existsSync(TMP_DIR)) await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: TMP_DIR, size: VIEWPORT },
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(SRC_HTML).href);

  // Hold the page in view long enough to capture the full animation
  // plus a beat of post-animation hold.
  await page.waitForTimeout(RECORD_MS);

  await page.close();
  await context.close();
  await browser.close();

  // Playwright names video files with random IDs — find the one webm
  // it just produced and rename it to the final path.
  const files = (await readdir(TMP_DIR)).filter((f) => f.endsWith('.webm'));
  if (files.length !== 1) {
    throw new Error(`Expected exactly one .webm in ${TMP_DIR}, found ${files.length}`);
  }
  if (existsSync(FINAL)) await rm(FINAL);
  await rename(resolve(TMP_DIR, files[0]), FINAL);
  await rm(TMP_DIR, { recursive: true, force: true });

  console.log(`✓ Wrote ${FINAL}`);
  console.log(`  duration ≈ ${RECORD_MS / 1000}s`);
  console.log(`  viewport ${VIEWPORT.width}x${VIEWPORT.height}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
