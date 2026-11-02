// The editor (ProseMirror and everything built on it) is most of the app's
// code, and reading never needs it. It's fetched on its own: in the
// background once the first document is on screen (App), or the moment edit
// mode is turned on if that comes first (Viewer). Viewer shows it from
// `editorComponent` once it's here.

import { writable } from 'svelte/store';
import type EditorType from '../components/Editor.svelte';

type EditorComponent = typeof EditorType;

export const editorComponent = writable<EditorComponent | null>(null);

let importEditor: () => Promise<{ default: EditorComponent }> = () => import('../components/Editor.svelte');
let loading: Promise<EditorComponent> | null = null;

export function loadEditor(): Promise<EditorComponent> {
  loading ??= importEditor().then(
    (m) => {
      editorComponent.set(m.default);
      return m.default;
    },
    (err) => {
      loading = null; // try again next time
      throw err;
    },
  );
  return loading;
}

export function setEditorImportForTests(fn: () => Promise<{ default: unknown }>): void {
  importEditor = fn as typeof importEditor;
  loading = null;
  editorComponent.set(null);
}
