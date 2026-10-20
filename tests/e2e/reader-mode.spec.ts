// Reader mode: nothing but the page. Every chrome element is hidden except
// a quiet way back and the window buttons along the top (the window can
// still be dragged by an invisible top band) and, unless turned off, the
// minimap. Annotations stay visible but read-only, and the reader theme
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
  '.wordmark',
  '.titlebar-drag',
  '.controls-aura',
  '.tabbar',
  '.left-title',
  '.rail',
  '.strip',
  '.notes-pill-wrap',
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
  await page.locator('.settings-window').waitFor();
  await fn();
  await page.locator('.settings-window button.close').click();
  await expect(page.locator('.settings-window')).toHaveCount(0);
}

const READER_THEME_LABEL: Record<string, string> = { default: 'Default', paper: 'Paper', textured: 'Textured', sepia: 'Sepia', night: 'Night', eink: 'E-ink' };

// Inside settingsDo: pick the app theme / reader theme in the Settings window.
async function pickAppTheme(page: Page, app: 'dark' | 'light') {
  const win = page.getByRole('dialog', { name: 'Settings' });
  await win.getByRole('button', { name: 'Appearance', exact: true }).click();
  await win.locator('#setting-theme').getByRole('radio', { name: app === 'dark' ? 'Dark' : 'Light', exact: true }).click();
}
async function pickReaderTheme(page: Page, theme: string) {
  const win = page.getByRole('dialog', { name: 'Settings' });
  await win.getByRole('button', { name: 'Reading', exact: true }).click();
  await win.locator('#setting-reader-theme').getByRole('radio', { name: READER_THEME_LABEL[theme], exact: true }).click();
}

async function enterReader(page: Page) {
  await page.locator('.reader-mode-toggle').click();
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
  // …and the old view has finished drying away (the ink transition).
  await expect.poll(() => page.evaluate(() => document.documentElement.matches(':active-view-transition'))).toBe(false);
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
  await page.waitForTimeout(1200); // the ink has dried; the wordmark has faded
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

test('clicks on the page and tool keys do not leave; Esc does', async ({ page }) => {
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
  // The section is named as soon as its heading comes up to the top third
  // of the page, while its text is on screen — not once it has gone by.
  await page.locator('.scroll').evaluate((el) => {
    const h = Array.from(document.querySelectorAll('.viewer h2')).find((x) => x.textContent === 'Chapter 3')!;
    el.scrollTop += h.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight * 0.4;
  });
  await page.waitForTimeout(100);
  await expect(meta).not.toContainText('Chapter 3');
  await page.locator('.scroll').evaluate((el) => { el.scrollTop += el.clientHeight * 0.15; });
  await expect(meta).toContainText('Chapter 3 · ');
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
    await pickReaderTheme(page, 'sepia');
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
    await pickReaderTheme(page, 'eink');
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
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Reading', exact: true }).click();
    await page.getByLabel('Always open documents in reader mode').check();
  });
  await open(page, [A]);
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
  await expect(page.locator('.reader-hint')).toBeVisible();
});

// RGBA bytes of a page region, decoded in the page (no PNG library here).
async function regionPixels(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number[]> {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
  }, png.toString('base64'));
}

function maxDiff(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
}

const PAGE_BG: Record<string, [number, number, number] | null> = {
  default: null, // the app's background has a soft glow; compared against itself below
  paper: [251, 249, 244],
  sepia: [243, 231, 207],
  night: [18, 20, 23],
  eink: [242, 242, 240],
};

test.describe('the top of the page is the page', () => {
  const cases = [
    { app: 'dark', theme: 'default' }, { app: 'light', theme: 'default' },
    { app: 'dark', theme: 'paper' }, { app: 'dark', theme: 'sepia' },
    { app: 'light', theme: 'night' }, { app: 'dark', theme: 'eink' },
  ] as const;
  for (const c of cases) {
    test(`${c.theme} over the ${c.app} app theme: nothing but the page colour behind the meta line`, async ({ page }) => {
      await open(page, [A]);
      await settingsDo(page, async () => {
        await pickAppTheme(page, c.app);
        await pickReaderTheme(page, c.theme);
      });
      await enterReader(page);
      // Text scrolled up under the meta line.
      await page.locator('.viewer h2').evaluate((el) => {
        document.querySelector('.scroll')!.scrollTop += el.getBoundingClientRect().top - 10;
      });
      await expect(page.locator('.reader-meta')).toContainText('min left');
      for (const sel of ['.reader-meta', '.reader-drag-band']) {
        const bg = await page.locator(sel).evaluate((el) => {
          const cs = getComputedStyle(el);
          return [cs.backgroundColor, cs.backgroundImage];
        });
        expect(bg, sel).toEqual(['rgba(0, 0, 0, 0)', 'none']);
      }
      const clip = { x: 215, y: 0, width: 665, height: 45 };
      // The area with the meta text made invisible…
      await page.addStyleTag({ content: '.reader-meta { color: transparent !important; }' });
      const live = await regionPixels(page, clip);
      // …must equal the bare page background (everything on it hidden).
      await page.addStyleTag({ content: '.scroll, .reader-meta, .reader-drag-band { visibility: hidden !important; }' });
      const bare = await regionPixels(page, clip);
      expect(maxDiff(live, bare)).toBeLessThanOrEqual(1);
      const bg = PAGE_BG[c.theme];
      if (bg) {
        for (let i = 0; i < live.length; i += 4) {
          const px = [live[i], live[i + 1], live[i + 2]];
          if (Math.max(...px.map((v, k) => Math.abs(v - bg[k]))) > 1) {
            throw new Error(`pixel ${i / 4} is rgb(${px}) not the ${c.theme} page rgb(${bg})`);
          }
        }
      }
    });
  }
});

