import { describe, it, expect, beforeEach } from 'vitest';
import { createAnchor, resolveAnchor, type Anchor } from '../../src/lib/anchoring';

// Small helper: build a viewer root from HTML for testing.
function buildRoot(html: string): HTMLElement {
  const root = document.createElement('article');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

// Helper: build a Range selecting `text` inside block with id `blockId`.
function rangeOf(root: HTMLElement, blockId: string, text: string): Range {
  const block = root.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const tn = walker.currentNode as Text;
    const idx = tn.data.indexOf(text);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(tn, idx);
      range.setEnd(tn, idx + text.length);
      return range;
    }
  }
  throw new Error(`text ${JSON.stringify(text)} not found in block ${blockId}`);
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('createAnchor', () => {
  it('captures text, prefix, suffix, and blockHint', () => {
    const root = buildRoot(
      '<p data-block-id="p:1">The reader who would truly understand must read slowly, and with care, turning the pages back when needed.</p>'
    );
    const range = rangeOf(root, 'p:1', 'must read slowly, and with care');
    const anchor = createAnchor(range, root);
    expect(anchor?.text).toBe('must read slowly, and with care');
    expect(anchor?.prefix).toMatch(/truly understand $/);
    expect(anchor?.suffix).toMatch(/^, turning the pages/);
    expect(anchor?.blockHint).toBe('p:1');
  });

  it('returns empty prefix when range starts at block beginning', () => {
    const root = buildRoot('<p data-block-id="p:1">Hello world and beyond.</p>');
    const range = rangeOf(root, 'p:1', 'Hello');
    const anchor = createAnchor(range, root);
    expect(anchor?.prefix).toBe('');
    expect(anchor?.text).toBe('Hello');
  });

  it('returns empty suffix when range ends at block end', () => {
    const root = buildRoot('<p data-block-id="p:1">The end of the story.</p>');
    const range = rangeOf(root, 'p:1', 'story.');
    const anchor = createAnchor(range, root);
    expect(anchor?.suffix).toBe('');
  });

  it('spans inline formatting (range across <em> boundary)', () => {
    const root = buildRoot(
      '<p data-block-id="p:1">Prefix before <em>the emphasized part</em> and after.</p>'
    );
    // Select "the emphasized part and after" — crosses the </em> boundary.
    const block = root.querySelector('[data-block-id="p:1"]') as HTMLElement;
    const em = block.querySelector('em')!.firstChild as Text;
    const tail = em.parentElement!.nextSibling as Text;
    const range = document.createRange();
    range.setStart(em, 0);
    range.setEnd(tail, ' and after'.length);
    const anchor = createAnchor(range, root);
    expect(anchor?.text).toBe('the emphasized part and after');
    expect(anchor?.prefix).toBe('Prefix before ');
    expect(anchor?.suffix).toBe('.');
  });

  it('returns null when range is not inside any data-block-id ancestor', () => {
    const root = buildRoot('<p>No block id here.</p>');
    // Simulate a range not inside a block.
    const bare = document.createElement('span');
    bare.textContent = 'orphan text';
    document.body.appendChild(bare);
    const r = document.createRange();
    r.selectNodeContents(bare.firstChild!);
    const anchor = createAnchor(r, root);
    expect(anchor).toBeNull();
  });
});

describe('resolveAnchor — fast path (doc unchanged)', () => {
  it('resolves an anchor back to a Range with the same text', () => {
    const root = buildRoot(
      '<p data-block-id="p:1">The reader must read slowly, and with care, to understand.</p>'
    );
    const original = rangeOf(root, 'p:1', 'read slowly, and with care');
    const anchor = createAnchor(original, root);
    expect(anchor).not.toBeNull();

    const resolved = resolveAnchor(anchor!, root);
    expect(resolved).not.toBeNull();
    expect(resolved!.toString()).toBe('read slowly, and with care');
  });
});

