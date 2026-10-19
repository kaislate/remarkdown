// Reader mode: nothing but the page. Every chrome element is hidden (the
// window can still be dragged by an invisible top band), annotations stay
// visible but read-only, Esc is the only way out, and the reader theme
// recolours the page — diagrams included. Set READER_SHOTS_DIR to also
// write a screenshot per reader theme for manual review.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.READER_SHOTS_DIR;
if (OUT) mkdirSync(OUT, { recursive: true });

const A = '/e2e/reader/On reading slowly.md';
const B = '/e2e/reader/Other.md';
const LONG = Array.from({ length: 40 }, (_, i) =>
  `Paragraph ${i + 1}. Speed is a fine thing for a timetable; for an argument it is mostly a way of arriving at the end without having been anywhere.`,
).join('\n\n');
const DOC = `# On reading slowly

The reader who would truly understand a passage must read slowly, and with care, turning the pages back when needed.

Speed is a fine thing for a timetable. For an argument, it is mostly a way of arriving at the end without having been anywhere.

## Chapter 3

> [!tip] A quiet room
> Find a chair, a lamp and an hour. Nothing else is needed.

| Pace | Words per minute |
| --- | --- |
| Slow | 150 |
| Average | 230 |

\`\`\`ts
function minutesLeft(words: number): number {
  return Math.ceil(words / 230); // an average adult pace
}
\`\`\`

Euler's identity, $e^{i\\pi} + 1 = 0$, reads best slowly too.

\`\`\`mermaid
flowchart LR
  A[Open the book] --> B[Read slowly] --> C[Think it over]
\`\`\`

${LONG}
`;

// Every chrome element reader mode must remove.
const CHROME = [
  '.menu-root',
  '.titlebar-drag',
  '.titlebar-controls',
  '.controls-aura',
  '.tabbar',
  '.left-title',
  '.rail',
  '.strip',
  '.notes-pill-wrap',
  '.minimap',
  '.minimap-toggle',
  '.zoom-rail',
  '.toc-button',
  '.edit-mode-toggle',
  '.reader-mode-toggle',
];

async function open(page: Page, paths: string[]) {
  await page.evaluate((ps) => {
    (window as any).__E2E_QUEUE_OPENS__(ps);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, paths);
  // The last file opened ends up in front; wait for it, not the first.
  const last = paths[paths.length - 1] === A ? 'On reading slowly' : 'Other';
  await expect(page.locator('.viewer h1')).toHaveText(last);
}

async function settingsDo(page: Page, fn: () => Promise<void>) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const item = page.getByRole('menuitem', { name: /settings/i });
  await item.evaluate((el) => (el as HTMLElement).click());
  await page.locator('.settings-panel').waitFor();
  await fn();
  await page.locator('.settings-panel button.close').click();
  await expect(page.locator('.settings-panel')).toHaveCount(0);
}

async function enterReader(page: Page) {
  await page.locator('.reader-mode-toggle').click();
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
}

// Selection → highlight, like a user dragging with the highlighter.
async function highlight(page: Page, text: string) {
  await page.getByRole('radio', { name: /highlight/i }).click();
  await page.evaluate((t) => {
    const p = Array.from(document.querySelectorAll('.viewer p')).find((el) => el.textContent?.includes(t))!;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let tn: Text | null = null;
    while (walker.nextNode()) {
      if ((walker.currentNode as Text).data.includes(t)) { tn = walker.currentNode as Text; break; }
    }
    const start = tn!.data.indexOf(t);
    const range = document.createRange();
    range.setStart(tn!, start);
    range.setEnd(tn!, start + t.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, text);
  await page.getByRole('radio', { name: /cursor/i }).click();
}

async function addNote(page: Page, word: string, body: string) {
  await page.getByRole('radio', { name: /re.mark/i }).click();
  const box = await page.evaluate((w) => {
    const p = Array.from(document.querySelectorAll('.viewer p')).find((el) => el.textContent?.includes(w))!;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const tn = walker.currentNode as Text;
      const i = tn.data.indexOf(w);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(tn, i);
        r.setEnd(tn, i + w.length);
        const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
    }
    return null;
  }, word);
  await page.mouse.click(box!.x, box!.y);
  const textarea = page.getByRole('textbox', { name: /re\.mark body/i });
  await textarea.fill(body);
  await page.mouse.click(30, 700);
  await page.getByRole('radio', { name: /cursor/i }).click();
}

async function diagramsSettled(page: Page, tone: 'dark' | 'light') {
  await expect.poll(() =>
    page.locator('.viewer .mermaid-block').evaluateAll((els, t) =>
      els.every((el) => (el as HTMLElement).dataset.mermaidRendered?.startsWith(`${t}|`) && el.querySelector('svg')),
    tone),
  ).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate(([a, b, doc]) => {
    (window as any).__E2E_SEED_DOC__(a, doc);
    (window as any).__E2E_SEED_DOC__(b, '# Other\n\nA second document.\n');
  }, [A, B, DOC]);
});