test.describe('screenshots', () => {
  test.skip(!OUT, 'set READER_SHOTS_DIR to capture');
  const cases: Array<{ name: string; app: 'dark' | 'light'; theme: string; tone: 'dark' | 'light' }> = [
    { name: 'default-dark', app: 'dark', theme: 'default', tone: 'dark' },
    { name: 'default-light', app: 'light', theme: 'default', tone: 'light' },
    { name: 'paper', app: 'dark', theme: 'paper', tone: 'light' },
    { name: 'textured', app: 'dark', theme: 'textured', tone: 'light' },
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
        await pickAppTheme(page, c.app);
        await pickReaderTheme(page, c.theme);
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

test('the menu button stays, in the same place, without its box', async ({ page }) => {
  await open(page, [A]);
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  const before = (await menu.boundingBox())!;
  await enterReader(page);
  await page.waitForTimeout(1300); // the ink has dried and the box has faded
  const after = (await menu.boundingBox())!;
  expect(after).toEqual(before);
  const look = await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, border: cs.borderTopColor, shadow: cs.boxShadow, opacity: Number(cs.opacity) };
  });
  expect(look.bg).toBe('rgba(0, 0, 0, 0)');
  expect(look.border).toBe('rgba(0, 0, 0, 0)');
  expect(look.shadow).toBe('none');
  expect(look.opacity).toBeLessThan(0.8);
  // It still opens the menu; Esc closes the menu first, then reader mode.
  await menu.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
});

