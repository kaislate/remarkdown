// The reader loads only the code grammars a document uses. Its colouring
// must be exactly what the old highlighter — every supported language loaded
// up front — produced, whatever order documents arrive in.
import { describe, it, expect, vi } from 'vitest';
import { getSingletonHighlighter } from 'shiki';
import { render } from '../../src/lib/MarkdownRenderer';
import { loadedLanguageCount } from '../../src/lib/shiki-highlighter';
import { SUPPORTED_LANGUAGES, LANG_ALIASES, resolveLanguage } from '../../src/lib/editor/code-block-languages';

const SAMPLES: Record<string, string> = {
  typescript: 'const n: number = 1;\nexport type A = { a?: string };\n',
  javascript: 'function f(a) { return a?.b ?? `x${a}`; }\n',
  tsx: 'const A = () => <div className="x">{1 + 1}</div>;\n',
  jsx: 'const A = () => <span onClick={() => go()}>hi</span>;\n',
  rust: 'fn main() { let v: Vec<u8> = vec![1]; println!("{:?}", v); }\n',
  python: 'def f(x: int) -> str:\n    return f"{x!r}"\n',
  go: 'package main\nfunc main() { fmt.Println("hi") }\n',
  bash: 'for f in *.md; do echo "$f"; done\n',
  shell: 'export A=1 && ls -la | grep x\n',
  json: '{ "a": [1, true, null], "b": { "c": "d" } }\n',
  yaml: 'a: 1\nb:\n  - c\n  - "d"\n',
  toml: '[package]\nname = "x"\nversion = "0.1.0"\n',
  sql: 'SELECT a, COUNT(*) FROM t WHERE b = \'x\' GROUP BY a;\n',
  html: '<div class="a"><script>let x = 1;</script><style>.a { color: red }</style></div>\n',
  css: '.a > b:hover { color: #fff; margin: 0 auto; }\n',
  // Tildes inside, so the backtick fence around it stays open.
  markdown: '# Title\n\n~~~js\nconst a = 1;\n~~~\n\n~~~python\nprint(1)\n~~~\n\n~~~sql\nselect 1\n~~~\n',
  svelte: '<script lang="ts">let a: number = 1;</script>\n<p>{a}</p>\n<style>p { color: red; }</style>\n',
  cpp: '#include <vector>\n#define SQ(x) ((x) * (x))\nint main() { std::vector<int> v; return SQ(2); }\n',
  objc: '@interface A : NSObject\n- (void)go;\n@end\n',
  fsharp: '/// <summary>Doc</summary>\nlet f x = x + 1\nprintfn "%d" (f 1)\n',
};

let reference: Awaited<ReturnType<typeof getSingletonHighlighter>> | null = null;
async function oldHighlight(lang: string, code: string): Promise<string> {
  reference ??= await getSingletonHighlighter({
    themes: ['github-dark', 'github-light'],
    langs: [...SUPPORTED_LANGUAGES],
  });
  const html = reference.codeToHtml(code, {
    lang,
    themes: { dark: 'github-dark', light: 'github-light' },
    defaultColor: 'dark',
  });
  // As render() serialises it.
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
  return doc.getElementById('r')!.innerHTML;
}

function fence(lang: string, code: string): string {
  return '```' + lang + '\n' + code + '```\n';
}

// What render() put in place of each fence, in order.
function shikiBlocks(html: string): string[] {
  return (html.match(/<pre class="shiki[\s\S]*?<\/pre>/g) ?? []).map((b) => b.replace(/ data-block-id="[^"]*"/, ''));
}

describe('reader code highlighting, grammars loaded on demand', () => {
  // Before anything else is loaded: markdown colours the code in its own
  // fences with whatever grammars are around, so it must bring them all.
  it('a markdown block colours the code inside it as before, even as the first code seen', async () => {
    vi.resetModules();
    const fresh = await import('../../src/lib/MarkdownRenderer');
    const { html } = await fresh.render(fence('markdown', SAMPLES.markdown));
    expect(shikiBlocks(html)).toEqual([await oldHighlight('markdown', SAMPLES.markdown)]);
  });

  it('a document with one shell snippet loads only that grammar, not all twenty', async () => {
    const { html } = await render(fence('bash', SAMPLES.bash));
    expect(shikiBlocks(html)).toHaveLength(1);
    expect(loadedLanguageCount()).toBeLessThanOrEqual(2); // bash is shellscript
  });

  // Each language as the first code the app ever sees (only its own
  // grammars loaded), then all of them again with everything loaded.
  it('colours every supported language exactly as before, alone and after the others', async () => {
    for (const [lang, code] of Object.entries(SAMPLES)) {
      vi.resetModules();
      const fresh = await import('../../src/lib/MarkdownRenderer');
      const { html } = await fresh.render(fence(lang, code));
      expect(shikiBlocks(html), lang).toEqual([await oldHighlight(lang, code)]);
    }
    for (const [lang, code] of Object.entries(SAMPLES)) {
      const { html } = await render(fence(lang, code));
      expect(shikiBlocks(html), lang).toEqual([await oldHighlight(lang, code)]);
    }
  }, 120_000);

  it('colours aliases and a mixed document exactly as before', async () => {
    const entries: Array<[string, string]> = [
      ...Object.entries(LANG_ALIASES).map(([alias, canonical]): [string, string] => [alias, SAMPLES[canonical] ?? SAMPLES.cpp]),
      ['markdown', SAMPLES.markdown],
      ['unknownlang', 'plain text here\n'],
      ['', 'no language\n'],
    ];
    const doc = entries.map(([l, c]) => fence(l, c)).join('\n');
    const blocks = shikiBlocks((await render(doc)).html);
    // markdown-it leaves a fence with no language as plain <pre><code>.
    const expected: string[] = [];
    for (const [l, c] of entries) {
      if (!l) continue;
      expected.push(await oldHighlight(resolveLanguage(l), c));
    }
    expect(blocks).toEqual(expected);
  });
});