test('hides every piece of chrome and keeps an invisible drag band', async ({ page }) => {
  await open(page, [B, A]);
  // Make sure the list means something: the chrome is there to begin with.
  for (const sel of ['.menu-root', '.titlebar-controls', '.tabbar', '.rail', '.minimap', '.zoom-rail', '.reader-mode-toggle']) {
    await expect(page.locator(sel).first(), `${sel} before`).toBeVisible();
  }
  await enterReader(page);
  for (const sel of CHROME) {
    const els = page.locator(sel);
    const n = await els.count();
    for (let i = 0; i < n; i++) {
      const shown = await els.nth(i).evaluate((el) => {
        const cs = getComputedStyle(el);
        return el.getClientRects().length > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
      });
      expect(shown, `${sel} hidden in reader mode`).toBe(false);
    }
  }
  // The resize grip still works; only its glyph goes.
  await expect(page.locator('.resize-grip .grip-glyph')).toHaveCSS('opacity', '0');
  // Drag band: full width along the top, transparent, still catches the pointer.
  const band = page.locator('.reader-drag-band');
  const box = (await band.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(box.width).toBe(1100);
  expect(box.height).toBeGreaterThanOrEqual(30);
  await expect(band).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await page.evaluate(() => document.elementFromPoint(550, 10)?.classList.contains('reader-drag-band'))).toBe(true);
});

test('annotations stay visible but read-only', async ({ page }) => {
  await open(page, [A]);
  await highlight(page, 'truly understand a passage');
  await addNote(page, 'timetable', 'Trains, not essays.');
  await page.getByRole('radio', { name: /highlight/i }).click();
  await enterReader(page);
  expect(await page.evaluate(() => (CSS as any).highlights.has('rmd-hl-0'))).toBe(true);
  await expect(page.locator('.note-pin')).toBeVisible();
  // The highlighter was parked: selecting text makes no new highlight.
  const before = await page.evaluate(() => (CSS as any).highlights.get('rmd-hl-0').size);
  await page.evaluate(() => {
    const p = document.querySelectorAll('.viewer p')[1];
    const r = document.createRange();
    r.selectNodeContents(p);
    window.getSelection()!.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  expect(await page.evaluate(() => (CSS as any).highlights.get('rmd-hl-0').size)).toBe(before);
  // A note opens read-only.
  await page.locator('.note-pin').click();
  const note = page.getByRole('textbox', { name: /re\.mark body/i });
  await expect(note).toHaveValue('Trains, not essays.');
  await expect(note).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  // Esc closes the note first, and only the note.
  await page.keyboard.press('Escape');
  await expect(note).toHaveCount(0);
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/reader-mode/);
  // And the tool comes back.
  await expect(page.getByRole('radio', { name: /highlight/i })).toHaveAttribute('aria-checked', 'true');
});

test('Esc is the only way out: clicks and tool keys do nothing', async ({ page }) => {
  await open(page, [A]);
  await enterReader(page);
  await page.mouse.click(550, 400);
  await page.mouse.click(550, 10);
  await page.keyboard.press('2');
  await page.keyboard.press('Control+e');
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
  await expect(page.locator('.editor-surface')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/reader-mode/);
  await expect(page.locator('.menu-root')).toBeVisible();
  await expect(page.getByRole('radio', { name: /cursor/i })).toHaveAttribute('aria-checked', 'true');
});

test('the entry hint says how to leave, then fades away', async ({ page }) => {
  await open(page, [A]);
  await enterReader(page);
  const hint = page.locator('.reader-hint');
  await expect(hint).toHaveText(/Press\s+Esc\s+to leave reader mode/);
  const r = await hint.boundingBox();
  expect(Math.abs(r!.x + r!.width / 2 - 550)).toBeLessThan(2);
  expect(r!.y).toBeGreaterThan(680);
  await expect(hint).toHaveCount(0, { timeout: 4000 });
});

test('reduced motion: the hint just shows, then goes', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1100, height: 780 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.evaluate(([a, doc]) => (window as any).__E2E_SEED_DOC__(a, doc), [A, DOC]);
  await open(page, [A]);
  await enterReader(page);
  await expect(page.locator('.reader-hint')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.reader-hint')).toHaveCSS('opacity', '1');
  await expect(page.locator('.reader-hint')).toHaveCount(0, { timeout: 4000 });
  await ctx.close();
});

test('reading typography and the minutes-left line', async ({ page }) => {
  await open(page, [A]);
  await enterReader(page);
  const p = page.locator('.viewer p').first();
  await expect(p).toHaveCSS('line-height', /^\d/);
  const m = await p.evaluate((el) => {
    const cs = getComputedStyle(el);
    const col = el.getBoundingClientRect();
    return { size: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight), left: col.left, right: col.right };
  });
  expect(m.size).toBeCloseTo(17 * 1.12, 0);
  expect(m.lh / m.size).toBeCloseTo(1.75, 2);
  // Centred in the window.
  expect(Math.abs((m.left + m.right) / 2 - 550)).toBeLessThan(2);
  const meta = page.locator('.reader-meta');
  await expect(meta).toHaveText(/^\d+ min left$/);
  const first = Number((await meta.textContent())!.match(/\d+/)![0]);
  await page.locator('.scroll').evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
  await expect(meta).toContainText('Chapter 3 · ');
  await expect.poll(async () => Number((await meta.textContent())!.match(/(\d+) min/)![1])).toBeLessThan(first);
  await page.locator('.scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(meta).toHaveCount(0);
});

test('reader theme recolours the page and diagrams follow it', async ({ page }) => {
  await open(page, [A]);
  await diagramsSettled(page, 'dark');
  await settingsDo(page, async () => {
    await page.getByLabel('Reader theme').selectOption('sepia');
  });
  // Outside reader mode nothing changes.
  await expect(page.locator('body')).not.toHaveCSS('background-color', 'rgb(243, 231, 207)');
  await enterReader(page);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 231, 207)');
  await expect(page.locator('.viewer h1')).toHaveCSS('color', 'rgb(59, 47, 30)');
  await expect(page.locator('.viewer p').first()).toHaveCSS('color', 'rgb(79, 65, 48)');
  await diagramsSettled(page, 'light');
  await page.keyboard.press('Escape');
  await diagramsSettled(page, 'dark');
});

