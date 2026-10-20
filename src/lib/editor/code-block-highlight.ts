// PM plugin: maintains a DecorationSet of inline color spans for
// every code_block in the doc. Decorations are produced by Shiki
// (re-using the reader's singleton highlighter), debounced so fast
// typing doesn't keep the highlighter hot. Decorations are NEVER
// written into the contentDOM — they're delivered via props.decorations
// so PM still owns text rendering.
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import {
  getSingletonHighlighter,
  type Highlighter,
  type BundledLanguage,
  type SpecialLanguage,
} from 'shiki';
import { SUPPORTED_LANGUAGES, resolveLanguage } from './code-block-languages';

interface HighlightState {
  decorations: DecorationSet;
}

export const codeBlockHighlightKey = new PluginKey<HighlightState>(
  'codeBlockHighlight',
);

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = getSingletonHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: [...SUPPORTED_LANGUAGES],
    });
  }
  return highlighterPromise;
}

// Tokens per (language, text), so an edit only tokenizes the block it
// changed — the others come from here. Bounded: the oldest go first.
type Tokens = ReturnType<Highlighter['codeToTokensWithThemes']>;
const tokenCache = new WeakMap<Highlighter, Map<string, Tokens>>();
const TOKEN_CACHE_LIMIT = 300;

function tokensFor(hl: Highlighter, lang: string, text: string): Tokens {
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
    lang: lang as BundledLanguage | SpecialLanguage,
    themes: { dark: 'github-dark', light: 'github-light' },
  });
  cache.set(key, tokens);
  if (cache.size > TOKEN_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return tokens;
}

// Note: we sum tok.content.length manually rather than reading tok.offset.
// Shiki's TokenBase.offset is documented as "relative to the input code"
// but the per-line semantics are ambiguous in practice; the manual sum is
// verified correct by the position-math test in code-blocks.test.ts.
// A future contributor with more Shiki context can revisit.
export function buildDecorations(doc: Node, hl: Highlighter): DecorationSet {
  const decs: Decoration[] = [];
  doc.descendants((node, pos) => {
    // Into lists, quotes and callouts (code can sit in them); not into
    // paragraphs and headings, which can't hold code blocks.
    if (node.type.name !== 'code_block') return !node.isTextblock;
    const lang = resolveLanguage(String(node.attrs.language || ''));
    const text = node.textContent;
    if (!text) return false;
    let tokens;
    try {
      tokens = tokensFor(hl, lang, text);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('codeBlockHighlight: tokenize failed', { lang, err });
      }
      return false;
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
    return false;
  });
  return DecorationSet.create(doc, decs);
}

export function createCodeBlockHighlightPlugin(): Plugin<HighlightState> {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return new Plugin<HighlightState>({
    key: codeBlockHighlightKey,
    state: {
      init() {
        return { decorations: DecorationSet.empty };
      },
      apply(tr, prev) {
        // A meta payload is how the async Shiki callback ships its
        // freshly-built DecorationSet back into plugin state.
        const meta = tr.getMeta(codeBlockHighlightKey) as
          | { decorations: DecorationSet }
          | undefined;
        if (meta?.decorations) return { decorations: meta.decorations };
        // Otherwise, map existing decorations through the document
        // change so positions stay valid for the user's next keystroke
        // until the debounced re-tokenize lands.
        if (tr.docChanged) {
          return { decorations: prev.decorations.map(tr.mapping, tr.doc) };
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
      // Single async-aware dispatcher: shared between the initial-mount path
      // and the debounced update path. The isDestroyed check guards the
      // window between awaiting getHighlighter() and dispatching, where the
      // editor could be torn down (e.g. component unmount during HMR).
      function scheduleHighlight(view: EditorView): void {
        void getHighlighter().then((hl) => {
          if (view.isDestroyed) return;
          const decs = buildDecorations(view.state.doc, hl);
          view.dispatch(
            view.state.tr.setMeta(codeBlockHighlightKey, { decorations: decs }),
          );
        });
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
