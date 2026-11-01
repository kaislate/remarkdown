import { test, expect, type Page } from '@playwright/test';

// Links in a document never take the window anywhere: a footnote link
// scrolls the page, a link to a sibling .md opens it in a tab, web and mail
// links go to the user's browser (open_external), and anything else, a
// diagram's `click X href` included, does nothing.

const START = '/e2e/links/Start.md';
const OTHER = '/e2e/links/other.md';
const FORM = '/e2e/links/Form.md';
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
    '[^1]: The footnote itself, with [a guide](CONTRIBUTING.md), [notes](https://example.com/notes) and [a host Rust cannot parse](http://xn--a.attacker.example/).',
    '',
  ].join('\n'),
  [OTHER]: '# Other\n\nThe other document.\n',
  // Mermaid keeps form controls in an HTML label, even under strict
  // security; the button would send the window to the form's action.
  [FORM]: [
    '# Form',
    '',
    '```mermaid',
    'flowchart TD',
    `  A["<form action='http://xn--a.attacker.example/'><button>Update required</button></form>"] --> B["<form method='post' action='/'><button>Reload</button></form>"]`,
    '```',
    '',
  ].join('\n'),
};

async function open(page: Page, path = START, title = 'Links') {
  await page.goto('/');
  await page.evaluate(([docs, p]) => {
    for (const [path, md] of Object.entries(docs)) (window as any).__E2E_SEED_DOC__(path, md);
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, [DOCS, path] as const);
  await expect(page.locator('.viewer h1')).toHaveText(title);
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

// The target is looked for in the article, not the first element anywhere
// on the page that shares its id.
test('a footnote link finds its footnote even when something outside the article has the same id', async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<div id="fn1" hidden></div>'));
  const footnote = page.locator('.viewer li#fn1');
  await expect(footnote).not.toBeInViewport();
  await page.locator('.viewer a[href="#fn1"]').click();
  await expect(footnote).toBeInViewport();
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

// The footnote editor's preview sits outside the reader, on <body>. A
// relative link there would reload the whole app, losing the edit. Rust's
// navigation guard never sees a host its URL parser rejects (Tauri lets
// those through), though Chromium follows it: only the page can stop it.
test("a link in the footnote editor's preview neither reloads the app nor leaves it", async ({ page, context }) => {
  await open(page);
  const url = page.url();
  await page.locator('.edit-mode-toggle').click();
  await page.locator('.editor-surface sup.footnote-ref a').click();
  const preview = page.locator('.preview[aria-label="How it will read"]');
  await expect(preview.locator('a')).toHaveCount(3);
  await page.evaluate(() => ((window as any).__E2E_STILL_HERE__ = true));
  await preview.locator('a[href="CONTRIBUTING.md"]').click();
  await preview.locator('a[href="https://example.com/notes"]').click();
  await expect.poll(() => external(page)).toEqual(['https://example.com/notes']);
  // Chromium hands this one to open_external, which refuses it; WebKit
  // can't parse it either.
  await preview.locator('a[href^="http://xn--a."]').click();
  await page.waitForTimeout(300);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => (window as any).__E2E_STILL_HERE__)).toBe(true);
  await expect(page.locator('.editor-surface .ProseMirror')).toBeVisible();
  expect(context.pages()).toHaveLength(1);
});

// A form in a diagram label never takes the window anywhere, in the reader
// or in the editor: not to another site (Rust can't stop that one, its URL
// parser rejects the host), and not back to the app's own page, which
// would reload it and lose the edit.
test("a form in a diagram's label goes nowhere", async ({ page, context }) => {
  const left: string[] = [];
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) left.push(`${r.method()} ${r.url()}`);
  });
  await page.route(/attacker\.example/, (r) => r.fulfill({ contentType: 'text/html', body: '<h1>phished</h1>' }));
  await open(page, FORM, 'Form');
  left.length = 0;
  const url = page.url();
  await page.evaluate(() => ((window as any).__E2E_STILL_HERE__ = true));

  const reader = page.locator('.viewer .mermaid-block');
  await expect(reader.getByText('Update required')).toBeVisible();
  await reader.getByText('Update required').click();
  await reader.getByText('Reload').click();
  // Put a form on the page as a sanitizer slip would, to show the window's
  // own guard holds on its own.
  await page.evaluate(() => {
    document.querySelector('.viewer .mermaid-block')!.insertAdjacentHTML(
      'beforeend',
      `<form method="post" action="/"><button id="slip">Slip</button></form>`,
    );
  });
  await page.locator('#slip').click();

  await page.locator('.edit-mode-toggle').click();
  const editor = page.locator('.editor-surface .mermaid-rendered');
  await expect(editor.getByText('Update required')).toBeVisible();
  await editor.getByText('Update required').click();
  await editor.getByText('Reload').click();

  await page.waitForTimeout(300);
  expect(left).toEqual([]);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => (window as any).__E2E_STILL_HERE__)).toBe(true);
  await expect(page.locator('.editor-surface .ProseMirror')).toBeVisible();
  expect(context.pages()).toHaveLength(1);
});

// The editor's link popover is the one form in the app. It applies the link
// itself, so the window's refusal to submit anything leaves it working.
test("the editor's link popover still applies a link", async ({ page }) => {
  await open(page, OTHER, 'Other');
  const url = page.url();
  await page.locator('.edit-mode-toggle').click();
  // Select 'other' in "The other document."; the bubble shows on a mouseup
  // once the editor has caught up with the selection.
  await page.evaluate(() => {
    const p = document.querySelector('.editor-surface .ProseMirror p')!;
    (p.closest('.ProseMirror') as HTMLElement).focus();
    const tn = p.firstChild as Text;
    const r = document.createRange();
    r.setStart(tn, 4);
    r.setEnd(tn, 9);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  const bubble = page.locator('.editor-bubble-menu');
  await expect(async () => {
    await page.locator('.editor-surface').dispatchEvent('mouseup');
    await expect(bubble.getByRole('button', { name: 'Link' })).toBeVisible({ timeout: 250 });
  }).toPass();
  await bubble.getByRole('button', { name: 'Link' }).click();
  await bubble.locator('.link-input').fill('https://example.com/applied');
  await bubble.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.editor-surface a[href="https://example.com/applied"]')).toHaveText('other');
  expect(page.url()).toBe(url);
});
