import type { Locator, Page } from '@playwright/test';

// Whether the page runs in WebKit (the `webkit` project).
export function isWebKit(page: Page): boolean {
  return page.context().browser()?.browserType().name() === 'webkit';
}

// Playwright's WebKit turns on the CSS Paint API, an experimental feature
// Safari and the system WebKit leave off, and it reports a bare "Script
// error." the first time a page starts a paint worklet, even an empty one.
// Tests that count the page's errors take the API away before the app
// loads: the app then does what it does on a Mac or Linux (the reader-mode
// swap fades, lib/ink-transition.ts) and every error counted is its own.
export async function withoutPaintWorklet(page: Page): Promise<void> {
  if (!isWebKit(page)) return;
  await page.addInitScript(() => {
    Object.defineProperty(CSS, 'paintWorklet', { value: undefined, configurable: true });
  });
}

// A real click in the middle of an element as the page lays it out.
// Playwright's WebKit misplaces some SVG text (a diagram's title, a gantt
// task's label, a pie legend's entry) when it works out where to click, by
// up to a few hundred pixels, so `click()` lands somewhere else, even with
// `force`; the page's own measurement is right.
export async function clickMiddle(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const r = await target.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await page.mouse.click(r.x, r.y);
}

// The editor's Mod key: ⌘ where the browser says it runs on a Mac, Ctrl
// elsewhere (ProseMirror goes by navigator.platform). Playwright's WebKit
// says Mac even when it runs on Windows, so there the editor's own
// shortcuts take ⌘, as they do for everyone on a Mac.
export async function editorMod(page: Page): Promise<'Meta' | 'Control'> {
  return (await page.evaluate(() => /Mac|iP(hone|[oa]d)/.test(navigator.platform))) ? 'Meta' : 'Control';
}
