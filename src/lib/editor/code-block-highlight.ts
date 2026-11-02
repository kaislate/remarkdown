// PM plugin: maintains a DecorationSet of inline color spans for
// every code_block in the doc. Decorations are produced by Shiki
// (re-using the reader's singleton highlighter), debounced so fast
// typing doesn't keep the highlighter hot. Decorations are NEVER
// written into the contentDOM — they're delivered via props.decorations
// so PM still owns text rendering.
//
// After the first full colouring, an edit only colours again the code
// blocks it touched: the plugin state remembers where the document changed
// (`dirty`), and the debounced pass replaces just those blocks' spans.
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import { AttrStep } from 'prosemirror-transform';
import type { HighlighterCore as Highlighter } from 'shiki/core';
import { SUPPORTED_LANGUAGES, resolveLanguage } from './code-block-languages';
import { ensureLanguages } from '../shiki-highlighter';
import { isMermaidFence } from '../mermaid-fence';

interface HighlightState {
  decorations: DecorationSet;
  // Where the document changed since the colouring was last brought up to
  // date, in the current document's positions.
  dirty: Array<[number, number]>;
}

export const codeBlockHighlightKey = new PluginKey<HighlightState>(
  'codeBlockHighlight',
);

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    // The reader's highlighter, with every supported grammar: any code
    // block can be switched to any language while editing.
    const starting = ensureLanguages(SUPPORTED_LANGUAGES);
    highlighterPromise = starting;
    // One that couldn't start isn't kept: the next edit tries again.
    starting.catch(() => {
      if (highlighterPromise === starting) highlighterPromise = null;
    });
  }
  return highlighterPromise;
}

// Tokens per (language, text), so an edit only tokenizes the block it
// changed — the others come from here. Bounded, the least recently used
// going first. An editor keeps room for every code block of its document
// plus TOKEN_CACHE_LIMIT more (cacheCapFor), in every pass, full or after an
// edit: a full colouring visits the blocks in document order, so a cap
// below that evicts exactly the block it needs next, all the way down,
// and each edit leaves the block's old text behind until it ages out.
type Tokens = ReturnType<Highlighter['codeToTokensWithThemes']>;
const tokenCache = new WeakMap<Highlighter, Map<string, Tokens>>();
const TOKEN_CACHE_LIMIT = 300;

function cacheCapFor(codeBlocks: number): number {
  return codeBlocks + TOKEN_CACHE_LIMIT;
}

