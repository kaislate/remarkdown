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

describe('MarkdownRenderer.render (image src rewriting)', () => {
  it('rewrites relative image srcs using the provided toAssetUrl function', async () => {
    const md = '![pic](./img/a.png)\n\n![other](../sibling/b.jpg)';
    const calls: string[] = [];
    const { html } = await render(md, {
      baseDir: '/tmp/doc',
      toAssetUrl: (abs) => {
        calls.push(abs);
        return `asset://localhost/${abs.replace(/^\//, '')}`;
      },
    });
    expect(html).toContain('asset://localhost/tmp/doc/img/a.png');
    expect(html).toContain('asset://localhost/tmp/sibling/b.jpg');
    expect(calls).toContain('/tmp/doc/img/a.png');
  });

  it('leaves absolute URLs (http/https/asset/data) untouched', async () => {
    const md = '![a](https://example.com/x.png)\n\n![b](data:image/png;base64,AAAA)';
    const { html } = await render(md, { baseDir: '/tmp/doc', toAssetUrl: () => 'NEVER' });
    expect(html).toContain('https://example.com/x.png');
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).not.toContain('NEVER');
  });

  it('leaves images as-is when no baseDir is provided', async () => {
    const { html } = await render('![x](./p.png)');
    expect(html).toContain('src="./p.png"');
  });
});

describe('MarkdownRenderer.render (mermaid)', () => {
  it('mermaid fence produces a .mermaid-block div with encoded data-mermaid attr', async () => {
    const src = '```mermaid\nflowchart TD\n    A[Start] --> B{Decision}\n```\n';
    const { html } = await render(src);
    expect(html).toMatch(/class="mermaid-block"/);
    expect(html).toMatch(/data-mermaid="/);
    // Source content should be encoded inside the attribute.
    expect(html).toContain('flowchart TD');
  });

  it('mermaid fence is NOT processed by Shiki (no shiki class present)', async () => {
    const src = '```mermaid\nsequenceDiagram\n    A->>B: Hello\n```\n';
    const { html } = await render(src);
    expect(html).not.toMatch(/class="shiki/);
    expect(html).not.toMatch(/language-mermaid/);
  });

  it('special chars in mermaid source survive round-trip through the data attr', async () => {
    const src = '```mermaid\ngraph LR\n    A["<Node>"] --> B\n```\n';
    const { html } = await render(src);
    expect(html).toMatch(/mermaid-block/);
    // Verify the data attribute value is present and the placeholder was created.
    expect(html).toMatch(/data-mermaid=/);
    // The attribute (as read from DOM via DOMParser) should contain the original source.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = doc.querySelector<HTMLElement>('.mermaid-block');
    expect(el).not.toBeNull();
    const source = el?.dataset.mermaid ?? '';
    expect(source).toContain('<Node>');
    expect(source).toContain('graph LR');
  });
});

describe('MarkdownRenderer.render (callouts)', () => {
  it('> [!note] produces callout-note div with default title "Note"', async () => {
    const src = '> [!note]\n> Body text\n';
    const { html } = await render(src);
    expect(html).toMatch(/class="callout callout-note"/);
    expect(html).toMatch(/data-callout="note"/);
    expect(html).toContain('Note');
    // Should not render a plain blockquote.
    expect(html).not.toMatch(/<blockquote/);
  });

  it('> [!warning] Custom title produces callout with custom title', async () => {
    const src = '> [!warning] Be careful here\n> Body\n';
    const { html } = await render(src);
    expect(html).toMatch(/class="callout callout-warning"/);
    expect(html).toContain('Be careful here');
    expect(html).not.toContain('Warning');
  });

  it('> [!tip]+ produces foldable callout that starts open', async () => {
    const src = '> [!tip]+\n> Body\n';
    const { html } = await render(src);
    expect(html).toMatch(/class="callout callout-tip"/);
    // Fold button should be present.
    expect(html).toMatch(/class="callout-fold"/);
    // Body should NOT have hidden attr when starting open.
    expect(html).not.toMatch(/callout-body"[^>]*hidden/);
    expect(html).not.toMatch(/callout-body hidden/);
    // Chevron pointing down = open state.
    expect(html).toContain('▾');
  });

  it('> [!info]- produces foldable callout that starts closed', async () => {
    const src = '> [!info]-\n> Body\n';
    const { html } = await render(src);
    expect(html).toMatch(/class="callout callout-info"/);
    expect(html).toMatch(/class="callout-fold"/);
    // Body should have hidden attr.
    expect(html).toMatch(/callout-body"[^>]*hidden/);
    // Chevron pointing right = closed state.
    expect(html).toContain('▸');
  });

  it('regular blockquote without [!type] still renders as <blockquote>', async () => {
    const src = '> Just a regular quote\n';
    const { html } = await render(src);
    expect(html).toMatch(/<blockquote/);
    expect(html).not.toContain('callout');
  });

  it('callout body content renders after stripping the marker line', async () => {
    const src = '> [!note]\n> This is the body\n';
    const { html } = await render(src);
    expect(html).toContain('This is the body');
    // Marker itself should not appear in output.
    expect(html).not.toContain('[!note]');
  });
});

describe('MarkdownRenderer.render (regression fixes)', () => {
  it('highlights all occurrences of a repeated identical code fence', async () => {
    const src = '```ts\nconst x = 1;\n```\n\n```ts\nconst x = 1;\n```';
    const { html } = await render(src);
    const matches = html.match(/class="shiki[^"]*github-dark/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('highlights a fence with a non-word language identifier (c++)', async () => {
    // Shiki's canonical name is "cpp", but markdown-it will emit class="language-c++".
    // The regex must match — whether it's highlighted with real cpp grammar depends on Shiki's
    // language aliases, but the test pins that the fence is recognized and transformed.
    const src = '```c++\nint x = 1;\n```';
    const { html } = await render(src);
    // Should no longer render as plain <pre><code class="language-c++">
    expect(html).not.toMatch(/class="language-c\+\+"/);
  });

  it('leaves a Windows drive-letter image path untouched (treats as absolute)', async () => {
    const md = '![x](C:/Users/me/img.png)';
    const { html } = await render(md, {
      baseDir: '/tmp/doc',
      toAssetUrl: (p) => `asset://${p}`,
    });
    // The drive-letter path is NOT joined to baseDir — it's left as-is so Tauri/webview can resolve.
    expect(html).toContain('src="C:/Users/me/img.png"');
    expect(html).not.toContain('/tmp/doc/C:');
  });

  it('normalizes backslashes in relative image paths before joining', async () => {
    const md = '![x](.\\\\img\\\\a.png)';
    const { html } = await render(md, {
      baseDir: '/tmp/doc',
      toAssetUrl: (p) => `asset://${p}`,
    });
    expect(html).toContain('asset:///tmp/doc/img/a.png');
  });
});
