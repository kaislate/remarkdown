import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSidecar, serializeSidecar, emptySidecar } from '../../src/lib/sidecar';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures', name), 'utf-8');

describe('sidecar', () => {
  it('loads a valid sidecar JSON string', () => {
    const result = loadSidecar(fixture('sidecar-valid.json'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.annotations).toHaveLength(3);
    }
  });

  it('returns an error for malformed JSON', () => {
    const result = loadSidecar('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
    }
  });

  it('returns an error for schema-invalid sidecar', () => {
    const result = loadSidecar(fixture('sidecar-malformed.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('schema');
    }
  });

  it('round-trips valid sidecar without losing unknown fields', () => {
    const original = JSON.parse(fixture('sidecar-valid.json'));
    original.futureField = { flavor: 'strawberry' };
    const loaded = loadSidecar(JSON.stringify(original));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const reserialized = JSON.parse(serializeSidecar(loaded.value));
      expect(reserialized.futureField).toEqual({ flavor: 'strawberry' });
    }
  });

  it('emptySidecar produces a valid, minimal sidecar', () => {
    const s = emptySidecar({ path: 'a.md', sha256: 'abc', lastSeenBytes: 42 });
    const json = serializeSidecar(s);
    const reloaded = loadSidecar(json);
    expect(reloaded.ok).toBe(true);
  });
});
