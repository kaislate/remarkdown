import { writable } from 'svelte/store';
import { readDocument, toAssetUrl } from '../lib/tauri-api';
import { render } from '../lib/MarkdownRenderer';

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
}

export function clearDocument(): void {
  doc.set(null);
}
