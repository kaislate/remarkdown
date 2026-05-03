import { test, expect } from '@playwright/test';

const FIXTURE_PATH = '/e2e/edit-mode-fixture.md';
const FIXTURE_MD = `# Hello\n\nFirst paragraph.\n`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
  await page.evaluate(
    ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
    [FIXTURE_PATH, FIXTURE_MD],
  );
  await page.evaluate(
    (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
    FIXTURE_PATH,
  );
  // Open the doc via the hamburger menu so the editor sees a loaded doc.
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();
});

test.describe('edit mode round-trip', () => {
  test('toggle on → contenteditable PM surface visible', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('.editor-surface .ProseMirror')).toBeVisible();
    await expect(page.locator('.editor-surface h1')).toHaveText('Hello');
  });

  test('typing flows back to disk after debounce', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    const surface = page.locator('.editor-surface .ProseMirror');
    await surface.click();
    // Append text at the end of the paragraph.
    await page.keyboard.press('End');
    await page.keyboard.type(' edited');
    // Wait for autosave debounce (default 500ms) to fire.
    await page.waitForTimeout(800);
    const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
    expect(writes.length).toBeGreaterThan(0);
    const last = writes[writes.length - 1];
    expect(last.path).toBe(FIXTURE_PATH);
    expect(last.markdown).toContain('edited');
  });

  test('toggle off → article view returns', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('.editor-surface .ProseMirror')).toBeVisible();
    await page.locator('.edit-mode-toggle').click();
    // Wait for the editor to unmount and the article to render.
    await expect(page.locator('.editor-surface')).toHaveCount(0);
    await expect(page.locator('article.viewer h1')).toHaveText('Hello');
  });
});

test.describe('edit mode — callouts', () => {
  const CALLOUT_FIXTURE_PATH = '/e2e/edit-callout-fixture.md';
  const CALLOUT_FIXTURE_MD = `# Callouts\n\n> [!info]\n> Existing callout body.\n\nA paragraph after.\n`;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
    await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
    await page.evaluate(
      ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
      [CALLOUT_FIXTURE_PATH, CALLOUT_FIXTURE_MD],
    );
    await page.evaluate(
      (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
      CALLOUT_FIXTURE_PATH,
    );
    await page.getByRole('button', { name: /menu/i }).click();
    await page.getByRole('menuitem', { name: /open…/i }).click();
    await page.getByRole('heading', { level: 1 }).waitFor();
  });

  test('toggle on → existing callout renders as styled .callout (not plain blockquote)', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('.editor-surface .ProseMirror .callout.callout-info')).toBeVisible();
  });

  test('insert-callout button wraps a paragraph and saves with [!info] syntax', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    // Click into the trailing paragraph "A paragraph after."
    const para = page.locator('.editor-surface .ProseMirror p', { hasText: 'A paragraph after.' });
    await para.click();
    await page.keyboard.press('End');
    // The toolbar button sits behind the fixed menu-root nav bar (z-index:100).
    // Playwright's locator.click({ force:true }) dispatches a full
    // mousedown+mouseup+click sequence, which blurs the ProseMirror editor and
    // clears its selection even with onmousedown:preventDefault on the button.
    // Using the DOM's native .click() fires only the click event without a
    // preceding mousedown, so the PM selection is preserved when the toolbar
    // handler runs.
    await page.evaluate(() => {
      (document.querySelector('.toolbar-btn[data-action="insert-callout"]') as HTMLElement | null)?.click();
    });
    await page.waitForTimeout(800);
    const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
    expect(writes.length).toBeGreaterThan(0);
    const last = writes[writes.length - 1];
    // Should now contain TWO callouts in the file.
    expect((last.markdown.match(/\[!info\]/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('toggle off → article view shows callouts styled', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('.editor-surface .ProseMirror .callout.callout-info')).toBeVisible();
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('article.viewer .callout.callout-info')).toBeVisible();
  });
});

