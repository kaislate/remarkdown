import { test, expect, type Page } from '@playwright/test';

// Right-click never shows the browser's own menu; the app's menu fits what
// was clicked.

const PATH = '/e2e/menu/Notes.md';
const DOC = '# Notes\n\nThe reader who would truly understand a passage must read slowly.\n\nA second paragraph.\n';

async function open(page: Page) {
  await page.goto('/');
  await page.evaluate(([p, md]) => {
    (window as any).__E2E_SEED_DOC__(p, md);
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, [PATH, DOC]);
  await expect(page.locator('.viewer h1')).toHaveText('Notes');
}

const menu = (page: Page) => page.getByRole('menu', { name: 'Options' });
const items = (page: Page) => menu(page).getByRole('menuitem');

async function selectText(page: Page, text: string) {
  await page.evaluate((t) => {
    const p = Array.from(document.querySelectorAll('.viewer p')).find((el) => el.textContent?.includes(t))!;
    const tn = p.firstChild as Text;
    const i = tn.data.indexOf(t);
    const r = document.createRange();
    r.setStart(tn, i);
    r.setEnd(tn, i + t.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  }, text);
}

// Right-click on the selected words themselves (right-clicking elsewhere
// moves the selection, in any browser).
async function rightClickSelection(page: Page) {
  const r = await page.evaluate(() => {
    const b = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await page.mouse.click(r.x, r.y, { button: 'right' });
}

async function rightClickOn(page: Page, selector: string) {
  const b = (await page.locator(selector).first().boundingBox())!;
  await page.mouse.click(b.x + 10, b.y + b.height / 2, { button: 'right' });
}

test('the page: what to do with the document', async ({ page }) => {
  await open(page);
  await rightClickOn(page, '.viewer p >> nth=1');
  await expect(items(page)).toHaveText(['Edit', 'Reader mode', 'Show in folder', 'Copy file path', 'Select all'].map((l) => new RegExp(`^${l}`)));
  await menu(page).getByRole('menuitem', { name: /^Reader mode/ }).click();
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
});

test('selected text: copy, highlight, add a re.mark', async ({ page }) => {
  await open(page);
  await selectText(page, 'truly understand');
  await rightClickSelection(page);
  await expect(items(page)).toHaveText([/^Copy/, /^Highlight/, /^Add a re\.mark/, /^Select all/]);
  await menu(page).getByRole('menuitem', { name: /^Copy/ }).click();
  expect(await page.evaluate(() => (window as any).__E2E_CLIPBOARD__)).toBe('truly understand');
  await selectText(page, 'truly understand');
  await rightClickSelection(page);
  await menu(page).getByRole('menuitem', { name: /^Highlight/ }).click();
  await expect.poll(() => page.evaluate(() => {
    let n = 0;
    for (const [, hl] of (CSS as any).highlights) n += hl.size;
    return n;
  })).toBe(1);
});

test('reader mode: just the way out (and Copy with a selection)', async ({ page }) => {
  await open(page);
  await page.locator('.reader-mode-toggle').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.matches(':active-view-transition'))).toBe(false);
  await rightClickOn(page, '.viewer p >> nth=1');
  await expect(items(page)).toHaveText([/^Leave reader mode/]);
  await page.keyboard.press('Escape'); // closes the menu, not reader mode
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
  await selectText(page, 'second paragraph');
  await rightClickSelection(page);
  await expect(items(page)).toHaveText([/^Copy/, /^Leave reader mode/]);
  await menu(page).getByRole('menuitem', { name: /^Leave reader mode/ }).click();
  await expect(page.locator('body')).not.toHaveClass(/reader-mode/);
});

test('the editor: cut, copy, paste, select all, done editing', async ({ page }) => {
  await open(page);
  await page.locator('.edit-mode-toggle').click();
  const para = page.locator('.editor-surface .ProseMirror p').nth(1);
  await expect(para).toBeVisible();
  await para.click();
  await page.keyboard.press('End');
  await page.evaluate(() => { (window as any).__E2E_CLIPBOARD__ = ' Pasted words.'; });
  await rightClickOn(page, '.editor-surface .ProseMirror p >> nth=1');
  await expect(items(page)).toHaveText([/^Cut/, /^Copy/, /^Paste/, /^Select all/, /^Done editing/]);
  await menu(page).getByRole('menuitem', { name: /^Paste/ }).click();
  await expect(para).toContainText('Pasted words.');
});

test('buttons and panels: no menu at all, and never the browser menu', async ({ page }) => {
  await open(page);
  await rightClickOn(page, '.minimap');
  await expect(menu(page)).toHaveCount(0);
  const prevented = await page.evaluate(() => {
    const results: boolean[] = [];
    for (const sel of ['.minimap', '.zoom-rail', '.viewer p', 'body']) {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
      document.querySelector(sel)!.dispatchEvent(ev);
      results.push(ev.defaultPrevented);
    }
    return results;
  });
  expect(prevented).toEqual([true, true, true, true]);
});
