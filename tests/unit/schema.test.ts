import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SidecarSchema } from '../../src/lib/schema';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures', name), 'utf-8');

describe('SidecarSchema', () => {
  it('accepts an empty-annotations sidecar', () => {
    const data = JSON.parse(fixture('sidecar-empty.json'));
    const result = SidecarSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts a sidecar with highlight + note + drawing', () => {
    const data = JSON.parse(fixture('sidecar-valid.json'));
    const result = SidecarSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.annotations).toHaveLength(3);
      expect(result.data.annotations[0].type).toBe('highlight');
      expect(result.data.annotations[1].type).toBe('note');
      expect(result.data.annotations[2].type).toBe('drawing');
    }
  });

  it('rejects a highlight missing its anchor', () => {
    const data = JSON.parse(fixture('sidecar-malformed.json'));
    const result = SidecarSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('preserves unknown top-level fields', () => {
    const data = {
      _comment: 'x',
      $schema: 'remarkdown/v1',
      document: { path: 'a.md', sha256: 'abc', lastSeenBytes: 1 },
      annotations: [],
      futureField: { hello: 'world' },
    };
    const result = SidecarSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).futureField).toEqual({ hello: 'world' });
    }
  });
});
