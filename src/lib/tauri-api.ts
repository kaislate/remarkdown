import { invoke, convertFileSrc } from '@tauri-apps/api/core';

export interface ReadDocumentResult {
  path: string;
  dir: string;
  markdown: string;
  sidecarRaw: string | null;
  sha256: string;
  bytes: number;
}

export async function openFileDialog(): Promise<string | null> {
  const result = await invoke<string | null>('open_file_dialog');
  return result;
}

export async function readDocument(path: string): Promise<ReadDocumentResult> {
  // Rust returns fields with snake_case by default in tauri 2.x unless configured.
  // We remap once here so the rest of the frontend sees camelCase only.
  const raw = await invoke<any>('read_document', { path });
  return {
    path: raw.path,
    dir: raw.dir,
    markdown: raw.markdown,
    sidecarRaw: raw.sidecar_raw ?? raw.sidecarRaw ?? null,
    sha256: raw.sha256,
    bytes: raw.bytes,
  };
}

export async function writeSidecar(mdPath: string, json: string): Promise<void> {
  await invoke('write_sidecar', { mdPath, json });
}

export async function pushRecent(path: string): Promise<string[]> {
  return await invoke<string[]>('push_recent', { path });
}

export async function listRecent(): Promise<string[]> {
  return await invoke<string[]>('list_recent');
}

export async function clearRecent(): Promise<void> {
  await invoke('clear_recent');
}

export async function checkPathsExist(paths: string[]): Promise<boolean[]> {
  return await invoke<boolean[]>('check_paths_exist', { paths });
}

export function toAssetUrl(absolutePath: string): string {
  return convertFileSrc(absolutePath);
}

export async function backupCorruptSidecar(mdPath: string): Promise<string> {
  return await invoke<string>('backup_corrupt_sidecar', { mdPath });
}

export async function loadSettingsJson(): Promise<string | null> {
  return await invoke<string | null>('load_settings');
}

export async function saveSettingsJson(json: string): Promise<void> {
  await invoke('save_settings', { json });
}
