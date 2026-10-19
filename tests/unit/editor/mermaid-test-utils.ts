// Shared helpers for the per-diagram-type parser / edit-engine tests.
//
//   - corpusBlocks: every mermaid block of tests/fixtures/mermaid-corpus.md
//     with the H2 heading it sits under
//   - mermaidDb: mermaid's OWN parse of a source (its diagram db) — the
//     oracle our parsers are checked against
//   - removedLines: original lines missing from an edit's output; the
//     source-preservation invariant is stated over it
//   - FUZZ_INPUTS: text a user can type into a popover; every engine must
//     write each one so mermaid accepts it and it reads back unchanged
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mermaid from 'mermaid';
import { parseMarkdown } from '../../../src/lib/editor/markdown';
import { isMermaidFence } from '../../../src/lib/mermaid-fence';

let initialized = false;
function init(): void {
  if (initialized) return;
  mermaid.initialize({ startOnLoad: false });
  initialized = true;
}

const CORPUS = readFileSync(resolve(__dirname, '../../fixtures/mermaid-corpus.md'), 'utf8').replace(/\r\n/g, '\n');

export interface CorpusBlock {
  heading: string;
  source: string;
}

export function corpusBlocks(filter?: (b: CorpusBlock) => boolean): CorpusBlock[] {
  const out: CorpusBlock[] = [];
  let heading = '';
  parseMarkdown(CORPUS).descendants((node) => {
    if (node.type.name === 'heading') heading = node.textContent;
    if (node.type.name === 'code_block' && isMermaidFence(String(node.attrs.language || ''))) {
      const b = { heading, source: node.textContent };
      if (!filter || filter(b)) out.push(b);
    }
    return true;
  });
  return out;
}

// mermaid's diagram db after parsing `source` (throws on invalid input).
// Each diagram type keeps one global db that getDiagramFromText clears
// first, so read what you need before the next call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function mermaidDb(source: string): Promise<{ type: string; db: any }> {
  init();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = await (mermaid as any).mermaidAPI.getDiagramFromText(source);
  return { type: d.type, db: d.db };
}

// Does mermaid accept `source`? true, or the first line of its error.
export async function mermaidAccepts(source: string): Promise<true | string> {
  init();
  try {
    await mermaid.parse(source);
    return true;
  } catch (e) {
    return String((e as Error).message ?? e).split('\n')[0];
  }
}

// Original lines missing from the output (multiset difference, in order).
export function removedLines(before: string, after: string): string[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(a[i++]); else j++;
  }
  while (i < a.length) out.push(a[i++]);
  return out;
}

// Does `line` mention `id` as a whole word?
export function mentions(line: string, id: string): boolean {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${esc}([^A-Za-z0-9_]|$)`).test(line);
}

export const FUZZ_INPUTS = [
  '',
  'semi; colon',
  'hash # sign',
  'percent %% comment',
  'colon: here',
  'comma, here',
  'back`tick',
  'class:::x',
  'end',
  'a->b',
  'x-->>y',
  'Tom & Jerry',
  '#59; entity',
  '  padded  ',
  'pipe | bar',
  'brace {x}',
  'bracket [x]',
  'paren (x)',
  'quote "q"',
  "apostrophe's",
  'angle <b>x</b>',
  'unicode Ünï 🚀',
];
