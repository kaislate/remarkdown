import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  createSession,
  sessions,
  activeSession,
  activeProxy,
  resetSessionsForTests,
} from '../../src/stores/sessions';
import { doc } from '../../src/stores/doc';
import { annots } from '../../src/stores/annots';
import { editMode } from '../../src/stores/edit-mode';
import { readerMode } from '../../src/stores/reader-mode';

describe('document sessions', () => {
  beforeEach(() => resetSessionsForTests());

  it('starts with one empty active session', () => {
    expect(get(sessions)).toHaveLength(1);
    expect(get(sessions)[0]).toBe(get(activeSession));
    expect(get(get(activeSession).doc)).toBeNull();
  });

  it('gives every session a unique id and independent stores', () => {
    const a = createSession();
    const b = createSession();
    expect(a.id).not.toBe(b.id);
    a.editMode.set(true);
    expect(get(b.editMode)).toBe(false);
  });

  it('a proxy reads and writes the active session only', () => {
    const p = activeProxy((s) => s.editMode);
    const a = get(activeSession);
    const b = createSession();
    sessions.update((l) => [...l, b]);

    p.set(true);
    expect(get(a.editMode)).toBe(true);
    expect(get(b.editMode)).toBe(false);

    activeSession.set(b);
    expect(get(p)).toBe(false);
    p.update((v) => !v);
    expect(get(b.editMode)).toBe(true);
    expect(get(a.editMode)).toBe(true);
  });

  it('proxy subscribers re-emit on switch and ignore background writes', () => {
    const p = activeProxy((s) => s.editMode);
    const a = get(activeSession);
    const b = createSession();
    const seen: boolean[] = [];
    const un = p.subscribe((v) => seen.push(v));
    activeSession.set(b);
    a.editMode.set(true); // background write — must not reach the subscriber
    b.editMode.set(true);
    un();
    b.editMode.set(false); // after unsubscribe — ignored
    expect(seen).toEqual([false, false, true]);
  });

  it('the exported app stores are proxies onto the active session', () => {
    const a = get(activeSession);
    const b = createSession();
    sessions.update((l) => [...l, b]);

    editMode.set(true);
    readerMode.set(true);
    annots.set([{ id: 'x' } as never]);
    expect(get(a.editMode)).toBe(true);
    expect(get(a.readerMode)).toBe(true);
    expect(get(a.annots)).toHaveLength(1);

    activeSession.set(b);
    expect(get(editMode)).toBe(false);
    expect(get(readerMode)).toBe(false);
    expect(get(annots)).toHaveLength(0);
    expect(get(doc)).toBeNull();
  });
});
