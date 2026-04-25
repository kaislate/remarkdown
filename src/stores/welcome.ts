import { derived, writable } from 'svelte/store';
import { doc } from './doc';

// Absolute path to the materialised welcome.md in app_data_dir, set by
// App.svelte after the Rust ensure_welcome_doc command resolves it. Null
// before launch hydration completes or when no welcome doc has been
// requested this session.
export const welcomeDocPath = writable<string | null>(null);

// True iff the document currently open in the viewer is the welcome doc.
// Components (e.g. WelcomeDismiss) subscribe to this to know whether to
// surface welcome-specific affordances.
export const isWelcomeDocOpen = derived(
  [doc, welcomeDocPath],
  ([$doc, $welcomePath]) =>
    $doc !== null && $welcomePath !== null && $doc.path === $welcomePath,
);
