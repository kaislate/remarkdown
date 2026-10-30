import { test, expect, type Page } from '@playwright/test';
import { chooseSetting } from './support/settings';
import { editorMod } from './support/webkit';

// Tabs keep every open document fully alive: switching back must restore
// the exact scroll position, the editor (with its undo history), and never
// lose an annotation made just before switching.

const A = '/e2e/tabs/Alpha.md';
const B = '/e2e/tabs/Beta.md';
const C = '/e2e/tabs/Gamma notes.markdown';

const LONG = Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1} with enough words to wrap a little and take some space.`).join('\n\n');
const DOCS: Record<string, string> = {
  [A]: `# Alpha\n\nThe alpha document is where we truly begin.\n\n${LONG}\n`,
  [B]: '# Beta\n\nSecond document.\n',
  [C]: '# Gamma\n\nThird document.\n',
};

async function openViaLaunch(page: Page, paths: string[]) {
  await page.evaluate((ps) => {
    (window as any).__E2E_QUEUE_OPENS__(ps);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, paths);
}

const tabs = (page: Page) => page.getByRole('tab');
// The tab's visible name (the close button's × is part of its text).
const labels = (page: Page) => page.locator('[role="tab"] .label');
const h1 = (page: Page) => page.locator('.viewer h1, .editor-surface h1').first();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((docs) => {
    for (const [p, md] of Object.entries(docs)) (window as any).__E2E_SEED_DOC__(p, md);
  }, DOCS);
});

test('opening several files gives one tab each, labelled without the extension', async ({ page }) => {
  await openViaLaunch(page, [A, B, C]);
  await expect(tabs(page)).toHaveCount(3);
  await expect(labels(page)).toHaveText(['Alpha', 'Beta', 'Gamma notes']);
  await expect(tabs(page).nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 1, name: 'Gamma' })).toBeVisible();
});

test('opening an already-open file switches to its tab instead of duplicating it', async ({ page }) => {
  await openViaLaunch(page, [A, B]);
  await expect(tabs(page)).toHaveCount(2);
  await openViaLaunch(page, [A]);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
});

test('switching away and back restores the exact scroll position', async ({ page }) => {
  await openViaLaunch(page, [A, B]);
  await tabs(page).nth(0).click();
  await expect(h1(page)).toHaveText('Alpha');
  const scroller = page.locator('.scroll');
  await scroller.evaluate((el) => { el.scrollTop = 1234; });
  await page.waitForTimeout(100);
  await tabs(page).nth(1).click();
  await expect(h1(page)).toHaveText('Beta');
  await tabs(page).nth(0).click();
  await expect(h1(page)).toHaveText('Alpha');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1230);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(1238);
});

test('edits and undo history survive a tab switch; edit mode is per tab', async ({ page }) => {
  await openViaLaunch(page, [A, B]);
  await tabs(page).nth(0).click();
  await page.locator('.edit-mode-toggle').click();
  const surface = page.locator('.editor-surface .ProseMirror');
  await expect(surface).toBeVisible();
  await surface.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' zzz');
  await expect(surface).toContainText('begin. zzz');

  await tabs(page).nth(1).click();
  // Beta was never put in edit mode.
  await expect(page.locator('.editor-surface')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Beta' })).toBeVisible();

  await tabs(page).nth(0).click();
  await expect(surface).toBeVisible();
  await expect(surface).toContainText('begin. zzz');
  await surface.focus();
  await page.keyboard.press(`${await editorMod(page)}+z`);
  await expect(surface).not.toContainText('zzz');
});