test('e-ink has no animation or transition at all', async ({ page }) => {
  await open(page, [A]);
  await settingsDo(page, async () => {
    await page.getByLabel('Reader theme').selectOption('eink');
  });
  await enterReader(page);
  await expect(page.locator('.reader-hint')).toHaveCSS('animation-name', 'none');
  const moving = await page.evaluate(() =>
    Array.from(document.querySelectorAll('body *')).filter((el) => {
      const cs = getComputedStyle(el);
      return (cs.animationName !== 'none') || cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0);
    }).length,
  );
  expect(moving).toBe(0);
});

test('reader mode is per tab', async ({ page }) => {
  await open(page, [B, A]);
  await enterReader(page);
  // Tabs are hidden in reader mode; switch with the keyboard.
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('.viewer h1')).toHaveText('Other');
  await expect(page.locator('body')).not.toHaveClass(/reader-mode/);
  await expect(page.locator('.menu-root')).toBeVisible();
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
});

test('"Always open documents in reader mode" opens straight into it', async ({ page }) => {
  await settingsDo(page, async () => {
    await page.getByLabel('Always open documents in reader mode').check();
  });
  await open(page, [A]);
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
  await expect(page.locator('.reader-hint')).toBeVisible();
});

test.describe('screenshots', () => {
  test.skip(!OUT, 'set READER_SHOTS_DIR to capture');
  const cases: Array<{ name: string; app: 'dark' | 'light'; theme: string; tone: 'dark' | 'light' }> = [
    { name: 'default-dark', app: 'dark', theme: 'default', tone: 'dark' },
    { name: 'default-light', app: 'light', theme: 'default', tone: 'light' },
    { name: 'paper', app: 'dark', theme: 'paper', tone: 'light' },
    { name: 'sepia', app: 'dark', theme: 'sepia', tone: 'light' },
    { name: 'night', app: 'light', theme: 'night', tone: 'dark' },
    { name: 'eink', app: 'dark', theme: 'eink', tone: 'light' },
  ];
  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await open(page, [A]);
      await highlight(page, 'truly understand a passage must read slowly');
      await addNote(page, 'timetable', 'Trains, not essays.');
      await settingsDo(page, async () => {
        await page.locator('#setting-theme').selectOption(c.app);
        await page.getByLabel('Reader theme').selectOption(c.theme);
      });
      await enterReader(page);
      await diagramsSettled(page, c.tone);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT!, `${c.name}-top.png`) });
      await page.locator('.viewer h2').evaluate((el) => {
        const s = document.querySelector('.scroll')!;
        s.scrollTop += el.getBoundingClientRect().top - 60;
      });
      await page.locator('.reader-hint').waitFor({ state: 'detached', timeout: 4000 });
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(OUT!, `${c.name}-blocks.png`) });
    });
  }
});