test('a quiet back arrow beside the menu button leaves reader mode', async ({ page }) => {
  await open(page, [A]);
  await enterReader(page);
  const back = page.getByRole('button', { name: 'Leave reader mode' });
  await expect(back).toBeVisible();
  await page.waitForTimeout(1300);
  const r = (await back.boundingBox())!;
  const m = (await page.getByRole('button', { name: 'Menu', exact: true }).boundingBox())!;
  expect(r.x).toBeGreaterThan(m.x + m.width);
  expect(Math.abs(r.y + r.height / 2 - (m.y + m.height / 2))).toBeLessThanOrEqual(1.5);
  // Subtle at rest.
  expect(Number(await back.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.8);
  await back.click();
  await expect(page.locator('body')).not.toHaveClass(/reader-mode/);
  await expect(back).toHaveCount(0);
});

test('the window buttons stay, on one line with the meta line', async ({ page }) => {
  await open(page, [A]);
  await settingsDo(page, async () => {
    const win = page.getByRole('dialog', { name: 'Settings' });
    await win.getByRole('button', { name: 'Reading', exact: true }).click();
    await win.locator('#setting-reader-nav').getByRole('radio', { name: 'Line at the top' }).click();
  });
  await enterReader(page);
  const mid = async (sel: string) => {
    const b = (await page.locator(sel).first().boundingBox())!;
    return b.y + b.height / 2;
  };
  for (const name of ['Minimize', 'Maximize', 'Close']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  expect(Math.abs((await mid('.titlebar-controls .ctrl.close')) - (await mid('.reader-meta .left')))).toBeLessThanOrEqual(2);
  // They work from reader mode and don't take it away.
  await page.getByRole('button', { name: 'Maximize', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
});

async function countViewTransitions(page: Page) {
  await page.evaluate(() => {
    (window as any).__vt = 0;
    const orig = document.startViewTransition.bind(document);
    (document as any).startViewTransition = (cb: () => void) => { (window as any).__vt++; return orig(cb); };
  });
}

test('switching in and out, the old view dries away like ink', async ({ page }) => {
  await open(page, [A]);
  await countViewTransitions(page);
  await enterReader(page);
  await page.waitForTimeout(1100);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/reader-mode/);
  expect(await page.evaluate(() => (window as any).__vt)).toBe(2);
  // The old view is masked by the ink worklet as it dries.
  expect(await page.evaluate(() => document.documentElement.classList.contains('ink-worklet'))).toBe(true);
});

test('no ink transition under reduced motion', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1100, height: 780 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.evaluate(([a, doc]) => (window as any).__E2E_SEED_DOC__(a, doc), [A, DOC]);
  await open(page, [A]);
  await countViewTransitions(page);
  await enterReader(page);
  expect(await page.evaluate(() => (window as any).__vt)).toBe(0);
  await ctx.close();
});

// The reader minimap's box stands for exactly the visible part of the page:
// its copy of the page lays out in the reader column and type too.
test('the minimap shows in reader mode and its box matches the page', async ({ page }) => {
  await open(page, [A]);
  await enterReader(page);
  const map = page.locator('.minimap');
  await expect(map).toBeVisible();
  await page.waitForTimeout(500);
  const scroller = page.locator('.scroll');
  const max = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
  for (const f of [0, 0.4, 1]) {
    await scroller.evaluate((el, top) => { el.scrollTop = top; }, Math.round(max * f));
    await page.waitForTimeout(80);
    const m = await page.evaluate(() => {
      const scroll = document.querySelector('.scroll') as HTMLElement;
      const article = document.querySelector('.viewer') as HTMLElement;
      const clone = document.querySelector('.minimap-content') as HTMLElement;
      const box = (document.querySelector('.viewport-indicator') as HTMLElement).getBoundingClientRect();
      const sr = scroll.getBoundingClientRect();
      const ar = article.getBoundingClientRect();
      const cr = clone.getBoundingClientRect();
      const scale = cr.width / ar.width;
      const visTop = sr.top - ar.top;
      const p = article.querySelectorAll('p')[30];
      const cp = clone.querySelectorAll('p')[30];
      return {
        boxTop: box.top, wantTop: cr.top + visTop * scale,
        boxBottom: box.bottom, wantBottom: cr.top + (visTop + scroll.clientHeight) * scale,
        pArticle: (p.getBoundingClientRect().top - ar.top) * scale, pClone: cp.getBoundingClientRect().top - cr.top,
      };
    });
    expect(Math.abs(m.pClone - m.pArticle), `line position at ${f}`).toBeLessThanOrEqual(1);
    expect(Math.abs(m.boxTop - m.wantTop), `box top at ${f}`).toBeLessThanOrEqual(1);
    expect(Math.abs(m.boxBottom - m.wantBottom), `box bottom at ${f}`).toBeLessThanOrEqual(1);
  }
  // The column still clears it.
  const col = (await page.locator('.viewer p').first().boundingBox())!;
  const mm = (await map.boundingBox())!;
  expect(col.x + col.width).toBeLessThan(mm.x);
});

test('"Show the minimap in reader mode" off: no minimap while reading', async ({ page }) => {
  await settingsDo(page, async () => {
    const win = page.getByRole('dialog', { name: 'Settings' });
    await win.getByRole('button', { name: 'Reading', exact: true }).click();
    await win.getByLabel('Show the minimap in reader mode').uncheck();
  });
  await open(page, [A]);
  await expect(page.locator('.minimap')).toBeVisible();
  await enterReader(page);
  await expect(page.locator('.minimap')).toBeHidden();
});

test('"Contents on the left": the headings beside the page instead of the line at the top', async ({ page }) => {
  await settingsDo(page, async () => {
    const win = page.getByRole('dialog', { name: 'Settings' });
    await win.getByRole('button', { name: 'Reading', exact: true }).click();
    await win.locator('#setting-reader-nav').getByRole('radio', { name: 'Contents on the left', exact: true }).click();
  });
  await open(page, [A]);
  await enterReader(page);
  const contents = page.getByRole('navigation', { name: 'Contents' });
  await expect(contents).toBeVisible();
  await expect(page.locator('.reader-meta')).toBeHidden();
  const items = contents.getByRole('link');
  await expect(items).toHaveText(['On reading slowly', 'Chapter 3']);
  await expect(contents).toContainText(/\d+ min left/);
  // Beside the column, not over it.
  const nav = (await contents.boundingBox())!;
  const col = (await page.locator('.viewer p').first().boundingBox())!;
  expect(nav.x + nav.width).toBeLessThan(col.x);
  // It follows the reading line, like the line at the top did.
  await expect(items.nth(0)).toHaveAttribute('aria-current', 'location');
  await page.locator('.scroll').evaluate((el) => {
    const h = Array.from(document.querySelectorAll('.viewer h2')).find((x) => x.textContent === 'Chapter 3')!;
    el.scrollTop += h.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight * 0.2;
  });
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'location');
  // And takes you there.
  await items.nth(0).click();
  await expect.poll(() => page.locator('.scroll').evaluate((el) => el.scrollTop)).toBeLessThan(80);
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
});

test('the minimap arrow works in reader mode too', async ({ page }) => {
  await open(page, [A]);
  await enterReader(page);
  const map = page.locator('.minimap');
  const arrow = page.getByRole('button', { name: 'Hide minimap' });
  await expect(arrow).toBeVisible();
  const onScreen = async () => {
    const b = (await map.boundingBox())!;
    return b.x < 1100;
  };
  expect(await onScreen()).toBe(true);
  await arrow.click();
  await expect.poll(onScreen).toBe(false);
  await page.getByRole('button', { name: 'Show minimap' }).click();
  await expect.poll(onScreen).toBe(true);
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
});

test('textured paper: a grained page that scrolls with the text, and ink that has soaked in a little', async ({ page }) => {
  await settingsDo(page, () => pickReaderTheme(page, 'textured'));
  await open(page, [A]);
  await enterReader(page);
  const scroll = page.locator('.scroll');
  // Paper grain on the page itself, moving with it.
  const bg = await scroll.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { image: cs.backgroundImage, attach: cs.backgroundAttachment };
  });
  expect(bg.image).toContain('feTurbulence');
  expect(bg.attach.split(',')[0].trim()).toBe('local');
  // Blue-black ink with a slight bleed.
  const p = page.locator('.viewer p').first();
  await expect(p).toHaveCSS('color', 'rgb(38, 42, 56)');
  expect(await p.evaluate((el) => getComputedStyle(el).textShadow)).not.toBe('none');
  // A light page: diagrams are drawn light.
  await diagramsSettled(page, 'light');
});


