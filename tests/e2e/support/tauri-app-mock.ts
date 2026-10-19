// tests/e2e/support/tauri-app-mock.ts
// Stand-in for @tauri-apps/api/app (which talks to Tauri directly rather
// than through the aliased core). getVersion goes through the core mock, so
// specs control it with __E2E_APP_VERSION__ and otherwise it fails as it
// does outside Tauri.
import { invoke } from './tauri-mock';

export async function getVersion(): Promise<string> {
  const v = await invoke('plugin:app|version');
  if (typeof v !== 'string') throw new Error('[mock] no app version');
  return v;
}
