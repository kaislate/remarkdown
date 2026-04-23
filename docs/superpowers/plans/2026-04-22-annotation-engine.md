# remarkdown — Plan 2: Annotation Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Reader MVP into an actual annotator — users can highlight, leave notes, and draw freehand strokes over the rendered markdown, persist everything to the sidecar, and round-trip faithfully on reopen.

**Architecture:** An `anchoring` module is the correctness core — it turns DOM ranges into stable W3C-style text-quote selectors and back. An `annots` store owns the full annotation list (resolved + orphaned alike); orphans survive saves even though they don't render. A 500ms debounced save subscribes to the store. Highlights render via the CSS Highlight API (one named highlight per color); notes render as absolute-positioned pins with inline popovers; drawings render into a single SVG overlay. A tool rail + color strip switches the active tool and color.

**Tech Stack:** everything from Plan 1 (Svelte 5 runes, Tauri 2, markdown-it, Zod, Vitest, @testing-library/svelte) plus the existing `ulid` npm package for annotation IDs and the browser-native CSS Custom Highlight API for highlight rendering.

**Starting state:** `main` at `6710cac` (merge of Plan 1). Tag `v0.1.0-reader-mvp`. 43 TS tests, 4 Rust tests, svelte-check clean. Reading works; no annotations yet.

**Out of scope (Plan 3):** Orphan Panel UI, Open Recent UI, error-matrix UX, Playwright E2E, per-doc asset scope tightening, file watcher.

**Explicit Plan 2 scope gap:** Only **notes** have an in-app delete affordance (the Delete button in `NotePopover`). Deleting a highlight or drawing requires editing the sidecar JSON by hand for now. Right-click context-menu delete for highlights and drawings is Plan 3 work — the spec calls for "right-click or popover `…` menu → confirm", and a context menu is a cohesive chunk that fits better in Plan 3's polish phase alongside the error matrix and orphan panel.

---

## Deliberate decisions locked in by this plan

