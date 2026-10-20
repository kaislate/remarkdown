import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { serializeDocToMarkdown } from '../../../src/lib/editor/serializer';
import { editorSchema } from '../../../src/lib/editor/schema';
import { MathInlineView, MathBlockView, FrontMatterView, formulaHtml } from '../../../src/lib/editor/source-node-views';
import { render } from '../../../src/lib/MarkdownRenderer';
import { frontMatterFields } from '../../../src/lib/markdown-it-frontmatter';

const roundTrip = (md: string) => serializeDocToMarkdown(parseMarkdownToDoc(md));

describe('formulas and document details survive an edit-mode save, exactly', () => {
  const exact: Record<string, string> = {
    'front matter': '---\ntitle: My notes\ntags: [a, b]\n---\n\n# Heading\n\nBody.\n',
    'front matter closed with ...': '---\ntitle: x\nlist:\n  - one\n  - two\n...\n\nText.\n',
    'inline maths': 'Euler: $e^{i\\pi} + 1 = 0$ and $a_1 * b_2$.\n',
    'a maths block': '$$\n\\sum_{i=1}^{n} x_i^2\n$$\n',
    'a one-line maths block': '$$x^2 + y^2$$\n',
    '$$ within a line': 'Here $$a_b$$ inline.\n',
    'a multi-line block with underscores and stars': '$$\n\\begin{aligned}\na_1 &= b * c \\\\\nd_2 &= e\n\\end{aligned}\n$$\n',
    'a document that merely starts with a rule': '---\n\nJust a rule.\n',
    'dollar amounts': 'It costs $5 and $6 today.\n',
    // Not maths, but the same promise: lists keep their own marker.
    'dash bullets': '- one\n- two\n',
    'plus bullets': '+ one\n+ two\n',
  };
  for (const [name, md] of Object.entries(exact)) {
    it(name, () => expect(roundTrip(md)).toBe(md));
  }

  it('maths inside a quote or a list keeps its place', () => {
    expect(roundTrip('> [!note]\n> $$\n> a_1 * b\n> $$\n')).toContain('> $$\n> a_1 * b\n> $$');
    expect(roundTrip('- item\n\n  $$\n  x_1\n  $$\n')).toContain('  $$\n  x_1\n  $$');
  });

  it('parses into their own nodes, text untouched', () => {
    const doc = parseMarkdownToDoc('---\ntitle: T\n---\n\nSee $a_1$.\n\n$$\nx * y\n$$\n');
    expect(doc.child(0).type.name).toBe('front_matter');
    expect(doc.child(0).attrs.content).toBe('title: T\n');
    expect(doc.child(1).child(1).type.name).toBe('math_inline');
    expect(doc.child(1).child(1).attrs.tex).toBe('a_1');
    expect(doc.child(2).type.name).toBe('math_block');
    expect(doc.child(2).attrs.tex).toBe('x * y');
  });

  it('a changed formula or detail is written back in the same form', () => {
    const doc = parseMarkdownToDoc('---\ntitle: T\n---\n\nSee $a$.\n');
    const state = EditorState.create({ doc });
    const tr = state.tr
      .setNodeMarkup(0, undefined, { content: 'title: New\nauthor: Me\n', close: '---' })
      .setNodeMarkup(doc.child(0).nodeSize + 5, undefined, { tex: 'b^2', display: false });
    expect(serializeDocToMarkdown(tr.doc)).toBe('---\ntitle: New\nauthor: Me\n---\n\nSee $b^2$.\n');
  });
});

describe('in the reader', () => {
  it('front matter is folded away as "Document details", not a rule and a heading', async () => {
    const { html, blocks } = await render('---\ntitle: My notes\ntags:\n  - a\n  - b\n---\n\n# Heading\n');
    expect(html).toContain('<details class="front-matter"');
    expect(html).toContain('<summary>Document details</summary>');
    expect(html).toContain('<dt>title</dt><dd>My notes</dd>');
    expect(html).not.toContain('<hr');
    expect(blocks[1]).toBe('h:2');
  });

  it('reads the fields people expect', () => {
    expect(frontMatterFields('title: "Quoted"\ntags:\n  - a\n  - b\ndraft: true\n')).toEqual([
      { key: 'title', value: 'Quoted' },
      { key: 'tags', value: 'a, b' },
      { key: 'draft', value: 'true' },
    ]);
  });
});

describe('in the editor', () => {
  function mountView(md: string) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return new EditorView(parent, {
      state: EditorState.create({ doc: parseMarkdownToDoc(md), schema: editorSchema }),
      nodeViews: {
        math_inline: (n, v, g) => new MathInlineView(n, v, g),
        math_block: (n, v, g) => new MathBlockView(n, v, g),
        front_matter: (n, v, g) => new FrontMatterView(n, v, g),
      },
    });
  }

  it('formulas are drawn, and a mistake shows the TeX instead of breaking', () => {
    const view = mountView('A $x^2$ here.\n\n$$\n\\frac{1}{2}\n$$\n');
    expect(view.dom.querySelector('.math-inline .katex')).not.toBeNull();
    expect(view.dom.querySelector('.math-block .katex-display')).not.toBeNull();
    expect(formulaHtml('\\frac{1', false)).toContain('math-error');
    view.destroy();
  });

  it('clicking a formula opens it for changing; saving writes the new TeX', async () => {
    let saved = '';
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView(parent, {
      state: EditorState.create({ doc: parseMarkdownToDoc('A $x$ here.\n') }),
      nodeViews: { math_inline: (n, v, g) => new MathInlineView(n, v, g) },
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
        saved = serializeDocToMarkdown(view.state.doc);
      },
    });
    (view.dom.querySelector('.math-inline') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    const box = document.querySelector<HTMLTextAreaElement>('.source-popover textarea')!;
    expect(box.value).toBe('x');
    box.value = 'y_1';
    box.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.source-popover .preview .katex')).not.toBeNull();
    (Array.from(document.querySelectorAll<HTMLButtonElement>('.source-popover button')).find((b) => b.textContent === 'Save'))!.click();
    expect(saved).toBe('A $y_1$ here.\n');
    view.destroy();
  });

  it('document details show as a quiet list', () => {
    const view = mountView('---\ntitle: T\nauthor: Me\n---\n\nBody.\n');
    const card = view.dom.querySelector('.front-matter-block')!;
    expect(card.textContent).toContain('Document details');
    expect(Array.from(card.querySelectorAll('dt')).map((d) => d.textContent)).toEqual(['title', 'author']);
    view.destroy();
  });
});
