// The editor keeps each code block's colouring between passes (so opening a
// document's editor again colours it without tokenizing), in a compact form:
// the spans it draws are exactly the ones Shiki's tokens give, and a block's
// kept colouring is a small fraction of Shiki's token objects.
import { describe, it, expect } from 'vitest';
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decoration, type DecorationSet } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import type { HighlighterCore } from 'shiki/core';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { buildDecorations } from '../../../src/lib/editor/code-block-highlight';
import { ensureLanguages } from '../../../src/lib/shiki-highlighter';
import { SUPPORTED_LANGUAGES, resolveLanguage } from '../../../src/lib/editor/code-block-languages';
import { isMermaidFence } from '../../../src/lib/mermaid-fence';

const SAMPLES: Record<string, string> = {
  typescript: 'const n: number = 1;\nexport type A = { a?: string };\n',
  javascript: 'function f(a) { return a?.b ?? `x${a}`; }\n',
  tsx: 'const A = () => <div className="x">{1 + 1}</div>;\n',
  jsx: 'const A = () => <span onClick={() => go()}>hi</span>;\n',
  rust: 'fn main() { let v: Vec<u8> = vec![1]; println!("{:?}", v); }\n',
  python: 'def f(x: int) -> str:\n    return f"{x!r}"\n\n\n    # trailing\n',
  go: 'package main\nfunc main() { fmt.Println("hi") }\n',
  bash: 'for f in *.md; do echo "$f"; done\n',
  shell: 'export A=1 && ls -la | grep x\n',
  json: '{ "a": [1, true, null], "b": { "c": "d" } }\n',
  yaml: 'a: 1\nb:\n  - c\n  - "d"\n',
  toml: '[package]\nname = "x"\nversion = "0.1.0"\n',
  sql: 'SELECT a, COUNT(*) FROM t WHERE b = \'x\' GROUP BY a;\n',
  html: '<div class="a"><script>let x = 1;</script><style>.a { color: red }</style></div>\n',
  css: '.a > b:hover { color: #fff; margin: 0 auto; }\n',
  markdown: '# Title\n\n~~~js\nconst a = 1;\n~~~\n\n**bold** _it_ `code`\n',
  svelte: '<script lang="ts">let a: number = 1;</script>\n<p>{a}</p>\n<style>p { color: red; }</style>\n',
  cpp: '#include <vector>\n#define SQ(x) ((x) * (x))\nint main() { std::vector<int> v; return SQ(2); }\n',
  objc: '@interface A : NSObject\n- (void)go;\n@end\n',
  fsharp: '/// <summary>Doc</summary>\nlet f x = x + 1\nprintfn "%d" (f 1)\n',
  text: 'plain words\n\tand a tab\n',
};

// Typed arrays keep their contents outside the JS heap; both count.
function used(): number {
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
}

function decoList(set: DecorationSet) {
  return decList(set.find());
}

// The spans straight from Shiki's tokens, as the editor drew them before
// it kept anything compact.
function fromFreshTokens(doc: Node, hl: HighlighterCore): string[] {
  const decs: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return !node.isTextblock;
    const language = String(node.attrs.language || '');
    const text = node.textContent;
    if (isMermaidFence(language) || !text) return false;
    const tokens = hl.codeToTokensWithThemes(text, {
      lang: resolveLanguage(language),
      themes: { dark: 'github-dark', light: 'github-light' },
    });
    let offset = 0;
    tokens.forEach((line, i) => {
      for (const tok of line) {
        const len = tok.content.length;
        if (len === 0) continue;
        const dark = tok.variants.dark?.color;
        const light = tok.variants.light?.color;
        if (dark) {
          decs.push(Decoration.inline(pos + 1 + offset, pos + 1 + offset + len, {
            class: 'shiki-tok',
            style: `color: ${dark}${light ? `; --shiki-light: ${light}` : ''}`,
          }));
        }
        offset += len;
      }
      if (i < tokens.length - 1) offset += 1;
    });
    return false;
  });
  return decList(decs);
}

// Each span: where, and exactly what it draws.
function decList(decs: Decoration[]) {
  return decs
    .map((d) => `${d.from}-${d.to}:${JSON.stringify((d as unknown as { type: { attrs: unknown } }).type.attrs)}`)
    .sort();
}

function fixtures(): string[] {
  const fence = (lang: string, code: string) => '````' + lang + '\n' + code + '````\n';
  const all = Object.entries(SAMPLES).map(([l, c]) => fence(l, c)).join('\n');
  const aliases = ['ts', 'js', 'py', 'rs', 'sh', 'yml', 'md', 'c++', 'f#'].map((l) => fence(l, SAMPLES.typescript + SAMPLES.cpp)).join('\n');
  return [
    readFileSync(resolve(__dirname, '../../fixtures/code.md'), 'utf8'),
    all,
    aliases,
    '- item\n\n  ```ts\n  type T = string;\n  ```\n\n> ```py\n> print(1)\n> ```\n',
    '```js\n\n\n```\n\n```js\nx\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```\n',
  ];
}

describe('the code colouring kept between passes', () => {
  it('draws exactly the spans fresh tokens give, across the code fixtures, first time and from the cache', async () => {
    const hl = await ensureLanguages(SUPPORTED_LANGUAGES);
    for (const md of fixtures()) {
      const doc = parseMarkdownToDoc(md);
      const want = fromFreshTokens(doc, hl);
      expect(want.length).toBeGreaterThan(0);
      expect(decoList(buildDecorations(doc, hl))).toEqual(want); // tokenized
      expect(decoList(buildDecorations(doc, hl))).toEqual(want); // from the cache
    }
  }, 120_000);

  it('keeps 200 twenty-line blocks in a few megabytes at most, not tens', async () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const hl = await ensureLanguages(['typescript']);
    const parts: string[] = [];
    for (let i = 0; i < 200; i++) {
      const lines: string[] = [];
      for (let l = 0; l < 20; l++) lines.push(`const v${i}_${l}: number = call(${i}, "s${l}") + ${l};`);
      parts.push('```ts\n' + lines.join('\n') + '\n```');
    }
    const doc = parseMarkdownToDoc(parts.join('\n\n') + '\n');
    gc();
    gc();
    const before = used();
    let set: DecorationSet | null = buildDecorations(doc, hl);
    expect(set.find().length).toBeGreaterThan(200 * 20);
    set = null;
    gc();
    gc();
    const retained = used() - before;
    // Shiki's token objects for these took about 19 MB.
    expect(retained).toBeLessThan(4 * 1024 * 1024);
  }, 120_000);
});
