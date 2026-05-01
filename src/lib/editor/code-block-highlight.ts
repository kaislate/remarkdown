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
      themes: ['github-dark'],
      langs: [...SUPPORTED_LANGUAGES],
    });
  }
  return highlighterPromise;
}

function buildDecorations(doc: Node, hl: Highlighter): DecorationSet {
  const decs: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return false; // don't descend
    const lang = resolveLanguage(String(node.attrs.language || ''));
    const text = node.textContent;
    if (!text) return false;
    let tokens;
    try {
      // resolveLanguage returns either a SUPPORTED_LANGUAGES entry or 'text'
      // (a Shiki SpecialLanguage). Cast to BundledLanguage to satisfy the
      // tokenizer's typed lang parameter; values are validated at runtime.
      tokens = hl.codeToTokensBase(text, {
        lang: lang as BundledLanguage,
        theme: 'github-dark',
      });
    } catch {
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
        if (tok.color) {
          decs.push(
            Decoration.inline(start, end, { style: `color: ${tok.color}` }),
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
      // Initial highlight on mount (in case the doc opens with code blocks).
      void getHighlighter().then((hl) => {
        const decs = buildDecorations(view.state.doc, hl);
        view.dispatch(
          view.state.tr.setMeta(codeBlockHighlightKey, { decorations: decs }),
        );
      });

      return {
        update(updatedView, prevState) {
          if (prevState.doc.eq(updatedView.state.doc)) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            void getHighlighter().then((hl) => {
              const decs = buildDecorations(updatedView.state.doc, hl);
              updatedView.dispatch(
                updatedView.state.tr.setMeta(codeBlockHighlightKey, {
                  decorations: decs,
                }),
              );
            });
          }, 150);
        },
        destroy() {
          if (debounceTimer) clearTimeout(debounceTimer);
        },
      };
    },
  });
}
