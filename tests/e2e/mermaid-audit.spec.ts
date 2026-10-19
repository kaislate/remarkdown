// Mermaid regression suite (grown out of the mermaid audit). Drives the
// corpus in tests/fixtures/mermaid-corpus.md through reader mode (dark
// + light) and edit mode. Set MERMAID_AUDIT_DIR to also write per-block
// JSON + screenshots for manual review.
//
// Known upstream mermaid quirks deliberately NOT asserted here:
// block-beta label overflow, sequence `critical` label spill, radar
// title clipping, C4 relation label colour.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CORPUS_MD = readFileSync(resolve(__dirname, '../fixtures/mermaid-corpus.md'), 'utf8').replace(/\r\n/g, '\n');
const CORPUS_PATH = '/e2e/mermaid-corpus.md';
const OTHER_PATH = '/e2e/other.md';
const OTHER_MD = '# Other doc\n\n```mermaid\nflowchart LR\n  X[Other] --> Y[Doc]\n```\n';
const OUT = process.env.MERMAID_AUDIT_DIR;
if (OUT) mkdirSync(OUT, { recursive: true });

function save(name: string, data: unknown): void {
  if (OUT) writeFileSync(join(OUT, name), JSON.stringify(data, null, 2));
}
async function shot(loc: { screenshot: (o: { path: string }) => Promise<unknown> }, name: string): Promise<void> {
  if (OUT) await loc.screenshot({ path: join(OUT, name) }).catch(() => {});
}

interface Logs { errors: string[]; warnings: string[] }
function captureConsole(page: Page): Logs {
  const logs: Logs = { errors: [], warnings: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') logs.errors.push(m.text());
    if (m.type() === 'warning') logs.warnings.push(m.text());
  });
  page.on('pageerror', (e) => logs.errors.push(`pageerror: ${e.message}`));
  return logs;
}

async function clickMenuItem(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('button', { name: /menu/i }).click();
  const item = page.getByRole('menuitem', { name });
  try {
    await item.click({ timeout: 2000 });
  } catch {
    // Known overlap bug (fixed on another branch): left-side buttons can
    // sit over the menu item.
    await item.evaluate((el) => (el as HTMLElement).click());
  }
}

async function seedAndOpen(page: Page, path: string, md: string, opts: { clear?: boolean } = {}): Promise<void> {
  if (opts.clear !== false) {
    await page.goto('/');
    await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
    await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
  }
  await page.evaluate(([p, m]) => (window as any).__E2E_SEED_DOC__?.(p, m), [path, md]);
  await page.evaluate((p) => (window as any).__E2E_SET_DIALOG_PATH__?.(p), path);
  await clickMenuItem(page, /open…/i);
  await page.getByRole('heading', { level: 1 }).first().waitFor();
}

async function setTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await clickMenuItem(page, /settings/i);
  await page.locator('#setting-theme').selectOption(theme);
  await page.keyboard.press('Escape');
  const close = page.locator('button.close[aria-label="Close"]');
  if (await close.count()) await close.first().click({ force: true }).catch(() => {});
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

