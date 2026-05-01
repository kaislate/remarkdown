// src/lib/editor/code-block-languages.ts
//
// Single source of truth for the Shiki language set. The reader
// (MarkdownRenderer.ts) and the editor (code-block-highlight.ts +
// code-block-node-view.ts) all reference these; keeping the list in
// one place avoids the highlighter being asked to load a language
// it doesn't bundle, and avoids the picker advertising languages
// the highlighter can't handle.

export const SUPPORTED_LANGUAGES = [
  'typescript', 'javascript', 'tsx', 'jsx', 'rust', 'python', 'go',
  'bash', 'shell', 'json', 'yaml', 'toml', 'sql', 'html', 'css',
  'markdown', 'svelte', 'cpp', 'objc', 'fsharp',
] as const;

// User-friendly aliases → canonical Shiki name. The first three are
// the user-typed-with-symbols variants; the rest are common shorthand
// identifiers (`ts`, `js`, `py`, ...) that Shiki recognises natively
// when its bundled languages are loaded. The reader's previous path
// trusted Shiki's getLoadedLanguages() (which returns canonical names
// PLUS registered aliases) and so silently accepted these — the
// shared resolveLanguage check below only consults SUPPORTED_LANGUAGES,
// so we have to enumerate the aliases here to avoid silently
// downgrading `\`\`\`ts` to plain text.
export const LANG_ALIASES: Record<string, string> = {
  'c++': 'cpp',
  'objective-c': 'objc',
  'f#': 'fsharp',
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  zsh: 'bash',
  shellscript: 'shell',
  yml: 'yaml',
  md: 'markdown',
  fs: 'fsharp',
  'cpp-macro': 'cpp',
};

// Resolve any input language string to either a supported Shiki
// language or `'text'` (which Shiki always handles as a no-op).
export function resolveLanguage(input: string): string {
  const trimmed = (input || '').trim().toLowerCase();
  if (!trimmed) return 'text';
  const aliased = LANG_ALIASES[trimmed] ?? trimmed;
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(aliased)
    ? aliased
    : 'text';
}

// Display label for the language pill. Empty / `'text'` shows as
// "Plain text"; everything else is shown verbatim (lowercase to match
// Shiki convention).
export function languageLabel(lang: string): string {
  if (!lang || lang === 'text') return 'Plain text';
  return lang;
}
