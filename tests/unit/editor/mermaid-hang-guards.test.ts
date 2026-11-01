// Diagram text comes from whatever file the user opens, and the edit
// mode parsers run on the UI thread. None of them may take more than
// linear time on crafted input: each case here is a diagram that once
// froze the app for seconds (or for good), scaled so the old code took
// well over 2 s. A fixed parser reads them in a few milliseconds.
import { describe, it, expect } from 'vitest';
import { parseGantt } from '../../../src/lib/editor/mermaid/gantt-parser';
import { parseGanttDate } from '../../../src/lib/editor/mermaid/gantt-dates';
import { parseMermaidSource, type SubgraphStatement } from '../../../src/lib/editor/mermaid-parser';
import { applyFlowchartEdit } from '../../../src/lib/editor/mermaid-flowchart-edit';

// Generous, so a slow CI machine doesn't fail a fixed parser, and far
// below what the old code took.
const BUDGET_MS = 500;

function timed<T>(fn: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = fn();
  return { ms: performance.now() - t0, value };
}

describe('gantt dates', () => {
  // G73: `HHHH…` is a run of one-or-two-digit tokens, and a regex over
  // the whole format tried all 2^n ways to split the digits.
  it('reads a long run of digit tokens without trying every split', () => {
    const k = 60;
    const source = ['gantt', `dateFormat ${'H'.repeat(k)}`, `T : a1, 2026-01-01, ${'1'.repeat(k)}x`].join('\n');
    const { ms, value } = timed(() => parseGantt(source));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.ok).toBe(true);
  });

  it('reads tokens split by empty literals (H[]H[]…) the same way', () => {
    const k = 28;
    const { ms, value } = timed(() => parseGanttDate(`${'1'.repeat(2 * k)}x`, Array(k).fill('H').join('[]')));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).toBeNull();
  });
});

describe('flowchart', () => {
  // G70: an id-less subgraph's placeholder id was `#pending<n>`, which a
  // bare subgraph id can also be. Closing it moved the user's subgraph
  // into its own group, and finding a node's outermost group looped
  // forever.
  it("keeps a user's `#pendingN` subgraph apart from an id-less one", () => {
    const source = ['flowchart TD', 'subgraph #pending1', 'subgraph "t"', 'X', 'end', 'end', 'subgraph #pending1', 'end'].join('\n');
    const parsed = parseMermaidSource(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const subgraphs = parsed.map.statements.filter((s): s is SubgraphStatement => s.kind === 'subgraph');
    expect(subgraphs.map((s) => [s.id, s.group])).toEqual([
      ['#pending1', null],
      ['subGraph0', '#pending1'],
      ['#pending1', null],
    ]);
    expect(parsed.graph.groupOf.get('X')).toBe('subGraph0');
    const { ms, value } = timed(() => applyFlowchartEdit(source, { kind: 'setNodeGroup', id: 'X', group: null }));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).not.toBeNull();
  });

  it('reads a `#pendingN` subgraph that is not repeated', () => {
    const source = ['flowchart TD', 'subgraph #pending1', 'subgraph "t"', 'X', 'end', 'end'].join('\n');
    expect(parseMermaidSource(source).ok).toBe(true);
  });

  // G72: each newline inside an open `{` scanned the whole bracket stack.
  it('splits statements in linear time under a deep bracket stack', () => {
    const k = 60_000;
    const source = `flowchart TD\nA${'['.repeat(k)}{${'\n'.repeat(k)}`;
    const { ms } = timed(() => parseMermaidSource(source));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  // G72: closing an id-less subgraph rescanned every statement so far.
  it('closes many id-less subgraphs in linear time', () => {
    const source = `flowchart TD\n${'subgraph "t"\nX\nend\n'.repeat(8_000)}`;
    const { ms, value } = timed(() => parseMermaidSource(source));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.ok).toBe(true);
  });
});
