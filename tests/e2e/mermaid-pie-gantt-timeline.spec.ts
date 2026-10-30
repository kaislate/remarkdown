// Pie, gantt and timeline editing in a real browser: click each kind of
// target, edit through the popover, and check that the saved markdown
// changes only the intended lines and the diagram still renders.
// Helpers copied from mermaid-audit.spec.ts.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { clickMiddle } from './support/webkit';

const PIE = ['pie', '    %% keep me', '    title Pets adopted', '    "Dogs" : 386', '    "Cats" : 85', '    "Rats" : 15'].join('\n');
const GANTT = [
  'gantt',
  '    title Plan',
  '    dateFormat YYYY-MM-DD',
  '    %% keep me',
  '    section Design',
  '    Research      :a1, 2026-01-05, 10d',
  '    Wireframes    :after a1, 7d',
  '    section Build',
  '    Implementation :2026-01-20, 20d',
].join('\n');
const TIMELINE = [
  'timeline',
  '    title History',
  '    %% keep me',
  '    section Early',
  '        2002 : LinkedIn',
  '        2004 : Facebook : Google',
  '    section Late',
  '        2006 : Twitter',
].join('\n');

const fence = (s: string) => '```mermaid\n' + s + '\n```';
const DOC = (pie: string, gantt: string, timeline: string) =>
  `# Diagrams\n\n## pie\n\n${fence(pie)}\n\n## gantt\n\n${fence(gantt)}\n\n## timeline\n\n${fence(timeline)}\n\nThe end.\n`;
const PATH = '/e2e/pie-gantt-timeline.md';

async function clickMenuItem(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('button', { name: /menu/i }).click();
  const item = page.getByRole('menuitem', { name });
  try {
    await item.click({ timeout: 2000 });
  } catch {
    await item.evaluate((el) => (el as HTMLElement).click());
  }
}

async function seedAndOpen(page: Page, path: string, md: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
  await page.evaluate(([p, m]) => (window as any).__E2E_SEED_DOC__?.(p, m), [path, md]);
  await page.evaluate((p) => (window as any).__E2E_SET_DIALOG_PATH__?.(p), path);
  await clickMenuItem(page, /open…/i);
  await page.getByRole('heading', { level: 1 }).first().waitFor();
}

