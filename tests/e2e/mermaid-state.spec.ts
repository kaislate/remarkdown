// State diagrams in edit mode, in a real browser: every kind of click
// target (state, group, transition, note, start circle) opens its
// popover, edits through it change only the intended lines of the saved
// markdown, the result still renders, and connect mode adds a
// transition. Helpers copied from mermaid-audit.spec.ts.
import { test, expect, type Page } from '@playwright/test';
import { withoutPaintWorklet } from './support/webkit';

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
      return blocks.length > 0 && blocks.every((b) => !!b.querySelector('.mermaid-rendered')?.querySelector(':scope > svg'));
    },
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(300);
}

function removedLines(a: string, b: string): string[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(A[i++]); else j++;
  }
  while (i < A.length) out.push(A[i++]);
  return out;
}

function fencedBlocks(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  let heading = '';
  let open: string[] | null = null;
  for (const raw of md.split('\n')) {
    if (!open) {
      const h = /^## (.*)$/.exec(raw);
      if (h) heading = h[1];
      if (/^```/.test(raw)) open = [];
    } else if (/^```\s*$/.test(raw)) {
      out[heading] = open.join('\n');
      open = null;
    } else {
      open.push(raw);
    }
  }
  return out;
}

async function lastWrite(page: Page): Promise<string | null> {
  const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
  return writes.length ? writes[writes.length - 1].markdown : null;
}

const BLOCK = '.editor-surface .mermaid-block-editor';

async function clickInBlock(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(([b, sel]) => {
    const el = document.querySelector(b)?.querySelector(sel);
    if (!el) return false;
    const inner = el.matches('path') ? el : el.querySelector('rect, circle, polygon, ellipse, path, text') ?? el;
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, [BLOCK, selector] as [string, string]);
}

const FALLBACK_NOTE = 'This diagram is changed through its text.';

const SOURCE = [
  'stateDiagram-v2',
  '    %% the order lifecycle',
  '    [*] --> Idle',
  '    Idle --> Running : start',
  '    state Running {',
  '        [*] --> Loading',
  '        Loading --> Working',
  '    }',
  '    Running --> Done',
  '    note right of Idle : Waiting for input',
].join('\n');
const MD = `# State test\n\n## machine\n\n\`\`\`mermaid\n${SOURCE}\n\`\`\`\n\nEDIT_TARGET_SENTENCE.\n`;

test.describe.configure({ timeout: 180_000 });

test('state diagrams: every target edits through its popover, only intended lines change', async ({ page }) => {
  await withoutPaintWorklet(page);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await seedAndOpen(page, '/e2e/state.md', MD);
  await enterEditMode(page);

  // Editable: no "coming soon" note, no syntax anywhere on screen.
  const note = await page.evaluate((b) => {
    const n = document.querySelector(b)?.querySelector('.mermaid-fallback-note') as HTMLElement | null;
    return n && n.offsetParent !== null ? n.textContent : null;
  }, BLOCK);
  expect(note).toBeNull();
  expect(await page.locator('.editor-surface').innerText()).not.toContain(FALLBACK_NOTE);

  let previous = SOURCE;
  // Apply one popover edit and check the saved source against the last.
  async function step(name: string, act: () => Promise<void>, touches: RegExp, expectIn?: string): Promise<string> {
    const before = (await page.evaluate(() => ((window as any).__E2E_WRITES__ as unknown[]).length)) as number;
    await act();
    await page.waitForFunction((n) => ((window as any).__E2E_WRITES__ as unknown[]).length > n, before, { timeout: 8000 });
    await page.waitForTimeout(400);
    const src = fencedBlocks((await lastWrite(page)) ?? '')['machine'];
    expect(src, `${name}: saved`).toBeDefined();
    for (const line of removedLines(previous, src)) {
      expect(touches.test(line), `${name}: unrelated line changed: ${JSON.stringify(line)}\n${src}`).toBe(true);
    }
    if (expectIn) expect(src, name).toContain(expectIn);
    // Still renders.
    await page.waitForFunction((b) => !!document.querySelector(b)?.querySelector('.mermaid-rendered > svg g.node'), BLOCK);
    expect(await page.locator(`${BLOCK} .mermaid-rendered .mermaid-error`).count(), `${name}: render error`).toBe(0);
    previous = src;
    await page.keyboard.press('Escape').catch(() => {});
    return src;
  }

  const popover = page.locator(`${BLOCK} .mermaid-form-popover:visible`);

  // A state: rename through the popover.
  await step('rename state', async () => {
    expect(await clickInBlock(page, 'g.node[id*="-state-Idle-"]')).toBe(true);
    await expect(popover).toBeVisible();
    await expect(popover).not.toContainText(/\[\*\]|-->|<</);
    const field = popover.locator('.mermaid-state-name');
    await field.fill('Waiting room');
    await field.press('Enter');
  }, /\bIdle\b/, 'state "Waiting room" as Idle');

  // A group: rename.
  await step('rename group', async () => {
    expect(await clickInBlock(page, '.statediagram-cluster[data-id="Running"]')).toBe(true);
    const field = popover.locator('.mermaid-group-title');
    await expect(field).toHaveText('Running');
    await field.fill('Run phase');
    await field.press('Enter');
  }, /state Running \{/, 'state "Run phase" as Running {');

  // A transition: relabel (via its label text).
  await step('relabel transition', async () => {
    expect(await clickInBlock(page, 'path.transition[data-id="edge1"]')).toBe(true);
    await expect(popover).toContainText('From Waiting room to Run phase');
    const field = popover.locator('.mermaid-transition-label');
    await field.fill('go now');
    await field.press('Enter');
  }, /Idle --> Running : start/, 'Idle --> Running : go now');

  // A note: move it to the left.
  await step('note side', async () => {
    expect(await clickInBlock(page, 'g.statediagram-note')).toBe(true);
    await popover.locator('[data-field="side"] button[aria-label="Left"]').click();
  }, /note right of Idle/, 'note left of Idle : Waiting for input');

  // Connect mode: Done → Idle.
  await step('connect', async () => {
    expect(await clickInBlock(page, 'g.node[id*="-state-Done-"]')).toBe(true);
    await popover.locator('[data-action="connect"]').click();
    await expect(page.locator(`${BLOCK} .mermaid-connect-banner:visible`)).toContainText('Click a state');
    expect(await clickInBlock(page, 'g.node[id*="-state-Idle-"]')).toBe(true);
  }, /^$/, 'Done --> Idle');

  // The start circle: delete it (its arrow goes; Idle stays).
  const src = await step('delete start', async () => {
    expect(await clickInBlock(page, 'g.node[id*="-state-root_start-"]')).toBe(true);
    await expect(popover).toContainText('Start');
    await popover.locator('[data-action="delete"]').click();
  }, /\[\*\] --> Idle/);
  expect(src).not.toContain('[*] --> Idle');
  expect(src).toContain('%% the order lifecycle');

  // Reader mode draws the edited diagram.
  await page.locator('.edit-mode-toggle').click();
  await page.waitForFunction(() => !!document.querySelector('article.viewer .mermaid-block')?.querySelector('svg g.node'), undefined, { timeout: 60_000 });
  const shown = (await page.locator('article.viewer .mermaid-block svg').textContent()) ?? '';
  expect(shown).toContain('Waiting room');
  expect(shown).toContain('go now');
  expect(errors).toEqual([]);
});
