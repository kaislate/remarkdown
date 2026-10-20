// Undo and redo for annotations: each change is a step (quick edits of
// one annotation are one), per tab, and loading the document starts over.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  annots,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  undoAnnot,
  redoAnnot,
  canUndoAnnot,
  resetAnnotHistory,
  describeChange,
} from '../../src/stores/annots';
import { activeSession, createSession } from '../../src/stores/sessions';
import type { Annotation } from '../../src/lib/schema';

const now = '2026-10-20T00:00:00Z';
const hl = (id: string, color = '#ffd25a'): Annotation =>
  ({ id, type: 'highlight', color, anchor: { text: id, prefix: '', suffix: '', blockHint: 'p:1' }, createdAt: now, updatedAt: now }) as Annotation;
const note = (id: string, body = ''): Annotation =>
  ({ id, type: 'note', body, anchor: { text: id, prefix: '', suffix: '', blockHint: 'p:1' }, createdAt: now, updatedAt: now }) as Annotation;
const ids = () => get(annots).map((a) => a.id);

beforeEach(() => {
  const s = createSession();
  activeSession.set(s);
  resetAnnotHistory(s);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('annotation undo', () => {
  it('undoes and redoes adds and removals, saying what', () => {
    addAnnotation(hl('a'));
    vi.advanceTimersByTime(2000);
    addAnnotation(note('b'));
    vi.advanceTimersByTime(2000);
    removeAnnotation('a');
    expect(ids()).toEqual(['b']);
    expect(undoAnnot()).toBe('removed a highlight');
    expect(ids()).toEqual(['a', 'b']);
    expect(undoAnnot()).toBe('added a re.mark');
    expect(ids()).toEqual(['a']);
    expect(redoAnnot()).toBe('added a re.mark');
    expect(ids()).toEqual(['a', 'b']);
  });

  it('quick changes to one annotation are one step — with its adding too', () => {
    addAnnotation(note('n'));
    for (const body of ['H', 'He', 'Hel', 'Hello']) {
      vi.advanceTimersByTime(200);
      updateAnnotation('n', (a) => ({ ...a, body }) as Annotation);
    }
    vi.advanceTimersByTime(3000);
    updateAnnotation('n', (a) => ({ ...a, body: 'Hello there' }) as Annotation);
    expect(undoAnnot()).toBe('changed a re.mark');
    expect((get(annots)[0] as { body: string }).body).toBe('Hello');
    expect(undoAnnot()).toBe('added a re.mark');
    expect(ids()).toEqual([]);
    expect(undoAnnot()).toBeNull();
  });

  it('a new change clears what could be redone', () => {
    addAnnotation(hl('a'));
    undoAnnot();
    vi.advanceTimersByTime(2000);
    addAnnotation(hl('b'));
    expect(redoAnnot()).toBeNull();
  });

  it('each tab has its own steps; loading the document starts over', () => {
    const first = get(activeSession);
    addAnnotation(hl('a'));
    const second = createSession();
    activeSession.set(second);
    expect(canUndoAnnot()).toBe(false);
    activeSession.set(first);
    expect(canUndoAnnot()).toBe(true);
    resetAnnotHistory(first);
    expect(canUndoAnnot()).toBe(false);
  });

  it('describes several at once', () => {
    expect(describeChange([], [hl('a'), hl('b')])).toBe('added 2 annotations');
  });
});
