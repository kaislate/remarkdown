import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import katex from '@vscode/markdown-it-katex';
import { getSingletonHighlighter, type Highlighter } from 'shiki';
import { calloutsPlugin } from './markdown-it-callouts';

export interface RenderResult {
  html: string;
  plaintext: string;
  blocks: string[]; // e.g., ["h:1", "p:2", "ul:3"]
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
})
  .use(footnote)
  .use(taskLists, { enabled: true, label: false })
  .use(katex.default ?? katex)
  .use(calloutsPlugin);

// Preload common languages lazily the first time render() is called.
const SUPPORTED_LANGS = [
  'typescript', 'javascript', 'tsx', 'jsx', 'rust', 'python', 'go',
  'bash', 'shell', 'json', 'yaml', 'toml', 'sql', 'html', 'css',
  'markdown', 'svelte', 'cpp', 'objc', 'fsharp',
];

// Map non-standard language identifiers (as emitted by markdown-it) to Shiki canonical names.
const LANG_ALIASES: Record<string, string> = {
  'c++': 'cpp',
  'objective-c': 'objc',
  'f#': 'fsharp',
};

// Matches fenced mermaid blocks specifically (before Shiki touches them).
const mermaidFenceRe = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g;

const fenceRe = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g;

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = getSingletonHighlighter({
      themes: ['github-dark'],
      langs: SUPPORTED_LANGS,
    });
  }
  return highlighterPromise;
}

/**
 * Replace mermaid fenced blocks with placeholder divs BEFORE Shiki runs.
 * The mermaid source is HTML-entity-encoded and stored in data-mermaid so it
 * survives the data attribute without breaking HTML parsing.
 */
function extractMermaidBlocks(html: string): string {
  if (!html.includes('language-mermaid')) return html;
  return html.replace(mermaidFenceRe, (_m, body) => {
    const source = decodeEntities(body);
    const encoded = source
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<div class="mermaid-block" data-mermaid="${encoded}"></div>`;
  });
}

async function highlightFences(html: string): Promise<string> {
  if (!html.includes('<pre><code class="language-')) return html;
  const highlighter = await getHighlighter();
  // Use the callback form so every match is replaced, even if two fences share identical text.
  return html.replace(fenceRe, (_m, lang, body) => {
    const raw = decodeEntities(body);
    const loaded = highlighter.getLoadedLanguages() as readonly string[];
    const normalizedLang = LANG_ALIASES[lang] ?? lang;
    const resolvedLang = loaded.includes(normalizedLang) ? normalizedLang : 'text';
    return highlighter.codeToHtml(raw, { lang: resolvedLang, theme: 'github-dark' });
  });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const BLOCK_TAG_TO_KIND: Record<string, string> = {
  H1: 'h', H2: 'h', H3: 'h', H4: 'h', H5: 'h', H6: 'h',
  P: 'p',
  UL: 'ul', OL: 'ol',
  BLOCKQUOTE: 'bq',
  PRE: 'pre',
  HR: 'hr',
  TABLE: 'table',
  DIV: 'div',
  FIGURE: 'fig',
};

function tagTopLevelBlocks(html: string): { html: string; blocks: string[] } {
  // Use a DOMParser in environments that have one (jsdom in tests, webview at runtime).
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return { html, blocks: [] };

  const blocks: string[] = [];
  let idx = 0;
  for (const child of Array.from(root.children)) {
    idx += 1;
    const kind = BLOCK_TAG_TO_KIND[child.tagName] ?? child.tagName.toLowerCase();
    const id = `${kind}:${idx}`;
    child.setAttribute('data-block-id', id);
    blocks.push(id);
  }
  return { html: root.innerHTML, blocks };
}

function extractPlaintext(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export interface RenderOptions {
  baseDir?: string;
  toAssetUrl?: (absolutePath: string) => string;
}

function isAbsoluteUrl(src: string): boolean {
  return (
    /^(https?:|asset:|data:|file:)/i.test(src) ||
    src.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(src) // Windows drive-letter absolute paths
  );
}

function joinPath(baseDir: string, rel: string): string {
  // Minimal POSIX-style join (our stored paths are normalized to forward slashes).
  const parts = (baseDir + '/' + rel).split('/').filter(Boolean);
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return '/' + stack.join('/');
}

function rewriteImageSrcs(html: string, opts: RenderOptions): string {
  if (!opts.baseDir || !opts.toAssetUrl) return html;
  const { baseDir, toAssetUrl } = opts;
  return html.replace(/<img([^>]*?)src="([^"]+)"([^>]*)>/g, (m, pre, src, post) => {
    if (isAbsoluteUrl(src)) return m;
    // Decode percent-encoded backslashes (markdown-it encodes \ as %5C) then normalize to forward slash.
    const normalized = src.replace(/%5C/gi, '/').replace(/\\/g, '/');
    const abs = joinPath(baseDir, normalized);
    return `<img${pre}src="${toAssetUrl(abs)}"${post}>`;
  });
}

export async function render(markdown: string, options: RenderOptions = {}): Promise<RenderResult> {
  const rawHtml = md.render(markdown);
  const withMermaid = extractMermaidBlocks(rawHtml);
  const highlightedHtml = await highlightFences(withMermaid);
  const withImages = rewriteImageSrcs(highlightedHtml, options);
  const { html, blocks } = tagTopLevelBlocks(withImages);
  const plaintext = extractPlaintext(html);
  return { html, plaintext, blocks };
}