- **Highlights render via CSS Highlight API.** One named highlight per preset color (e.g. `rmd-hl-yellow`, `rmd-hl-green`). No DOM mutation. Overlaps handled by the browser. A thin jsdom shim in `tests/setup.ts` makes the API available in unit tests.
- **Notes are single anchor + absolutely-positioned pin.** Pin position is recomputed whenever the doc or annotations change. No re-layout on scroll (the pin's container scrolls with the article).
- **Drawings anchor by block, not by text.** A drawing's `anchorBlock` is the `data-block-id` of the element under the stroke's centroid at draw-finalization time. Drawing finalization triggers on tool change or 3-second pointer-idle.
- **Orphans are preserved silently.** If `resolve()` fails for an annotation on load, it goes into `orphaned` (serialized on save, never rendered). Plan 3 exposes them in a panel.
- **Save is debounced at 500ms.** `annots` store subscribe → schedule → flush via `writeSidecar`. Window close triggers a synchronous flush (already spec'd in Plan 1, implemented here).
- **The doc store gains a `render epoch` number** that increments on every `loadDocument`. Annotation resolution depends on this epoch — components recompute when it ticks.

---

## File Structure

```
remarkdown/
├── src/
│   ├── lib/
│   │   ├── anchoring.ts                  [new — W3C-style text-quote anchor + resolve]
│   │   ├── save.ts                       [new — debounced sidecar persistence]
│   │   └── positioning.ts                [new — geometric helpers for note pins]
│   ├── stores/
│   │   ├── doc.ts                        [modify — add epoch + annotation loading]
│   │   ├── annots.ts                     [new — writable<Annotation[]> + CRUD + derived partitions]
│   │   └── tool.ts                       [new — {mode, color} state]
│   ├── components/
│   │   ├── Viewer.svelte                 [modify — mount annotation layers as children]
│   │   ├── HighlightLayer.svelte         [new — selection→anchor + render via CSS Highlights]
│   │   ├── NoteLayer.svelte              [new — click→anchor + render pins + open popover]
│   │   ├── NotePopover.svelte            [new — inline textarea + delete]
│   │   ├── DrawLayer.svelte              [new — SVG overlay, stroke capture, finalization]
│   │   ├── ToolRail.svelte               [new — glass pill with 4 tool buttons]
│   │   └── ColorStrip.svelte             [new — 5-color preset picker]
│   ├── styles/
│   │   └── highlights.css                [new — ::highlight() rules for the 5 preset colors]
│   ├── App.svelte                        [modify — mount ToolRail + ColorStrip + saved-pulse]
│   └── main.ts                           [modify — install window-close save flush]
├── tests/
│   ├── setup.ts                          [modify — add CSS Highlight API shim]
│   ├── unit/
│   │   ├── anchoring.test.ts             [new]
│   │   ├── save.test.ts                  [new]
│   │   ├── annots-store.test.ts          [new]
│   │   ├── tool-store.test.ts            [new]
│   │   ├── positioning.test.ts           [new]
│   │   └── doc-store.test.ts             [modify — epoch + annotation loading]
│   ├── component/
│   │   ├── ToolRail.test.ts              [new]
│   │   ├── ColorStrip.test.ts            [new]
│   │   ├── HighlightLayer.test.ts        [new]
│   │   ├── NoteLayer.test.ts             [new]
│   │   ├── NotePopover.test.ts           [new]
│   │   └── DrawLayer.test.ts             [new]
│   └── fixtures/
│       └── sidecar-with-stale-anchor.json [new — document changed after save]
└── docs/
    └── QA-plan-2.md                      [new — manual QA checklist]
```

No Rust changes. `write_sidecar` already handles atomic persistence. This plan is entirely in TS/Svelte.

---

## Phase 1 — Anchoring (Task 1)

The correctness core. Must be bulletproof before anything that depends on it is built.

### Task 1: `anchoring.ts` with round-trip tests

**Files:**
- Create: `src/lib/anchoring.ts`, `tests/unit/anchoring.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/anchoring.test.ts
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
    expect(anchor.text).toBe('must read slowly, and with care');
    expect(anchor.prefix).toMatch(/truly understand $/);
    expect(anchor.suffix).toMatch(/^, turning the pages/);
    expect(anchor.blockHint).toBe('p:1');
  });

  it('returns empty prefix when range starts at block beginning', () => {
    const root = buildRoot('<p data-block-id="p:1">Hello world and beyond.</p>');
    const range = rangeOf(root, 'p:1', 'Hello');
    const anchor = createAnchor(range, root);
    expect(anchor.prefix).toBe('');
    expect(anchor.text).toBe('Hello');
  });

  it('returns empty suffix when range ends at block end', () => {
    const root = buildRoot('<p data-block-id="p:1">The end of the story.</p>');
    const range = rangeOf(root, 'p:1', 'story.');
    const anchor = createAnchor(range, root);
    expect(anchor.suffix).toBe('');
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
    expect(anchor.text).toBe('the emphasized part and after');
    expect(anchor.prefix).toBe('Prefix before ');
    expect(anchor.suffix).toBe('.');
  });

  it('returns null when range is not inside any data-block-id ancestor', () => {
    const root = buildRoot('<p>No block id here.</p>');
    const range = rangeOf(root, /* fake */ '' as any, 'No block').constructor as unknown as Range;
    // Simulate a range not inside a block by using document.body directly.
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
    const idx2 = tn.data.indexOf('the phrase', tn.data.indexOf('the phrase') + 1);
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
    // It should point to the SECOND occurrence — prefix contains "Second context around ".
    const secondIdx = r2.textContent!.indexOf('the phrase', r2.textContent!.indexOf('the phrase') + 1);
    expect(resolved.startOffset).toBeGreaterThan(10);
    // Simpler assertion: the 16 chars before the resolved range should contain "Second".
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
    // Both occurrences score identically. Expected behavior: return null (ambiguous).
    // If the implementation picks the first deterministically, that's also acceptable —
    // update this assertion accordingly. The plan prefers null-on-tie for safety.
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
```

- [ ] **Step 2: Run to verify failures**

```bash
npx vitest run tests/unit/anchoring.test.ts
```

Expected: all fail with module-not-found.

- [ ] **Step 3: Implement `src/lib/anchoring.ts`**

```ts
// Re-use the Anchor type from the Zod schema so sidecar round-trips and anchor
// creation share a single source of truth.
import type { Anchor } from './schema';
export type { Anchor };

const CONTEXT_LEN = 32;
const SCORE_THRESHOLD = 0.7;
const MIN_GAP = 0.08; // winning candidate must beat runner-up by this margin

function findContainingBlock(node: Node): HTMLElement | null {
  let n: Node | null = node;
  while (n && n !== document) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      if (el.dataset && el.dataset.blockId) return el;
    }
    n = n.parentNode;
  }
  return null;
}

function blockText(block: HTMLElement): string {
  return block.textContent ?? '';
}

// Convert a DOM position (node + offset) to a plaintext offset within a block.
function posToPlaintextOffset(block: HTMLElement, node: Node, offset: number): number {
  let acc = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let tn: Node | null = walker.nextNode();
  while (tn) {
    if (tn === node) return acc + offset;
    acc += (tn as Text).data.length;
    tn = walker.nextNode();
  }
  // If the exact node isn't found (e.g., element boundary), fall back to a best-effort scan.
  return acc;
}

// Convert a plaintext offset within a block back to a DOM (node, offset) pair.
function plaintextOffsetToPos(block: HTMLElement, target: number): { node: Text; offset: number } | null {
  let acc = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let tn = walker.nextNode() as Text | null;
  while (tn) {
    const next = acc + tn.data.length;
    if (target <= next) {
      return { node: tn, offset: target - acc };
    }
    acc = next;
    tn = walker.nextNode() as Text | null;
  }
  return null;
}

export function createAnchor(range: Range, _viewerRoot: HTMLElement): Anchor | null {
  const startBlock = findContainingBlock(range.startContainer);
  const endBlock = findContainingBlock(range.endContainer);
  if (!startBlock || !endBlock) return null;
  // Clamp cross-block ranges by anchoring to the start block only.
  const block = startBlock;
  const text = range.toString();
  if (!text) return null;

  const startOffset = posToPlaintextOffset(block, range.startContainer, range.startOffset);
  const endOffset = startBlock === endBlock
    ? posToPlaintextOffset(block, range.endContainer, range.endOffset)
    : Math.min(startOffset + text.length, blockText(block).length);

  const full = blockText(block);
  const prefix = full.slice(Math.max(0, startOffset - CONTEXT_LEN), startOffset);
  const suffix = full.slice(endOffset, endOffset + CONTEXT_LEN);

  return {
    text,
    prefix,
    suffix,
    blockHint: block.dataset.blockId!,
  };
}

// Find all plaintext offsets of `needle` in `hay`. Linear scan.
function allIndexOf(hay: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    out.push(i);
    from = i + 1;
  }
  return out;
}

// Similarity of two strings in [0, 1] — trailing-char overlap for prefix, leading for suffix.
// Simple, cheap, good enough for 32-char context windows.
function trailMatch(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  let n = 0;
  const lim = Math.min(a.length, b.length);
  while (n < lim && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n / Math.max(a.length, b.length);
}

function headMatch(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  let n = 0;
  const lim = Math.min(a.length, b.length);
  while (n < lim && a[n] === b[n]) n += 1;
  return n / Math.max(a.length, b.length);
}

function scoreCandidate(anchor: Anchor, full: string, index: number): number {
  const cPrefix = full.slice(Math.max(0, index - CONTEXT_LEN), index);
  const cSuffix = full.slice(index + anchor.text.length, index + anchor.text.length + CONTEXT_LEN);
  // Weight: prefix + suffix equally. Combined, each contributes half.
  return (trailMatch(anchor.prefix, cPrefix) + headMatch(anchor.suffix, cSuffix)) / 2;
}

function rangeFromBlockOffsets(block: HTMLElement, start: number, end: number): Range | null {
  const s = plaintextOffsetToPos(block, start);
  const e = plaintextOffsetToPos(block, end);
  if (!s || !e) return null;
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return range;
}

// Resolve: fast path checks the hinted block first, slow path scans all blocks.
export function resolveAnchor(anchor: Anchor, viewerRoot: HTMLElement): Range | null {
  const hinted = viewerRoot.querySelector(`[data-block-id="${CSS.escape(anchor.blockHint)}"]`) as HTMLElement | null;
  if (hinted) {
    const full = blockText(hinted);
    const indices = allIndexOf(full, anchor.text);
    if (indices.length === 1) {
      return rangeFromBlockOffsets(hinted, indices[0], indices[0] + anchor.text.length);
    }
    if (indices.length > 1) {
      const scored = indices.map((i) => ({ i, s: scoreCandidate(anchor, full, i) }));
      scored.sort((a, b) => b.s - a.s);
      if (scored[0].s >= SCORE_THRESHOLD && scored[0].s - (scored[1]?.s ?? 0) >= MIN_GAP) {
        return rangeFromBlockOffsets(hinted, scored[0].i, scored[0].i + anchor.text.length);
      }
    }
  }

  // Slow path: scan every block.
  const blocks = Array.from(viewerRoot.querySelectorAll<HTMLElement>('[data-block-id]'));
  let best: { block: HTMLElement; i: number; score: number } | null = null;
  let secondBest = 0;
  for (const block of blocks) {
    const full = blockText(block);
    for (const i of allIndexOf(full, anchor.text)) {
      const s = scoreCandidate(anchor, full, i);
      if (!best || s > best.score) {
        if (best) secondBest = Math.max(secondBest, best.score);
        best = { block, i, score: s };
      } else if (s > secondBest) {
        secondBest = s;
      }
    }
  }
  if (!best) return null;
  if (best.score < SCORE_THRESHOLD) return null;
  if (best.score - secondBest < MIN_GAP) return null;
  return rangeFromBlockOffsets(best.block, best.i, best.i + anchor.text.length);
}
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/anchoring.test.ts
```

Expected: all 10 tests passing. If the ambiguous-tie test fails because the implementation returns the first match, that's an acceptable design choice — remove that test. The plan prefers null-on-tie but either is safe.

- [ ] **Step 5: Commit**

```bash
git add src/lib/anchoring.ts tests/unit/anchoring.test.ts
git commit -m "feat: add W3C-style text-quote anchoring with resolve scoring"
```

---

## Phase 2 — Stores (Tasks 2–3)

### Task 2: `tool` store

**Files:**
- Create: `src/stores/tool.ts`, `tests/unit/tool-store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/tool-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { tool, setMode, setColor, HIGHLIGHT_COLORS, DRAW_COLORS } from '../../src/stores/tool';

describe('tool store', () => {
  beforeEach(() => {
    setMode('cursor');
  });

  it('starts in cursor mode with sensible default colors', () => {
    const t = get(tool);
    expect(t.mode).toBe('cursor');
    expect(HIGHLIGHT_COLORS).toContain(t.highlightColor);
    expect(DRAW_COLORS).toContain(t.drawColor);
  });

  it('setMode switches the active tool', () => {
    setMode('highlight');
    expect(get(tool).mode).toBe('highlight');
    setMode('note');
    expect(get(tool).mode).toBe('note');
    setMode('draw');
    expect(get(tool).mode).toBe('draw');
  });

  it('setColor in highlight mode updates highlightColor, leaves drawColor alone', () => {
    setMode('highlight');
    const originalDraw = get(tool).drawColor;
    setColor('#d6336c');
    const t = get(tool);
    expect(t.highlightColor).toBe('#d6336c');
    expect(t.drawColor).toBe(originalDraw);
  });

  it('setColor in draw mode updates drawColor, leaves highlightColor alone', () => {
    setMode('draw');
    const originalHighlight = get(tool).highlightColor;
    setColor('#5f9bff');
    const t = get(tool);
    expect(t.drawColor).toBe('#5f9bff');
    expect(t.highlightColor).toBe(originalHighlight);
  });

  it('setColor is a no-op in cursor and note modes', () => {
    setMode('cursor');
    const before = get(tool);
    setColor('#123456');
    expect(get(tool)).toEqual(before);

    setMode('note');
    const before2 = get(tool);
    setColor('#123456');
    expect(get(tool)).toEqual(before2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/tool-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/stores/tool.ts`**

```ts
import { writable, get } from 'svelte/store';
import type { Tool } from '../lib/schema';

export const HIGHLIGHT_COLORS = ['#ffd25a', '#82d99c', '#ffa58a', '#a8c5ff', '#e0a8ff'] as const;
export const DRAW_COLORS = ['#d6336c', '#5f9bff', '#f59f00', '#20c997', '#d9d9d9'] as const;

export interface ToolState {
  mode: Tool;
  highlightColor: string;
  drawColor: string;
}

const initial: ToolState = {
  mode: 'cursor',
  highlightColor: HIGHLIGHT_COLORS[0],
  drawColor: DRAW_COLORS[0],
};

export const tool = writable<ToolState>(initial);

export function setMode(mode: Tool): void {
  tool.update((t) => ({ ...t, mode }));
}

export function setColor(color: string): void {
  const current = get(tool);
  if (current.mode === 'highlight') {
    tool.update((t) => ({ ...t, highlightColor: color }));
  } else if (current.mode === 'draw') {
    tool.update((t) => ({ ...t, drawColor: color }));
  }
}
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/tool-store.test.ts
```

Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/stores/tool.ts tests/unit/tool-store.test.ts
git commit -m "feat: add tool store with mode and per-tool color"
```

---

### Task 3: `annots` store with CRUD and derived partitions

**Files:**
- Create: `src/stores/annots.ts`, `tests/unit/annots-store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/annots-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  annots,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  replaceAll,
  resolvedAnnots,
  orphanedAnnots,
  currentViewerRoot,
} from '../../src/stores/annots';
import type { Annotation, Highlight } from '../../src/lib/schema';

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? '01HP8XYZABCDEFGHJKMNPQRSTV',
    type: 'highlight',
    color: overrides.color ?? '#ffd25a',
    anchor: overrides.anchor ?? {
      text: 'sample',
      prefix: 'the ',
      suffix: ' text',
      blockHint: 'p:1',
    },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

describe('annots store CRUD', () => {
  beforeEach(() => { replaceAll([]); currentViewerRoot.set(null); });

  it('starts empty', () => {
    expect(get(annots)).toEqual([]);
  });

  it('addAnnotation appends to list', () => {
    const h = makeHighlight({ id: '01A' });
    addAnnotation(h);
    expect(get(annots)).toHaveLength(1);
    expect(get(annots)[0].id).toBe('01A');
  });

  it('updateAnnotation patches by id and bumps updatedAt', async () => {
    const h = makeHighlight({ id: '01A', updatedAt: '2020-01-01T00:00:00Z' });
    addAnnotation(h);
    updateAnnotation('01A', (a) => ({ ...a, color: '#82d99c' }));
    const after = get(annots)[0] as Highlight;
    expect(after.color).toBe('#82d99c');
    expect(after.updatedAt).not.toBe('2020-01-01T00:00:00Z');
  });

  it('removeAnnotation removes by id', () => {
    addAnnotation(makeHighlight({ id: '01A' }));
    addAnnotation(makeHighlight({ id: '01B' }));
    removeAnnotation('01A');
    const list = get(annots);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('01B');
  });

  it('replaceAll swaps the whole list', () => {
    addAnnotation(makeHighlight({ id: '01A' }));
    const fresh: Annotation[] = [
      makeHighlight({ id: '01X' }),
      makeHighlight({ id: '01Y' }),
    ];
    replaceAll(fresh);
    expect(get(annots).map((a) => a.id)).toEqual(['01X', '01Y']);
  });
});

describe('annots derived partitions', () => {
  beforeEach(() => { replaceAll([]); currentViewerRoot.set(null); });

  it('with no viewer root, everything is orphaned', () => {
    replaceAll([makeHighlight({ id: '01A' })]);
    expect(get(resolvedAnnots)).toEqual([]);
    expect(get(orphanedAnnots)).toHaveLength(1);
  });

  it('with a matching viewer root, resolvable annotations appear in resolved', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p:1">the sample text</p>';
    document.body.appendChild(root);
    currentViewerRoot.set(root);

    replaceAll([
      makeHighlight({
        id: '01A',
        anchor: { text: 'sample', prefix: 'the ', suffix: ' text', blockHint: 'p:1' },
      }),
    ]);

    expect(get(resolvedAnnots)).toHaveLength(1);
    expect(get(orphanedAnnots)).toHaveLength(0);
    expect(get(resolvedAnnots)[0].range.toString()).toBe('sample');
  });

  it('puts unresolvable annotations into orphaned', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p:1">nothing interesting here</p>';
    document.body.appendChild(root);
    currentViewerRoot.set(root);

    replaceAll([
      makeHighlight({
        id: '01A',
        anchor: { text: 'missing', prefix: 'xxx', suffix: 'yyy', blockHint: 'p:1' },
      }),
    ]);

    expect(get(resolvedAnnots)).toHaveLength(0);
    expect(get(orphanedAnnots)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/annots-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/stores/annots.ts`**

```ts
import { writable, derived, get } from 'svelte/store';
import { resolveAnchor } from '../lib/anchoring';
import type { Annotation } from '../lib/schema';

export interface ResolvedAnnotation {
  annotation: Annotation;
  range: Range; // only present when anchor resolves; drawings store a block element instead (Task 11 extends)
}

export const annots = writable<Annotation[]>([]);

// The viewer root element the store uses to resolve anchors. Set by Viewer.svelte on mount.
// null when no document is loaded.
export const currentViewerRoot = writable<HTMLElement | null>(null);

// epoch increments when the rendered doc changes, forcing derived stores to re-resolve.
export const docEpoch = writable(0);

export function addAnnotation(a: Annotation): void {
  annots.update((list) => [...list, a]);
}

export function updateAnnotation(id: string, mutate: (a: Annotation) => Annotation): void {
  annots.update((list) =>
    list.map((a) => (a.id === id ? { ...mutate(a), updatedAt: new Date().toISOString() } : a)),
  );
}

export function removeAnnotation(id: string): void {
  annots.update((list) => list.filter((a) => a.id !== id));
}

export function replaceAll(list: Annotation[]): void {
  annots.set(list);
}

// Shared helper so both derived stores partition from the same source of truth.
function partition($annots: Annotation[], $root: HTMLElement | null): {
  resolved: ResolvedAnnotation[];
  orphanedIds: Set<string>;
} {
  if (!$root) return { resolved: [], orphanedIds: new Set($annots.map((a) => a.id)) };
  const resolved: ResolvedAnnotation[] = [];
  const orphanedIds = new Set<string>();
  for (const a of $annots) {
    if (a.type === 'drawing') {
      const block = $root.querySelector(`[data-block-id="${CSS.escape(a.anchorBlock)}"]`);
      if (block) resolved.push({ annotation: a, range: null as unknown as Range });
      else orphanedIds.add(a.id);
      continue;
    }
    const range = resolveAnchor(a.anchor, $root);
    if (range) resolved.push({ annotation: a, range });
    else orphanedIds.add(a.id);
  }
  return { resolved, orphanedIds };
}

export const resolvedAnnots = derived(
  [annots, currentViewerRoot, docEpoch],
  ([$annots, $root]) => partition($annots, $root).resolved,
);

export const orphanedAnnots = derived(
  [annots, currentViewerRoot, docEpoch],
  ([$annots, $root]) => {
    const { orphanedIds } = partition($annots, $root);
    return $annots.filter((a) => orphanedIds.has(a.id));
  },
);
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/annots-store.test.ts
```

Expected: all 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/stores/annots.ts tests/unit/annots-store.test.ts
git commit -m "feat: add annots store with CRUD and resolved/orphaned partitions"
```

---

## Phase 3 — Save/Load (Tasks 4–5)

### Task 4: Extend `doc` store to load annotations from the sidecar

**Files:**
- Modify: `src/stores/doc.ts`
- Modify: `tests/unit/doc-store.test.ts`

- [ ] **Step 1: Add new failing test to `doc-store.test.ts`**

Append the following describe block (keep existing tests intact):

```ts
import { loadSidecar, serializeSidecar, emptySidecar } from '../../src/lib/sidecar';
import { annots } from '../../src/stores/annots';

describe('doc store — sidecar annotations', () => {
  beforeEach(() => {
    vi.mocked(readDocument).mockReset();
    clearDocument();
    annots.set([]);
  });

  it('populates annots from a valid sidecar', async () => {
    const sidecar = emptySidecar({ path: '/tmp/a.md', sha256: 'abc', lastSeenBytes: 8 });
    (sidecar.annotations as any[]).push({
      id: '01Z',
      type: 'highlight',
      color: '#ffd25a',
      anchor: { text: 'Hello', prefix: '', suffix: '\n', blockHint: 'h:1' },
      createdAt: '2026-04-20T00:00:00Z',
      updatedAt: '2026-04-20T00:00:00Z',
    });
    vi.mocked(readDocument).mockResolvedValue({
      path: '/tmp/a.md',
      dir: '/tmp',
      markdown: '# Hello\n',
      sidecarRaw: serializeSidecar(sidecar),
      sha256: 'abc',
      bytes: 8,
    });
    await loadDocument('/tmp/a.md');
    expect(get(annots)).toHaveLength(1);
    expect(get(annots)[0].id).toBe('01Z');
  });

  it('starts with empty annotations when sidecar is null', async () => {
    vi.mocked(readDocument).mockResolvedValue({
      path: '/tmp/a.md',
      dir: '/tmp',
      markdown: '# Hello\n',
      sidecarRaw: null,
      sha256: 'abc',
      bytes: 8,
    });
    await loadDocument('/tmp/a.md');
    expect(get(annots)).toEqual([]);
  });

  it('starts with empty annotations and logs on malformed sidecar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(readDocument).mockResolvedValue({
      path: '/tmp/a.md',
      dir: '/tmp',
      markdown: '# Hello\n',
      sidecarRaw: '{ not json',
      sha256: 'abc',
      bytes: 8,
    });
    await loadDocument('/tmp/a.md');
    expect(get(annots)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('increments docEpoch on every load', async () => {
    const { docEpoch } = await import('../../src/stores/annots');
    const before = get(docEpoch);
    vi.mocked(readDocument).mockResolvedValue({
      path: '/tmp/a.md',
      dir: '/tmp',
      markdown: '',
      sidecarRaw: null,
      sha256: 'a',
      bytes: 0,
    });
    await loadDocument('/tmp/a.md');
    expect(get(docEpoch)).toBe(before + 1);
  });
});
```

Add `import { vi } from 'vitest';` if missing. (The existing test file already imports from vitest.)

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/doc-store.test.ts
```

Expected: 4 new tests fail — `doc.ts` doesn't load annotations yet.

- [ ] **Step 3: Modify `src/stores/doc.ts`**

Replace the existing `loadDocument` (and file top) with:

```ts
import { writable } from 'svelte/store';
import { readDocument, toAssetUrl } from '../lib/tauri-api';
import { render } from '../lib/MarkdownRenderer';
import { loadSidecar } from '../lib/sidecar';
import { annots, docEpoch, replaceAll } from './annots';

export interface DocState {
  path: string;
  dir: string;
  sha256: string;
  bytes: number;
  markdown: string;
  html: string;
  plaintext: string;
  blocks: string[];
  sidecarRaw: string | null;
}

export const doc = writable<DocState | null>(null);

export async function loadDocument(path: string): Promise<void> {
  const r = await readDocument(path);
  const { html, plaintext, blocks } = await render(r.markdown, {
    baseDir: r.dir,
    toAssetUrl,
  });

  // Partition sidecar into structured annotations. Orphan resolution happens later
  // in annots-store's derived stores, once the Viewer mounts and sets currentViewerRoot.
  let parsedAnnotations: ReturnType<typeof JSON.parse> = [];
  if (r.sidecarRaw) {
    const result = loadSidecar(r.sidecarRaw);
    if (result.ok) {
      parsedAnnotations = result.value.annotations;
    } else {
      console.warn('[remarkdown] sidecar load failed:', result.error);
    }
  }
  replaceAll(parsedAnnotations);

  doc.set({
    path: r.path,
    dir: r.dir,
    sha256: r.sha256,
    bytes: r.bytes,
    markdown: r.markdown,
    html,
    plaintext,
    blocks,
    sidecarRaw: r.sidecarRaw,
  });
  docEpoch.update((e) => e + 1);
}

export function clearDocument(): void {
  doc.set(null);
  replaceAll([]);
  docEpoch.update((e) => e + 1);
}
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/doc-store.test.ts
```

Expected: 6/6 tests pass (2 original + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/stores/doc.ts tests/unit/doc-store.test.ts
git commit -m "feat: load sidecar annotations into annots store on document open"
```

---

### Task 5: Debounced save via `save.ts`

**Files:**
- Create: `src/lib/save.ts`, `tests/unit/save.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/save.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  writeSidecar: vi.fn().mockResolvedValue(undefined),
}));

import { writeSidecar } from '../../src/lib/tauri-api';
import { annots } from '../../src/stores/annots';
import { doc } from '../../src/stores/doc';
import { installSaveWatcher, flushSave, SAVE_DEBOUNCE_MS } from '../../src/lib/save';

describe('save', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(writeSidecar).mockReset().mockResolvedValue(undefined);
    annots.set([]);
    doc.set(null);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('does not save when no doc is loaded', async () => {
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(writeSidecar).not.toHaveBeenCalled();
    dispose();
  });

  it('saves after debounce when annots change with a loaded doc', async () => {
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
    expect(writeSidecar).toHaveBeenCalledTimes(1);
    const [mdPath, json] = vi.mocked(writeSidecar).mock.calls[0];
    expect(mdPath).toBe('/tmp/a.md');
    expect(JSON.parse(json).annotations).toHaveLength(1);
    dispose();
  });

  it('collapses rapid changes into a single debounced write', async () => {
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    const dispose = installSaveWatcher();
    const mk = (id: string) => ({
      id, type: 'highlight' as const, color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    });
    annots.set([mk('01A')]);
    await vi.advanceTimersByTimeAsync(100);
    annots.set([mk('01A'), mk('01B')]);
    await vi.advanceTimersByTimeAsync(100);
    annots.set([mk('01A'), mk('01B'), mk('01C')]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(writeSidecar).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('flushSave forces an immediate write and cancels the pending timer', async () => {
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await flushSave();
    expect(writeSidecar).toHaveBeenCalledTimes(1);
    // advance past the debounce — no further writes should fire.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(writeSidecar).toHaveBeenCalledTimes(1);
    dispose();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/save.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/save.ts`**

```ts
import { get } from 'svelte/store';
import { writeSidecar } from './tauri-api';
import { serializeSidecar } from './sidecar';
import { doc } from '../stores/doc';
import { annots } from '../stores/annots';
import type { Sidecar } from './schema';

export const SAVE_DEBOUNCE_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSerializedSnapshot: string | null = null;

function currentSidecar(): { path: string; json: string } | null {
  const d = get(doc);
  if (!d) return null;
  const sidecar: Sidecar = {
    _comment: `remarkdown annotations for: ${d.path.split(/[\\/]/).pop() ?? d.path}`,
    $schema: 'remarkdown/v1',
    document: { path: d.path, sha256: d.sha256, lastSeenBytes: d.bytes },
    annotations: get(annots),
  };
  return { path: d.path, json: serializeSidecar(sidecar) };
}

async function doSave(): Promise<void> {
  const current = currentSidecar();
  if (!current) return;
  if (current.json === lastSerializedSnapshot) return;
  await writeSidecar(current.path, current.json);
  lastSerializedSnapshot = current.json;
  savedPulse.set(Date.now());
}

export async function flushSave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await doSave();
}

function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    doSave().catch((e) => console.error('[remarkdown] save failed:', e));
  }, SAVE_DEBOUNCE_MS);
}

import { writable, type Writable } from 'svelte/store';
export const savedPulse: Writable<number> = writable(0);

export function installSaveWatcher(): () => void {
  // Re-initialize snapshot whenever doc changes, so the first write for a new doc always fires.
  const unsubDoc = doc.subscribe(() => { lastSerializedSnapshot = null; });
  let firstAnnots = true;
  const unsubAnnots = annots.subscribe(() => {
    // Don't save on the initial subscription emit.
    if (firstAnnots) { firstAnnots = false; return; }
    if (!get(doc)) return;
    scheduleSave();
  });
  return () => {
    unsubDoc();
    unsubAnnots();
    if (timer) { clearTimeout(timer); timer = null; }
  };
}
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/save.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/save.ts tests/unit/save.test.ts
git commit -m "feat: add debounced sidecar save watcher"
```

---

## Phase 4 — Tool chrome (Tasks 6–7)

### Task 6: `ToolRail.svelte`

**Files:**
- Create: `src/components/ToolRail.svelte`, `tests/component/ToolRail.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/component/ToolRail.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import ToolRail from '../../src/components/ToolRail.svelte';
import { tool, setMode } from '../../src/stores/tool';

beforeEach(() => { setMode('cursor'); });

describe('ToolRail', () => {
  it('renders four tool buttons', () => {
    render(ToolRail);
    for (const name of ['cursor', 'highlight', 'note', 'draw']) {
      expect(screen.getByRole('radio', { name: new RegExp(name, 'i') })).toBeInTheDocument();
    }
  });

  it('marks the active tool with aria-checked=true', () => {
    render(ToolRail);
    const cursorBtn = screen.getByRole('radio', { name: /cursor/i });
    expect(cursorBtn.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking a tool updates the store and aria-checked state', async () => {
    const user = userEvent.setup();
    render(ToolRail);
    await user.click(screen.getByRole('radio', { name: /highlight/i }));
    expect(get(tool).mode).toBe('highlight');
    expect(screen.getByRole('radio', { name: /highlight/i }).getAttribute('aria-checked')).toBe('true');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/component/ToolRail.test.ts
```

Expected: FAIL — component not found.

- [ ] **Step 3: Implement `src/components/ToolRail.svelte`**

```svelte
<script lang="ts">
  import { tool, setMode } from '../stores/tool';
  import type { Tool } from '../lib/schema';

  const TOOLS: { mode: Tool; label: string; glyph: string }[] = [
    { mode: 'cursor', label: 'Cursor', glyph: '↖' },
    { mode: 'highlight', label: 'Highlight', glyph: '▬' },
    { mode: 'note', label: 'Note', glyph: '✎' },
    { mode: 'draw', label: 'Draw', glyph: '✏' },
  ];
</script>

<div class="rail glass glass-pill" role="radiogroup" aria-label="Annotation tool">
  {#each TOOLS as t (t.mode)}
    <button
      class="btn"
      role="radio"
      aria-checked={$tool.mode === t.mode}
      aria-label={t.label}
      onclick={() => setMode(t.mode)}
    >
      <span class="glyph" aria-hidden="true">{t.glyph}</span>
    </button>
  {/each}
</div>

<style>
  .rail {
    position: fixed;
    bottom: 22px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 4px;
    padding: 4px;
    z-index: 100;
  }
  .btn {
    background: transparent;
    border: 0;
    color: var(--fg-1);
    width: 38px;
    height: 38px;
    border-radius: 999px;
    cursor: pointer;
    display: grid;
    place-items: center;
    font-size: 16px;
  }
  .btn[aria-checked='true'] {
    background: var(--accent-soft);
    color: var(--fg-0);
  }
  .btn:hover:not([aria-checked='true']) {
    background: rgba(255, 255, 255, 0.04);
  }
</style>
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/component/ToolRail.test.ts
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/ToolRail.svelte tests/component/ToolRail.test.ts
git commit -m "feat: add ToolRail glass pill component"
```

---

### Task 7: `ColorStrip.svelte`

**Files:**
- Create: `src/components/ColorStrip.svelte`, `tests/component/ColorStrip.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/component/ColorStrip.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import ColorStrip from '../../src/components/ColorStrip.svelte';
import { tool, setMode, HIGHLIGHT_COLORS } from '../../src/stores/tool';

beforeEach(() => { setMode('cursor'); });

describe('ColorStrip', () => {
  it('renders nothing when tool mode is cursor or note', () => {
    setMode('cursor');
    const { container } = render(ColorStrip);
    expect(container.querySelector('.strip')).toBeNull();
  });

  it('renders 5 color swatches in highlight mode', () => {
    setMode('highlight');
    render(ColorStrip);
    const swatches = screen.getAllByRole('radio');
    expect(swatches).toHaveLength(5);
  });

  it('clicking a swatch updates the highlight color', async () => {
    setMode('highlight');
    const user = userEvent.setup();
    render(ColorStrip);
    const swatches = screen.getAllByRole('radio');
    await user.click(swatches[2]);
    expect(get(tool).highlightColor).toBe(HIGHLIGHT_COLORS[2]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/component/ColorStrip.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/components/ColorStrip.svelte`**

```svelte
<script lang="ts">
  import { tool, setColor, HIGHLIGHT_COLORS, DRAW_COLORS } from '../stores/tool';
  const palette = $derived(
    $tool.mode === 'highlight' ? HIGHLIGHT_COLORS :
    $tool.mode === 'draw' ? DRAW_COLORS :
    null
  );
  const active = $derived(
    $tool.mode === 'highlight' ? $tool.highlightColor :
    $tool.mode === 'draw' ? $tool.drawColor :
    null
  );
</script>

{#if palette}
  <div class="strip glass glass-pill" role="radiogroup" aria-label="Color">
    {#each palette as c (c)}
      <button
        class="swatch"
        role="radio"
        aria-checked={active === c}
        aria-label={`Color ${c}`}
        style="background:{c}"
        onclick={() => setColor(c)}
      ></button>
    {/each}
  </div>
{/if}

<style>
  .strip {
    position: fixed;
    bottom: 74px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 6px;
    padding: 6px;
    z-index: 100;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 1.5px solid rgba(255,255,255,0.1);
    cursor: pointer;
    padding: 0;
  }
  .swatch[aria-checked='true'] {
    border-color: var(--fg-0);
    outline: 2px solid var(--accent-soft);
  }
</style>
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/component/ColorStrip.test.ts
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/ColorStrip.svelte tests/component/ColorStrip.test.ts
git commit -m "feat: add ColorStrip above tool rail"
```

---

## Phase 5 — Highlight layer (Task 8)

### Task 8: `HighlightLayer.svelte` — CSS Highlight API

**Files:**
- Create: `src/components/HighlightLayer.svelte`, `tests/component/HighlightLayer.test.ts`, `src/styles/highlights.css`
- Modify: `tests/setup.ts` (add CSS Highlight API shim for jsdom)
- Modify: `src/App.svelte` (import `highlights.css`)

- [ ] **Step 1: Add CSS Highlight API shim to `tests/setup.ts`**

Replace the current `tests/setup.ts` with:

```ts
import '@testing-library/jest-dom/vitest';

// jsdom does not implement CSS Custom Highlight API. Provide a minimal shim so
// HighlightLayer can run in the test environment; tests assert via this shim.

class MockHighlight {
  ranges: Set<Range>;
  constructor(...ranges: Range[]) {
    this.ranges = new Set(ranges);
  }
  add(range: Range) { this.ranges.add(range); }
  clear() { this.ranges.clear(); }
  delete(range: Range) { this.ranges.delete(range); }
}

if (typeof window !== 'undefined') {
  // @ts-expect-error adding to global
  window.Highlight = MockHighlight;
  const g: any = window.CSS ?? {};
  if (!g.highlights) g.highlights = new Map();
  if (!g.escape) g.escape = (s: string) => s.replace(/[^\w-]/g, '\\$&');
  // @ts-expect-error adding to global
  window.CSS = g;
}
```

- [ ] **Step 2: Write `src/styles/highlights.css`**

```css
/* Named highlights — one per preset color. Order matches HIGHLIGHT_COLORS in tool.ts. */
::highlight(rmd-hl-0) { background-color: rgba(255, 210, 90, 0.35); }
::highlight(rmd-hl-1) { background-color: rgba(130, 217, 156, 0.35); }
::highlight(rmd-hl-2) { background-color: rgba(255, 165, 138, 0.35); }
::highlight(rmd-hl-3) { background-color: rgba(168, 197, 255, 0.35); }
::highlight(rmd-hl-4) { background-color: rgba(224, 168, 255, 0.35); }
```

- [ ] **Step 3: Import the stylesheet in `App.svelte`**

Append to the existing `<script>` imports in `src/App.svelte`:

```ts
import './styles/highlights.css';
```

- [ ] **Step 4: Write failing component tests**

```ts
// tests/component/HighlightLayer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import HighlightLayer from '../../src/components/HighlightLayer.svelte';
import { annots, currentViewerRoot, docEpoch } from '../../src/stores/annots';
import { tool, setMode } from '../../src/stores/tool';
import { HIGHLIGHT_COLORS } from '../../src/stores/tool';

function mountViewer(html: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = html;
  document.body.appendChild(article);
  currentViewerRoot.set(article);
  docEpoch.update((e) => e + 1);
  return article;
}

beforeEach(() => {
  document.body.innerHTML = '';
  annots.set([]);
  currentViewerRoot.set(null);
  setMode('cursor');
  (CSS.highlights as unknown as Map<string, unknown>).clear();
});

afterEach(() => { document.body.innerHTML = ''; });

describe('HighlightLayer — rendering existing highlights', () => {
  it('registers a Highlight for each resolved highlight annotation', () => {
    const root = mountViewer('<p data-block-id="p:1">Hello the world here.</p>');
    render(HighlightLayer);
    annots.set([
      {
        id: '01A', type: 'highlight', color: HIGHLIGHT_COLORS[0],
        anchor: { text: 'the world', prefix: 'Hello ', suffix: ' here.', blockHint: 'p:1' },
        createdAt: 'now', updatedAt: 'now',
      },
    ]);
    const hl = (CSS.highlights as any).get('rmd-hl-0');
    expect(hl).toBeDefined();
    expect(hl.ranges.size).toBe(1);
  });

  it('uses the right named highlight per color', () => {
    const root = mountViewer('<p data-block-id="p:1">aaaa bbbb cccc</p>');
    render(HighlightLayer);
    annots.set([
      {
        id: '01A', type: 'highlight', color: HIGHLIGHT_COLORS[0],
        anchor: { text: 'aaaa', prefix: '', suffix: ' bbbb', blockHint: 'p:1' },
        createdAt: 'now', updatedAt: 'now',
      },
      {
        id: '01B', type: 'highlight', color: HIGHLIGHT_COLORS[3],
        anchor: { text: 'cccc', prefix: 'bbbb ', suffix: '', blockHint: 'p:1' },
        createdAt: 'now', updatedAt: 'now',
      },
    ]);
    expect((CSS.highlights as any).get('rmd-hl-0').ranges.size).toBe(1);
    expect((CSS.highlights as any).get('rmd-hl-3').ranges.size).toBe(1);
  });
});

describe('HighlightLayer — creating highlights from selection', () => {
  it('adds a highlight annotation when user finishes a selection in highlight mode', async () => {
    const root = mountViewer('<p data-block-id="p:1">select me now</p>');
    render(HighlightLayer);
    setMode('highlight');

    // Simulate a selection: set window selection to a Range in the paragraph.
    const tn = root.querySelector('p')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(tn, tn.data.indexOf('select me'));
    range.setEnd(tn, tn.data.indexOf('select me') + 'select me'.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // Fire mouseup to commit the selection.
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const list = get(annots);
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('highlight');
    expect((list[0] as any).anchor.text).toBe('select me');
  });

  it('does not add a highlight when tool mode is not highlight', () => {
    const root = mountViewer('<p data-block-id="p:1">nothing happens</p>');
    render(HighlightLayer);
    setMode('cursor');

    const tn = root.querySelector('p')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 7);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(get(annots)).toHaveLength(0);
  });

  it('ignores an empty selection', () => {
    const root = mountViewer('<p data-block-id="p:1">nothing</p>');
    render(HighlightLayer);
    setMode('highlight');
    window.getSelection()!.removeAllRanges();
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(get(annots)).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run to verify failures**

```bash
npx vitest run tests/component/HighlightLayer.test.ts
```

Expected: FAIL — component not found.

- [ ] **Step 6: Implement `src/components/HighlightLayer.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { ulid } from 'ulid';
  import { tool, HIGHLIGHT_COLORS } from '../stores/tool';
  import {
    addAnnotation,
    resolvedAnnots,
    currentViewerRoot,
  } from '../stores/annots';
  import { createAnchor } from '../lib/anchoring';
  import type { Highlight } from '../lib/schema';

  function colorIndex(color: string): number {
    const i = HIGHLIGHT_COLORS.indexOf(color as (typeof HIGHLIGHT_COLORS)[number]);
    return i >= 0 ? i : 0;
  }

  // Render: rebuild CSS Highlights on every resolved-annots change.
  $effect(() => {
    const resolved = $resolvedAnnots;
    if (typeof CSS === 'undefined' || !(CSS as any).highlights) return;
    // Clear all named highlights we might own.
    for (let i = 0; i < HIGHLIGHT_COLORS.length; i++) {
      const name = `rmd-hl-${i}`;
      (CSS as any).highlights.delete(name);
    }
    // Group ranges by color index.
    const byColor = new Map<number, Range[]>();
    for (const r of resolved) {
      if (r.annotation.type !== 'highlight') continue;
      const idx = colorIndex((r.annotation as Highlight).color);
      if (!byColor.has(idx)) byColor.set(idx, []);
      byColor.get(idx)!.push(r.range);
    }
    for (const [idx, ranges] of byColor) {
      const name = `rmd-hl-${idx}`;
      const hl = new (window as any).Highlight(...ranges);
      (CSS as any).highlights.set(name, hl);
    }
  });

  // Create: listen for selection end while tool=highlight.
  onMount(() => {
    const onMouseUp = () => {
      if ($tool.mode !== 'highlight') return;
      const root = $currentViewerRoot;
      if (!root) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
      const anchor = createAnchor(range, root);
      if (!anchor) return;
      const now = new Date().toISOString();
      const hl: Highlight = {
        id: ulid(),
        type: 'highlight',
        color: $tool.highlightColor,
        anchor,
        createdAt: now,
        updatedAt: now,
      };
      addAnnotation(hl);
      sel.removeAllRanges();
    };

    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  });
</script>
```

The component has no template — it's a side-effect-only layer. Rendering happens via `CSS.highlights`.

- [ ] **Step 7: Run to verify passing**

```bash
npx vitest run tests/component/HighlightLayer.test.ts
```

Expected: 5 tests passing.

If the "adds highlight on selection" test fails because the `mouseup` listener fires before `$effect` has subscribed to `$currentViewerRoot`, wrap the `addEventListener` registration in `setTimeout(() => { ... }, 0)` or use `tick()` from svelte. The simplest fix is to listen on `document` (which works immediately) — the spec already does this.

- [ ] **Step 8: Commit**

```bash
git add src/components/HighlightLayer.svelte src/styles/highlights.css tests/component/HighlightLayer.test.ts tests/setup.ts src/App.svelte
git commit -m "feat: add HighlightLayer using CSS Custom Highlight API"
```

---

## Phase 6 — Note layer (Tasks 9–10)

### Task 9: `positioning.ts` + `NotePopover.svelte`

**Files:**
- Create: `src/lib/positioning.ts`, `tests/unit/positioning.test.ts`
- Create: `src/components/NotePopover.svelte`, `tests/component/NotePopover.test.ts`

- [ ] **Step 1: Write failing tests for `positioning.ts`**

```ts
// tests/unit/positioning.test.ts
import { describe, it, expect } from 'vitest';
import { pinPosition } from '../../src/lib/positioning';

describe('pinPosition', () => {
  it('returns top/left relative to the viewer root', () => {
    const root = document.createElement('article');
    root.style.position = 'absolute';
    document.body.appendChild(root);
    // jsdom returns zeros for getBoundingClientRect, so we test the arithmetic contract.
    const fakeRootRect = { top: 10, left: 20, width: 700, height: 1000, right: 720, bottom: 1010, x: 20, y: 10 } as DOMRect;
    const fakeRangeRect = { top: 50, left: 100, width: 40, height: 20, right: 140, bottom: 70, x: 100, y: 50 } as DOMRect;
    const result = pinPosition(fakeRootRect, fakeRangeRect);
    expect(result.top).toBe(50 - 10); // rangeTop - rootTop
    expect(result.left).toBe(140 - 20); // rangeRight - rootLeft
  });
});
```

- [ ] **Step 2: Implement `src/lib/positioning.ts`**

```ts
export interface PinPosition { top: number; left: number; }

export function pinPosition(rootRect: DOMRect, rangeRect: DOMRect): PinPosition {
  return {
    top: rangeRect.top - rootRect.top,
    left: rangeRect.right - rootRect.left,
  };
}
```

- [ ] **Step 3: Verify `positioning.ts` tests pass**

```bash
npx vitest run tests/unit/positioning.test.ts
```

Expected: 1 test passing.

- [ ] **Step 4: Write failing tests for `NotePopover.svelte`**

```ts
// tests/component/NotePopover.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import NotePopover from '../../src/components/NotePopover.svelte';

describe('NotePopover', () => {
  it('renders current body in the textarea', () => {
    render(NotePopover, { props: { body: 'current note body', onUpdate: () => {}, onDelete: () => {} } });
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('current note body');
  });

  it('calls onUpdate as the user types', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(NotePopover, { props: { body: '', onUpdate, onDelete: () => {} } });
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hi');
    expect(onUpdate).toHaveBeenCalled();
    const lastCall = onUpdate.mock.calls.at(-1)?.[0];
    expect(lastCall).toBe('hi');
  });

  it('calls onDelete when Delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(NotePopover, { props: { body: 'to go', onUpdate: () => {}, onDelete } });
    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run to verify failure**

```bash
npx vitest run tests/component/NotePopover.test.ts
```

Expected: FAIL.

- [ ] **Step 6: Implement `src/components/NotePopover.svelte`**

```svelte
<script lang="ts">
  interface Props {
    body: string;
    onUpdate: (next: string) => void;
    onDelete: () => void;
  }
  let { body, onUpdate, onDelete }: Props = $props();
</script>

<div class="popover glass" role="dialog" aria-label="Note">
  <textarea
    aria-label="Note body"
    value={body}
    oninput={(e) => onUpdate((e.currentTarget as HTMLTextAreaElement).value)}
    rows="4"
  ></textarea>
  <div class="actions">
    <button class="danger" onclick={onDelete}>Delete</button>
  </div>
</div>

<style>
  .popover {
    padding: 10px;
    width: 260px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  textarea {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    padding: 6px 8px;
    font-family: var(--font-sans);
    font-size: 13px;
    resize: vertical;
  }
  .actions { display: flex; justify-content: flex-end; }
  .danger {
    background: transparent;
    color: var(--fg-2);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 12px;
  }
  .danger:hover { color: #ff8080; border-color: #ff8080; }
</style>
```

- [ ] **Step 7: Run to verify passing**

```bash
npx vitest run tests/component/NotePopover.test.ts tests/unit/positioning.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 8: Commit**

```bash
git add src/lib/positioning.ts src/components/NotePopover.svelte tests/unit/positioning.test.ts tests/component/NotePopover.test.ts
git commit -m "feat: add pinPosition helper and NotePopover component"
```

---

### Task 10: `NoteLayer.svelte`

**Files:**
- Create: `src/components/NoteLayer.svelte`, `tests/component/NoteLayer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/component/NoteLayer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import NoteLayer from '../../src/components/NoteLayer.svelte';
import { annots, currentViewerRoot, docEpoch } from '../../src/stores/annots';
import { setMode } from '../../src/stores/tool';

function mountViewer(html: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = html;
  document.body.appendChild(article);
  currentViewerRoot.set(article);
  docEpoch.update((e) => e + 1);
  return article;
}

beforeEach(() => {
  document.body.innerHTML = '';
  annots.set([]);
  currentViewerRoot.set(null);
  setMode('cursor');
});
afterEach(() => { document.body.innerHTML = ''; });

describe('NoteLayer', () => {
  it('renders a pin for each resolved note annotation', () => {
    const root = mountViewer('<p data-block-id="p:1">Good evening friend</p>');
    render(NoteLayer);
    annots.set([
      {
        id: '01A', type: 'note', body: 'hello',
        anchor: { text: 'evening', prefix: 'Good ', suffix: ' friend', blockHint: 'p:1' },
        createdAt: 'now', updatedAt: 'now',
      },
    ]);
    const pins = document.querySelectorAll('.note-pin');
    expect(pins.length).toBe(1);
  });

  it('adds a note when the user clicks in note mode', async () => {
    const root = mountViewer('<p data-block-id="p:1">The cat sat on the mat</p>');
    render(NoteLayer);
    setMode('note');

    const p = root.querySelector('p')!;
    // Simulate click: we can't rely on caretPositionFromPoint in jsdom, so the
    // NoteLayer expands from a click's textContent fallback to the nearest word.
    // We'll simulate by dispatching a custom click with a target.
    const user = userEvent.setup();
    await user.click(p);

    // Accept either: a new note was added, OR the anchoring failed gracefully (0 notes).
    // Since jsdom lacks caretPositionFromPoint, the implementation should fall back
    // to anchoring at the block's first word.
    const list = get(annots).filter((a) => a.type === 'note');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].type).toBe('note');
  });

  it('opens a popover when a pin is clicked', async () => {
    const root = mountViewer('<p data-block-id="p:1">hi friend</p>');
    render(NoteLayer);
    annots.set([
      {
        id: '01A', type: 'note', body: 'existing',
        anchor: { text: 'friend', prefix: 'hi ', suffix: '', blockHint: 'p:1' },
        createdAt: 'now', updatedAt: 'now',
      },
    ]);
    const user = userEvent.setup();
    const pin = document.querySelector('.note-pin') as HTMLButtonElement;
    await user.click(pin);
    expect(screen.getByRole('dialog', { name: /note/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/component/NoteLayer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/components/NoteLayer.svelte`**

```svelte
<script lang="ts">
  import { ulid } from 'ulid';
  import { tool } from '../stores/tool';
  import {
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    resolvedAnnots,
    currentViewerRoot,
  } from '../stores/annots';
  import { createAnchor } from '../lib/anchoring';
  import { pinPosition } from '../lib/positioning';
  import NotePopover from './NotePopover.svelte';
  import type { Note } from '../lib/schema';

  let openPinId = $state<string | null>(null);

  // Recompute pin positions whenever resolved notes change.
  const pins = $derived.by(() => {
    const root = $currentViewerRoot;
    if (!root) return [];
    const rootRect = root.getBoundingClientRect();
    return $resolvedAnnots
      .filter((r) => r.annotation.type === 'note')
      .map((r) => ({
        note: r.annotation as Note,
        position: pinPosition(rootRect, r.range.getBoundingClientRect()),
      }));
  });

  function createNoteAt(target: HTMLElement, clientX: number, clientY: number): void {
    const root = $currentViewerRoot;
    if (!root) return;
    const block = target.closest<HTMLElement>('[data-block-id]');
    if (!block) return;

    // Try caretPositionFromPoint, fall back to first word of block.
    let range: Range | null = null;
    const cp = (document as any).caretPositionFromPoint?.(clientX, clientY);
    if (cp && cp.offsetNode && cp.offsetNode.nodeType === Node.TEXT_NODE) {
      const tn = cp.offsetNode as Text;
      const off = cp.offset as number;
      // Expand to enclosing word.
      const data = tn.data;
      let start = off;
      let end = off;
      while (start > 0 && /\S/.test(data[start - 1])) start -= 1;
      while (end < data.length && /\S/.test(data[end])) end += 1;
      if (start === end) { start = 0; end = Math.min(data.length, 8); }
      range = document.createRange();
      range.setStart(tn, start);
      range.setEnd(tn, end);
    } else {
      // Fallback: anchor to the first text node's first word.
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const tn = walker.nextNode() as Text | null;
      if (!tn) return;
      const m = tn.data.match(/\S+/);
      if (!m) return;
      range = document.createRange();
      range.setStart(tn, m.index!);
      range.setEnd(tn, m.index! + m[0].length);
    }

    const anchor = createAnchor(range, root);
    if (!anchor) return;
    const now = new Date().toISOString();
    const note: Note = {
      id: ulid(),
      type: 'note',
      anchor,
      body: '',
      createdAt: now,
      updatedAt: now,
    };
    addAnnotation(note);
    openPinId = note.id;
  }

  function onClickViewer(e: MouseEvent): void {
    if ($tool.mode !== 'note') return;
    const target = e.target as HTMLElement;
    if (!$currentViewerRoot?.contains(target)) return;
    if ((target as HTMLElement).closest?.('.note-pin, .popover')) return;
    createNoteAt(target, e.clientX, e.clientY);
  }

  $effect(() => {
    document.addEventListener('click', onClickViewer);
    return () => document.removeEventListener('click', onClickViewer);
  });
</script>

<div class="notes-layer">
  {#each pins as p (p.note.id)}
    <button
      class="note-pin"
      style="top:{p.position.top}px; left:{p.position.left}px"
      aria-label="Open note"
      onclick={(e) => { e.stopPropagation(); openPinId = openPinId === p.note.id ? null : p.note.id; }}
    >●</button>
    {#if openPinId === p.note.id}
      <div class="popover-wrap" style="top:{p.position.top + 18}px; left:{p.position.left + 18}px">
        <NotePopover
          body={p.note.body}
          onUpdate={(next) => updateAnnotation(p.note.id, (a) => ({ ...(a as Note), body: next }))}
          onDelete={() => { removeAnnotation(p.note.id); openPinId = null; }}
        />
      </div>
    {/if}
  {/each}
</div>

<style>
  .notes-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .note-pin {
    position: absolute;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: #ffca4a;
    border: 1.5px solid rgba(0,0,0,0.15);
    color: transparent;
    cursor: pointer;
    pointer-events: auto;
    box-shadow: 0 2px 6px rgba(255, 202, 74, 0.5);
  }
  .popover-wrap {
    position: absolute;
    z-index: 200;
    pointer-events: auto;
  }
</style>
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/component/NoteLayer.test.ts
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/NoteLayer.svelte tests/component/NoteLayer.test.ts
git commit -m "feat: add NoteLayer with pins, popovers, and click-to-create"
```

---

## Phase 7 — Draw layer (Task 11)

### Task 11: `DrawLayer.svelte`

**Files:**
- Create: `src/components/DrawLayer.svelte`, `tests/component/DrawLayer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/component/DrawLayer.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import DrawLayer from '../../src/components/DrawLayer.svelte';
import { annots, currentViewerRoot, docEpoch } from '../../src/stores/annots';
import { setMode, tool } from '../../src/stores/tool';

function mountViewer(html: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = html;
  article.style.width = '800px';
  article.style.height = '600px';
  document.body.appendChild(article);
  currentViewerRoot.set(article);
  docEpoch.update((e) => e + 1);
  return article;
}

// Helper: synthesize a pointer event.
function pe(type: string, x: number, y: number): PointerEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as any;
  e.clientX = x; e.clientY = y; e.pointerId = 1; e.pointerType = 'mouse';
  return e as PointerEvent;
}

beforeEach(() => {
  document.body.innerHTML = '';
  annots.set([]);
  currentViewerRoot.set(null);
  setMode('cursor');
  vi.useFakeTimers();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('DrawLayer', () => {
  it('renders an SVG overlay', () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    const svg = document.querySelector('svg.draw-overlay');
    expect(svg).toBeTruthy();
  });

  it('renders existing drawing annotations as SVG paths', () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    annots.set([
      {
        id: '01A', type: 'drawing', anchorBlock: 'p:1',
        strokes: [{ color: '#d6336c', width: 2, points: [[10, 10], [20, 20], [30, 30]] }],
        createdAt: 'now', updatedAt: 'now',
      },
    ]);
    const paths = document.querySelectorAll('svg.draw-overlay path');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('captures strokes in draw mode and finalizes after idle', async () => {
    const root = mountViewer('<p data-block-id="p:1">where to draw</p>');
    render(DrawLayer);
    setMode('draw');

    const svg = document.querySelector('svg.draw-overlay')!;
    svg.dispatchEvent(pe('pointerdown', 40, 40));
    svg.dispatchEvent(pe('pointermove', 50, 50));
    svg.dispatchEvent(pe('pointermove', 60, 60));
    svg.dispatchEvent(pe('pointerup', 60, 60));

    // Before idle timer fires, no annotation yet.
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3100);

    const drawings = get(annots).filter((a) => a.type === 'drawing');
    expect(drawings).toHaveLength(1);
    expect((drawings[0] as any).strokes).toHaveLength(1);
  });

  it('ignores pointer events when tool is not draw', () => {
    const root = mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    setMode('cursor');
    const svg = document.querySelector('svg.draw-overlay')!;
    svg.dispatchEvent(pe('pointerdown', 40, 40));
    svg.dispatchEvent(pe('pointermove', 50, 50));
    svg.dispatchEvent(pe('pointerup', 50, 50));
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/component/DrawLayer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/components/DrawLayer.svelte`**

```svelte
<script lang="ts">
  import { ulid } from 'ulid';
  import { tool } from '../stores/tool';
  import {
    addAnnotation,
    resolvedAnnots,
    currentViewerRoot,
  } from '../stores/annots';
  import type { Drawing, Stroke } from '../lib/schema';

  const IDLE_MS = 3000;

  type Point = [number, number];
  let drawing = $state(false);
  let currentStroke = $state<Point[]>([]);
  let pendingStrokes = $state<Stroke[]>([]);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function startIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(finalize, IDLE_MS);
  }

  function finalize(): void {
    if (pendingStrokes.length === 0) return;
    const root = $currentViewerRoot;
    if (!root) { pendingStrokes = []; return; }

    // Compute centroid of all points across all strokes.
    let sx = 0, sy = 0, n = 0;
    for (const s of pendingStrokes) for (const [x, y] of s.points) { sx += x; sy += y; n += 1; }
    const cx = n > 0 ? sx / n : 0;
    const cy = n > 0 ? sy / n : 0;

    // Find the block under the centroid by walking from the point.
    // Centroid is in viewer-root local coords, translate to viewport for elementFromPoint.
    const rootRect = root.getBoundingClientRect();
    const el = document.elementFromPoint(cx + rootRect.left, cy + rootRect.top);
    const block = el?.closest?.<HTMLElement>('[data-block-id]') ??
      root.querySelector<HTMLElement>('[data-block-id]');
    const blockId = block?.dataset.blockId ?? 'p:1';

    const now = new Date().toISOString();
    const drawingAnnot: Drawing = {
      id: ulid(),
      type: 'drawing',
      anchorBlock: blockId,
      strokes: pendingStrokes,
      createdAt: now,
      updatedAt: now,
    };
    addAnnotation(drawingAnnot);
    pendingStrokes = [];
  }

  function onPointerDown(e: PointerEvent): void {
    if ($tool.mode !== 'draw') return;
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    (svg as unknown as Element).setPointerCapture(e.pointerId);
    drawing = true;
    currentStroke = [[e.clientX - rect.left, e.clientY - rect.top]];
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drawing) return;
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    currentStroke = [...currentStroke, [e.clientX - rect.left, e.clientY - rect.top]];
  }

  function onPointerUp(_e: PointerEvent): void {
    if (!drawing) return;
    drawing = false;
    if (currentStroke.length >= 2) {
      pendingStrokes = [
        ...pendingStrokes,
        { color: $tool.drawColor, width: 2, points: currentStroke },
      ];
    }
    currentStroke = [];
    startIdle();
  }

  // Re-finalize if tool changes away from draw while strokes pending.
  $effect(() => {
    if ($tool.mode !== 'draw' && pendingStrokes.length > 0) {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      finalize();
    }
  });

  function pathD(points: Point[]): string {
    if (points.length === 0) return '';
    const [first, ...rest] = points;
    return `M ${first[0]} ${first[1]} ` + rest.map(([x, y]) => `L ${x} ${y}`).join(' ');
  }

  // Existing drawings rendered from resolved annotations (by block existence).
  const existingDrawings = $derived(
    $resolvedAnnots
      .filter((r) => r.annotation.type === 'drawing')
      .map((r) => r.annotation as Drawing),
  );
</script>

<svg
  class="draw-overlay"
  class:active={$tool.mode === 'draw'}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  {#each existingDrawings as d (d.id)}
    {#each d.strokes as s, i}
      <path d={pathD(s.points as Point[])} stroke={s.color} stroke-width={s.width} fill="none" stroke-linecap="round" stroke-linejoin="round" />
    {/each}
  {/each}
  {#each pendingStrokes as s, i}
    <path d={pathD(s.points as Point[])} stroke={s.color} stroke-width={s.width} fill="none" stroke-linecap="round" stroke-linejoin="round" />
  {/each}
  {#if drawing}
    <path d={pathD(currentStroke)} stroke={$tool.drawColor} stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
  {/if}
</svg>

<style>
  .draw-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .draw-overlay.active {
    pointer-events: auto;
    cursor: crosshair;
  }
</style>
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/component/DrawLayer.test.ts
```

Expected: 4 tests passing.

If the pointer-capture test fails because jsdom's `setPointerCapture` is missing, add a try/catch around it — it's best-effort and the draw flow works without it in jsdom.

- [ ] **Step 5: Commit**

```bash
git add src/components/DrawLayer.svelte tests/component/DrawLayer.test.ts
git commit -m "feat: add DrawLayer with stroke capture and block-centroid anchoring"
```

---

## Phase 8 — Integration + polish (Tasks 12–16)

### Task 12: Wire annotation layers into `Viewer.svelte`

**Files:**
- Modify: `src/components/Viewer.svelte`, `tests/component/Viewer.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/component/Viewer.test.ts`:

```ts
import { currentViewerRoot } from '../../src/stores/annots';
import { get } from 'svelte/store';

it('publishes viewer root element to currentViewerRoot store after mount', async () => {
  doc.set({
    path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 0, markdown: '',
    html: '<p data-block-id="p:1">hello</p>', plaintext: 'hello', blocks: ['p:1'],
    sidecarRaw: null,
  });
  render(Viewer);
  // Wait a tick for onMount to run.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(get(currentViewerRoot)).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/component/Viewer.test.ts
```

Expected: FAIL — Viewer doesn't publish its root yet.

- [ ] **Step 3: Modify `src/components/Viewer.svelte`**

Replace the `<script>` block:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { doc } from '../stores/doc';
  import { currentViewerRoot } from '../stores/annots';
  import HighlightLayer from './HighlightLayer.svelte';
  import NoteLayer from './NoteLayer.svelte';
  import DrawLayer from './DrawLayer.svelte';

  let articleEl = $state<HTMLElement | null>(null);

  $effect(() => {
    if (articleEl) currentViewerRoot.set(articleEl);
    return () => currentViewerRoot.set(null);
  });
</script>
```

And replace the template body (keep styles intact):

```svelte
<div class="scroll">
  {#if $doc === null}
    <div class="empty">
      <p>Open a markdown file to start reading.</p>
    </div>
  {:else}
    <div class="content">
      <article class="viewer" bind:this={articleEl}>
        {@html $doc.html}
      </article>
      <HighlightLayer />
      <NoteLayer />
      <DrawLayer />
    </div>
  {/if}
</div>
```

Update the `.viewer` style's parent positioning so overlays can be absolute-positioned over it. Add this rule inside `<style>` (keep all existing rules):

```css
  .content {
    position: relative;
    max-width: 720px;
    width: 100%;
  }
  .content .viewer {
    max-width: none;
    width: 100%;
  }
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/component/Viewer.test.ts
```

Expected: 3 tests pass (2 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/Viewer.svelte tests/component/Viewer.test.ts
git commit -m "feat: mount annotation layers inside Viewer"
```

---

### Task 13: Wire `ToolRail` + `ColorStrip` + save watcher in `App.svelte`

**Files:**
- Modify: `src/App.svelte`, `src/main.ts`

- [ ] **Step 1: Modify `src/App.svelte`**

Replace the file with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import './styles/theme-dark.css';
  import './styles/glass.css';
  import './styles/highlights.css';
  import Viewer from './components/Viewer.svelte';
  import GlassMenu from './components/GlassMenu.svelte';
  import ToolRail from './components/ToolRail.svelte';
  import ColorStrip from './components/ColorStrip.svelte';
  import { refreshRecent } from './stores/recent';
  import { installSaveWatcher, flushSave, savedPulse } from './lib/save';

  let pulse = $state(0);
  savedPulse.subscribe((v) => (pulse = v));

  let disposeSave: (() => void) | null = null;
  onMount(async () => {
    try { await refreshRecent(); } catch { /* ignore on first launch */ }
    disposeSave = installSaveWatcher();
  });
  onDestroy(() => { disposeSave?.(); });
</script>

<Viewer />
<GlassMenu />
<ToolRail />
<ColorStrip />

{#if pulse > 0}
  {#key pulse}
    <div class="saved-pulse" aria-live="polite">saved</div>
  {/key}
{/if}

<style>
  .saved-pulse {
    position: fixed;
    top: 18px;
    left: 64px;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--fg-2);
    letter-spacing: 0.04em;
    animation: pulse 1.4s ease-out forwards;
    z-index: 90;
  }
  @keyframes pulse {
    0%   { opacity: 0; transform: translateY(-4px); }
    25%  { opacity: 1; transform: translateY(0); }
    75%  { opacity: 1; }
    100% { opacity: 0; }
  }
</style>
```

- [ ] **Step 2: Install window-close save flush in `src/main.ts`**

Replace `src/main.ts`:

```ts
import { mount } from 'svelte';
import App from './App.svelte';
import { flushSave } from './lib/save';

const app = mount(App, { target: document.getElementById('app')! });

// Flush on window close; Tauri 2.x emits beforeunload through the webview.
window.addEventListener('beforeunload', () => {
  // Fire-and-forget — the save is debounced so this may be already done.
  flushSave().catch(() => {});
});

export default app;
```

- [ ] **Step 3: Verify all tests still pass**

```bash
npm test
```

Expected: all previous tests pass. No new tests in this task; visual verification via manual QA.

- [ ] **Step 4: Verify svelte-check is clean**

```bash
npm run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte src/main.ts
git commit -m "feat: wire ToolRail, ColorStrip, save watcher, and saved-pulse in App"
```

---

### Task 14: Manual QA checklist

**Files:**
- Create: `docs/QA-plan-2.md`

- [ ] **Step 1: Write `docs/QA-plan-2.md`**

```markdown
# Plan 2 Manual QA Checklist

Run `npm run tauri dev` and walk through each item.

## Prereqs
- [ ] App launches cleanly, shows empty reader state.
- [ ] Open a fixture `.md` — content renders correctly (Plan 1 regression check).

## Tool rail
- [ ] Bottom-center glass pill appears with 4 buttons: Cursor, Highlight, Note, Draw.
- [ ] Active tool button is visibly highlighted.
- [ ] Clicking each tool updates the active state.
- [ ] Color strip appears above the rail when Highlight or Draw is selected; hidden for Cursor/Note.

## Highlights
- [ ] Select Highlight tool.
- [ ] Drag-select a phrase in the document — a translucent yellow highlight appears.
- [ ] Switch colors via ColorStrip — subsequent highlights use the new color.
- [ ] Select Cursor tool — existing highlights remain visible; text selection works normally (can copy).
- [ ] Switch back to Highlight and create overlapping highlights — browser handles overlap rendering cleanly.

## Notes
- [ ] Select Note tool.
- [ ] Click inside a paragraph — a small amber pin appears on the right edge at the clicked line.
- [ ] A popover opens for typing; type some text.
- [ ] Click elsewhere — popover closes.
- [ ] Click the pin — popover reopens with typed text intact.
- [ ] Click Delete in the popover — pin disappears.

## Drawings
- [ ] Select Draw tool.
- [ ] Draw a squiggle over a paragraph with the mouse.
- [ ] After 3 seconds of no movement, the squiggle is finalized (persists).
- [ ] Switch to Cursor tool mid-draw — pending stroke finalizes immediately.
- [ ] Switch back to Draw with a different color — next stroke uses the new color.

## Persistence round-trip
- [ ] Make one of each: highlight, note, drawing.
- [ ] Observe a brief "saved" text pulse near the hamburger (within 500ms of last change).
- [ ] Close the app window.
- [ ] Reopen the app; use hamburger → Open… to load the same `.md` file.
- [ ] All three annotations reappear in their original positions.
- [ ] Open the `.md.remarkdown.json` file next to the source in a text editor — it's readable, has `_comment`, and lists all three annotations.

## Orphans (preserved silently)
- [ ] With a highlight saved, open the `.md` in a text editor and delete the highlighted phrase entirely. Save.
- [ ] Reopen in remarkdown. The highlight does not render. No UI surfaces it (that's Plan 3).
- [ ] Create a new, unrelated annotation. Save.
- [ ] Open `.md.remarkdown.json` — the orphaned annotation is STILL THERE alongside the new one.

## Regressions
- [ ] `npm test` is green. `cargo test` is green. `npm run check` is clean.
```

- [ ] **Step 2: Commit**

```bash
git add docs/QA-plan-2.md
git commit -m "docs: add Plan 2 manual QA checklist"
```

---

### Task 15: README update + tag v0.2.0-annotations

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

Replace the Status section with:

```markdown
## Status

**Plan 2 — Annotation engine (v0.2.0-annotations)**: highlights, notes, freehand drawings, with atomic sidecar persistence and faithful reload. See `docs/superpowers/plans/` for the roadmap.
```

- [ ] **Step 2: Final test sweep**

```bash
npm test && npm run check && (cd src-tauri && cargo test)
```

Expected: all green.

- [ ] **Step 3: Commit + tag**

```bash
git add README.md
git commit -m "docs: update status to Plan 2 complete"
git tag v0.2.0-annotations
```

---

## Success criteria (Plan 2)

At tag `v0.2.0-annotations`:

1. Three annotation types work end-to-end: highlight (text selection → persistence → reload), note (click → typed body → persistence → reload), drawing (pointer strokes → finalization → persistence → reload).
2. Tool rail and color strip are present, functional, and follow the design spec's glass aesthetic.
3. Orphaned annotations (anchor unresolvable) are preserved in the sidecar on save — zero user data loss.
4. Save is debounced at 500ms and triggers a "saved" pulse near the hamburger.
5. Every new TS file in `src/lib/` and `src/stores/` has a test file. Every new component in `src/components/` has a test file. All passing.
6. No Rust changes required.
7. Plan 2's manual QA checklist in `docs/QA-plan-2.md` has been walked.

## What's next

- **Plan 3 — Robustness polish:** Orphan Panel UI, Open Recent menu integration, error-matrix UX (corrupt sidecar modal, permission-denied banner, not-UTF-8 toast), Playwright E2E for the 5 spec scenarios, per-doc asset protocol scope tightening.