describe('resolveAnchor — slow path (doc changed)', () => {
  it('finds the text when prefix has been edited but text and suffix survive', () => {
    // Create anchor from one doc.
    const r1 = buildRoot(
      '<p data-block-id="p:1">The reader must read slowly, and with care, to understand.</p>'
    );
    const range = rangeOf(r1, 'p:1', 'read slowly, and with care');
    const anchor = createAnchor(range, r1)!;
    document.body.innerHTML = '';

    // New doc — prefix edited but target phrase present with surrounding context.
    const r2 = buildRoot(
      '<p data-block-id="p:1">Every reader should read slowly, and with care, if they hope to understand.</p>'
    );
    const resolved = resolveAnchor(anchor, r2);
    expect(resolved).not.toBeNull();
    expect(resolved!.toString()).toBe('read slowly, and with care');
  });

  it('returns null when the text has been deleted entirely', () => {
    const r1 = buildRoot(
      '<p data-block-id="p:1">Some context. The important phrase. More context.</p>'
    );
    const range = rangeOf(r1, 'p:1', 'The important phrase');
    const anchor = createAnchor(range, r1)!;
    document.body.innerHTML = '';

    const r2 = buildRoot(
      '<p data-block-id="p:1">Some context. More context.</p>'
    );
    const resolved = resolveAnchor(anchor, r2);
    expect(resolved).toBeNull();
  });

  it('disambiguates between two identical phrases using prefix/suffix', () => {
    const r1 = buildRoot(
      '<p data-block-id="p:1">First context around the phrase here. Second context around the phrase there.</p>'
    );
    // Select the second occurrence.
    const block = r1.querySelector('[data-block-id="p:1"]')!;
    const tn = block.firstChild as Text;
    const firstIdx = tn.data.indexOf('the phrase');
    const idx2 = tn.data.indexOf('the phrase', firstIdx + 1);
    const r = document.createRange();
    r.setStart(tn, idx2);
    r.setEnd(tn, idx2 + 'the phrase'.length);
    const anchor = createAnchor(r, r1)!;
    document.body.innerHTML = '';

    // Same doc reloaded.
    const r2 = buildRoot(
      '<p data-block-id="p:1">First context around the phrase here. Second context around the phrase there.</p>'
    );
    const resolved = resolveAnchor(anchor, r2)!;
    expect(resolved).not.toBeNull();
    const secondIdx = r2.textContent!.indexOf('the phrase', r2.textContent!.indexOf('the phrase') + 1);
    const beforeText = r2.textContent!.slice(0, secondIdx);
    expect(beforeText).toMatch(/Second context/);
  });

  it('returns null when two candidates tie in score (cannot disambiguate)', () => {
    // Both occurrences have the same surrounding context — truly ambiguous.
    const r1 = buildRoot(
      '<p data-block-id="p:1">prefix target suffix prefix target suffix</p>'
    );
    const block = r1.querySelector('[data-block-id="p:1"]')!;
    const tn = block.firstChild as Text;
    const r = document.createRange();
    r.setStart(tn, tn.data.indexOf('target'));
    r.setEnd(tn, tn.data.indexOf('target') + 'target'.length);
    const anchor = createAnchor(r, r1)!;
    document.body.innerHTML = '';

    const r2 = buildRoot(
      '<p data-block-id="p:1">prefix target suffix prefix target suffix</p>'
    );
    const resolved = resolveAnchor(anchor, r2);
    expect(resolved).toBeNull();
  });

  it('still resolves even when blockHint block no longer exists', () => {
    const r1 = buildRoot(
      '<p data-block-id="p:3">A paragraph with a distinctive phrase inside.</p>'
    );
    const range = rangeOf(r1, 'p:3', 'distinctive phrase');
    const anchor = createAnchor(range, r1)!;
    document.body.innerHTML = '';

    // Doc restructured — the phrase moved to a different block.
    const r2 = buildRoot(
      '<h2 data-block-id="h:1">New heading</h2>' +
      '<p data-block-id="p:2">A paragraph with a distinctive phrase inside.</p>'
    );
    const resolved = resolveAnchor(anchor, r2);
    expect(resolved).not.toBeNull();
    expect(resolved!.toString()).toBe('distinctive phrase');
  });
});
