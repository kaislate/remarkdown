import { writable } from 'svelte/store';
import { readDocument, toAssetUrl } from '../lib/tauri-api';
import { render } from '../lib/MarkdownRenderer';
import { loadSidecar } from '../lib/sidecar';
import { docEpoch, replaceAll } from './annots';
import type { Annotation } from '../lib/schema';

export interface DocState {
  path: string;
  dir: string;
  sha256: string;
  bytes: number;
  markdown: string;
  html: string;
  plaintext: string;
  blocks: string[];
  sidecarRaw: string | null;
}

export const doc = writable<DocState | null>(null);

export async function loadDocument(path: string): Promise<void> {
  const r = await readDocument(path);
  const { html, plaintext, blocks } = await render(r.markdown, {
    baseDir: r.dir,
    toAssetUrl,
  });

  let parsedAnnotations: Annotation[] = [];
  if (r.sidecarRaw) {
    const result = loadSidecar(r.sidecarRaw);
    if (result.ok) {
      parsedAnnotations = result.value.annotations;
    } else {
      console.warn('[remarkdown] sidecar load failed:', result.error);
    }
  }
  replaceAll(parsedAnnotations);

  doc.set({
    path: r.path,
    dir: r.dir,
    sha256: r.sha256,
    bytes: r.bytes,
    markdown: r.markdown,
    html,
    plaintext,
    blocks,
    sidecarRaw: r.sidecarRaw,
  });
  docEpoch.update((e) => e + 1);
}

export function clearDocument(): void {
  doc.set(null);
  replaceAll([]);
  docEpoch.update((e) => e + 1);
}
