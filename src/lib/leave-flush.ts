import { get } from 'svelte/store';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { runBeforeSwitch } from '../stores/tabs';
import { flushSessionNow } from '../stores/session-persist';
import { sessions } from '../stores/sessions';
import { savesSettled } from './edit-save';
import { isMac } from './platform';

// Write out everything still pending: the active tab's debounced edits and
// annotations, then every tab's in-flight saves. Shared by the window's
// close handler and the Mac blur flush below.
export async function settlePendingSaves(): Promise<void> {
  await runBeforeSwitch();
  await Promise.all(get(sessions).map((s) => savesSettled(s)));
}

// A Mac app can be quit from the Dock, or by logging out, without any
// window hearing about it first. So on a Mac each window saves whenever it
// loses focus, which those always cause. No prompting here: an edit waiting
// on a "changed by another program" decision is asked about when the
// window closes. Windows and Linux always run the close handler, so they
// don't register this.
export async function installMacBlurFlush(): Promise<(() => void) | null> {
  if (!isMac()) return null;
  return getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) return;
    void (async () => {
      try {
        await settlePendingSaves();
        await flushSessionNow();
      } catch (err) {
        console.error('[remarkdown] flush on blur failed:', err);
      }
    })();
  });
}
