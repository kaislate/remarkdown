import MarkdownIt from 'markdown-it';

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
});

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

export async function render(markdown: string): Promise<RenderResult> {
  const rawHtml = md.render(markdown);
  const { html, blocks } = tagTopLevelBlocks(rawHtml);
  const plaintext = extractPlaintext(html);
  return { html, plaintext, blocks };
}