// Every reader diagram has been drawn for the current theme (each
// block records the theme|font it was rendered for).
async function waitReaderDiagramsSettled(page: Page, theme?: 'dark' | 'light'): Promise<void> {
  await page.waitForFunction(
    (t) => {
      const a = document.querySelector('article.viewer');
      if (!a) return false;
      const blocks = Array.from(a.querySelectorAll<HTMLElement>('.mermaid-block'));
      return (
        blocks.length > 0 &&
        blocks.every((b) => !!b.dataset.mermaidRendered && (!t || b.dataset.mermaidRendered.startsWith(`${t}|`)))
      );
    },
    theme,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(300);
}

// Per-block reader-mode measurements, computed in the page.
async function measureReader(page: Page) {
  return page.evaluate(() => {
    const article = document.querySelector('article.viewer') as HTMLElement;
    const h2s = Array.from(article.querySelectorAll('h2'));
    const headingFor = (el: Element) => {
      let h = '';
      for (const x of h2s) if (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) h = x.textContent ?? '';
      return h;
    };
    const cs = getComputedStyle(article);
    const contentW = article.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const blocks = Array.from(article.querySelectorAll<HTMLElement>('.mermaid-block')).map((el, idx) => {
      const svg = el.querySelector(':scope > svg') as SVGSVGElement | null;
      const err = el.querySelector('.mermaid-error') as HTMLElement | null;
      const r: Record<string, unknown> = { idx, heading: headingFor(el) };
      if (err) {
        r.status = 'error';
        r.errorTitle = err.querySelector('.mermaid-error-title')?.textContent ?? null;
        r.detailsOpen = (err.querySelector('details') as HTMLDetailsElement | null)?.open ?? null;
        r.errorText = (err.textContent ?? '').slice(0, 200);
        const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
        const lum = ([r0, g0, b0]: number[]) => {
          const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * f(r0) + 0.7152 * f(g0) + 0.0722 * f(b0);
        };
        const title = err.querySelector('.mermaid-error-title') as HTMLElement | null;
        if (title) {
          const L1 = lum(parse(getComputedStyle(title).color));
          const L2 = lum(parse(getComputedStyle(err).backgroundColor));
          r.titleContrast = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        }
      } else if (svg) {
        r.status = 'svg';
        const br = svg.getBoundingClientRect();
        const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
        const natural = vb.length === 4 && vb[2] > 0 ? vb[2] : null;
        r.svgW = Math.round(br.width);
        r.svgH = Math.round(br.height);
        r.natural = natural;
        r.scale = natural ? br.width / natural : null;
        r.blockW = el.clientWidth;
        r.blockScrolls = el.scrollWidth > el.clientWidth + 1;
        r.blockOverflowsColumn = el.getBoundingClientRect().width > contentW + 1;
        r.tiny = br.width < 60 || br.height < 25;
        const clipped: string[] = [];
        svg.querySelectorAll('foreignObject').forEach((fo) => {
          const inner = fo.firstElementChild as HTMLElement | null;
          if (!inner) return;
          const foW = parseFloat(fo.getAttribute('width') || '0');
          const foH = parseFloat(fo.getAttribute('height') || '0');
          if ((foW > 0 && inner.scrollWidth > foW + 1.5) || (foH > 0 && inner.scrollHeight > foH + 1.5)) {
            clipped.push(`${(inner.textContent ?? '').trim().slice(0, 40)} [${inner.scrollWidth}x${inner.scrollHeight} > ${foW}x${foH}]`);
          }
        });
        r.clippedLabels = clipped;
        const firstLabel = svg.querySelector('foreignObject span, foreignObject div, text') as Element | null;
        r.labelFont = firstLabel ? getComputedStyle(firstLabel).fontFamily : null;
        const firstShape = svg.querySelector('g.node rect, g.node polygon, g.node path, rect.actor, .task, .pieCircle, rect') as Element | null;
        r.firstShapeFill = firstShape ? getComputedStyle(firstShape).fill : null;
        r.svgId = svg.id;
      } else {
        r.status = el.innerHTML.trim() ? 'other' : 'empty';
      }
      return r;
    });
    // What did the non-standard fences become?
    const otherFences = h2s
      .filter((h) => /^mixed-/.test(h.textContent ?? ''))
      .map((h) => {
        const kinds: string[] = [];
        let n = h.nextElementSibling;
        while (n && n.tagName !== 'H2') {
          if (n.matches('.mermaid-block') || n.querySelector('.mermaid-block')) kinds.push('diagram');
          else if (n.matches('pre') || n.querySelector('pre')) kinds.push('code');
          n = n.nextElementSibling;
        }
        return { heading: h.textContent, kinds };
      });
    // Stray mermaid temp elements outside the article.
    const strays = Array.from(document.body.children)
      .filter((c) => !c.matches('#app, script, style, noscript') && (c.id.startsWith('d') || c.querySelector('svg[aria-roledescription="error"], svg[id^="mermaid"], svg[id^="rmd-mermaid"]')))
      .map((c) => ({ tag: c.tagName, id: c.id }));
    const errorSvgs = document.querySelectorAll('svg[aria-roledescription="error"]').length;
    // Ids shared between DIFFERENT copies (two svgs, or svg vs. page).
    // Some mermaid diagram types (mindmap) repeat ids inside their own
    // svg — upstream, and harmless to everything else on the page.
    const owners = new Map<string, Set<Element | null>>();
    for (const el of Array.from(document.querySelectorAll('[id]'))) {
      if (!el.id) continue;
      let root: Element | null = el.closest('svg');
      while (root?.parentElement?.closest('svg')) root = root.parentElement.closest('svg');
      const set = owners.get(el.id) ?? new Set<Element | null>();
      set.add(root);
      owners.set(el.id, set);
    }
    const dupIds = Array.from(owners.entries()).filter(([, s]) => s.size > 1).map(([id]) => id);
    return { blocks, otherFences, strays, errorSvgs, dupIds, articleFont: cs.fontFamily, contentW };
  });
}

test.describe.configure({ timeout: 300_000 });

test.describe('mermaid — reader mode', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`renders every corpus block (${theme})`, async ({ page }) => {
      const logs = captureConsole(page);
      await page.goto('/');
      await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
      if (theme === 'light') await setTheme(page, 'light');
      await seedAndOpen(page, CORPUS_PATH, CORPUS_MD, { clear: false });
      await waitReaderDiagramsSettled(page, theme);
      const m = await measureReader(page);
      save(`reader-${theme}.json`, { ...m, logs });
      if (OUT) {
        const blocks = page.locator('article.viewer .mermaid-block');
        for (let i = 0; i < m.blocks.length; i++) {
          await blocks.nth(i).scrollIntoViewIfNeeded().catch(() => {});
          await shot(blocks.nth(i), `reader-${theme}-${String(i).padStart(2, '0')}-${String(m.blocks[i].heading)}.png`);
        }
      }

      const valid = m.blocks.filter((b) => !/^invalid-/.test(String(b.heading)));
      expect(valid.filter((b) => b.status !== 'svg').map((b) => `${b.heading}: ${b.status}`), 'blocks that failed to render').toEqual([]);
      // Broken diagrams: plain words, technical detail folded away, readable in both themes.
      const invalid = m.blocks.filter((b) => /^invalid-/.test(String(b.heading)));
      expect(invalid.length).toBe(2);
      for (const b of invalid) {
        expect(b.status, String(b.heading)).toBe('error');
        expect(b.errorTitle).toBe("This diagram couldn't be displayed.");
        expect(b.detailsOpen).toBe(false);
        expect(b.titleContrast as number, `${b.heading} error title contrast`).toBeGreaterThanOrEqual(4.5);
      }
      // Nothing leaks onto <body>; mermaid never draws its own error "bomb".
      expect(m.errorSvgs, 'mermaid error svgs').toBe(0);
      expect(m.strays, 'stray mermaid temp elements on <body>').toEqual([]);
      expect(m.dupIds, 'duplicate ids in the document').toEqual([]);
      // Every mermaid fence spelling is a diagram.
      for (const f of m.otherFences) {
        expect(f.kinds, String(f.heading)).toEqual(f.heading === 'mixed-plain-code' ? ['code'] : ['diagram']);
      }
      // Wide diagrams stay legible: never below ~75% of natural size;
      // ones that can't fit scroll inside their block instead.
      for (const b of valid) {
        if (b.scale !== null) expect(b.scale as number, `${b.heading} scale`).toBeGreaterThanOrEqual(0.74);
        expect(b.blockOverflowsColumn, `${b.heading} block wider than the column`).toBe(false);
        if ((b.natural as number) * 0.75 > m.contentW + 1) expect(b.blockScrolls, `${b.heading} should scroll`).toBe(true);
        expect(b.tiny, `${b.heading} tiny`).toBe(false);
        expect(b.clippedLabels, `${b.heading} clipped labels`).toEqual([]);
      }
      // Diagram text uses the article's font.
      for (const h of ['fc-td-basic', 'seq-basic', 'class-diagram']) {
        expect(m.blocks.find((b) => b.heading === h)?.labelFont, h).toBe(m.articleFont);
      }
      expect(logs.errors, 'console errors').toEqual([]);
    });
  }

  test('switching theme re-renders diagrams already on screen', async ({ page }) => {
    const logs = captureConsole(page);
    await seedAndOpen(page, CORPUS_PATH, CORPUS_MD);
    await waitReaderDiagramsSettled(page, 'dark');
    const dark = await measureReader(page);
    await setTheme(page, 'light');
    await waitReaderDiagramsSettled(page, 'light');
    const light = await measureReader(page);
    await shot(page.locator('article.viewer .mermaid-block').first(), 'theme-switch-after-light.png');
    await setTheme(page, 'dark');
    await waitReaderDiagramsSettled(page, 'dark');
    const back = await measureReader(page);
    const fills = [0, 1, 21].map((i) => ({ h: dark.blocks[i].heading, dark: dark.blocks[i].firstShapeFill, light: light.blocks[i].firstShapeFill, back: back.blocks[i].firstShapeFill }));
    save('theme-switch.json', { fills, logs });
    for (const f of fills) {
      expect(f.light, `${f.h} fill after switching to light`).not.toBe(f.dark);
      expect(f.back, `${f.h} fill after switching back`).toBe(f.dark);
    }
    expect(light.dupIds).toEqual([]);
    expect(logs.errors).toEqual([]);
  });

  test('switching documents / reopening: no leftovers, no stale renders', async ({ page }) => {
    const logs = captureConsole(page);
    await seedAndOpen(page, CORPUS_PATH, CORPUS_MD);
    await waitReaderDiagramsSettled(page);
    const first = await measureReader(page);
    await seedAndOpen(page, OTHER_PATH, OTHER_MD, { clear: false });
    await waitReaderDiagramsSettled(page);
    const other = await measureReader(page);
    await seedAndOpen(page, CORPUS_PATH, CORPUS_MD, { clear: false });
    await waitReaderDiagramsSettled(page);
    const back = await measureReader(page);
    await page.reload();
    await page.evaluate((p) => (window as any).__E2E_SET_DIALOG_PATH__?.(p), CORPUS_PATH);
    await clickMenuItem(page, /open…/i);
    await waitReaderDiagramsSettled(page);
    const reloaded = await measureReader(page);
    // Rapid switching: open A, immediately B, before A's diagrams finish.
    await page.evaluate((p) => (window as any).__E2E_SET_DIALOG_PATH__?.(p), CORPUS_PATH);
    await clickMenuItem(page, /open…/i);
    await page.evaluate((p) => (window as any).__E2E_SET_DIALOG_PATH__?.(p), OTHER_PATH);
    await clickMenuItem(page, /open…/i);
    await page.getByRole('heading', { level: 1, name: 'Other doc' }).waitFor();
    await waitReaderDiagramsSettled(page);
    await page.waitForTimeout(1500);
    const rapid = await measureReader(page);
    save('doc-switch.json', { first: first.strays, other: other.strays, back: back.strays, reloaded: reloaded.strays, rapid: rapid.blocks, logs });
    expect(back.blocks.length).toBe(first.blocks.length);
    expect(other.blocks.length).toBe(1);
    expect(rapid.blocks.map((b) => b.status)).toEqual(['svg']);
    for (const m of [first, other, back, reloaded, rapid]) {
      expect(m.strays).toEqual([]);
      expect(m.dupIds).toEqual([]);
    }
    expect(logs.errors).toEqual([]);
  });

  test('minimap mirrors diagrams with unique ids; highlights decline diagram text', async ({ page }) => {
    const logs = captureConsole(page);
    await seedAndOpen(page, CORPUS_PATH, CORPUS_MD);
    await waitReaderDiagramsSettled(page);
    await page.waitForTimeout(500);
    const minimap = await page.evaluate(() => {
      const mm = document.querySelector('.minimap-content');
      const article = document.querySelector('article.viewer')!;
      return {
        present: !!mm,
        svgCount: mm?.querySelectorAll('.mermaid-block > svg').length ?? 0,
        articleSvgCount: article.querySelectorAll('.mermaid-block > svg').length,
      };
    });
    await shot(page.locator('.minimap.glass').first(), 'minimap.png');
    expect(minimap.present).toBe(true);
    expect(minimap.svgCount).toBe(minimap.articleSvgCount);
    expect((await measureReader(page)).dupIds, 'duplicate ids incl. minimap clone').toEqual([]);

    await page.getByRole('radio', { name: /highlight/i }).click();
    const selectAndMouseup = async (finder: string, needle: string) =>
      page.evaluate(([f, nd]) => {
        const root = document.querySelector(f) as HTMLElement | null;
        if (!root) return 'no-root';
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let tn: Text | null = null;
        let n: Node | null;
        while ((n = walker.nextNode())) { if ((n as Text).data.includes(nd)) { tn = n as Text; break; } }
        if (!tn) return 'no-text';
        const s = tn.data.indexOf(nd);
        const range = document.createRange();
        range.setStart(tn, s);
        range.setEnd(tn, s + nd.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return 'ok';
      }, [finder, needle] as [string, string]);
    expect(await selectAndMouseup('article.viewer', 'EDIT_TARGET_SENTENCE')).toBe('ok');
    await page.waitForTimeout(300);
    expect(await selectAndMouseup('article.viewer .mermaid-block svg', 'Ship it')).toBe('ok');
    await expect(page.getByText('Use the pen to mark up diagrams.')).toBeVisible();
    await page.waitForTimeout(900);
    const sidecar = await page.evaluate((p) => localStorage.getItem(`rmd-sidecar::${p}`), CORPUS_PATH);
    const annots = sidecar ? (JSON.parse(sidecar).annotations as Array<{ anchor: { text: string } }>) : [];
    expect(annots.map((a) => a.anchor.text)).toEqual(['EDIT_TARGET_SENTENCE']);
    // The highlight that was made comes back after a reload.
    await page.reload();
    await page.evaluate((p) => (window as any).__E2E_SET_DIALOG_PATH__?.(p), CORPUS_PATH);
    await clickMenuItem(page, /open…/i);
    await waitReaderDiagramsSettled(page);
    await page.waitForTimeout(800);
    const restored = await page.evaluate(() => {
      const out: string[] = [];
      (CSS as any).highlights?.forEach((h: any) => h.forEach((r: Range) => out.push(r.toString())));
      return out;
    });
    expect(restored).toEqual(['EDIT_TARGET_SENTENCE']);
    expect(logs.errors).toEqual([]);
  });
});

