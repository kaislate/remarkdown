import { describe, it, expect } from 'vitest';
import {
  findPreamble,
  setFrontmatterTitle,
  splitLines,
  joinLines,
  indentFor,
  lastStatementLine,
  nextFreeId,
  moveItem,
} from '../../../src/lib/editor/mermaid/source-text';
import { mermaidAccepts } from './mermaid-test-utils';

describe('mermaid source-text helpers', () => {
  it('splits and joins keeping CRLF', () => {
    const s = splitLines('pie\r\n  "a" : 1\r\n');
    expect(s.eol).toBe('\r\n');
    expect(joinLines(s)).toBe('pie\r\n  "a" : 1\r\n');
  });

  it('finds the header after frontmatter, init directives and comments', () => {
    const lines = ['---', 'title: Hello', 'config:', '  theme: forest', '---', '%%{init: {}}%%', '', '%% c', 'pie'];
    const p = findPreamble(lines);
    expect(p.headerLine).toBe(8);
    expect(p.frontmatter).toEqual({ startLine: 0, endLine: 4, title: { line: 1, span: { start: 7, end: 12 }, value: 'Hello' } });
    expect(findPreamble(['', '%% only']).headerLine).toBe(-1);
    expect(findPreamble(['  gantt']).frontmatter).toBeNull();
  });

  it('sets, adds and removes the frontmatter title, keeping other keys', async () => {
    expect(setFrontmatterTitle('---\ntitle: Old\n---\npie\n', 'New one')).toBe('---\ntitle: New one\n---\npie\n');
    expect(setFrontmatterTitle('pie\n  "a" : 1\n', 'T')).toBe('---\ntitle: T\n---\npie\n  "a" : 1\n');
    expect(setFrontmatterTitle('---\nconfig:\n  x: 1\n---\npie\n', 'T')).toBe('---\ntitle: T\nconfig:\n  x: 1\n---\npie\n');
    expect(setFrontmatterTitle('---\ntitle: Old\n---\npie\n', '')).toBe('pie\n');
    expect(setFrontmatterTitle('---\ntitle: Old\nconfig:\n  x: 1\n---\npie\n', '')).toBe('---\nconfig:\n  x: 1\n---\npie\n');
    for (const t of ['a: b', 'quote "q" and #hash', "it's", '- dash', '[x]']) {
      const out = setFrontmatterTitle('flowchart LR\n  A --> B\n', t);
      expect(await mermaidAccepts(out), `${t}\n${out}`).toBe(true);
      const p = findPreamble(out.split('\n'));
      expect(p.frontmatter?.title?.value).toBe(t);
    }
  });

  it('indentation and append points', () => {
    const lines = ['pie', '  "a" : 1', '  %% trailing', ''];
    expect(lastStatementLine(lines, 0)).toBe(1);
    expect(indentFor(lines, 1, 0)).toBe('  ');
    expect(lastStatementLine(['pie'], 0)).toBe(0);
    expect(indentFor(['pie'], 0, 0)).toBe('    ');
  });

  it('ids and moves', () => {
    expect(nextFreeId((id) => ['A', 'B'].includes(id))).toBe('C');
    expect(nextFreeId((id) => id === 'task1', 'task')).toBe('task2');
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });
});
