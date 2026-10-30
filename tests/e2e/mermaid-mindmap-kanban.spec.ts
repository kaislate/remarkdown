// Mindmap and kanban visual editing in a real browser: click each kind
// of target, edit through the popover, and check that the saved
// markdown changes only the intended lines and the diagram still
// renders. (Helpers copied from mermaid-audit.spec.ts.)
import { test, expect, type Page, type Locator } from '@playwright/test';
import { withoutPaintWorklet } from './support/webkit';

const PATH = '/e2e/mindmap-kanban.md';

const MINDMAP = [
  'mindmap',
  '  %% the plan',
  '  root((Plan))',
  '    Research',
  '    ::icon(fa fa-book)',
  '      Papers',
  '    Design',
  '    Build',
].join('\n');

const KANBAN = [
  'kanban',
  '  %% the board',
  '  todo[To do]',
  "    a[Draft]@{ assigned: 'Sam', ticket: T-1 }",
  '    b[Review]',
  '  Done',
  '    [Shipped]',
].join('\n');

const DOC = `# Boards\n\n## mm\n\n\`\`\`mermaid\n${MINDMAP}\n\`\`\`\n\n## kb\n\n\`\`\`mermaid\n${KANBAN}\n\`\`\`\n\nThe end.\n`;

const FALLBACK_NOTE = 'This diagram is changed through its text.';

async function captureErrors(page: Page): Promise<string[]> {
  await withoutPaintWorklet(page);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

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
      return blocks.length === 2 && blocks.every((b) => !!b.querySelector('.mermaid-rendered > svg'));
    },
    undefined,
    { timeout: 90_000 },
  );
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
  let body: string[] | null = null;
  for (const raw of md.split('\n')) {
    if (body === null) {
      const h = /^## (.*)$/.exec(raw);
      if (h) heading = h[1];
      if (/^```/.test(raw)) body = [];
    } else if (/^```\s*$/.test(raw)) {
      out[heading] = body.join('\n');
      body = null;
    } else {
      body.push(raw);
    }
  }
  return out;
}

async function lastWrite(page: Page): Promise<string | null> {
  const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
  return writes.length ? writes[writes.length - 1].markdown : null;
}

function block(page: Page, index: number): Locator {
  return page.locator('.editor-surface .mermaid-block-editor').nth(index);
}

// The saved source of `heading` once autosave has written it.
async function savedSource(page: Page, heading: string, previous: string): Promise<string> {
  let src = previous;
  await expect
    .poll(async () => {
      src = fencedBlocks((await lastWrite(page)) ?? '')[heading] ?? previous;
      return src !== previous;
    }, { timeout: 8000 })
    .toBe(true);
  return src;
}

// Only `allowed` lines of `before` may be missing from `after`; the
// diagram must still draw.
async function expectOnly(page: Page, index: number, before: string, after: string, allowed: string[]): Promise<void> {
  for (const line of removedLines(before, after)) {
    expect(allowed, `unrelated line changed: ${JSON.stringify(line)}\n${after}`).toContain(line);
  }
  await expect(block(page, index).locator('.mermaid-rendered > svg')).toHaveCount(1);
  await expect(block(page, index).locator('.mermaid-error')).toHaveCount(0);
}

const popover = (page: Page, index: number) => block(page, index).locator('.mermaid-form-popover:visible');

async function typeRich(field: Locator, text: string): Promise<void> {
  // A real click must put the caret in the field (not in the document).
  await field.click();
  await expect(field).toBeFocused();
  await field.fill(text);
  await field.press('Enter');
}

test.describe.configure({ timeout: 180_000 });