// ── Edit mode ──────────────────────────────────────────────────────────

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

async function measureEditor(page: Page) {
  return page.evaluate(() => {
    const pm = document.querySelector('.editor-surface .ProseMirror') as HTMLElement;
    const h2s = Array.from(pm.querySelectorAll('h2'));
    const headingFor = (el: Element) => {
      let h = '';
      for (const x of h2s) if (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) h = x.textContent ?? '';
      return h;
    };
    const blocks = Array.from(pm.querySelectorAll('.mermaid-block-editor')).map((b) => {
      const rendered = b.querySelector('.mermaid-rendered') as HTMLElement;
      const src = b.querySelector('.mermaid-source') as HTMLElement | null;
      const note = b.querySelector('.mermaid-fallback-note') as HTMLElement | null;
      const svg = rendered.querySelector(':scope > svg');
      const label = svg?.querySelector('foreignObject span, foreignObject div, text') ?? null;
      const shape = svg?.querySelector('g.node rect, g.node polygon, rect.actor, rect') ?? null;
      return {
        heading: headingFor(b),
        status: svg ? 'svg' : rendered.querySelector('.mermaid-error') ? 'error' : rendered.querySelector('.mermaid-empty-state') ? 'empty-state' : 'none',
        note: note && note.offsetParent !== null ? note.textContent : null,
        sourceVisible: src ? getComputedStyle(src).display !== 'none' : false,
        labelFont: label ? getComputedStyle(label).fontFamily : null,
        firstShapeFill: shape ? getComputedStyle(shape).fill : null,
        edgeHitStroke: (() => { const h = svg?.querySelector('path.mermaid-edge-hit'); return h ? getComputedStyle(h).stroke : null; })(),
      };
    });
    const codeBlocks = Array.from(pm.querySelectorAll('pre')).filter((p) => !p.closest('.mermaid-block-editor')).map((p) => ({
      heading: headingFor(p),
      visible: (p as HTMLElement).offsetParent !== null,
    }));
    const visibleText = (document.querySelector('.editor-surface') as HTMLElement).innerText;
    return { blocks, codeBlocks, visibleText };
  });
}

