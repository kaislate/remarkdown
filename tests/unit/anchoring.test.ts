import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAnchor, resolveAnchor, resolvingPass, type Anchor } from '../../src/lib/anchoring';

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

  it('returns null when slow-path candidates tie (cannot disambiguate)', () => {
    // Build an anchor in one doc, then reload a doc where the blockHint is gone
    // AND two remaining blocks contain identical `target` in identical context.
    // Slow path should find both, score them equally, and reject due to MIN_GAP.
    const r1 = buildRoot(
      '<p data-block-id="p:99">context-here target context-here</p>'
    );
    const range = rangeOf(r1, 'p:99', 'target');
    const anchor = createAnchor(range, r1)!;
    document.body.innerHTML = '';

    const r2 = buildRoot(
      '<p data-block-id="p:1">context-here target context-here</p>' +
      '<p data-block-id="p:2">context-here target context-here</p>'
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

// Highlights that span paragraphs (#multi-block): the selection's text
// includes both paragraphs and the newline between them, so it can only be
// found again in the article's full text, not inside one block.
describe('anchors across several blocks', () => {
  const HTML =
    '<h1 data-block-id="h:1">Title</h1>\n' +
    '<p data-block-id="p:1">The first paragraph ends here.</p>\n' +
    '<p data-block-id="p:2">The second paragraph starts here.</p>\n' +
    '<p data-block-id="p:3">A third one.</p>';

  function crossRange(root: HTMLElement): Range {
    const a = rangeOf(root, 'p:1', 'ends here.');
    const b = rangeOf(root, 'p:2', 'The second');
    const r = document.createRange();
    r.setStart(a.startContainer, a.startOffset);
    r.setEnd(b.endContainer, b.endOffset);
    return r;
  }

  it('records the end block and context from the surrounding text', () => {
    const root = buildRoot(HTML);
    const a = createAnchor(crossRange(root), root)!;
    expect(a.blockHint).toBe('p:1');
    expect(a.endBlockHint).toBe('p:2');
    expect(a.text).toBe('ends here.\nThe second');
    expect(a.prefix.endsWith('The first paragraph ')).toBe(true);
    expect(a.suffix.startsWith(' paragraph starts')).toBe(true);
  });

  it('resolves after a reload (fresh DOM) to the same text', () => {
    const a = createAnchor(crossRange(buildRoot(HTML)), document.body)!;
    document.body.innerHTML = '';
    const root = buildRoot(HTML);
    const r = resolveAnchor(a, root);
    expect(r).not.toBeNull();
    expect(r!.toString()).toBe('ends here.\nThe second');
  });

  it('still resolves when text elsewhere in the document changed', () => {
    const a = createAnchor(crossRange(buildRoot(HTML)), document.body)!;
    document.body.innerHTML = '';
    const root = buildRoot(HTML.replace('A third one.', 'A rewritten third paragraph.'));
    expect(resolveAnchor(a, root)!.toString()).toBe('ends here.\nThe second');
  });

  it('is orphaned when the spanned text is gone', () => {
    const a = createAnchor(crossRange(buildRoot(HTML)), document.body)!;
    document.body.innerHTML = '';
    const root = buildRoot(HTML.replace('The second paragraph', 'Another paragraph'));
    expect(resolveAnchor(a, root)).toBeNull();
  });

  it('recovers highlights saved by older versions (no end block recorded) when unambiguous', () => {
    const legacy: Anchor = {
      text: 'ends here.\nThe second',
      prefix: 'The first paragraph ',
      suffix: '', // older versions clamped context to the first block
      blockHint: 'p:1',
    };
    const root = buildRoot(HTML);
    expect(resolveAnchor(legacy, root)!.toString()).toBe('ends here.\nThe second');
  });
});

describe('cross-block anchors over a diagram', () => {
  const svg = (id: string) =>
    `<svg id="${id}"><style>#${id}{fill:#333}</style><g><text>Start</text><text>End</text></g></svg>`;

  it('ignore the diagram, so the highlight survives the diagram being redrawn', () => {
    const root = buildRoot(
      `<p data-block-id="p:1">Before the chart we explain things.</p>\n` +
      `<div class="mermaid-block" data-block-id="div:2">${svg('mermaid-1')}</div>\n` +
      `<p data-block-id="p:3">After the chart we conclude.</p>\n`,
    );
    const p1 = root.querySelector('[data-block-id="p:1"]')!.firstChild as Text;
    const p3 = root.querySelector('[data-block-id="p:3"]')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(p1, 7);
    range.setEnd(p3, 15); // ends after "After the chart"
    const a = createAnchor(range, root)!;
    expect(a.text).not.toMatch(/mermaid|fill|Start|End/);
    expect(a.text).toContain('the chart we explain things.');
    expect(a.text).toContain('After the chart');
    // Next launch: drawn again with a new id (and briefly empty before that).
    root.querySelector('.mermaid-block')!.innerHTML = '';
    expect(resolveAnchor(a, root)).not.toBeNull();
    root.querySelector('.mermaid-block')!.innerHTML = svg('mermaid-7');
    expect(resolveAnchor(a, root)).not.toBeNull();
  });
});

// A crafted sidecar can hold thousands of one-letter anchors. Scoring every
// place a letter occurs in a long article, for each of them, froze the app
// for minutes; the work per anchor has to stay small however common its text.
describe('anchors whose text is everywhere', () => {
  const words = ['the', 'reader', 'sees', 'every', 'line', 'here', 'before', 'we', 'edit'];
  // About 330 KB of text, with tens of thousands of each common letter.
  const longText = (): string => {
    const out: string[] = [];
    for (let i = 0; out.join(' ').length < 1000; i++) out.push(words[i % words.length]);
    const chunk = out.join(' ') + ' ';
    return chunk.repeat(330);
  };

  it('resolve quickly, even thousands of them over a long article', () => {
    const root = buildRoot(
      `<p data-block-id="p:1">${longText()}</p><p data-block-id="p:2">${longText()}</p>`,
    );
    const anchor: Anchor = { text: 'e', prefix: '', suffix: '', blockHint: 'p:1', endBlockHint: 'p:2' };
    const start = performance.now();
    // As the annotation store resolves them: in one pass over the article.
    resolvingPass(() => {
      for (let i = 0; i < 2_000; i++) resolveAnchor(anchor, root);
    });
    // Scoring every "e" took about 15 ms per anchor; this is 2,000 of them.
    expect(performance.now() - start).toBeLessThan(3_000);
  });

  it('stay quick on the per-block path too', () => {
    const root = buildRoot(`<p data-block-id="p:1">${longText()}</p>`);
    const anchor: Anchor = { text: 'e', prefix: 'x', suffix: 'y', blockHint: 'gone' };
    const start = performance.now();
    resolvingPass(() => {
      for (let i = 0; i < 2_000; i++) resolveAnchor(anchor, root);
    });
    expect(performance.now() - start).toBeLessThan(3_000);
  });

  it('still resolve when their whole context is found in exactly one place', () => {
    const root = buildRoot(
      `<p data-block-id="p:1">${longText()}</p><p data-block-id="p:2">a unique marker sentence. ${longText()}</p>`,
    );
    const anchor: Anchor = { text: 'e', prefix: 'a uniqu', suffix: ' marker', blockHint: 'gone' };
    const range = resolveAnchor(anchor, root);
    expect(range?.toString()).toBe('e');
    const block = (range!.startContainer.parentElement as HTMLElement).dataset.blockId;
    expect(block).toBe('p:2');
    expect(range!.startOffset).toBe('a uniqu'.length);
  });

  // Turning a found offset back into a place in the page walked every text
  // node of the article, twice per anchor: about 70 ms an anchor on a long
  // article in Chromium, minutes for a sidecar of cross-paragraph anchors.
  // Inside a pass each scope is walked once, however many anchors land in it.
  it('walk the article once per pass, not once per anchor', () => {
    const paras = Array.from({ length: 60 }, (_, i) => `<p data-block-id="p:${i}">Paragraph ${i} says its piece.</p>`);
    const root = buildRoot(paras.join(''));
    const across = document.createRange();
    across.setStart(root.querySelector('[data-block-id="p:40"]')!.firstChild!, 13);
    across.setEnd(root.querySelector('[data-block-id="p:41"]')!.firstChild!, 9);
    const crossing = createAnchor(across, root)!;
    const within = createAnchor(rangeOf(root, 'p:50', 'its piece'), root)!;
    const expected = [across.toString(), 'its piece'];

    const walkers = vi.spyOn(document, 'createTreeWalker');
    try {
      const found = resolvingPass(() => {
        const out: Array<string | undefined> = [];
        for (let i = 0; i < 100; i++) {
          out.push(resolveAnchor(crossing, root)?.toString(), resolveAnchor(within, root)?.toString());
        }
        return out;
      });
      expect(found).toEqual(Array.from({ length: 100 }, () => expected).flat());
      // One walk of the article (its text and where each node starts) and one
      // of the paragraph, instead of two for every anchor.
      expect(walkers.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      walkers.mockRestore();
    }
  });

  it('find an offset at the edge between two text nodes the same way inside a pass', () => {
    const root = buildRoot(
      '<p data-block-id="p:1">one <b>two</b><i></i> three</p><p data-block-id="p:2">four <em>five</em> six</p>',
    );
    const across = document.createRange();
    across.setStart(root.querySelector('b')!.firstChild!, 3);
    across.setEnd(root.querySelector('em')!.firstChild!, 0);
    const anchor = createAnchor(across, root)!;
    const outside = resolveAnchor(anchor, root)!;
    const inside = resolvingPass(() => resolveAnchor(anchor, root))!;
    expect(inside.startContainer).toBe(outside.startContainer);
    expect(inside.startOffset).toBe(outside.startOffset);
    expect(inside.endContainer).toBe(outside.endContainer);
    expect(inside.endOffset).toBe(outside.endOffset);
  });

  it('give the same answer inside a pass as outside one', () => {
    const root = buildRoot(
      '<p data-block-id="p:1">One fish, two fish.</p><p data-block-id="p:2">Red fish, blue fish.</p>',
    );
    const anchor = createAnchor(rangeOf(root, 'p:2', 'blue'), root)!;
    const outside = resolveAnchor(anchor, root)?.toString();
    const inside = resolvingPass(() => resolveAnchor(anchor, root)?.toString());
    expect(inside).toBe('blue');
    expect(inside).toBe(outside);
  });

  it('are orphaned when their context is found nowhere, or in several places', () => {
    const root = buildRoot(`<p data-block-id="p:1">${longText()}</p>`);
    expect(resolveAnchor({ text: 'e', prefix: 'zzz', suffix: 'qqq', blockHint: 'p:1' }, root)).toBeNull();
    expect(resolveAnchor({ text: 'e', prefix: 'th', suffix: ' reader', blockHint: 'p:1' }, root)).toBeNull();
  });
});

// Each anchor searches the article up to three times, so a sidecar of
// 20,000 anchors (the most one may hold) over a long article took minutes,
// however few places each was scored at. What one pass may search is capped.
describe('a pass over many anchors', () => {
  it('stays quick when every anchor searches the whole article and is found nowhere', () => {
    // The text's first letters match everywhere, the slowest case for a search.
    const root = buildRoot(`<p data-block-id="p:1">${'x'.repeat(330_000)}</p><p data-block-id="p:2">the end</p>`);
    const nowhere: Anchor = { text: 'xxQ', prefix: '', suffix: '', blockHint: 'gone' };
    const hinted: Anchor = { ...nowhere, blockHint: 'p:1' };
    const findable: Anchor = { text: 'the end', prefix: '', suffix: '', blockHint: 'p:2' };
    const start = performance.now();
    const found = resolvingPass(() => {
      const out: Array<Range | null> = [];
      for (let i = 0; i < 10_000; i++) out.push(resolveAnchor(nowhere, root), resolveAnchor(hinted, root));
      // Past the cap the rest of the pass's anchors are left unplaced; the
      // annotations aren't changed, and the next pass tries them again.
      out.push(resolveAnchor(findable, root));
      return out;
    });
    // About a second and a half here; uncapped, about a hundred.
    expect(performance.now() - start).toBeLessThan(5_000);
    expect(found.every((r) => r === null)).toBe(true);
    expect(resolvingPass(() => resolveAnchor(findable, root))?.toString()).toBe('the end');
  });

  it('stops inside one anchor whose search alone would run past the cap', () => {
    // Text that's half the paragraph is found at every place in the first
    // half, and each find reads all of it: four seconds for this one anchor.
    const root = buildRoot(`<p data-block-id="p:1">${'a'.repeat(8_000_000)}</p>`);
    const half: Anchor = { text: 'a'.repeat(4_000_000), prefix: '', suffix: '', blockHint: 'p:1' };
    const start = performance.now();
    const found = resolvingPass(() => resolveAnchor(half, root));
    // About a quarter of a second here.
    expect(performance.now() - start).toBeLessThan(1_500);
    expect(found).toBeNull();
  });

  // A browser's search can cost far more than the characters it passes over.
  // Chromium's compares up to the whole of a long text at each place when
  // the text's last 250 characters are all found there and what's before
  // them isn't: 80 ns a character with 250 of them, 2 µs with 5,000.
  it('stays quick when every anchor is a text that is slow to search for', () => {
    const root = buildRoot(`<p data-block-id="p:1">${'a'.repeat(300_000)}</p>`);
    const slow: Anchor = { text: `${'a'.repeat(10)}b${'a'.repeat(250)}`, prefix: '', suffix: '', blockHint: 'p:1', endBlockHint: 'p:1' };
    const start = performance.now();
    resolvingPass(() => {
      for (let i = 0; i < 2_000; i++) resolveAnchor(slow, root);
    });
    // Thirty seconds before.
    expect(performance.now() - start).toBeLessThan(3_000);
  });

  it('stays quick when one search alone would take seconds', () => {
    const root = buildRoot(`<p data-block-id="p:1">${'a'.repeat(300_000)}</p>`);
    const slow: Anchor = { text: `${'a'.repeat(10)}b${'a'.repeat(20_000)}`, prefix: '', suffix: '', blockHint: 'p:1', endBlockHint: 'p:1' };
    const start = performance.now();
    resolvingPass(() => {
      for (let i = 0; i < 20; i++) resolveAnchor(slow, root);
    });
    // Two seconds a search before, and nothing counted them as more than one
    // pass over the paragraph.
    expect(performance.now() - start).toBeLessThan(1_500);
  });

  it('still finds a long text whose opening words also occur earlier', () => {
    const passage = 'The reader sees every line here before we edit any of it, and then reads on. '.repeat(4);
    const opening = passage.slice(0, 120);
    const root = buildRoot(
      `<p data-block-id="p:1">${opening} but then it goes elsewhere.</p>` +
        `<p data-block-id="p:2">Before it. ${passage} After it.</p>`,
    );
    const within: Anchor = { text: passage, prefix: 'Before it. ', suffix: ' After it.', blockHint: 'gone' };
    const across: Anchor = { ...within, endBlockHint: 'p:2' };
    for (const anchor of [across, within]) {
      const range = resolvingPass(() => resolveAnchor(anchor, root));
      expect(range?.toString()).toBe(passage);
      expect((range!.startContainer.parentElement as HTMLElement).dataset.blockId).toBe('p:2');
    }
  });

  it('stops at a time limit whatever the searches cost, and the next pass tries again', () => {
    const root = buildRoot('<p data-block-id="p:1">One fish, two fish.</p>');
    const anchor: Anchor = { text: 'two', prefix: 'One fish, ', suffix: ' fish.', blockHint: 'p:1' };
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const found = resolvingPass(() => {
        const first = resolveAnchor(anchor, root)?.toString();
        now += 60_000;
        return [first, resolveAnchor(anchor, root)?.toString()];
      });
      expect(found).toEqual(['two', undefined]);
      expect(resolvingPass(() => resolveAnchor(anchor, root))?.toString()).toBe('two');
    } finally {
      clock.mockRestore();
    }
  });

  it('still places hundreds of annotations in a long article whose paragraphs all moved', () => {
    // A paragraph added at the top renumbers every block after it, so no
    // anchor is in the block it remembers and each searches the whole article.
    const filler = 'the reader sees every line here before we edit it. '.repeat(23);
    const para = (i: number) => `<p data-block-id="p:${i}">Paragraph ${i} opens. ${filler}Paragraph ${i} closes.</p>`;
    const count = 250;
    const before = buildRoot(Array.from({ length: count }, (_, i) => para(i)).join(''));
    expect(before.textContent!.length).toBeGreaterThan(300_000);
    const anchors = Array.from({ length: count }, (_, i) => [
      createAnchor(rangeOf(before, `p:${i}`, `Paragraph ${i} opens`), before)!,
      createAnchor(rangeOf(before, `p:${i}`, `Paragraph ${i} closes`), before)!,
    ]).flat();
    before.remove();

    const moved = buildRoot(
      '<p data-block-id="p:0">A new first paragraph.</p>' +
        Array.from({ length: count }, (_, i) => para(i)).join('').replace(/data-block-id="p:(\d+)"/g, (_, n) => `data-block-id="p:${Number(n) + 1}"`),
    );
    const found = resolvingPass(() => anchors.map((a) => resolveAnchor(a, moved)?.toString()));
    expect(found).toEqual(anchors.map((a) => a.text));
  });
});

describe('anchors in repetitive text', () => {
  // Every match of an anchor's text is compared in full, so a long
  // anchor over text that repeats it everywhere (a crafted file and
  // sidecar) took seconds for each annotation. Past a bound it is
  // ambiguous: nothing to pick between that many places.
  it('gives up on a long anchor that matches nearly everywhere, quickly', () => {
    const root = buildRoot(`<p data-block-id="p:1">${'a'.repeat(100_000)}</p>`);
    const anchor: Anchor = { text: 'a'.repeat(50_000), prefix: '', suffix: '', blockHint: 'p:1' };
    const t0 = performance.now();
    expect(resolveAnchor(anchor, root)).toBeNull();
    expect(resolveAnchor({ ...anchor, blockHint: 'p:9' }, root)).toBeNull();
    expect(resolveAnchor({ ...anchor, endBlockHint: 'p:1' }, root)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('still finds a short word among thousands of its copies', () => {
    const root = buildRoot(`<p data-block-id="p:1">${'x the '.repeat(20_000)}unique the end</p>`);
    const range = resolveAnchor({ text: 'the', prefix: 'x the unique ', suffix: ' end', blockHint: 'p:1' }, root);
    expect(range?.toString()).toBe('the');
    expect(range?.startOffset).toBe(20_000 * 6 + 7);
  });
});