function tokensFor(hl: Highlighter, lang: string, text: string, cap = TOKEN_CACHE_LIMIT): Tokens {
  let cache = tokenCache.get(hl);
  if (!cache) tokenCache.set(hl, (cache = new Map()));
  const key = `${lang}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  // resolveLanguage returns either a SUPPORTED_LANGUAGES entry or 'text'
  // (a Shiki SpecialLanguage); values are validated at runtime. Both
  // colourings, as in the reader: dark by default, the light one
  // (--shiki-light) swapped in by article.css on light pages.
  const tokens = hl.codeToTokensWithThemes(text, {
    lang,
    themes: { dark: 'github-dark', light: 'github-light' },
  });
  cache.set(key, tokens);
  while (cache.size > cap) cache.delete(cache.keys().next().value!);
  return tokens;
}

// A diagram's source is never shown (the editor draws the diagram, and
// article.css hides the source), so it isn't coloured.
function isColouredCode(node: Node): boolean {
  return node.type.name === 'code_block' && !isMermaidFence(String(node.attrs.language || ''));
}

// Note: we sum tok.content.length manually rather than reading tok.offset.
// Shiki's TokenBase.offset is documented as "relative to the input code"
// but the per-line semantics are ambiguous in practice; the manual sum is
// verified correct by the position-math test in code-blocks.test.ts.
// A future contributor with more Shiki context can revisit.
function blockDecorations(node: Node, pos: number, hl: Highlighter, cacheCap?: number): Decoration[] {
  const decs: Decoration[] = [];
  const lang = resolveLanguage(String(node.attrs.language || ''));
  const text = node.textContent;
  if (!text) return decs;
  let tokens;
  try {
    tokens = tokensFor(hl, lang, text, cacheCap);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('codeBlockHighlight: tokenize failed', { lang, err });
    }
    return decs;
  }
  // PM positions: pos is BEFORE the code_block; pos + 1 is the
  // start of its first text node. Each character (including \n)
  // counts as one position.
  let offset = 0;
  for (let lineIdx = 0; lineIdx < tokens.length; lineIdx++) {
    const line = tokens[lineIdx];
    for (const tok of line) {
      const len = tok.content.length;
      if (len === 0) continue;
      const start = pos + 1 + offset;
      const end = start + len;
      const dark = tok.variants.dark?.color;
      const light = tok.variants.light?.color;
      if (dark) {
        decs.push(
          Decoration.inline(start, end, {
            class: 'shiki-tok',
            style: `color: ${dark}${light ? `; --shiki-light: ${light}` : ''}`,
          }),
        );
      }
      offset += len;
    }
    // Newline between lines (Shiki splits on \n; the \n is a position too).
    if (lineIdx < tokens.length - 1) offset += 1;
  }
  return decs;
}

export function buildDecorations(doc: Node, hl: Highlighter): DecorationSet {
  return buildDecorationsCounted(doc, hl).set;
}

// A full colouring, and how many code blocks it coloured.
function buildDecorationsCounted(doc: Node, hl: Highlighter): { set: DecorationSet; blocks: number } {
  const blocks: Array<[Node, number]> = [];
  doc.descendants((node, pos) => {
    // Into lists, quotes and callouts (code can sit in them); not into
    // paragraphs and headings, which can't hold code blocks.
    if (node.type.name !== 'code_block') return !node.isTextblock;
    if (isColouredCode(node)) blocks.push([node, pos]);
    return false;
  });
  const decs: Decoration[] = [];
  const cap = cacheCapFor(blocks.length);
  for (const [node, pos] of blocks) {
    for (const d of blockDecorations(node, pos, hl, cap)) decs.push(d);
  }
  return { set: DecorationSet.create(doc, decs), blocks: blocks.length };
}

// Brings `set` (already mapped onto `doc`) up to date where the document
// changed: every textblock a dirty range touches loses its spans, and the
// code blocks among them get fresh ones (a block that stopped being code,
// or became a diagram, keeps none). Spans elsewhere stay as they are.
// `cacheCap` is the token cache's size for this document (cacheCapFor).
export function refreshDecorations(
  set: DecorationSet,
  doc: Node,
  dirty: Array<[number, number]>,
  hl: Highlighter,
  cacheCap?: number,
): DecorationSet {
  const size = doc.content.size;
  const touched = new Map<number, Node>();
  for (const [a, b] of dirty) {
    // One position wider on each side: a change right at a block's edge
    // (its type, its language) counts as touching it.
    const from = Math.max(0, Math.min(a, b) - 1);
    const to = Math.min(size, Math.max(a, b) + 1);
    if (from >= to) continue;
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) {
        touched.set(pos, node);
        return false;
      }
      return true;
    });
  }
  if (touched.size === 0) return set;
  const stale: Decoration[] = [];
  const fresh: Decoration[] = [];
  for (const [pos, node] of touched) {
    for (const d of set.find(pos, pos + node.nodeSize)) stale.push(d);
    if (isColouredCode(node)) {
      for (const d of blockDecorations(node, pos, hl, cacheCap)) fresh.push(d);
    }
  }
  return set.remove(stale).add(doc, fresh);
}

// The ranges a transaction changed, in its resulting document.
function changedRanges(tr: Transaction): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1);
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
    // Changing a node's attribute (a code block's language) moves nothing,
    // so its step map is empty.
    if (step instanceof AttrStep) {
      const at = rest.map(step.pos, 1);
      ranges.push([at, at + 1]);
    }
  });
  return ranges;
}

// Past this many separate ranges (a long burst of edits all over the
// document), one range spanning them all is cheaper to keep.
const DIRTY_LIMIT = 64;

export function createCodeBlockHighlightPlugin(): Plugin<HighlightState> {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return new Plugin<HighlightState>({
    key: codeBlockHighlightKey,
    state: {
      init() {
        return { decorations: DecorationSet.empty, dirty: [] };
      },
      apply(tr, prev) {
        // A meta payload is how the async Shiki callback ships its
        // freshly-built DecorationSet back into plugin state. It was built
        // from the state it is applied to, so nothing is left to redo.
        const meta = tr.getMeta(codeBlockHighlightKey) as
          | { decorations: DecorationSet }
          | undefined;
        if (meta?.decorations) return { decorations: meta.decorations, dirty: [] };
        // Otherwise, map existing decorations through the document
        // change so positions stay valid for the user's next keystroke
        // until the debounced re-tokenize lands, and remember where the
        // document changed.
        if (tr.docChanged) {
          let dirty: Array<[number, number]> = prev.dirty.map(([a, b]) => [
            tr.mapping.map(a, -1),
            tr.mapping.map(b, 1),
          ]);
          for (const r of changedRanges(tr)) dirty.push(r);
          if (dirty.length > DIRTY_LIMIT) {
            let lo = Infinity;
            let hi = -Infinity;
            for (const [a, b] of dirty) {
              lo = Math.min(lo, a);
              hi = Math.max(hi, b);
            }
            dirty = [[lo, hi]];
          }
          return { decorations: prev.decorations.map(tr.mapping, tr.doc), dirty };
        }
        return prev;
      },
    },
    props: {
      decorations(state: EditorState) {
        return (
          codeBlockHighlightKey.getState(state)?.decorations ??
          DecorationSet.empty
        );
      },
    },
    view(view: EditorView) {
      // Until a full colouring of this view has landed, every pass is a
      // full one (the first, or a retry if the highlighter failed to
      // start); after that, only what changed is coloured again.
      let coloured = false;
      // The token cache's size for this document, from its last full
      // colouring (an edit adds or removes a block or two at most).
      let cacheCap = TOKEN_CACHE_LIMIT;

      // Single async-aware dispatcher: shared between the initial-mount path
      // and the debounced update path. The isDestroyed check guards the
      // window between awaiting getHighlighter() and dispatching, where the
      // editor could be torn down (e.g. component unmount during HMR).
      // Everything after the await runs synchronously on the current state,
      // so the dirty ranges it clears are exactly the ones it handled.
      function scheduleHighlight(view: EditorView): void {
        // If no highlighter can start, the code just stays uncoloured.
        getHighlighter().then((hl) => {
          if (view.isDestroyed) return;
          const current = codeBlockHighlightKey.getState(view.state);
          let decs: DecorationSet;
          if (!coloured || !current) {
            const full = buildDecorationsCounted(view.state.doc, hl);
            decs = full.set;
            cacheCap = cacheCapFor(full.blocks);
            coloured = true;
          } else {
            if (current.dirty.length === 0) return;
            decs = refreshDecorations(current.decorations, view.state.doc, current.dirty, hl, cacheCap);
          }
          view.dispatch(
            view.state.tr.setMeta(codeBlockHighlightKey, { decorations: decs }),
          );
        }, () => {});
      }

      // Initial highlight on mount (in case the doc opens with code blocks).
      scheduleHighlight(view);

      return {
        update(updatedView, prevState) {
          if (prevState.doc.eq(updatedView.state.doc)) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            scheduleHighlight(updatedView);
          }, 150);
        },
        destroy() {
          if (debounceTimer) clearTimeout(debounceTimer);
        },
      };
    },
  });
}
