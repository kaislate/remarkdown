import { test, expect, type Page, type Browser } from '@playwright/test';

// The window chrome per OS. On a Mac the real red / yellow / green buttons
// sit in the top-left corner (tauri.macos.conf.json: an Overlay title bar),
// so the app's own Windows-style buttons, their aura and the resize grip
// go, and the left column — menu button, wordmark, the round buttons under
// it, the tab sidebar — steps down to clear them. The top tabs stay on
// their line. Windows keeps exactly the layout it has always had.

type OS = 'windows' | 'macos' | 'linux';

const A = '/e2e/chrome/Alpha.md';
const B = '/e2e/chrome/Beta.md';
const LONG = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}, long enough to wrap across a line or two of the reading column.`).join('\n\n');
const DOCS: Record<string, string> = {
  [A]: `# Alpha\n\nThe alpha document.\n\n## Part one\n\n${LONG}\n\n## Part two\n\n${LONG}\n`,
  [B]: '# Beta\n\nSecond document.\n',
};

// How far the column steps down on a Mac (--chrome-inset-top).
const MAC_INSET = 28;

const rect = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });

async function boot(page: Page, os: OS, settings: Record<string, unknown> = {}, tiling = false) {
  await page.addInitScript(([o, t]) => { (window as any).__E2E_PLATFORM__ = { os: o, tiling: t }; }, [os, tiling] as const);
  await page.goto('/');
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\bplatform-${os}\\b`));
  await page.evaluate((docs) => {
    for (const [p, md] of Object.entries(docs)) (window as any).__E2E_SEED_DOC__(p, md);
  }, DOCS);
  await page.evaluate((p) => (window as any).__E2E_SETTINGS__(p), { openMode: 'tabs', tabPosition: 'top', ...settings });
  await page.evaluate((ps) => {
    (window as any).__E2E_QUEUE_OPENS__(ps);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, [A, B]);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('tab').nth(0).click();
  await expect(page.locator('.viewer h1').first()).toHaveText('Alpha');
}

async function bootFresh(browser: Browser, os: OS, settings: Record<string, unknown> = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  await boot(page, os, settings);
  return page;
}

test('on a Mac the native buttons take over: no app buttons, aura or resize grip', async ({ page }) => {
  await boot(page, 'macos');
  await expect(page.locator('.titlebar-controls')).toBeHidden();
  await expect(page.locator('.controls-aura')).toBeHidden();
  await expect(page.locator('.resize-grip')).toBeHidden();
  // The window still moves from the top edge.
  await expect(page.locator('.titlebar-drag')).toBeVisible();
  // The menu button clears the traffic lights.
  expect((await rect(page, '.hamburger')).top).toBeGreaterThanOrEqual(36);
});

test('on Windows the app keeps its own buttons and the menu button stays at 14px', async ({ page }) => {
  await boot(page, 'windows');
  await expect(page.locator('.titlebar-controls')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(page.locator('.resize-grip')).toBeVisible();
  await expect(page.locator('.titlebar-drag')).toBeVisible();
  expect((await rect(page, '.hamburger')).top).toBe(14);
});

test('the left column steps down on a Mac; the top tabs stay on their line', async ({ browser }) => {
  const win = await bootFresh(browser, 'windows');
  const mac = await bootFresh(browser, 'macos');
  try {
    for (const sel of ['.hamburger', '.wordmark', '.pre-tag', '.edit-mode-toggle', '.toc-button', '.reader-mode-toggle']) {
      if ((await win.locator(sel).count()) === 0) continue;
      const w = await rect(win, sel);
      const m = await rect(mac, sel);
      expect(m.top - w.top, `${sel} steps down`).toBe(MAC_INSET);
      expect(m.left, `${sel} keeps its column`).toBe(w.left);
    }
    // The contents popover opens beside its button, wherever that is. (The
    // button is measured before the click: under the pointer it grows a
    // little, and how far it has grown depends on when it's measured.)
    const macButton = await rect(mac, '.toc-button');
    for (const p of [win, mac]) await p.locator('.toc-button').click();
    await expect(mac.locator('.toc-popover')).toBeVisible();
    await expect(win.locator('.toc-popover')).toBeVisible();
    expect((await rect(mac, '.toc-popover')).top - (await rect(win, '.toc-popover')).top).toBe(MAC_INSET);
    expect((await rect(mac, '.toc-popover')).top).toBe(macButton.top);

    // The tabs keep their place.
    expect(await rect(mac, '[role="tab"]')).toEqual(await rect(win, '[role="tab"]'));
  } finally {
    await win.close();
    await mac.close();
  }
});

test('on a Mac the menu opens below its stepped-down button', async ({ page }) => {
  await boot(page, 'macos');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const popover = page.locator('.menu-root .popover');
  await expect(popover).toBeVisible();
  await page.waitForTimeout(400);
  expect((await rect(page, '.menu-root .popover')).top).toBeGreaterThan((await rect(page, '.hamburger')).top);
  expect((await rect(page, '.menu-root .popover')).top).toBe(60 + MAC_INSET);
});

test('tabs on the left: on a Mac the sidebar starts below the stepped-down menu button', async ({ page }) => {
  await boot(page, 'macos', { tabPosition: 'left' });
  const sidebar = await rect(page, '.tab-sidebar');
  expect(sidebar.top).toBe(60 + MAC_INSET);
  expect((await rect(page, '.hamburger')).bottom).toBeLessThan(sidebar.top);
});

test('editing under top tabs on a Mac: the toolbar clears the menu row', async ({ page }) => {
  await boot(page, 'macos');
  await page.locator('.edit-mode-toggle').click();
  await expect(page.locator('.editor-toolbar')).toBeVisible();
  await expect.poll(() => page.locator('.content').evaluate((el) => el.getAnimations().length)).toBe(0);
  for (const scrolled of [false, true]) {
    if (scrolled) {
      await page.locator('.scroll').evaluate((el) => { el.scrollTop = 1500; });
      await page.waitForTimeout(100);
    }
    const bar = await rect(page, '.editor-toolbar');
    const menu = await rect(page, '.menu-root');
    const overlaps = bar.left < menu.right && bar.right > menu.left && bar.top < menu.bottom && bar.bottom > menu.top;
    expect(overlaps, `the menu row overlaps the toolbar (scrolled: ${scrolled})`).toBe(false);
  }
});

test('reader mode on a Mac: the back arrow and contents step down with the menu button', async ({ page }) => {
  await boot(page, 'macos', { readerNav: 'left' });
  await page.locator('.reader-mode-toggle').click();
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
  await expect.poll(() => page.evaluate(() => document.documentElement.matches(':active-view-transition'))).toBe(false);
  const menu = await rect(page, '.hamburger');
  const back = await rect(page, '.reader-back');
  expect(menu.top).toBeGreaterThanOrEqual(36);
  // Level with the menu button, as on Windows.
  expect(Math.abs(back.top + back.height / 2 - (menu.top + menu.height / 2))).toBeLessThanOrEqual(1);
  const contents = page.locator('.reader-contents');
  await expect(contents).toBeVisible();
  expect((await rect(page, '.reader-contents')).top).toBe(56 + MAC_INSET);
});

test('the tutorial on a Mac: the drag tip points past the tabs, not at the traffic lights', async ({ page }) => {
  await boot(page, 'macos');
  await page.locator('body').press('?');
  const drag = page.locator('[data-tip="drag"]');
  await expect(drag).toBeVisible();
  await expect.poll(async () => (await drag.getAttribute('style')) ?? '').not.toContain('visibility:hidden');
  const tip = await rect(page, '[data-tip="drag"]');
  const end = await rect(page, '.tabbar .new-tab');
  expect(tip.left + tip.width / 2).toBeGreaterThan(end.right);
});

test('on a tiling Linux desktop there are no window buttons, aura or resize grip', async ({ page }) => {
  await boot(page, 'linux', {}, true);
  await expect(page.locator('body')).toHaveClass(/(^| )tiling-desktop( |$)/);
  await expect(page.locator('.titlebar-controls')).toBeHidden();
  await expect(page.locator('.controls-aura')).toBeHidden();
  await expect(page.locator('.resize-grip')).toBeHidden();
  // Floating windows still move from the top edge.
  await expect(page.locator('.titlebar-drag')).toBeVisible();
});

// Linux draws the wordmark in the desktop's own sans-serif, which may be much
// wider than Windows' Segoe UI. A larger wordmark stands in for one here, so
// the test means the same thing on any machine's fonts.
async function bootWithWideWordmark(browser: Browser, os: OS) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  await page.addInitScript(() => {
    const widen = () => {
      const style = document.createElement('style');
      style.textContent = '.menu-root .wordmark { font-size: 26px !important; }';
      document.head.append(style);
    };
    if (document.head) widen(); else document.addEventListener('DOMContentLoaded', widen);
  });
  await boot(page, os);
  return page;
}

test('on Linux the top tabs start clear of the unfolded wordmark, however wide its font', async ({ browser }) => {
  const linux = await bootWithWideWordmark(browser, 'linux');
  const win = await bootWithWideWordmark(browser, 'windows');
  try {
    await linux.locator('.hamburger').hover();
    await linux.waitForTimeout(700); // fully unfolded
    const mark = await rect(linux, '.menu-root .wordmark');
    const tab = await rect(linux, '[role="tab"]');
    expect(mark.right).toBeGreaterThan(178); // past where the tabs start on Windows
    expect(mark.right).toBeLessThan(tab.left);
    // Windows keeps its fixed layout whatever the font.
    expect((await rect(win, '.tabbar')).left).toBe(174);
  } finally {
    await linux.close();
    await win.close();
  }
});

test('on a regular Linux desktop the chrome looks exactly like Windows', async ({ page }) => {
  await boot(page, 'linux', {}, false);
  await expect(page.locator('.titlebar-controls')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(page.locator('.resize-grip')).toBeVisible();
  await expect(page.locator('.titlebar-drag')).toBeVisible();
  expect((await rect(page, '.hamburger')).top).toBe(14);
});
