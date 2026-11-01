// Diagram text comes from whatever file the user opens, and the edit
// mode parsers run on the UI thread. None of them may take more than
// linear time on crafted input: each case here is a diagram that once
// froze the app for seconds (or for good), scaled so the old code took
// well over 2 s. A fixed parser reads them in a few milliseconds.
import { describe, it, expect } from 'vitest';
import { parseGantt } from '../../../src/lib/editor/mermaid/gantt-parser';
import { parseGanttDate } from '../../../src/lib/editor/mermaid/gantt-dates';

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