test.describe('edit mode — code blocks', () => {
  const CODE_FIXTURE_PATH = '/e2e/edit-code-fixture.md';
  const CODE_FIXTURE_MD = `# Hello\n\n\`\`\`typescript\nconst x = 1;\n\`\`\`\n`;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
    await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
    await page.evaluate(
      ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
      [CODE_FIXTURE_PATH, CODE_FIXTURE_MD],
    );
    await page.evaluate(
      (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
      CODE_FIXTURE_PATH,
    );
    await page.getByRole('button', { name: /menu/i }).click();
    await page.getByRole('menuitem', { name: /open…/i }).click();
    await page.getByRole('heading', { level: 1 }).waitFor();
  });

  test('toggle on → existing fenced code block renders with language pill', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    // The NodeView's pill is the marker that the code-block surface mounted.
    await expect(page.locator('.code-block-lang-pill')).toBeVisible();
    await expect(page.locator('.code-block-lang-pill')).toHaveText('typescript');
  });

  test('insert-code-block button wraps a paragraph and saves with ``` syntax', async ({ page }) => {
    // Override the describe-level beforeEach fixture (which seeds a doc with an
    // existing fence) — we need a clean slate so the assertion proves the toolbar
    // action wrote the fence, not the seed. localStorage-backed docs persist
    // across the page reload; window-scoped helpers (__E2E_DIALOG_PATH__,
    // __E2E_WRITES__) do not, so reset & set them AFTER the goto.
    const NO_FENCE_PATH = '/e2e/edit-code-no-fence-fixture.md';
    const NO_FENCE_MD = `# Hello\n\nA paragraph.\n`;
    await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
    await page.evaluate(
      ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
      [NO_FENCE_PATH, NO_FENCE_MD],
    );
    await page.goto('/');
    await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
    await page.evaluate(
      (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
      NO_FENCE_PATH,
    );
    await page.getByRole('button', { name: /menu/i }).click();
    await page.getByRole('menuitem', { name: /open…/i }).click();
    await page.getByRole('heading', { level: 1 }).waitFor();

    await page.locator('.edit-mode-toggle').click();
    // Place caret in the trailing paragraph so the toolbar action has a valid target.
    const para = page.locator('.editor-surface .ProseMirror p', { hasText: 'A paragraph.' });
    await para.click();
    await page.keyboard.press('End');
    // The toolbar button sits behind the fixed menu-root nav bar (z-index:100);
    // use DOM-native .click() to avoid blurring the PM selection (same workaround
    // as the callout E2E test above).
    await page.evaluate(() => {
      (document.querySelector('.toolbar-btn[data-action="code"]') as HTMLElement | null)?.click();
    });
    // Wait for the autosave debounce to fire.
    await page.waitForTimeout(800);
    const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
    expect(writes.length).toBeGreaterThan(0);
    const last = writes[writes.length - 1];
    expect(last.path).toBe(NO_FENCE_PATH);
    // With a no-fence seed, any '```' in the saved markdown proves the toolbar
    // action — not the fixture — wrote the fence.
    expect(last.markdown).toContain('```');
  });
});

test.describe('edit mode — task lists', () => {
  const TASK_FIXTURE_PATH = '/e2e/edit-task-fixture.md';
  const TASK_FIXTURE_MD = `# Doc\n\n- [ ] todo one\n- [x] done two\n`;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
    await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
    await page.evaluate(
      ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
      [TASK_FIXTURE_PATH, TASK_FIXTURE_MD],
    );
    await page.evaluate(
      (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
      TASK_FIXTURE_PATH,
    );
    await page.getByRole('button', { name: /menu/i }).click();
    await page.getByRole('menuitem', { name: /open…/i }).click();
    await page.getByRole('heading', { level: 1 }).waitFor();
  });

  test('toggle on → existing task list renders with clickable checkboxes', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    const cb = page.locator('.editor-surface li.task-list-item input[type="checkbox"]').first();
    await expect(cb).toBeVisible();
  });

  test('clicking a checkbox toggles its checked state and saves to disk', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    // Wait for the task-list checkbox to mount before reading the pre-click state.
    await expect(page.locator('.editor-surface li.task-list-item input[type="checkbox"]').first()).toBeVisible();
    // Count `[x]` markers in the seed (effectively — the seed has one).
    const beforeCount = (TASK_FIXTURE_MD.match(/\[x\]/g) || []).length;
    // Use DOM-native .click() so the PM selection isn't blurred by a synthetic
    // mousedown — same workaround the callout / code-block tests document.
    await page.evaluate(() => {
      (document.querySelector('.editor-surface li.task-list-item input[type="checkbox"]') as HTMLInputElement | null)?.click();
    });
    await page.waitForTimeout(800);
    const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
    expect(writes.length).toBeGreaterThan(0);
    const last = writes[writes.length - 1];
    expect(last.path).toBe(TASK_FIXTURE_PATH);
    // The saved markdown must still contain task-list markers. The serializer
    // emits `*` as the bullet (CommonMark-compatible) but accept `-` too in
    // case that ever changes — both are valid task-list markers.
    expect(last.markdown).toMatch(/[*-] \[(x| )\] /);
    // Stricter check: clicking the FIRST checkbox (which was `- [ ]` in the seed)
    // must have flipped exactly one marker, so the `[x]` count changes by 1.
    const afterCount = (last.markdown.match(/\[x\]/g) || []).length;
    expect(Math.abs(afterCount - beforeCount)).toBe(1);
  });
});

