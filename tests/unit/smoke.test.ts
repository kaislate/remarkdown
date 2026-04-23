import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs a trivial assertion', () => {
    expect(2 + 2).toBe(4);
  });
});
