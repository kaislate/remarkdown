// Making the shape of a document in edit mode without knowing markdown:
// the toolbar's Text style menu (headings, lists, quotes, a divider),
// pictures and formulas — and formulas and document details surviving a
// save untouched.
import { test, expect, type Page } from '@playwright/test';
import { editorMod } from './support/webkit';

const PATH = '/e2e/docs/structure.md';
const MD = `---\ntitle: Structure\n---\n\n# Start\n\nA plain line.\n\nEuler: $e^{i\\pi} + 1 = 0$.\n`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
  await page.evaluate(([p, md]) => (window as any).__E2E_SEED_DOC__(p, md), [PATH, MD]);
  await page.evaluate((p) => (window as any).__E2E_SET_DIALOG_PATH__(p), PATH);
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();
});

async function lastWrite(page: Page): Promise<string> {
  await page.waitForTimeout(900);
  const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ markdown: string }>);
  return writes.length ? writes[writes.length - 1].markdown : '';
}

async function clickInto(page: Page, text: string) {
  await page.locator('.editor-surface .ProseMirror p', { hasText: text }).click();
  await page.keyboard.press('End');
}

async function pickStyle(page: Page, label: string) {
  await page.locator('[data-action="style-menu"]').click();
  await page.locator('.style-menu').getByRole('menuitemradio', { name: new RegExp(`^${label}`) }).click();
}

test('the reader shows the details folded away, and the formula drawn', async ({ page }) => {
  await expect(page.locator('.viewer details.front-matter summary')).toHaveText('Document details');
  await expect(page.locator('.viewer .katex')).toHaveCount(1);
  await expect(page.locator('.viewer hr')).toHaveCount(0);
});

test('Text style shows where the cursor is and turns a line into a heading, a list, a quote', async ({ page }) => {
  await page.locator('.edit-mode-toggle').click();
  await clickInto(page, 'A plain line');
  const styleBtn = page.locator('[data-action="style-menu"]');
  await expect(styleBtn).toContainText('Normal text');

  await pickStyle(page, 'Heading 2');
  await expect(page.locator('.editor-surface h2')).toHaveText('A plain line.');
  await expect(styleBtn).toContainText('Heading 2');

  await pickStyle(page, 'Bulleted list');
  await expect(page.locator('.editor-surface ul li')).toHaveText('A plain line.');
  await pickStyle(page, 'Numbered list');
  await expect(page.locator('.editor-surface ol li')).toHaveText('A plain line.');
  // Quoting a list quotes it whole; the menu still names the innermost style.
  await pickStyle(page, 'Quote');
  await expect(page.locator('.editor-surface blockquote ol li')).toHaveText('A plain line.');

  const saved = await lastWrite(page);
  expect(saved).toContain('> 1. A plain line.');
  // Untouched: the details and the formula, exactly as written.
  expect(saved.startsWith('---\ntitle: Structure\n---\n')).toBe(true);
  expect(saved).toContain('$e^{i\\pi} + 1 = 0$');
});

test('typing # at the start of a line makes a heading; Mod+Alt+0 makes it normal text again', async ({ page }) => {
  await page.locator('.edit-mode-toggle').click();
  await clickInto(page, 'A plain line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# New part');
  await expect(page.locator('.editor-surface h1', { hasText: 'New part' })).toBeVisible();
  await page.keyboard.press(`${await editorMod(page)}+Alt+0`);
  await expect(page.locator('.editor-surface p', { hasText: 'New part' })).toBeVisible();
});

test('a divider line from the Text style menu', async ({ page }) => {
  await page.locator('.edit-mode-toggle').click();
  await clickInto(page, 'A plain line');
  await page.locator('[data-action="style-menu"]').click();
  await page.locator('[data-action="divider"]').click();
  await page.keyboard.type('Below the line');
  expect(await lastWrite(page)).toContain('A plain line.\n\n---\n\nBelow the line');
});

