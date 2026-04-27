// Shared "an update is waiting for the user to install" signal.
//
// Set by the background launch check in App.svelte and by the manual
// check inside UpdateModal.svelte. Read by GlassMenu so its menu item
// can flip from "Check for updates…" to "Update available — v0.5.x"
// with an accent-coloured shine.
//
// Cleared after the user installs (the app relaunches into the new
// version, so the store resets naturally).

import { writable } from 'svelte/store';

export const availableUpdate = writable<{ version: string } | null>(null);
