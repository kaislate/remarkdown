// The one Shiki highlighter the reader and the editor share.
//
// Shiki's default regex engine (Oniguruma) is WebAssembly, which the CSP
// allows through 'wasm-unsafe-eval'. WebKit before Safari 16 (macOS 12's)
// doesn't know that keyword and refuses WebAssembly outright, so there the
// highlighter starts on Shiki's JavaScript regex engine instead. It is
// loaded only then, and is forgiving: a grammar pattern it can't express
// is skipped rather than failing the language.
import { createHighlighter, type Highlighter } from 'shiki';
import { SUPPORTED_LANGUAGES } from './editor/code-block-languages';

const options = {
  themes: ['github-dark', 'github-light'],
  langs: [...SUPPORTED_LANGUAGES],
};

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    const starting = createHighlighter(options).catch(async () => {
      const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript');
      return createHighlighter({ ...options, engine: createJavaScriptRegexEngine({ forgiving: true }) });
    });
    highlighterPromise = starting;
    // A highlighter that couldn't start isn't kept: the next caller tries again.
    starting.catch(() => {
      if (highlighterPromise === starting) highlighterPromise = null;
    });
  }
  return highlighterPromise;
}