async function enterEditMode(page: Page): Promise<void> {
  await page.locator('.edit-mode-toggle').click();
  await expect(page.locator('.editor-surface .ProseMirror')).toBeVisible();
  await page.waitForFunction(
    () => {
      const blocks = Array.from(document.querySelectorAll('.editor-surface .mermaid-block-editor'));
      return blocks.length === 3 && blocks.every((b) => !!b.querySelector('.mermaid-rendered > svg'));
    },
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(300);
}

async function lastWrite(page: Page): Promise<string | null> {
  const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
  return writes.length ? writes[writes.length - 1].markdown : null;
}

function fencedBlocks(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  let heading = '';
  let body: string[] | null = null;
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    if (!body) {
      const h = /^## (.*)$/.exec(raw);
      if (h) heading = h[1];
      if (/^```/.test(raw)) body = [];
    } else if (/^```\s*$/.test(raw)) {
      out[heading] = body.join('\n');
      body = null;
    } else body.push(raw);
  }
  return out;
}

// The editor wrapper of the diagram under `## heading`.
function block(page: Page, heading: string): Locator {
  return page.locator('.editor-surface .mermaid-block-editor').nth(['pie', 'gantt', 'timeline'].indexOf(heading));
}

// Saved sources are exactly `expected` (all three blocks).
async function expectSaved(page: Page, expected: { pie: string; gantt: string; timeline: string }): Promise<void> {
  await expect.poll(async () => fencedBlocks((await lastWrite(page)) ?? ''), { timeout: 15_000 }).toEqual(expected);
}

async function expectDrawn(page: Page, heading: string): Promise<void> {
  const b = block(page, heading);
  await expect(b.locator('.mermaid-rendered > svg')).toHaveCount(1);
  await expect(b.locator('.mermaid-error')).toHaveCount(0);
}

const popover = (page: Page) => page.locator('.mermaid-form-popover:not([hidden])');
const fieldInput = (page: Page, id: string) => popover(page).locator(`[data-field="${id}"] input, [data-field="${id}"] select`).first();

async function fill(page: Page, id: string, value: string): Promise<void> {
  const input = fieldInput(page, id);
  await input.fill(value);
  await input.press('Enter');
}

test.describe('pie / gantt / timeline — visual editing', () => {
  test.beforeEach(async ({ page }) => {
    await seedAndOpen(page, PATH, DOC(PIE, GANTT, TIMELINE));
    await enterEditMode(page);
  });

  test('no "coming soon" note on any of them', async ({ page }) => {
    for (const h of ['pie', 'gantt', 'timeline']) {
      const b = block(page, h);
      await expect(b).not.toHaveClass(/mermaid-fallback/);
      await expect(b.getByText(/coming soon/i)).toBeHidden();
      await expect(b.locator('.mermaid-actions-bar')).toBeVisible();
    }
  });

  test('pie: wedge, legend entry, title and Show values', async ({ page }) => {
    const pie = block(page, 'pie');
    await pie.locator('path.pieCircle').nth(1).click({ force: true });
    await expect(fieldInput(page, 'label')).toHaveValue('Cats');
    await fill(page, 'label', 'Kittens');
    let p = PIE.replace('"Cats"', '"Kittens"');
    await expectSaved(page, { pie: p, gantt: GANTT, timeline: TIMELINE });
    await expectDrawn(page, 'pie');

    await pie.locator('g.legend').nth(2).locator('text').click({ force: true });
    await expect(fieldInput(page, 'label')).toHaveValue('Rats');
    await fill(page, 'value', '30');
    p = p.replace('"Rats" : 15', '"Rats" : 30');
    await expectSaved(page, { pie: p, gantt: GANTT, timeline: TIMELINE });

    await clickMiddle(page, pie.locator('text.pieTitleText'));
    await fill(page, 'title', 'Adoptions');
    p = p.replace('title Pets adopted', 'title Adoptions');
    await expectSaved(page, { pie: p, gantt: GANTT, timeline: TIMELINE });

    await pie.locator('.mermaid-actions-bar [data-action="show-values"]').click();
    p = p.replace(/^pie/, 'pie showData');
    await expectSaved(page, { pie: p, gantt: GANTT, timeline: TIMELINE });
    await expectDrawn(page, 'pie');
    await expect(pie.locator('g.legend text').first()).toHaveText('Dogs [386]');
  });

  test('gantt: bar, task label, section title, date format', async ({ page }) => {
    const gantt = block(page, 'gantt');
    const svgId = await gantt.locator('.mermaid-rendered > svg').getAttribute('id');
    await gantt.locator(`[id="${svgId}-a1"]`).click({ force: true });
    await expect(fieldInput(page, 'name')).toHaveValue('Research');
    await fill(page, 'duration', '12');
    let g = GANTT.replace('2026-01-05, 10d', '2026-01-05, 12d');
    await expectSaved(page, { pie: PIE, gantt: g, timeline: TIMELINE });
    await expectDrawn(page, 'gantt');

    const svgId2 = await gantt.locator('.mermaid-rendered > svg').getAttribute('id');
    await clickMiddle(page, gantt.locator(`[id="${svgId2}-task1-text"]`));
    await expect(fieldInput(page, 'name')).toHaveValue('Wireframes');
    await fill(page, 'name', 'Mock-ups');
    g = g.replace('Wireframes    :', 'Mock-ups    :');
    await expectSaved(page, { pie: PIE, gantt: g, timeline: TIMELINE });

    await clickMiddle(page, gantt.locator('text.sectionTitle', { hasText: 'Build' }));
    await fill(page, 'name', 'Delivery');
    g = g.replace('section Build', 'section Delivery');
    await expectSaved(page, { pie: PIE, gantt: g, timeline: TIMELINE });

    await gantt.locator('.mermaid-actions-bar [data-action="dates"]').click();
    const format = fieldInput(page, 'format');
    await expect(format.locator('option', { hasText: 'Day/month/year (31/01/2026)' })).toHaveCount(1);
    await format.selectOption('DD/MM/YYYY');
    g = g.replace('dateFormat YYYY-MM-DD', 'dateFormat DD/MM/YYYY').replace('2026-01-05', '05/01/2026').replace('2026-01-20', '20/01/2026');
    await expectSaved(page, { pie: PIE, gantt: g, timeline: TIMELINE });
    await expectDrawn(page, 'gantt');
  });

  test('timeline: period, event, section header, + Period', async ({ page }) => {
    const tl = block(page, 'timeline');
    const nodes = tl.locator('g.timeline-node');
    // Section Early, 2002, LinkedIn, 2004, Facebook, Google, section Late, 2006, Twitter
    await nodes.nth(3).locator('path').click({ force: true });
    await expect(fieldInput(page, 'label')).toHaveValue('2004');
    await fill(page, 'label', 'Year 2004');
    let t = TIMELINE.replace('2004 :', 'Year 2004 :');
    await expectSaved(page, { pie: PIE, gantt: GANTT, timeline: t });
    await expectDrawn(page, 'timeline');

    await nodes.nth(5).locator('path').click({ force: true });
    await expect(fieldInput(page, 'text')).toHaveValue('Google');
    await fill(page, 'text', 'Alphabet');
    t = t.replace('Google', 'Alphabet');
    await expectSaved(page, { pie: PIE, gantt: GANTT, timeline: t });

    await nodes.nth(6).locator('path').click({ force: true });
    await fill(page, 'name', 'Recent');
    t = t.replace('section Late', 'section Recent');
    await expectSaved(page, { pie: PIE, gantt: GANTT, timeline: t });

    await tl.locator('.mermaid-actions-bar [data-action="add-period"]').click();
    await expect(fieldInput(page, 'label')).toHaveValue('New period');
    await fill(page, 'label', '2010');
    t = `${t}\n        2010`;
    await expectSaved(page, { pie: PIE, gantt: GANTT, timeline: t });
    await expectDrawn(page, 'timeline');
  });
});
