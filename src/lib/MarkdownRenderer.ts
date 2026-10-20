import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import katex from '@vscode/markdown-it-katex';
import subPlugin from 'markdown-it-sub';
import supPlugin from 'markdown-it-sup';
import { getSingletonHighlighter, type Highlighter } from 'shiki';
import { calloutsPlugin } from './markdown-it-callouts';
import { frontMatterPlugin } from './markdown-it-frontmatter';
import { SUPPORTED_LANGUAGES, resolveLanguage } from './editor/code-block-languages';
import { isMermaidFence } from './mermaid-fence';
import { resolveImageSrc } from './image-paths';

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
  .use(subPlugin)
  .use(supPlugin)
  .use(calloutsPlugin)
  .use(frontMatterPlugin);

// Mermaid fences become diagram placeholders at markdown-it's fence
// renderer, BEFORE Shiki sees the html. Deciding here (from the token's
// info string) rather than by regex over the html means ```Mermaid,
// ```mermaid title="…" and fences nested in lists/quotes all count —
// the same rule the editor uses (isMermaidFence). The source is
// entity-encoded into data-mermaid; MermaidRenderer reads it from there
// and keeps it for re-renders (theme switches).
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (isMermaidFence(token.info)) {
    const encoded = token.content
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<div class="mermaid-block" data-mermaid="${encoded}"></div>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

const fenceRe = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g;

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

async function highlightFences(html: string): Promise<string> {
  if (!html.includes('<pre><code class="language-')) return html;
  const highlighter = await getHighlighter();
  // Use the callback form so every match is replaced, even if two fences share identical text.
  return html.replace(fenceRe, (_m, lang, body) => {
    const raw = decodeEntities(body);
    // resolveLanguage handles case-folding, alias lookup, and unknown-lang
    // fallback to 'text' so the same matrix the editor uses applies here.
    const resolvedLang = resolveLanguage(lang);
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

function rewriteImageSrcs(html: string, opts: RenderOptions): string {
  if (!opts.baseDir || !opts.toAssetUrl) return html;
  const { baseDir, toAssetUrl } = opts;
  // markdown-it encodes a backslash as %5C; resolveImageSrc decodes it.
  return html.replace(/<img([^>]*?)src="([^"]+)"([^>]*)>/g, (_m, pre, src, post) =>
    `<img${pre}src="${resolveImageSrc(src, baseDir, toAssetUrl)}"${post}>`,
  );
}

export async function render(markdown: string, options: RenderOptions = {}): Promise<RenderResult> {
  const rawHtml = md.render(markdown);
  const highlightedHtml = await highlightFences(rawHtml);
  const withImages = rewriteImageSrcs(highlightedHtml, options);
  const { html, blocks } = tagTopLevelBlocks(withImages);
  const plaintext = extractPlaintext(html);
  return { html, plaintext, blocks };
}
