import { test, expect } from '@playwright/test';

// GitHub #24: double-clicking a .md file opened remarkdown on the welcome
// doc (or nothing) instead of the file. Rust queues the launch paths; the
// frontend must drain them on startup and when a running instance is told
// about more.

const A = '/e2e/launch-a.md';
const B = '/e2e/launch-b.md';

test('a file passed at launch opens instead of the empty / welcome state', async ({ page }) => {
  // Seed the document and the launch queue before any app code runs.
  await page.addInitScript(([path]) => {
    localStorage.setItem(`rmd-doc::${path}`, JSON.stringify({
      markdown: '# Launched file\n\nOpened from the command line.\n',
      sidecar_raw: null,
      sha256: '1'.repeat(64),
      bytes: 10,
    }));
    (window as any).__E2E_PENDING_OPENS__ = [path];
  }, [A]);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Launched file' })).toBeVisible();
  await expect(page.getByText(/Open a markdown file/i)).toHaveCount(0);
});

test('a second launch while running opens the new file', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(([a, b]) => {
    (window as any).__E2E_SEED_DOC__(a, '# First\n');
    (window as any).__E2E_SEED_DOC__(b, '# Second\n');
    (window as any).__E2E_QUEUE_OPENS__([a]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, [A, B]);
  await expect(page.getByRole('heading', { level: 1, name: 'First' })).toBeVisible();
  await page.evaluate(([b]) => {
    (window as any).__E2E_QUEUE_OPENS__([b]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, [B]);
  await expect(page.getByRole('heading', { level: 1, name: 'Second' })).toBeVisible();
});