// Minimal line-level LCS diff: lines of `a` missing from `b`.
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
  const lines = md.split('\n');
  let heading = '';
  let open: { fence: string; prefix: string; body: string[] } | null = null;
  for (const raw of lines) {
    if (!open) {
      const h = /^## (.*)$/.exec(raw);
      if (h) heading = h[1];
      const f = /^([\s>]*)(`{3,}|~{3,})(.*)$/.exec(raw);
      if (f) open = { prefix: f[1], fence: f[2], body: [] };
    } else {
      const stripped = raw.replace(/^[\s>]*/, '');
      if (stripped.startsWith(open.fence[0].repeat(3)) && stripped.trim().replace(/[`~]/g, '') === '') {
        out[heading] = open.body.join('\n');
        open = null;
      } else {
        open.body.push(raw.slice(Math.min(open.prefix.length, raw.length - raw.replace(/^[\s>]*/, '').length)));
      }
    }
  }
  return out;
}

async function lastWrite(page: Page): Promise<string | null> {
  const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
  return writes.length ? writes[writes.length - 1].markdown : null;
}

async function editTrailingParagraph(page: Page, text: string): Promise<void> {
  const para = page.locator('.editor-surface .ProseMirror p', { hasText: 'EDIT_TARGET_SENTENCE' });
  await para.scrollIntoViewIfNeeded();
  await para.click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await page.waitForTimeout(1500);
}

