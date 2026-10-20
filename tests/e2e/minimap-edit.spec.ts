import { test, expect, type Page } from '@playwright/test';

// While editing, the minimap's box must still stand for exactly what's on
// screen. Diagrams are taller in edit mode (they carry their editing
// controls), so a minimap that kept showing the reading layout drifted
// further off with every diagram above the fold.

const PATH = '/e2e/minimap/Diagrams.md';
const PROSE = 'Some prose that goes on for a while so the page scrolls along nicely. '.repeat(10);
const DOC = '# Diagrams\n\n' + Array.from({ length: 6 }, (_, i) =>
  `## Part ${i + 1}\n\n${PROSE}\n\n\`\`\`mermaid\nflowchart LR\n  A${i}[Start] --> B${i}{Check}\n  B${i} --> C${i}[Done]\n\`\`\`\n\n${PROSE}\n`).join('\n');

async function open(page: Page) {
  await page.goto('/');
  await page.evaluate(([p, md]) => {
    (window as any).__E2E_SEED_DOC__(p, md);
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, [PATH, DOC]);
  await expect(page.locator('.viewer h1')).toHaveText('Diagrams');
}

// Where heading `i` sits inside the box (as a share of the box's height)
// versus where it sits on screen (as a share of the visible page).
function headingPlacement(page: Page, i: number) {
  return page.evaluate((i) => {
    const scroll = document.querySelector('.scroll') as HTMLElement;
    const sr = scroll.getBoundingClientRect();
    const onPage = Array.from(document.querySelectorAll('.editor-surface h2'))[i] as HTMLElement;
    const inMap = Array.from(document.querySelectorAll('.minimap-content h2'))[i] as HTMLElement;
    const box = (document.querySelector('.viewport-indicator') as HTMLElement).getBoundingClientRect();
    return {
      page: (onPage.getBoundingClientRect().top - sr.top) / scroll.clientHeight,
      map: (inMap.getBoundingClientRect().top - box.top) / box.height,
      boxPx: box.height,
    };
  }, i);
}

test('in edit mode the minimap box matches the page, all the way down past the diagrams', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.locator('.viewer .mermaid-block svg')).toHaveCount(6);
  await page.locator('.edit-mode-toggle').click();
  await expect(page.locator('.editor-surface .ProseMirror')).toBeVisible();
  await expect(page.locator('.editor-surface .mermaid-rendered svg')).toHaveCount(6);
  await page.waitForTimeout(600); // the minimap's snapshot debounce + layout

  for (const i of [1, 3, 5]) {
    // Bring heading i to a third of the way down the page.
    await page.evaluate((i) => {
      const scroll = document.querySelector('.scroll') as HTMLElement;
      const h = Array.from(document.querySelectorAll('.editor-surface h2'))[i] as HTMLElement;
      scroll.scrollTop += h.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientHeight / 3;
    }, i);
    await page.waitForTimeout(120);
    const m = await headingPlacement(page, i);
    // Within one map pixel.
    expect(Math.abs(m.map - m.page) * m.boxPx, `heading ${i + 1}`).toBeLessThanOrEqual(1.5);
  }
});