test('Picture: chosen from disk, linked next to the document, shown, and describable', async ({ page }) => {
  await page.evaluate(() => { (window as any).__E2E_IMAGE_PICK__ = '/e2e/docs/pics/Sunny day.png'; });
  await page.locator('.edit-mode-toggle').click();
  await clickInto(page, 'A plain line');
  await page.locator('[data-action="image"]').click();
  const img = page.locator('.editor-surface .editor-image img');
  await expect(img).toHaveAttribute('src', 'asset://localhost//e2e/docs/pics/Sunny day.png');
  expect(await page.evaluate(() => (window as any).__E2E_IMAGE_DIALOG_START__)).toBe('/e2e/docs');
  expect(await lastWrite(page)).toContain('A plain line.![Sunny day](pics/Sunny%20day.png)');

  await img.click();
  const pop = page.getByRole('dialog', { name: 'Edit picture description' });
  await pop.locator('textarea').fill('A sunny beach');
  await pop.getByRole('button', { name: 'Save' }).click();
  expect(await lastWrite(page)).toContain('![A sunny beach](pics/Sunny%20day.png)');
});

test('Formula: opens straight away with a live preview, and saves as TeX', async ({ page }) => {
  await page.locator('.edit-mode-toggle').click();
  await clickInto(page, 'A plain line');
  await page.keyboard.press('Enter');
  await page.locator('[data-action="formula"]').click();
  const pop = page.getByRole('dialog', { name: 'Edit formula' });
  await expect(pop).toBeVisible();
  await pop.locator('textarea').fill('\\frac{a}{b}');
  await expect(pop.locator('.preview .katex')).toBeVisible();
  await pop.locator('textarea').press('Control+Enter');
  await expect(pop).toHaveCount(0);
  await expect(page.locator('.editor-surface .math-block .katex-display')).toBeVisible();
  expect(await lastWrite(page)).toContain('$$\n\\frac{a}{b}\n$$');
});

test('the details card opens its text to change', async ({ page }) => {
  await page.locator('.edit-mode-toggle').click();
  await page.locator('.editor-surface .front-matter-block').click();
  const pop = page.getByRole('dialog', { name: 'Edit document details' });
  await expect(pop.locator('textarea')).toHaveValue('title: Structure');
  await pop.locator('textarea').fill('title: Structure\nauthor: Me');
  await pop.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.editor-surface .front-matter-block dt')).toHaveText(['title', 'author']);
  expect((await lastWrite(page)).startsWith('---\ntitle: Structure\nauthor: Me\n---\n')).toBe(true);
});

test('a kind of diagram the visual editor does not cover: changed through its text, with a live drawing', async ({ page }) => {
  const GIT = '/e2e/docs/git.md';
  await page.evaluate(([p, md]) => (window as any).__E2E_SEED_DOC__(p, md), [GIT, '# Git\n\n```mermaid\ngitGraph\n  commit\n  branch feature\n  commit\n```\n']);
  await page.evaluate((p) => (window as any).__E2E_SET_DIALOG_PATH__(p), GIT);
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await expect(page.locator('.viewer h1')).toHaveText('Git');
  await page.locator('.edit-mode-toggle').click();
  const block = page.locator('.editor-surface .mermaid-block-editor');
  await expect(block.locator('.mermaid-rendered svg')).toBeVisible();
  await block.getByRole('button', { name: 'Edit diagram text' }).click();
  const panel = page.getByRole('dialog', { name: 'Edit diagram text' });
  await expect(panel.locator('.mermaid-text-preview svg')).toBeVisible();
  const box = panel.getByRole('textbox', { name: 'Diagram text' });
  await box.press('Control+End');
  await box.pressSequentially('\n  checkout main\n  merge feature');
  await expect(panel.locator('.mermaid-text-problem')).toBeHidden();
  await box.press('Control+Enter');
  await expect(panel).toHaveCount(0);
  expect(await lastWrite(page)).toContain('  checkout main\n  merge feature\n```');
});
