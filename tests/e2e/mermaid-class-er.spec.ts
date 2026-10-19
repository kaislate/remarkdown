// Class and ER diagrams in edit mode, in a real browser: click each
// kind of target, edit through the popover, and check that the saved
// markdown changes only the intended lines and the diagram still
// renders. Helpers copied from mermaid-audit.spec.ts.
import { test, expect, type Page } from '@playwright/test';

const PATH = '/e2e/class-er.md';
const CLASS_SRC = [
  'classDiagram',
  '    %% keep me',
  '    class Animal {',
  '        +String name',
  '        +makeSound() void',
  '    }',
  '    Animal <|-- Dog',
  '    Dog "1" --> "*" Bone : chews',
  '    note for Dog "Good boy"',
].join('\n');
const ER_SRC = [
  'erDiagram',
  '    %% keep me too',
  '    CUSTOMER ||--o{ ORDER : places',
  '    CUSTOMER {',
  '        string name',
  '        string email PK',
  '    }',
].join('\n');
const MD = `# Class and ER\n\n## class-edit\n\n\`\`\`mermaid\n${CLASS_SRC}\n\`\`\`\n\n## er-edit\n\n\`\`\`mermaid\n${ER_SRC}\n\`\`\`\n\nThe end.\n`;

test.describe.configure({ timeout: 300_000 });

