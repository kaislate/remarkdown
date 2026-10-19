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
  '.menu-root',
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

const READER_THEME_LABEL: Record<string, string> = { default: 'Default', paper: 'Paper', sepia: 'Sepia', night: 'Night', eink: 'E-ink' };

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

test('a quiet back arrow top-left leaves reader mode', async ({ page }) => {
  await open(page, [A]);
  await enterReader(page);
  const back = page.getByRole('button', { name: 'Leave reader mode' });
  await expect(back).toBeVisible();
  const r = (await back.boundingBox())!;
  expect(r.x).toBeLessThan(24);
  expect(r.y).toBeLessThan(12);
  // Subtle at rest.
  expect(Number(await back.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.8);
  await back.click();
  await expect(page.locator('body')).not.toHaveClass(/reader-mode/);
  await expect(page.locator('.menu-root')).toBeVisible();
});

test('the window buttons stay, in line with the back arrow and the meta line', async ({ page }) => {
  await open(page, [A]);
  await enterReader(page);
  const mid = async (sel: string) => {
    const b = (await page.locator(sel).first().boundingBox())!;
    return b.y + b.height / 2;
  };
  for (const name of ['Minimize', 'Maximize', 'Close']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  const arrow = await mid('.reader-back');
  expect(Math.abs((await mid('.titlebar-controls .ctrl.close')) - arrow)).toBeLessThanOrEqual(1.5);
  expect(Math.abs((await mid('.reader-meta .left')) - arrow)).toBeLessThanOrEqual(2);
  // They work from reader mode and don't take it away.
  await page.getByRole('button', { name: 'Maximize', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
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

