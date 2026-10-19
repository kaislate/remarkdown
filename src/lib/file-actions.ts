// "Show in folder" and "Copy path", shared by every right-click menu that
// acts on a file (recent files, tabs). Failures become toasts, never throws.

import { revealInFolder } from './tauri-api';
import { addToast } from '../stores/toasts';

export async function showInFolder(path: string): Promise<void> {
  try {
    await revealInFolder(path);
  } catch (err) {
    addToast({ kind: 'error', message: `Couldn't open the folder: ${String(err)}` });
  }
}

export async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path);
    addToast({ kind: 'info', message: 'Path copied.' });
  } catch {
    addToast({ kind: 'error', message: "Couldn't copy the path." });
  }
}
