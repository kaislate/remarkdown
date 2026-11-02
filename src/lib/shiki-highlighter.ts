// The one Shiki highlighter, shared by the reader and the editor. It starts
// with just the two themes; each code grammar is loaded the first time a
// document (or the editor) needs it, instead of all twenty supported ones —
// cpp alone is 700 KB — before the first code block can be shown.
//
// The colouring is exactly what loading every grammar up front gave. One
// thing makes that more than "load the fence's language": a few grammars
// colour code nested inside them with whichever other grammars happen to be
// loaded (markdown's fenced code, svelte's <style lang="…"> / markdown
// blocks, F#'s doc comments, which are markdown). For those, every
// supported grammar is loaded first, as before.

import { createHighlighterCore, type HighlighterCore, type LanguageInput } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { SUPPORTED_LANGUAGES } from './editor/code-block-languages';

type Supported = (typeof SUPPORTED_LANGUAGES)[number];

// Explicit, so the build only ships these grammars (and what they import).
const GRAMMARS: Record<Supported, LanguageInput> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  shell: () => import('shiki/langs/shell.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  objc: () => import('shiki/langs/objc.mjs'),
  fsharp: () => import('shiki/langs/fsharp.mjs'),
};

// Grammars that colour nested code with any other loaded grammar.
const NEEDS_ALL = new Set<string>(['markdown', 'svelte', 'fsharp']);

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loaded = new Map<string, Promise<void>>();

export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import('shiki/themes/github-dark.mjs'), import('shiki/themes/github-light.mjs')],
    langs: [],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  });
  return highlighterPromise;
}

function isSupported(lang: string): lang is Supported {
  return Object.prototype.hasOwnProperty.call(GRAMMARS, lang);
}

// Loads what highlighting these languages (supported names, or 'text')
// needs. Each grammar loads once, even when asked for again meanwhile.
export async function ensureLanguages(langs: Iterable<string>): Promise<HighlighterCore> {
  const hl = await getHighlighter();
  const wanted = new Set<Supported>();
  for (const lang of langs) {
    if (!isSupported(lang)) continue;
    if (NEEDS_ALL.has(lang)) SUPPORTED_LANGUAGES.forEach((l) => wanted.add(l));
    else wanted.add(lang);
  }
  // In list order, as the old highlighter registered them.
  // The modules download in parallel; they're registered one by one.
  const order = SUPPORTED_LANGUAGES.filter((l) => wanted.has(l));
  const modules = new Map(order.filter((l) => !loaded.has(l)).map((l) => [l, (GRAMMARS[l] as () => Promise<unknown>)()]));
  for (const lang of order) {
    let load = loaded.get(lang);
    if (!load) {
      load = hl.loadLanguage(modules.get(lang) as LanguageInput);
      loaded.set(lang, load);
    }
    await load;
  }
  return hl;
}

// For tests: how many grammars are registered (dependencies included).
export function loadedLanguageCount(): number {
  return loaded.size;
}
