// tests/e2e/scenarios.spec.ts
import { test, expect } from '@playwright/test';

const FIXTURE_PATH = '/e2e/sample.md';
const FIXTURE_MD = `# Sample\n\nThe **reader** who would truly understand must read slowly, and with care.\n\nAnother paragraph follows.\n`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate(
    ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
    [FIXTURE_PATH, FIXTURE_MD],
  );
  await page.evaluate(
    (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
    FIXTURE_PATH,
  );
});

test('1. opens a markdown file from the hamburger menu', async ({ page }) => {
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample');
});

test('2. a highlight persists across reload', async ({ page }) => {
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();

  await page.getByRole('radio', { name: /highlight/i }).click();

  // Programmatic selection — more reliable than mouse drag in Playwright.
  await page.evaluate(() => {
    const p = document.querySelector('p[data-block-id]') as HTMLElement;
    // Walk text nodes to find the one that contains 'truly'.
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let tn: Text | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = node as Text;
      if (t.data.includes('truly')) { tn = t; break; }
    }
    if (!tn) throw new Error('Could not find text node containing "truly"');
    const start = tn.data.indexOf('truly');
    const end = start + 'truly understand'.length;
    const range = document.createRange();
    range.setStart(tn, start);
    range.setEnd(tn, end);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  // Wait for debounced save (500ms) + margin.
  await page.waitForTimeout(800);

  // The sidecar in localStorage should now have 1 highlight.
  const sidecar = await page.evaluate(() =>
    localStorage.getItem('rmd-sidecar::/e2e/sample.md'),
  );
  expect(sidecar).toBeTruthy();
  const parsed = JSON.parse(sidecar!);
  expect(parsed.annotations).toHaveLength(1);
  expect(parsed.annotations[0].type).toBe('highlight');

  // Reload and reopen to verify persistence.
  await page.reload();
  await page.evaluate(
    (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
    FIXTURE_PATH,
  );
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.waitForTimeout(300);

  const afterReload = await page.evaluate(() =>
    localStorage.getItem('rmd-sidecar::/e2e/sample.md'),
  );
  expect(JSON.parse(afterReload!).annotations).toHaveLength(1);
});

test('3. a note persists across reload with body intact', async ({ page }) => {
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();

  await page.getByRole('radio', { name: /note/i }).click();
  await page.locator('p[data-block-id]').first().click();

  const popover = page.getByRole('dialog', { name: /note/i });
  await popover.waitFor();
  const textarea = popover.getByRole('textbox');
  await textarea.fill('this is my note');
  await page.waitForTimeout(800);

  const sidecar = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('rmd-sidecar::/e2e/sample.md')))!,
  );
  const note = sidecar.annotations.find((a: any) => a.type === 'note');
  expect(note.body).toBe('this is my note');
});

test('4. a drawing persists', async ({ page }) => {
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();

  await page.getByRole('radio', { name: /draw/i }).click();
  const svg = page.locator('svg.draw-overlay');
  const box = await svg.boundingBox();
  if (!box) throw new Error('svg not laid out');

  // Draw a small stroke over the document.
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.up();

  // Wait for 3s idle finalization + 500ms debounce + margin.
  await page.waitForTimeout(3800);

  const sidecar = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('rmd-sidecar::/e2e/sample.md')))!,
  );
  const drawing = sidecar.annotations.find((a: any) => a.type === 'drawing');
  expect(drawing).toBeTruthy();
  expect(drawing.strokes.length).toBeGreaterThan(0);
});

test('5. external edit to the markdown orphans a highlight', async ({ page }) => {
  // Create a highlight first.
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.getByRole('radio', { name: /highlight/i }).click();
  await page.evaluate(() => {
    const p = document.querySelector('p[data-block-id]') as HTMLElement;
    // Walk text nodes to find the one that contains 'truly'.
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let tn: Text | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = node as Text;
      if (t.data.includes('truly')) { tn = t; break; }
    }
    if (!tn) throw new Error('Could not find text node containing "truly"');
    const start = tn.data.indexOf('truly');
    const end = start + 'truly understand'.length;
    const range = document.createRange();
    range.setStart(tn, start);
    range.setEnd(tn, end);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(800);

  // Simulate an external edit — the highlighted phrase is gone.
  await page.evaluate(
    ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
    [FIXTURE_PATH, '# Sample\n\nCompletely different text here, no overlap at all.\n'],
  );

  // Reopen.
  await page.reload();
  await page.evaluate(
    (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
    FIXTURE_PATH,
  );
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.waitForTimeout(500);

  // Re-open the menu and check the Orphaned Annotations entry.
  await page.getByRole('button', { name: /menu/i }).click();
  const orphanItem = page.getByRole('menuitem', { name: /orphaned annotations/i });
  await expect(orphanItem).toBeEnabled();
  await expect(orphanItem).toContainText(/\(1\)/);
});
