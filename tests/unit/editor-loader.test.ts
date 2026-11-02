import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { importEditor } = vi.hoisted(() => ({ importEditor: vi.fn() }));

import { loadEditor, editorComponent, setEditorImportForTests } from '../../src/lib/editor-loader';

describe('editor-loader', () => {
  it('fetches the editor once, however often it is asked for, and publishes it', async () => {
    const Editor = () => {};
    importEditor.mockResolvedValue({ default: Editor });
    setEditorImportForTests(importEditor);
    expect(get(editorComponent)).toBeNull();
    const a = loadEditor();
    const b = loadEditor();
    await Promise.all([a, b]);
    expect(importEditor).toHaveBeenCalledTimes(1);
    expect(get(editorComponent)).toBe(Editor);
  });

  it('a failed fetch is tried again next time', async () => {
    setEditorImportForTests(importEditor);
    importEditor.mockReset();
    importEditor.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ default: () => {} });
    await expect(loadEditor()).rejects.toThrow('offline');
    await loadEditor();
    expect(importEditor).toHaveBeenCalledTimes(2);
  });

  // The reader's entry script must not carry the editor (ProseMirror and
  // all its parts): nothing on the reading path imports it statically.
  it('the viewer does not import the editor up front', () => {
    const viewer = readFileSync(resolve(__dirname, '../../src/components/Viewer.svelte'), 'utf-8');
    expect(viewer).not.toMatch(/import\s+Editor\s+from/);
  });
});
