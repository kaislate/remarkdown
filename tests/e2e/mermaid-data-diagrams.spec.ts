// The data diagram types with real mermaid: each one inserted from the
// toolbar draws, opens its table on a click, and still draws after every
// kind of change the table makes.
import { test, expect, type Page } from '@playwright/test';

const PATH = '/e2e/docs/data-diagrams.md';

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
  await page.evaluate((p) => (window as any).__E2E_SEED_DOC__(p, '# Charts\n\nStart here.\n'), PATH);
  await page.evaluate((p) => (window as any).__E2E_SET_DIALOG_PATH__(p), PATH);
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.locator('.edit-mode-toggle').click();
  await page.locator('.editor-surface .ProseMirror p', { hasText: 'Start here' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
});

async function lastWrite(page: Page): Promise<string> {
  await page.waitForTimeout(900);
  const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ markdown: string }>);
  return writes.length ? writes[writes.length - 1].markdown : '';
}

async function insert(page: Page, label: string) {
  await page.locator('[data-action="diagram-menu"]').click();
  await page.locator('.toolbar-diagram-menu').getByRole('menuitem', { name: label }).click();
  const block = page.locator('.editor-surface .mermaid-block-editor').first();
  await expect(block.locator('.mermaid-rendered svg')).toBeVisible({ timeout: 20_000 });
  await expect(block.locator('.mermaid-error')).toHaveCount(0);
  // Edited visually: no text panel offered.
  await expect(block.locator('.mermaid-fallback-note')).toBeHidden();
  return block;
}

// Still drawn (no error box) after a change.
async function drawn(block: ReturnType<Page['locator']>) {
  await expect(block.locator('.mermaid-error')).toHaveCount(0);
  await expect(block.locator('.mermaid-rendered svg')).toBeVisible();
}

async function setCell(form: ReturnType<Page['locator']>, row: number, column: string, value: string) {
  const cell = form.locator(`tbody tr[data-row="${row}"]`).getByRole(column === 'choice' ? 'combobox' : 'textbox', { name: column }).or(
    form.locator(`tbody tr[data-row="${row}"] input[aria-label="${column}"]`),
  ).first();
  await cell.fill(value);
  await cell.press('Enter');
}

const form = (page: Page) => page.locator('.mermaid-form-popover').first();

test('bar & line chart: a spreadsheet of values', async ({ page }) => {
  const block = await insert(page, 'Bar & line chart');
  await block.locator('.mermaid-rendered svg').click({ position: { x: 40, y: 40 } });
  await expect(form(page)).toBeVisible();
  await setCell(form(page), 0, 'Bars', '80');
  await drawn(block);
  await form(page).getByRole('button', { name: 'Add row' }).click();
  await drawn(block);
  await setCell(form(page), 5, 'Label', 'Weekend days');
  await drawn(block);
  const md = await lastWrite(page);
  expect(md).toContain('bar [80, 45, 40, 60, 55, 0]');
  expect(md).toContain('x-axis [Mon, Tue, Wed, Thu, Fri, "Weekend days"]');
});

test('journey: steps with a feeling and people', async ({ page }) => {
  const block = await insert(page, 'Journey');
  await block.locator('[data-action="data"]').click();
  await setCell(form(page), 0, 'Feeling (1–5)', '1');
  await drawn(block);
  await form(page).getByRole('button', { name: 'Add step' }).first().click();
  await drawn(block);
  await block.locator('[data-action="settings"]').click();
  await form(page).getByRole('button', { name: 'Add section' }).click();
  await drawn(block);
  const md = await lastWrite(page);
  expect(md).toContain('Wake up: 1: Me');
  expect(md).toMatch(/section Section 3\n\s+New task: 3/);
});

test('quadrant: points and labels', async ({ page }) => {
  const block = await insert(page, 'Quadrant');
  await block.locator('[data-action="data"]').click();
  await setCell(form(page), 0, 'Across', '0.9');
  await drawn(block);
  await form(page).getByRole('button', { name: 'Add point' }).click();
  await drawn(block);
  await block.locator('[data-action="settings"]').click();
  const top = form(page).getByLabel('Top end');
  await top.fill('Very valuable');
  await top.press('Enter');
  await drawn(block);
  const md = await lastWrite(page);
  expect(md).toContain('Idea A: [0.9, 0.7]');
  expect(md).toContain('y-axis Low value --> Very valuable');
});

test('radar: scores per measure', async ({ page }) => {
  const block = await insert(page, 'Radar');
  await block.locator('[data-action="data"]').click();
  await setCell(form(page), 0, 'Ana', '5');
  await drawn(block);
  await form(page).getByRole('button', { name: 'Add measure' }).click();
  await drawn(block);
  const md = await lastWrite(page);
  expect(md).toContain('curve ana["Ana"]{5, 3, 5, 2, 4, 0}');
});

test('Sankey: flows', async ({ page }) => {
  const block = await insert(page, 'Flows (Sankey)');
  await block.locator('[data-action="data"]').click();
  await setCell(form(page), 1, 'Amount', '450');
  await drawn(block);
  await form(page).getByRole('button', { name: 'Add flow' }).click();
  await drawn(block);
  expect(await lastWrite(page)).toContain('Income,Food,450');
});

test('packet: fields follow on when one grows', async ({ page }) => {
  const block = await insert(page, 'Packet');
  await block.locator('[data-action="data"]').click();
  await setCell(form(page), 0, 'Bits', '16');
  await drawn(block);
  const md = await lastWrite(page);
  expect(md).toContain('0-15: "Type"\n    16-23: "Length"\n    24-39: "Checksum"\n    40-71: "Data"');
});
