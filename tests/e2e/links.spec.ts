import { test, expect, type Page } from '@playwright/test';

// Links in a document never take the window anywhere: a footnote link
// scrolls the page, a link to a sibling .md opens it in a tab, web and mail
// links go to the user's browser (open_external), and anything else, a
// diagram's `click X href` included, does nothing.

const START = '/e2e/links/Start.md';
const OTHER = '/e2e/links/other.md';
const FILLER = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}, long enough to take a line or two of the column.`).join('\n\n');
const DOCS: Record<string, string> = {
  [START]: [
    '# Links',
    '',
    'A claim with a note[^1], [the other document](other.md), [the site](https://example.com/page) and [mail](mailto:me@example.com).',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[Go] --> B[Stay]',
    '  click A href "https://attacker.example/remarkdown"',
    '```',
    '',
    FILLER,
    '',
    '[^1]: The footnote itself.',
    '',
  ].join('\n'),
  [OTHER]: '# Other\n\nThe other document.\n',
};

async function open(page: Page) {
  await page.goto('/');
  await page.evaluate(([docs, p]) => {
    for (const [path, md] of Object.entries(docs)) (window as any).__E2E_SEED_DOC__(path, md);
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, [DOCS, START] as const);
  await expect(page.locator('.viewer h1')).toHaveText('Links');
}

const external = (page: Page) => page.evaluate(() => (window as any).__E2E_EXTERNAL__ ?? []);

test('a footnote link scrolls to the footnote, and the page stays put', async ({ page }) => {
  await open(page);
  const url = page.url();
  const footnote = page.locator('.viewer li#fn1');
  await expect(footnote).not.toBeInViewport();
  await page.locator('.viewer a[href="#fn1"]').click();
  await expect(footnote).toBeInViewport();
  expect(page.url()).toBe(url);
});

test('a link to a sibling .md opens it in a tab', async ({ page }) => {
  await open(page);
  const url = page.url();
  await page.locator('.viewer a[href="other.md"]').click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.viewer h1')).toHaveText('Other');
  expect(page.url()).toBe(url);
});

test('web and mail links go to the browser, never into the window', async ({ page, context }) => {
  await open(page);
  const url = page.url();
  await page.locator('.viewer a[href="https://example.com/page"]').click();
  await expect.poll(() => external(page)).toEqual(['https://example.com/page']);
  // A ctrl/middle click would ask for a new window; it goes the same way.
  await page.locator('.viewer a[href="https://example.com/page"]').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('.viewer a[href="mailto:me@example.com"]').click({ button: 'middle' });
  await expect.poll(() => external(page)).toEqual([
    'https://example.com/page',
    'https://example.com/page',
    'mailto:me@example.com',
  ]);
  expect(page.url()).toBe(url);
  expect(context.pages()).toHaveLength(1);
});

test('javascript: and file: links do nothing', async ({ page, context }) => {
  await open(page);
  const url = page.url();
  // markdown-it never writes these hrefs; put them on the page as a
  // sanitizer slip would, to show the click handler holds on its own.
  await page.evaluate(() => {
    const p = document.querySelector('.viewer p')!;
    p.insertAdjacentHTML(
      'beforeend',
      ' <a id="js" href="javascript:window.__PWNED__ = 1">js</a>' +
        ' <a id="file" href="file:///C:/Windows/win.ini">file</a>' +
        ' <a id="unc" href="%5C%5Cevil.example%5Cs%5Cr.md">unc</a>',
    );
  });
  for (const id of ['js', 'file', 'unc']) await page.locator(`.viewer #${id}`).click();
  // Give anything that was going to happen a moment to.
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__PWNED__)).toBeUndefined();
  expect(await external(page)).toEqual([]);
  await expect(page.getByRole('tab')).toHaveCount(1);
  expect(page.url()).toBe(url);
  expect(context.pages()).toHaveLength(1);
});

test("a diagram's click-href node goes nowhere", async ({ page, context }) => {
  await open(page);
  const url = page.url();
  const block = page.locator('.viewer .mermaid-block');
  const link = block.locator('svg a');
  await expect(link).toHaveCount(1);
  // The link is still drawn, without anywhere to go.
  expect(await link.evaluate((a) => a.getAttributeNames())).not.toContain('xlink:href');
  expect(await link.evaluate((a) => a.hasAttribute('href'))).toBe(false);
  await link.locator('.node').click();
  await link.locator('.node').click({ modifiers: ['ControlOrMeta'] });
  await page.waitForTimeout(300);
  expect(await external(page)).toEqual([]);
  expect(page.url()).toBe(url);
  expect(context.pages()).toHaveLength(1);
});