test('the menu over a reader page stands out on solid paper, not dimmed with the page', async ({ page }) => {
  await settingsDo(page, () => pickReaderTheme(page, 'paper'));
  await open(page, [A]);
  await enterReader(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(400);
  const look = await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { bg: cs.backgroundColor, onTop: el.contains(top) };
  });
  // Opaque: the dimmed page doesn't show through it.
  expect(look.bg).toBe('rgb(243, 239, 230)');
  expect(look.onTop).toBe(true);
  // The page behind is dimmed lightly, in its own ink, not a dark wash.
  const dim = await page.locator('.menu-overlay').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(dim).not.toBe('rgba(11, 10, 18, 0.6)');
});

// Painted pixels on the pointer-ink canvas.
const inkedPixels = (page: Page) => () => page.locator('canvas.cursor-ink').evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});

async function pickCursorInk(page: Page, label: string) {
  await settingsDo(page, async () => {
    const win = page.getByRole('dialog', { name: 'Settings' });
    await win.getByRole('button', { name: 'Reading', exact: true }).click();
    await win.locator('#setting-reader-cursor-ink').getByRole('radio', { name: label, exact: true }).click();
  });
}

test('ink leaks from a resting pointer, spreading until it moves away, then dries', async ({ page }) => {
  await open(page, [A]);
  await enterReader(page);
  const ink = page.locator('canvas.cursor-ink');
  await expect(ink).toHaveCount(1);
  expect(await ink.evaluate((c) => getComputedStyle(c).pointerEvents)).toBe('none');
  const inked = inkedPixels(page);
  await page.mouse.move(300, 300);
  await page.mouse.move(420, 340, { steps: 10 });
  // Moving: nothing yet. Resting: a spot that keeps growing.
  expect(await inked()).toBe(0);
  await expect.poll(inked).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  const early = await inked();
  await page.waitForTimeout(1500);
  const later = await inked();
  expect(later).toBeGreaterThan(early * 1.5);
  // A wobble doesn't stop it…
  await page.mouse.move(424, 342);
  await page.waitForTimeout(400);
  expect(await inked()).toBeGreaterThanOrEqual(later);
  // …moving away does: it dries away (and a new rest starts a new spot).
  await page.mouse.move(700, 500, { steps: 6 });
  await page.mouse.move(700, 500);
  await expect.poll(inked, { timeout: 4000 }).toBeLessThan(later);
});

test('the other ink styles: a trail of drops, a pen line, or none', async ({ page }) => {
  await open(page, [A]);
  const inked = inkedPixels(page);
  for (const label of ['Trail', 'Pen']) {
    await pickCursorInk(page, label);
    await enterReader(page);
    await page.mouse.move(300, 300);
    await page.mouse.move(600, 360, { steps: 20 });
    await expect.poll(inked, { message: label }).toBeGreaterThan(200);
    await expect.poll(inked, { timeout: 8000, message: `${label} dries` }).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/reader-mode/);
  }
  await pickCursorInk(page, 'Off');
  await enterReader(page);
  await expect(page.locator('canvas.cursor-ink')).toHaveCount(0);
});