function captureErrors(page: Page): string[] {
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
      return blocks.length > 0 && blocks.every((b) => {
        const r = b.querySelector('.mermaid-rendered');
        return !!r && (r.querySelector(':scope > svg') || r.querySelector('.mermaid-error') || r.querySelector('.mermaid-empty-state'));
      });
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

// Extract fenced blocks keyed by the nearest preceding `## heading`.
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

// The mermaid editor wrapper that follows `## heading`.
function blockSelectorScript(heading: string): string {
  return `(() => { const h = Array.from(document.querySelectorAll('.editor-surface .ProseMirror h2')).find(x => x.textContent === ${JSON.stringify(heading)}); let n = h && h.nextElementSibling; while (n && !n.matches('.mermaid-block-editor') && n.tagName !== 'H2') n = n.nextElementSibling; return n && n.matches('.mermaid-block-editor') ? n : null; })()`;
}

// Click an element of the block's diagram: by selector, or the label
// whose text is exactly `text`.
async function clickInBlock(page: Page, heading: string, target: { selector?: string; text?: string }): Promise<boolean> {
  return page.evaluate(([h, sel, text]) => {
    // eslint-disable-next-line no-eval
    const block = (0, eval)(h) as Element | null;
    const rendered = block?.querySelector('.mermaid-rendered');
    let el: Element | null | undefined = null;
    if (sel) el = rendered?.querySelector(sel);
    else el = Array.from(rendered?.querySelectorAll('p') ?? []).reverse().find((p) => p.textContent === text);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, [blockSelectorScript(heading), target.selector ?? '', target.text ?? ''] as [string, string, string]);
}

function block(page: Page, heading: string) {
  return page.locator('.editor-surface .mermaid-block-editor').nth(heading === 'class-edit' ? 0 : 1);
}

interface Step {
  name: string;
  heading: 'class-edit' | 'er-edit';
  target: { selector?: string; text?: string };
  // Edit through the popover.
  act: (popover: ReturnType<Page['locator']>) => Promise<void>;
  // Lines the edit may rewrite.
  touches: RegExp;
  // The saved block must contain this.
  expect: RegExp;
}

const STEPS: Step[] = [
  {
    name: 'rename a class',
    heading: 'class-edit',
    target: { text: 'Animal' },
    act: async (p) => {
      await p.locator('.mermaid-class-name').fill('Any animal');
      await p.locator('.mermaid-class-name').press('Enter');
    },
    touches: /class Animal \{/,
    expect: /^ {4}class Animal\["Any animal"\] \{$/m,
  },
  {
    name: 'rename a method from its row',
    heading: 'class-edit',
    target: { text: '+makeSound() : void' },
    act: async (p) => {
      const name = p.locator('[data-field="members"] tr[data-row="1"] input[aria-label="Name"]');
      await expect(name).toBeFocused();
      await name.fill('speak');
      await name.press('Enter');
    },
    touches: /makeSound/,
    expect: /^ {8}\+speak\(\) void$/m,
  },
  {
    name: 'change a relationship kind',
    heading: 'class-edit',
    target: { selector: 'path.relation[data-id^="id_Animal_Dog_"]' },
    act: async (p) => {
      await expect(p).toContainText('Dog inherits from Any animal');
      await p.getByRole('radio', { name: 'Composition' }).click();
    },
    touches: /Animal <\|-- Dog/,
    expect: /^ {4}Animal \*-- Dog$/m,
  },
  {
    name: 'edit a relationship label',
    heading: 'class-edit',
    target: { text: 'chews' },
    act: async (p) => {
      await p.locator('.mermaid-relation-label').fill('eats');
      await p.locator('.mermaid-relation-label').press('Enter');
    },
    touches: /chews/,
    expect: /^ {4}Dog "1" --> "\*" Bone : eats$/m,
  },
  {
    name: 'edit a note',
    heading: 'class-edit',
    target: { text: 'Good boy' },
    act: async (p) => {
      await p.locator('.mermaid-note-text').fill('Best dog');
      await p.locator('.mermaid-note-text').press('Enter');
    },
    touches: /note for Dog/,
    expect: /^ {4}note for Dog "Best dog"$/m,
  },
  {
    name: 'rename an entity',
    heading: 'er-edit',
    target: { text: 'CUSTOMER' },
    act: async (p) => {
      await p.locator('.mermaid-entity-name').fill('Customer');
      await p.locator('.mermaid-entity-name').press('Enter');
    },
    touches: /CUSTOMER \{/,
    expect: /^ {4}CUSTOMER\["Customer"\] \{$/m,
  },
  {
    name: 'toggle a key on an attribute row',
    heading: 'er-edit',
    target: { text: 'email' },
    act: async (p) => {
      await p.locator('[data-field="attributes"] tr[data-row="1"] input[aria-label="FK"]').check();
    },
    touches: /email/,
    expect: /^ {8}string email PK, FK$/m,
  },
  {
    name: 'set a relationship cardinality',
    heading: 'er-edit',
    target: { text: 'places' },
    act: async (p) => {
      await expect(p).not.toContainText('o{');
      await p.locator('select[aria-label="Customer side"]').selectOption({ label: 'zero or one' });
    },
    touches: /places/,
    expect: /^ {4}CUSTOMER \|o--o\{ ORDER : places$/m,
  },
];

test('class and ER diagrams: every kind of target edits through its popover', async ({ page }) => {
  const errors = captureErrors(page);
  await seedAndOpen(page, PATH, MD);
  await enterEditMode(page);
  for (const heading of ['class-edit', 'er-edit'] as const) {
    await expect(block(page, heading)).not.toHaveClass(/mermaid-fallback/);
    await expect(block(page, heading).locator('.mermaid-fallback-note')).toBeHidden();
  }
  let before = fencedBlocks(MD);
  for (const s of STEPS) {
    expect(await clickInBlock(page, s.heading, s.target), `${s.name}: element to click`).toBe(true);
    const popover = block(page, s.heading).locator('.mermaid-form-popover');
    await expect(popover, s.name).toBeVisible();
    // Never syntax in a popover.
    await expect(popover).not.toContainText(/<\|--|\|\|--|o\{|\}o/);
    await s.act(popover);
    await page.waitForTimeout(1200);
    const saved = fencedBlocks((await lastWrite(page)) ?? '');
    const src = saved[s.heading];
    expect(src, `${s.name}: saved`).toMatch(s.expect);
    for (const line of removedLines(before[s.heading], src)) {
      expect(s.touches.test(line), `${s.name}: unrelated line changed: ${JSON.stringify(line)}\n${src}`).toBe(true);
    }
    // The other diagram is untouched.
    const other = s.heading === 'class-edit' ? 'er-edit' : 'class-edit';
    expect(saved[other], `${s.name}: other diagram`).toBe(before[other]);
    await expect(block(page, s.heading).locator('.mermaid-rendered > svg'), `${s.name}: renders`).toBeVisible();
    await page.keyboard.press('Escape').catch(() => {});
    before = saved;
  }
  // Both still render in reader mode.
  await page.locator('.edit-mode-toggle').click();
  await expect(page.locator('.editor-surface')).toHaveCount(0);
  await page.waitForFunction(() => {
    const blocks = Array.from(document.querySelectorAll<HTMLElement>('article.viewer .mermaid-block'));
    return blocks.length === 2 && blocks.every((b) => !!b.querySelector(':scope > svg'));
  }, undefined, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('connect mode, and adding from the toolbars (class and ER)', async ({ page }) => {
  const errors = captureErrors(page);
  await seedAndOpen(page, PATH, MD);
  await enterEditMode(page);
  const b = block(page, 'class-edit');
  expect(await clickInBlock(page, 'class-edit', { text: 'Bone' })).toBe(true);
  await b.locator('.mermaid-form-popover [data-action="connect"]').click();
  await expect(b.locator('.mermaid-connect-banner')).toBeVisible();
  expect(await clickInBlock(page, 'class-edit', { text: 'Animal' })).toBe(true);
  // The new relationship's kind picker opens.
  await expect(b.locator('.mermaid-form-popover').getByRole('radio', { name: 'Association' })).toHaveAttribute('aria-checked', 'true');
  await b.locator('.mermaid-actions-bar [data-action="add-class"]').click();
  await expect(b.locator('.mermaid-form-popover .mermaid-class-name')).toHaveValue('New class');
  await page.waitForTimeout(1200);
  const src = fencedBlocks((await lastWrite(page)) ?? '')['class-edit'];
  expect(src).toBe(`${CLASS_SRC}\n    Bone --> Animal\n    class NewClass["New class"]`);
  await expect(b.locator('.mermaid-rendered > svg')).toBeVisible();
  const er = block(page, 'er-edit');
  await er.locator('.mermaid-actions-bar [data-action="add-entity"]').click();
  await expect(er.locator('.mermaid-form-popover .mermaid-entity-name')).toHaveValue('New entity');
  await page.waitForTimeout(1200);
  const saved = fencedBlocks((await lastWrite(page)) ?? '');
  expect(saved['er-edit']).toBe(`${ER_SRC}\n    New_entity["New entity"]`);
  expect(saved['class-edit']).toBe(src);
  await expect(er.locator('.mermaid-rendered > svg')).toBeVisible();
  expect(errors).toEqual([]);
});
