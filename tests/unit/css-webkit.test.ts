import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// WebKitGTK (through 2.54) only knows -webkit-backdrop-filter, and Linux/Mac
// have no Segoe Print. These scan the sources so a new panel or hand stack
// can't quietly regress on those platforms.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(css|svelte)$/.test(name) ? [p] : [];
  });
}

const files = sourceFiles('src').map((path) => ({
  path,
  text: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));

// The body of every innermost `{ ... }` (declaration blocks, not @media
// wrappers). Svelte script braces come along too; they hold no declarations
// we look for.
function blocks(text: string): string[] {
  return [...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
}

describe('WebKit styling', () => {
  it('every backdrop-filter has a -webkit- sibling in the same block', () => {
    const missing: string[] = [];
    for (const { path, text } of files) {
      for (const body of blocks(text)) {
        if (/(^|[\s;])backdrop-filter\s*:/.test(body) && !/-webkit-backdrop-filter\s*:/.test(body)) {
          missing.push(`${path}: ${body.trim().slice(0, 60)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every 'Segoe Print' stack has 'Patrick Hand' after it", () => {
    const bad: string[] = [];
    for (const { path, text } of files) {
      for (const m of text.matchAll(/[^;{}]*'Segoe Print'[^;{}]*/g)) {
        const stack = m[0];
        const at = stack.indexOf("'Segoe Print'");
        if (!stack.slice(at).includes("'Patrick Hand'")) bad.push(`${path}: ${stack.trim().slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('--font-mono falls back to ui-monospace and Menlo after Consolas', () => {
    const theme = files.find((f) => f.path.endsWith('theme.css'))!.text;
    const stack = theme.match(/--font-mono:([^;]*);/)![1];
    const at = (name: string) => stack.indexOf(name);
    expect(at('Consolas')).toBeGreaterThan(-1);
    expect(at('ui-monospace')).toBeGreaterThan(at('Consolas'));
    expect(at('Menlo')).toBeGreaterThan(at('Consolas'));
  });
});
