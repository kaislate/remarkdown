import { test, expect } from '@playwright/test';

// A highlight dragged across two paragraphs must come back after the
// document is closed and reopened (it used to be orphaned).

const P = '/e2e/multi/Notes.md';
const MD = '# Notes\n\nThe first paragraph ends here.\n\nThe second paragraph starts here.\n';

test('a highlight spanning two paragraphs survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(([p, md]) => {
    (window as any).__E2E_SEED_DOC__(p, md);
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, [P, MD]);
  await expect(page.getByRole('heading', { level: 1, name: 'Notes' })).toBeVisible();
  await page.getByRole('radio', { name: /highlight/i }).click();
  await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('.viewer p[data-block-id]')) as HTMLElement[];
    const t1 = ps[0].firstChild as Text;
    const t2 = ps[1].firstChild as Text;
    const r = document.createRange();
    r.setStart(t1, t1.data.indexOf('ends here.'));
    r.setEnd(t2, 'The second'.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(800);
  const saved = JSON.parse(await page.evaluate((p) => localStorage.getItem(`rmd-sidecar::${p}`)!, P));
  expect(saved.annotations).toHaveLength(1);

  await page.reload(); // tabs are restored from the session
  await expect(page.getByRole('heading', { level: 1, name: 'Notes' })).toBeVisible();
  await page.waitForTimeout(500);
  // Not orphaned: the menu's Orphaned Annotations entry stays disabled.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Orphaned Annotations/ })).toBeDisabled();
  const painted = await page.evaluate(() => {
    const reg = (CSS as any).highlights as Map<string, any>;
    let n = 0;
    for (const h of reg.values()) n += h.size;
    return n;
  });
  expect(painted).toBeGreaterThan(0);
});
