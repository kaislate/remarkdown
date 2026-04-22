import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '../../src/lib/MarkdownRenderer';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures', name), 'utf-8');

describe('MarkdownRenderer.render (core)', () => {
  it('returns html, plaintext, and blocks for a simple document', async () => {
    const result = await render(fixture('simple.md'));
    expect(result.html).toContain('<h1');
    expect(result.html).toContain('Heading');
    expect(result.plaintext).toContain('First paragraph with bold and italic.');
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('tags top-level children with data-block-id', async () => {
    const { html } = await render('# A\n\nB\n\nC');
    // Expect something like id="h:1", "p:2", "p:3"
    expect(html).toMatch(/data-block-id="h:1"/);
    expect(html).toMatch(/data-block-id="p:2"/);
    expect(html).toMatch(/data-block-id="p:3"/);
  });

  it('block ids are stable across renders of the same input', async () => {
    const a = await render(fixture('simple.md'));
    const b = await render(fixture('simple.md'));
    expect(a.blocks).toEqual(b.blocks);
  });
});

describe('MarkdownRenderer.render (plugins: footnote/tasklist/tables)', () => {
  it('renders task-list checkboxes as input[type=checkbox]', async () => {
    const { html } = await render(fixture('tables.md'));
    expect(html).toMatch(/<input[^>]*checked[^>]*type="checkbox"/);
    expect(html).toMatch(/<input[^>]*type="checkbox"(?![^>]*checked)/);
  });

  it('renders footnote references and footnote section', async () => {
    const { html } = await render(fixture('tables.md'));
    expect(html).toMatch(/footnote-ref/);
    expect(html).toMatch(/footnotes/);
  });

  it('renders GFM tables', async () => {
    const { html } = await render(fixture('tables.md'));
    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<tbody');
  });
});

describe('MarkdownRenderer.render (KaTeX)', () => {
  it('renders inline math as KaTeX HTML', async () => {
    const { html } = await render(fixture('math.md'));
    expect(html).toMatch(/class="katex"/);
  });

  it('renders display math in a block container', async () => {
    const { html } = await render(fixture('math.md'));
    expect(html).toMatch(/katex-display/);
  });
});

describe('MarkdownRenderer.render (Shiki)', () => {
  it('highlights a TypeScript code fence with Shiki output (pre.shiki class)', async () => {
    const { html } = await render(fixture('code.md'));
    expect(html).toMatch(/class="shiki[^"]*github-dark/);
    expect(html).toMatch(/<span[^>]*style="color:/);
  });

  it('falls back to a plain <pre><code> for fences without a language', async () => {
    const { html } = await render('```\njust text\n```\n');
    expect(html).toMatch(/<pre[^>]*><code>just text\n<\/code><\/pre>/);
  });
});