test.describe('mermaid — mindmap and kanban editing', () => {
  test('both are visually editable: no "coming soon" note', async ({ page }) => {
    const errors = await captureErrors(page);
    await seedAndOpen(page, PATH, DOC);
    await enterEditMode(page);
    for (const i of [0, 1]) {
      const notes = block(page, i).locator('.mermaid-fallback-note:visible');
      await expect(notes).toHaveCount(0);
    }
    await expect(page.getByText(FALLBACK_NOTE).locator('visible=true')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('mindmap: rename, add child, indent with Tab, delete a branch', async ({ page }) => {
    const errors = await captureErrors(page);
    await seedAndOpen(page, PATH, DOC);
    await enterEditMode(page);
    const mm = block(page, 0);
    let src = MINDMAP;

    // Rename an idea.
    await mm.locator('g.mindmap-node', { hasText: 'Design' }).click();
    await expect(popover(page, 0)).toBeVisible();
    await expect(popover(page, 0)).not.toContainText('::');
    await typeRich(popover(page, 0).locator('.mermaid-mindmap-text'), 'Visual design');
    let next = await savedSource(page, 'mm', src);
    expect(next).toBe(src.replace('    Design', '    Visual design'));
    await expectOnly(page, 0, src, next, ['    Design']);
    src = next;

    // Add a child: the new idea's popover opens, ready to type.
    await mm.locator('g.mindmap-node', { hasText: 'Research' }).click();
    await popover(page, 0).locator('[data-action="add-child"]').click();
    next = await savedSource(page, 'mm', src);
    await expect(popover(page, 0).locator('.mermaid-mindmap-text')).toHaveText('');
    src = next;
    await typeRich(popover(page, 0).locator('.mermaid-mindmap-text'), 'Notes');
    next = await savedSource(page, 'mm', src);
    expect(next).toBe(MINDMAP.replace('    Design', '    Visual design').replace('      Papers', '      Papers\n      Notes'));
    src = next;

    // Tab indents the open idea under its previous sibling.
    await page.keyboard.press('Escape');
    await mm.locator('g.mindmap-node', { hasText: 'Build' }).click();
    await popover(page, 0).locator('.mermaid-mindmap-text').click();
    await page.keyboard.press('Tab');
    next = await savedSource(page, 'mm', src);
    expect(next).toBe(src.replace('    Build', '      Build'));
    await expectOnly(page, 0, src, next, ['    Build']);
    src = next;

    // Delete takes the branch, icon line included.
    await page.keyboard.press('Escape');
    await mm.locator('g.mindmap-node', { hasText: 'Research' }).first().click();
    const del = popover(page, 0).locator('[data-action="delete"]');
    await expect(del).toHaveText('Delete (with its branch)');
    await del.click();
    next = await savedSource(page, 'mm', src);
    expect(next).toBe(src.replace('    Research\n    ::icon(fa fa-book)\n      Papers\n      Notes\n', ''));
    await expectOnly(page, 0, src, next, ['    Research', '    ::icon(fa fa-book)', '      Papers', '      Notes']);
    expect(errors).toEqual([]);
  });

  test('kanban: rename a column, edit a card, move it, add a column', async ({ page }) => {
    const errors = await captureErrors(page);
    await seedAndOpen(page, PATH, DOC);
    await enterEditMode(page);
    const kb = block(page, 1);
    let src = KANBAN;

    // Column header → rename.
    await kb.locator('g.sections > g.cluster', { hasText: 'To do' }).locator('.cluster-label').click();
    await expect(popover(page, 1)).toBeVisible();
    await typeRich(popover(page, 1).locator('.mermaid-kanban-column-name'), 'Backlog');
    let next = await savedSource(page, 'kb', src);
    expect(next).toBe(src.replace('todo[To do]', 'todo[Backlog]'));
    await expectOnly(page, 1, src, next, ['  todo[To do]']);
    src = next;

    // Card → assigned person and priority.
    await kb.locator('g.items > g.node', { hasText: 'Draft' }).click();
    await expect(popover(page, 1).locator('.mermaid-kanban-assigned')).toHaveValue('Sam');
    await expect(popover(page, 1)).not.toContainText('@{');
    const assigned = popover(page, 1).locator('.mermaid-kanban-assigned');
    await assigned.fill('Kim');
    await assigned.press('Enter');
    next = await savedSource(page, 'kb', src);
    expect(next).toBe(src.replace("@{ assigned: 'Sam', ticket: T-1 }", '@{ assigned: Kim, ticket: T-1 }'));
    await expectOnly(page, 1, src, next, ["    a[Draft]@{ assigned: 'Sam', ticket: T-1 }"]);
    src = next;
    await kb.locator('g.items > g.node', { hasText: 'Draft' }).click();
    await popover(page, 1).locator('select[aria-label="Priority"]').selectOption('High');
    next = await savedSource(page, 'kb', src);
    expect(next).toBe(src.replace('@{ assigned: Kim, ticket: T-1 }', '@{ assigned: Kim, ticket: T-1, priority: High }'));
    src = next;

    // Move it to the other column.
    await popover(page, 1).locator('select[aria-label="Column"]').selectOption({ label: 'Done' });
    next = await savedSource(page, 'kb', src);
    const card = '    a[Draft]@{ assigned: Kim, ticket: T-1, priority: High }';
    expect(next).toBe(src.replace(`${card}\n`, '') + `\n${card}`);
    await expectOnly(page, 1, src, next, [card]);
    src = next;

    // "+ Column" adds one at the end, its popover open for naming.
    await page.keyboard.press('Escape');
    await kb.locator('.mermaid-actions-bar [data-action="add-column"]').click();
    next = await savedSource(page, 'kb', src);
    src = next;
    await typeRich(popover(page, 1).locator('.mermaid-kanban-column-name'), 'Later');
    next = await savedSource(page, 'kb', src);
    expect(next).toBe(`${KANBAN.replace('todo[To do]', 'todo[Backlog]').replace("    a[Draft]@{ assigned: 'Sam', ticket: T-1 }\n", '')}\n${card}\n  Later`);
    await expectOnly(page, 1, src, next, ['  [" "]']);
    expect(errors).toEqual([]);
  });
});