test.describe('edit mode — tables', () => {
  const TABLE_FIXTURE_PATH = '/e2e/edit-table-fixture.md';
  const TABLE_FIXTURE_MD = `# Doc\n\n| a | b |\n| - | - |\n| 1 | 2 |\n`;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
    await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
    await page.evaluate(
      ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
      [TABLE_FIXTURE_PATH, TABLE_FIXTURE_MD],
    );
    await page.evaluate(
      (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
      TABLE_FIXTURE_PATH,
    );
    await page.getByRole('button', { name: /menu/i }).click();
    await page.getByRole('menuitem', { name: /open…/i }).click();
    await page.getByRole('heading', { level: 1 }).waitFor();
  });

  test('toggle on → existing table renders editable', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    const table = page.locator('.editor-surface table').first();
    await expect(table).toBeVisible();
  });

  test('toolbar Table button inserts a 3x2 table that saves to disk', async ({ page }) => {
    // Override the describe-level beforeEach fixture (which seeds a doc with an
    // existing table) — we need a clean slate so the assertion proves the toolbar
    // action wrote a fresh table, not the seed. localStorage-backed docs persist
    // across the page reload; window-scoped helpers (__E2E_DIALOG_PATH__,
    // __E2E_WRITES__) do not, so reset & set them AFTER the goto. Mirrors the
    // code-block toolbar test above.
    const NO_TABLE_PATH = '/e2e/edit-table-no-table-fixture.md';
    const NO_TABLE_MD = `# Doc\n\nA paragraph.\n`;
    await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
    await page.evaluate(
      ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
      [NO_TABLE_PATH, NO_TABLE_MD],
    );
    await page.goto('/');
    await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
    await page.evaluate(
      (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
      NO_TABLE_PATH,
    );
    await page.getByRole('button', { name: /menu/i }).click();
    await page.getByRole('menuitem', { name: /open…/i }).click();
    await page.getByRole('heading', { level: 1 }).waitFor();

    await page.locator('.edit-mode-toggle').click();
    // Place caret in the trailing paragraph so the toolbar action has a valid target.
    const para = page.locator('.editor-surface .ProseMirror p', { hasText: 'A paragraph.' });
    await para.click();
    await page.keyboard.press('End');
    // The toolbar button sits behind the fixed menu-root nav bar (z-index:100);
    // use DOM-native .click() to avoid blurring the PM selection (same workaround
    // as the callout / code-block / task-list E2E tests above).
    await page.evaluate(() => {
      (document.querySelector('.toolbar-btn[data-action="table"]') as HTMLElement | null)?.click();
    });
    // Wait for the autosave debounce (750ms) to fire.
    await page.waitForTimeout(800);
    const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
    expect(writes.length).toBeGreaterThan(0);
    const last = writes[writes.length - 1];
    expect(last.path).toBe(NO_TABLE_PATH);
    // A real GFM table written to disk must contain BOTH a pipe-bordered row
    // and a header-separator row — together these prove the toolbar action
    // emitted a proper GFM table (not just stray pipes in a paragraph).
    expect(last.markdown).toMatch(/^\|.*\|$/m); // contains a table line
    expect(last.markdown).toMatch(/\| -+ \|/);  // contains a separator row
  });
});