test('an annotation made just before switching is saved to its own file', async ({ page }) => {
  await openViaLaunch(page, [A, B]);
  await tabs(page).nth(0).click();
  await expect(h1(page)).toHaveText('Alpha');
  await page.getByRole('radio', { name: /highlight/i }).click();
  await page.evaluate(() => {
    const p = document.querySelector('.viewer p[data-block-id]') as HTMLElement;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let tn: Text | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if ((node as Text).data.includes('truly')) { tn = node as Text; break; }
    }
    if (!tn) throw new Error('no "truly" text node');
    const start = tn.data.indexOf('truly');
    const range = document.createRange();
    range.setStart(tn, start);
    range.setEnd(tn, start + 'truly begin'.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  // Switch immediately — before the debounced save would have fired.
  await tabs(page).nth(1).click();
  const sidecar = await page.evaluate((p) => localStorage.getItem(`rmd-sidecar::${p}`), A);
  expect(sidecar).toBeTruthy();
  expect(JSON.parse(sidecar!).annotations).toHaveLength(1);
  const betaSidecar = await page.evaluate((p) => localStorage.getItem(`rmd-sidecar::${p}`), B);
  expect(betaSidecar ? JSON.parse(betaSidecar).annotations : []).toHaveLength(0);
});

test('closing the active tab shows its right-hand neighbour; tabs come back after a restart', async ({ page }) => {
  await openViaLaunch(page, [A, B, C]);
  await tabs(page).nth(1).click();
  await page.getByRole('button', { name: 'Close Beta' }).click();
  await expect(labels(page)).toHaveText(['Alpha', 'Gamma notes']);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(h1(page)).toHaveText('Gamma');

  await page.waitForTimeout(500); // session autosave debounce
  await page.reload();
  await expect(labels(page)).toHaveText(['Alpha', 'Gamma notes']);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(h1(page)).toHaveText('Gamma');
});

test('closing the last tab returns to the empty state', async ({ page }) => {
  await openViaLaunch(page, [A]);
  await expect(tabs(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Close Alpha' }).click();
  await expect(page.getByText(/Open a markdown file/i)).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
});

test('keyboard: Ctrl+Tab cycles and Ctrl+W closes', async ({ page }) => {
  await openViaLaunch(page, [A, B]);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+Tab');
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+w');
  await expect(labels(page)).toHaveText(['Beta']);
});

test('replace mode never shows a second tab', async ({ page }) => {
  await chooseSetting(page, 'Tabs & files', 'setting-open-mode', 'Replace');
  await openViaLaunch(page, [A]);
  await expect(h1(page)).toHaveText('Alpha');
  await openViaLaunch(page, [B]);
  await expect(h1(page)).toHaveText('Beta');
  await expect(page.getByRole('tablist')).toHaveCount(0);
});

test('scrolling right after switching to a tab is not undone by the scroll restore', async ({ page }) => {
  await openViaLaunch(page, [A, B]);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  // Switch to Alpha and scroll the moment its content is in the DOM.
  await page.evaluate(() => {
    (document.querySelectorAll('[role="tab"]')[0] as HTMLElement).click();
    const iv = setInterval(() => {
      if (document.querySelector('.viewer h1')?.textContent === 'Alpha') {
        clearInterval(iv);
        (document.querySelector('.scroll') as HTMLElement).scrollTop = 1234;
      }
    }, 0);
  });
  await expect(h1(page)).toHaveText('Alpha');
  await page.waitForTimeout(300);
  const top = await page.locator('.scroll').evaluate((el) => el.scrollTop);
  expect(top).toBeGreaterThan(1230);
});

test('a diagram is shown again, without an error, after switching tabs', async ({ page }) => {
  const D = '/e2e/tabs/Diagram.md';
  await page.evaluate((p) => {
    (window as any).__E2E_SEED_DOC__(p, '# Diagram\n\n```mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n```\n');
  }, D);
  await openViaLaunch(page, [D, B]);
  await tabs(page).nth(0).click();
  const svg = page.locator('.viewer .mermaid-block svg');
  await expect(svg).toBeVisible({ timeout: 10_000 });
  await tabs(page).nth(1).click();
  await expect(h1(page)).toHaveText('Beta');
  await tabs(page).nth(0).click();
  await expect(svg).toBeVisible({ timeout: 2_000 });
  await expect(svg).toContainText('Finish');
  await expect(page.locator('.viewer .mermaid-error')).toHaveCount(0);
});
