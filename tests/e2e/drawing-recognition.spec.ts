import { test, expect } from '@playwright/test';

const TEST_DOC_PATH = '/test/drawings.md';
const TEST_DOC_MARKDOWN = `# Sample document

This is the first paragraph with some plain text and an italic *quick brown* word.

This is the second paragraph that's just a regular line of prose for testing underline detection below.
`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    (window as any).__E2E_CLEAR_ALL__();
  });
  await page.evaluate(
    ({ path, md }: { path: string; md: string }) => {
      (window as any).__E2E_SEED_DOC__(path, md);
      (window as any).__E2E_SET_DIALOG_PATH__(path);
    },
    { path: TEST_DOC_PATH, md: TEST_DOC_MARKDOWN },
  );
  // Open the seeded doc via the menu's Open… handler.
  await page.getByRole('button', { name: /Menu/i }).click();
  await page.getByRole('menuitem', { name: /^Open…/ }).click();
  // Wait for the article to render the seeded content.
  await expect(page.locator('article.viewer')).toContainText('Sample document');
});

test.describe('drawing recognition (E2E)', () => {
  test('findEnclosedText returns text fully inside the bbox', async ({ page }) => {
    const result = await page.evaluate(() => {
      const root = document.querySelector('article.viewer') as HTMLElement;
      const em = root.querySelector('em') as HTMLElement;
      const r = em.getBoundingClientRect();
      const bbox = {
        minX: r.left - 4, maxX: r.right + 4,
        minY: r.top - 4, maxY: r.bottom + 4,
        width: r.width + 8, height: r.height + 8,
      };
      return (window as any).__E2E_DRAW__.findEnclosedText(bbox, root);
    });
    // The em element wraps "quick brown".
    expect(result).toContain('quick');
    expect(result).toContain('brown');
  });

  test('findEnclosedText returns null when no text falls fully inside', async ({ page }) => {
    const result = await page.evaluate(() => {
      const root = document.querySelector('article.viewer') as HTMLElement;
      // Bbox far off-screen — no text could fall inside.
      const bbox = { minX: 9999, maxX: 10000, minY: 9999, maxY: 10000, width: 1, height: 1 };
      return (window as any).__E2E_DRAW__.findEnclosedText(bbox, root);
    });
    expect(result).toBeNull();
  });

  test('recognize classifies a closed loop around text as "circle"', async ({ page }) => {
    const result = await page.evaluate(() => {
      const root = document.querySelector('article.viewer') as HTMLElement;
      const em = root.querySelector('em') as HTMLElement;
      const r = em.getBoundingClientRect();
      // Build a closed-loop stroke around the em element.
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const rx = r.width * 1.2;
      const ry = r.height * 2;
      const points: Array<[number, number]> = [];
      const N = 24;
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * 2 * Math.PI;
        points.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
      }
      const recognized = (window as any).__E2E_DRAW__.recognize(points, root);
      return { kind: recognized.kind, hasAnchor: !!recognized.anchor };
    });
    expect(result.kind).toBe('circle');
    expect(result.hasAnchor).toBe(true);
  });

  test('recognize classifies a horizontal line below text as "underline"', async ({ page }) => {
    const result = await page.evaluate(() => {
      const root = document.querySelector('article.viewer') as HTMLElement;
      // Find the second paragraph for underline detection.
      const ps = root.querySelectorAll('p');
      const p = ps[1] as HTMLElement;
      const r = p.getBoundingClientRect();
      const y = r.bottom + 4;
      const points: Array<[number, number]> = [
        [r.left + 10, y],
        [r.left + r.width / 2, y],
        [r.left + r.width - 10, y],
      ];
      const recognized = (window as any).__E2E_DRAW__.recognize(points, root);
      return { kind: recognized.kind };
    });
    expect(result.kind).toBe('underline');
  });
});
