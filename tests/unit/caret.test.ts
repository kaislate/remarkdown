import { describe, it, expect } from 'vitest';
import { caretFromPoint } from '../../src/lib/caret';

const node = { nodeType: 3 } as unknown as Node;
const stub = (o: object) => o as unknown as Document;

describe('caretFromPoint', () => {
  it('uses caretPositionFromPoint when present', () => {
    const doc = stub({ caretPositionFromPoint: () => ({ offsetNode: node, offset: 4 }) });
    expect(caretFromPoint(1, 2, doc)).toEqual({ node, offset: 4 });
  });

  it('falls back to caretRangeFromPoint (WebKit)', () => {
    const doc = stub({ caretRangeFromPoint: () => ({ startContainer: node, startOffset: 7 }) });
    expect(caretFromPoint(1, 2, doc)).toEqual({ node, offset: 7 });
  });

  it('returns null when neither exists', () => {
    expect(caretFromPoint(1, 2, stub({}))).toBeNull();
  });

  it('falls through when caretPositionFromPoint returns null', () => {
    const doc = stub({
      caretPositionFromPoint: () => null,
      caretRangeFromPoint: () => ({ startContainer: node, startOffset: 3 }),
    });
    expect(caretFromPoint(1, 2, doc)).toEqual({ node, offset: 3 });
  });
});