// Locate the mermaid editor wrapper that follows `## heading`.
function blockSelectorScript(heading: string): string {
  return `(() => { const h = Array.from(document.querySelectorAll('.editor-surface .ProseMirror h2')).find(x => x.textContent === ${JSON.stringify(heading)}); let n = h && h.nextElementSibling; while (n && !n.matches('.mermaid-block-editor') && n.tagName !== 'H2') n = n.nextElementSibling; return n && n.matches('.mermaid-block-editor') ? n : null; })()`;
}

async function clickInBlock(page: Page, heading: string, selector: string): Promise<boolean> {
  return page.evaluate(([h, sel]) => {
    // eslint-disable-next-line no-eval
    const block = (0, eval)(h) as Element | null;
    const el = block?.querySelector(sel);
    if (!el) return false;
    const inner = el.querySelector('rect, circle, polygon, ellipse, path, text') ?? el;
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, [blockSelectorScript(heading), selector] as [string, string]);
}

const FALLBACK_NOTE = 'Editing for this kind of diagram is coming soon — it will be kept exactly as it is.';

test.describe('mermaid — edit mode', () => {
  test('every block: diagram (never raw code), friendly notes, untouched sources survive a save', async ({ page }) => {
    const logs = captureConsole(page);
    await seedAndOpen(page, CORPUS_PATH, CORPUS_MD);
    await waitReaderDiagramsSettled(page);
    await enterEditMode(page);
    const m = await measureEditor(page);
    if (OUT) {
      const blocks = page.locator('.editor-surface .mermaid-block-editor');
      for (let i = 0; i < m.blocks.length; i++) {
        await blocks.nth(i).scrollIntoViewIfNeeded().catch(() => {});
        await shot(blocks.nth(i), `edit-${String(i).padStart(2, '0')}-${m.blocks[i].heading}.png`);
      }
    }

    const before = fencedBlocks(CORPUS_MD);
    const mermaidHeadings = Object.keys(before).filter((h) => h !== 'mixed-plain-code');
    expect(m.blocks.map((b) => b.heading).sort()).toEqual(mermaidHeadings.sort());
    for (const b of m.blocks) {
      expect(b.status, b.heading).toBe(/^invalid-/.test(b.heading) ? 'error' : 'svg');
      expect(b.sourceVisible, `${b.heading} source visible`).toBe(false);
      if (b.note !== null) expect(b.note).toBe(FALLBACK_NOTE);
      if (b.status === 'error') expect(b.note, `${b.heading}: broken, not "coming soon"`).toBeNull();
    }
    expect(m.blocks.find((b) => b.heading === 'gitgraph')?.note).toBe(FALLBACK_NOTE);
    expect(m.blocks.find((b) => b.heading === 'fc-td-basic')?.note).toBeNull();
    // Every flowchart (legacy `graph`, subgraphs, styling, every shape
    // and link) is editable: none says "coming soon".
    const flowcharts = m.blocks.filter((b) => /^(fc-|graph-)/.test(b.heading));
    expect(flowcharts.length).toBeGreaterThanOrEqual(19);
    expect(flowcharts.filter((b) => b.note !== null).map((b) => b.heading)).toEqual([]);
    // Same for every sequence diagram (actors, activations, blocks, boxes …).
    const sequences = m.blocks.filter((b) => /^seq-/.test(b.heading));
    expect(sequences.length).toBeGreaterThanOrEqual(10);
    expect(sequences.filter((b) => b.note !== null).map((b) => b.heading)).toEqual([]);
    // The only code block left is the real one.
    expect(m.codeBlocks.map((c) => c.heading)).toEqual(['mixed-plain-code']);
    // Never tell people to edit markdown / source.
    expect(m.visibleText).not.toMatch(/markdown source|edit the markdown|visual editing supports/i);

    await editTrailingParagraph(page, ' zz');
    const saved = await lastWrite(page);
    expect(saved, 'autosave should have written the document').not.toBeNull();
    const after = fencedBlocks(saved!);
    const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
    save('edit-mode.json', { ...m, changed, logs });
    expect(changed, 'diagram/code sources changed without user action').toEqual([]);
    expect(logs.errors, 'console errors in edit mode').toEqual([]);
  });

  // Each case: click an element, change its text via the popover, then
  // check that ONLY lines naming that element changed.
  const visualCases: Array<{ heading: string; selector: string; input: string; value: string; touches: RegExp; keeps?: RegExp; shows?: string }> = [
    { heading: 'fc-comments-only-subset', selector: 'g.node[id*="flowchart-C-"]', input: '.mermaid-popover-label', value: 'Third renamed', touches: /\bC\b/, keeps: /%% another comment/ },
    { heading: 'fc-init-directive', selector: 'g.node[id*="flowchart-B-"]', input: '.mermaid-popover-label', value: 'Forest renamed', touches: /\bB\b/, keeps: /%%\{init/ },
    { heading: 'fc-markdown-string-subset', selector: 'g.node[id*="flowchart-B-"]', input: '.mermaid-popover-label', value: 'Plain renamed', touches: /\bB\b/, keeps: /"`\*\*Bold\*\* label`"/ },
    { heading: 'fc-tb-direction', selector: 'g.node[id*="flowchart-B-"]', input: '.mermaid-popover-label', value: 'Renamed', touches: /\bB\b/, keeps: /flowchart TB/ },
    { heading: 'fc-special-chars', selector: 'g.node[id*="flowchart-E-"]', input: '.mermaid-popover-label', value: 'End & <done>', touches: /\bE\b/ },
    { heading: 'fc-quoted-unicode-emoji', selector: 'g.node[id*="flowchart-A-"]', input: '.mermaid-popover-label', value: 'Ärger 🚀 "quoted"', touches: /\bA\b/ },
    { heading: 'graph-td-legacy', selector: 'g.node[id*="flowchart-B-"]', input: '.mermaid-popover-label', value: 'Common still', touches: /\bB\b/, keeps: /^graph TD$/m },
    { heading: 'fc-subgraphs-nested', selector: 'g.cluster[id$="-Inner1"]', input: '.mermaid-group-title', value: 'Renamed group', touches: /subgraph Inner1/, keeps: /subgraph Inner2\[Inner two\]/ },
    { heading: 'fc-styling', selector: 'g.node[id*="flowchart-C-"]', input: '.mermaid-popover-label', value: 'Plainer', touches: /\bC\b/, keeps: /classDef hot fill:#f96,stroke:#333,stroke-width:2px/ },
    { heading: 'fc-comments-ampersand-chain', selector: 'g.node[id*="flowchart-E-"]', input: '.mermaid-popover-label', value: 'Echo', touches: /\bE\b/, keeps: /A & B --> C/ },
    { heading: 'fc-frontmatter-title', selector: 'g.node[id*="flowchart-B-"]', input: '.mermaid-popover-label', value: 'Below', touches: /\bB\b/, keeps: /title: Flowchart with frontmatter title/ },
    { heading: 'seq-comment-subset', selector: '[data-et="message"][data-id="i1"]', input: '.mermaid-message-popover-text', value: 'Done!', touches: /B-->>A/, keeps: /Map x->y and back/ },
    { heading: 'seq-special-chars', selector: '[data-et="message"][data-id="i1"]', input: '.mermaid-message-popover-text', value: 'OK & <done>', touches: /B-->>A/ },
    // Past blocks, numbering and activations mermaid's own numbering
    // shifts: i26 is "Highlighted", i4 "Hi Alice".
    { heading: 'seq-blocks', selector: '[data-et="message"][data-id="i26"]', input: '.mermaid-message-popover-text', value: 'Lit up', touches: /Highlighted|loop Every minute/, keeps: /loop Every minute/ },
    { heading: 'seq-activations', selector: '[data-et="message"][data-id="i4"]', input: '.mermaid-message-popover-text', value: 'Hi there', touches: /Hi Alice/, keeps: /activate Alice/ },
    { heading: 'seq-blocks', selector: 'g[data-et="control-structure"][data-id="i3"]', input: '.mermaid-block-label', value: 'Every hour', touches: /Highlighted|loop Every minute/, keeps: /C->>S: Lit up/ },
    { heading: 'seq-box', selector: 'g[data-et="participant"][data-id="A"]', input: '.mermaid-participant-popover-display', value: 'Web browser', touches: /participant A as Browser/, keeps: /box Purple Frontend/ },
    { heading: 'seq-participants-actors', selector: '[data-et="message"][data-id="i0"]', input: '.mermaid-message-popover-text', value: 'Tap', touches: /U->>W: Click/, keeps: /actor U as User/ },
    { heading: 'seq-basic', selector: '[data-et="message"][data-id="i0"]', input: '.mermaid-message-popover-text', value: 'Hello again; Bob # 1', touches: /A->>B/, shows: 'Hello again; Bob # 1' },
  ];

  test('visual edits change only what was edited, and the result renders', async ({ page }) => {
    const logs = captureConsole(page);
    await seedAndOpen(page, CORPUS_PATH, CORPUS_MD);
    await waitReaderDiagramsSettled(page);
    await enterEditMode(page);
    const original = fencedBlocks(CORPUS_MD);
    for (const c of visualCases) {
      expect(await clickInBlock(page, c.heading, c.selector), `${c.heading}: element to click`).toBe(true);
      const blockIdx = await page.evaluate((h) => {
        // eslint-disable-next-line no-eval
        const b = (0, eval)(h) as Element | null;
        return b ? Array.from(document.querySelectorAll('.editor-surface .mermaid-block-editor')).indexOf(b) : -1;
      }, blockSelectorScript(c.heading));
      const input = page.locator('.editor-surface .mermaid-block-editor').nth(blockIdx).locator(`${c.input}:visible`).first();
      await input.waitFor({ state: 'visible', timeout: 4000 });
      await input.fill(c.value);
      await input.press('Enter');
      await page.waitForTimeout(1200);
      const saved = await lastWrite(page);
      const src = fencedBlocks(saved ?? '')[c.heading];
      expect(src, `${c.heading}: saved`).toBeDefined();
      for (const line of removedLines(original[c.heading], src)) {
        expect(c.touches.test(line), `${c.heading}: unrelated line changed: ${JSON.stringify(line)}\n${src}`).toBe(true);
      }
      if (c.keeps) expect(src).toMatch(c.keeps);
      const state = await page.evaluate((h) => {
        // eslint-disable-next-line no-eval
        const b = (0, eval)(h) as Element | null;
        const r = b?.querySelector('.mermaid-rendered');
        return r?.querySelector(':scope > svg') ? 'svg' : (r?.querySelector('.mermaid-error')?.textContent ?? 'none');
      }, blockSelectorScript(c.heading));
      expect(state, `${c.heading}: editor render after edit`).toBe('svg');
      await page.keyboard.press('Escape').catch(() => {});
    }
    // Every edited diagram renders in reader mode too.
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('.editor-surface')).toHaveCount(0);
    await waitReaderDiagramsSettled(page);
    const reader = await measureReader(page);
    for (const c of visualCases) {
      expect(reader.blocks.find((b) => b.heading === c.heading)?.status, `${c.heading} in reader`).toBe('svg');
    }
    const labels = await page.evaluate(() => {
      const find = (heading: string) => {
        const h = Array.from(document.querySelectorAll('article.viewer h2')).find((x) => x.textContent === heading);
        let n = h?.nextElementSibling;
        while (n && !n.matches('.mermaid-block')) n = n.nextElementSibling;
        return n;
      };
      return {
        boldStillBold: !!find('fc-markdown-string-subset')?.querySelector('g.node .label strong, g.node .label b'),
        seqText: find('seq-basic')?.querySelector('svg')?.textContent ?? '',
      };
    });
    expect(labels.boldStillBold, 'markdown-string label still renders bold').toBe(true);
    for (const c of visualCases) if (c.shows) expect(labels.seqText).toContain(c.shows);
    expect(logs.errors).toEqual([]);
  });

  test('edit mode uses the app theme and the article font; edge hit areas are invisible', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
    await setTheme(page, 'light');
    await seedAndOpen(page, CORPUS_PATH, CORPUS_MD, { clear: false });
    await waitReaderDiagramsSettled(page, 'light');
    const reader = await measureReader(page);
    await enterEditMode(page);
    const edit = await measureEditor(page);
    await shot(page.locator('.editor-surface .mermaid-block-editor').first(), 'edit-light-theme.png');
    save('edit-theme.json', { reader: reader.blocks[0], edit: edit.blocks[0] });
    expect(edit.blocks[0].firstShapeFill, 'edit-mode diagram fill matches reader in light theme').toBe(reader.blocks[0].firstShapeFill);
    expect(edit.blocks[0].labelFont).toBe(reader.blocks[0].labelFont);
    const hit = edit.blocks.find((b) => b.heading === 'fc-td-basic')?.edgeHitStroke;
    expect(hit, 'edge hit area stroke').toBe('rgba(0, 0, 0, 0)');
  });

  test('a popover rich-text field takes a real click and real typing (bold included)', async ({ page }) => {
    const logs = captureConsole(page);
    const md = '# T\n\n## rich\n\n```mermaid\nflowchart LR\n    A[Start] --> B[End]\n```\n\nAfter.\n';
    await seedAndOpen(page, '/e2e/rich.md', md);
    await enterEditMode(page);
    expect(await clickInBlock(page, 'rich', 'g.node[id*="flowchart-B-"]')).toBe(true);
    const field = page.locator('.editor-surface .mermaid-popover .mermaid-popover-label:visible').first();
    await field.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Big ');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type('finish');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    const src = fencedBlocks((await lastWrite(page)) ?? '')['rich'];
    expect(src).toBe('flowchart LR\n    A[Start] --> B["`Big **finish**`"]');
    // The document around the diagram was not typed into.
    expect(await lastWrite(page)).toContain('\nAfter.\n');
    expect(logs.errors).toEqual([]);
  });

  test('a sequence group box opens from its frame and is renamed in place', async ({ page }) => {
    const logs = captureConsole(page);
    await seedAndOpen(page, CORPUS_PATH, CORPUS_MD);
    await waitReaderDiagramsSettled(page);
    await enterEditMode(page);
    // Boxes are drawn last-first: the first frame in the svg is "Backend".
    expect(await clickInBlock(page, 'seq-box', 'svg > g > rect.rect')).toBe(true);
    const input = page.locator('.editor-surface .mermaid-form-popover .mermaid-box-label:visible').first();
    await expect(input).toHaveValue('Backend');
    await input.fill('Server side');
    await input.press('Enter');
    await page.waitForTimeout(1200);
    const src = fencedBlocks((await lastWrite(page)) ?? '')['seq-box'];
    const original = fencedBlocks(CORPUS_MD)['seq-box'];
    expect(src).toBe(original.replace('box Backend', 'box Server side'));
    expect(logs.errors).toEqual([]);
  });

  test('keyboard next to a diagram never edits its hidden source', async ({ page }) => {    const md = '# T\n\nBefore para.\n\n```mermaid\nsequenceDiagram\n    A->>B: one\n    B->>A: two\n```\n\nAfter para.\n';
    await seedAndOpen(page, '/e2e/keys.md', md);
    await enterEditMode(page);
    await page.locator('.editor-surface p', { hasText: 'Before para.' }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Delete');
    await page.locator('.editor-surface p', { hasText: 'After para.' }).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('x');
    await page.waitForTimeout(1200);
    const saved = await lastWrite(page);
    const src = fencedBlocks(saved ?? md)[''] ?? fencedBlocks(md)[''];
    expect(src).toBe('sequenceDiagram\n    A->>B: one\n    B->>A: two');
  });
});
