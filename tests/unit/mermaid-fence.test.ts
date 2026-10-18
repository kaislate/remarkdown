// Every fence spelling that means "mermaid" must be a diagram in BOTH
// the reader and the editor — and the editor must write the fence's
// info string back exactly as it found it.
import { describe, it, expect } from 'vitest';
import { isMermaidFence } from '../../src/lib/mermaid-fence';
import { render } from '../../src/lib/MarkdownRenderer';
import { createEditorView } from '../../src/lib/editor/view';
import { parseMarkdown, serializeToMarkdown } from '../../src/lib/editor/markdown';

const VARIANTS = ['mermaid', 'Mermaid', 'MERMAID', 'mermaid title="extra info"', '  mermaid  ', 'mermaid {.wide}'];

describe('isMermaidFence', () => {
  it.each(VARIANTS)('treats %j as mermaid', (info) => {
    expect(isMermaidFence(info)).toBe(true);
  });
  it.each(['', 'js', 'mermaidx', 'not-mermaid', 'text mermaid'])('does not treat %j as mermaid', (info) => {
    expect(isMermaidFence(info)).toBe(false);
  });
});

describe('reader', () => {
  it.each(VARIANTS)('renders a %j fence as a diagram placeholder, not code', async (info) => {
    const { html } = await render('```' + info + '\nflowchart LR\n  A --> B\n```\n');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const block = doc.querySelector<HTMLElement>('.mermaid-block');
    expect(block).not.toBeNull();
    expect(block!.dataset.mermaid).toBe('flowchart LR\n  A --> B\n');
    expect(doc.querySelector('pre')).toBeNull();
  });

  it('still renders tilde fences and nested (list / quote) fences as diagrams', async () => {
    const md = '~~~mermaid\nflowchart LR\nA-->B\n~~~\n\n- item\n\n  ```mermaid\n  flowchart LR\n  C-->D\n  ```\n\n> ```Mermaid\n> flowchart LR\n> E-->F\n> ```\n';
    const { html } = await render(md);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('.mermaid-block').length).toBe(3);
    expect(doc.querySelector('pre')).toBeNull();
  });
});

describe('editor', () => {
  it.each(VARIANTS)('uses the diagram NodeView (never a code block) for %j', (info) => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = createEditorView(parent, '```' + info + '\nflowchart LR\nA --> B\n```\n', () => {});
    expect(parent.querySelector('.mermaid-block-editor')).not.toBeNull();
    expect(parent.querySelector('pre.code-block-editor')).toBeNull();
    view.destroy();
    parent.remove();
  });

  it.each(['Mermaid', 'mermaid title="extra info"', 'mermaid {.wide}'])(
    'writes the %j info string back unchanged',
    (info) => {
      const md = '# T\n\n```' + info + '\nflowchart LR\nA --> B\n```\n';
      expect(serializeToMarkdown(parseMarkdown(md))).toContain('```' + info + '\nflowchart LR\nA --> B\n```');
    },
  );
});
