<script lang="ts">
  import { activeModal, closeModal } from '../stores/modals';
  import { availableUpdate } from '../stores/updates';
  import { check, type Update } from '@tauri-apps/plugin-updater';
  import { getVersion } from '@tauri-apps/api/app';

  // The state machine that drives every visible variation of the modal.
  // Centralising it in one tagged union keeps the template's `{:else if}`
  // chain honest — every state has a single canonical render branch.
  type UpdateState =
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'up-to-date' }
    | { kind: 'available'; update: Update }
    | {
        kind: 'downloading';
        progress: number;
        downloadedBytes: number;
        totalBytes: number;
      }
    | { kind: 'installed' }
    | { kind: 'error'; message: string };

  let currentVersion = $state('—');
  let st: UpdateState = $state({ kind: 'idle' });
  let initialised = false;

  async function fetchCurrentVersion(): Promise<void> {
    try {
      currentVersion = await getVersion();
    } catch {
      currentVersion = 'unknown';
    }
  }

  async function runCheck(): Promise<void> {
    st = { kind: 'checking' };
    try {
      const update = await check();
      if (update) {
        st = { kind: 'available', update };
        // Sync the global "update available" signal so the hamburger menu
        // flips to its accent-coloured affordance for the rest of the
        // session — even if the user closes this modal without installing.
        availableUpdate.set({ version: update.version });
      } else {
        st = { kind: 'up-to-date' };
        // The user is on the latest — wipe any stale signal that may have
        // been set by an earlier session start.
        availableUpdate.set(null);
      }
    } catch (e) {
      st = { kind: 'error', message: (e as Error).message ?? String(e) };
    }
  }

  async function install(): Promise<void> {
    if (st.kind !== 'available') return;
    const update = st.update;
    st = {
      kind: 'downloading',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    };
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          st = {
            kind: 'downloading',
            progress: total > 0 ? downloaded / total : 0,
            downloadedBytes: downloaded,
            totalBytes: total,
          };
        }
      });
      // downloadAndInstall on Windows triggers an installer relaunch; if
      // we make it past the await without throwing, the install succeeded
      // and the app is about to be replaced. Show a friendly message.
      st = { kind: 'installed' };
    } catch (e) {
      st = { kind: 'error', message: (e as Error).message ?? String(e) };
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if ($activeModal?.kind !== 'check-update') return;
    if (e.key === 'Escape') {
      // Don't allow closing mid-download to avoid leaving the user
      // with an inconsistent install state.
      if (st.kind === 'downloading') return;
      closeModal();
    }
  }

  // Auto-check on first open. Reset when the modal closes so reopening
  // performs a fresh check.
  $effect(() => {
    const isOpen = $activeModal?.kind === 'check-update';
    if (isOpen && !initialised) {
      initialised = true;
      fetchCurrentVersion();
      runCheck();
    } else if (!isOpen) {
      initialised = false;
      st = { kind: 'idle' };
    }
  });

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if $activeModal?.kind === 'check-update'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="scrim"
    onclick={() => st.kind !== 'downloading' && closeModal()}
    role="presentation"
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="update-panel glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <header>
        <h2 id="update-title">Updates</h2>
        {#if st.kind !== 'downloading'}
          <button class="close" aria-label="Close" onclick={closeModal}>×</button>
        {/if}
      </header>

      <div class="body">
        <div class="row">
          <span class="label">Current version</span>
          <code class="value">{currentVersion}</code>
        </div>

        {#if st.kind === 'idle'}
          <p class="status">Click "Check now" to look for updates.</p>
        {:else if st.kind === 'checking'}
          <p class="status">Checking for updates…</p>
        {:else if st.kind === 'up-to-date'}
          <p class="status ok">You're running the latest version. ✓</p>
        {:else if st.kind === 'available'}
          <div class="row">
            <span class="label">New version</span>
            <code class="value highlight">{st.update.version}</code>
          </div>
          {#if st.update.body}
            <div class="notes">
              <div class="notes-label">Release notes</div>
              <pre>{st.update.body}</pre>
            </div>
          {/if}
        {:else if st.kind === 'downloading'}
          <p class="status">Downloading update…</p>
          <progress value={st.progress} max="1" class="progress"></progress>
          <p class="progress-text">
            {fmtBytes(st.downloadedBytes)}
            {#if st.totalBytes > 0}/ {fmtBytes(st.totalBytes)}{/if}
            ({Math.round(st.progress * 100)}%)
          </p>
        {:else if st.kind === 'installed'}
          <p class="status ok">
            Update installed. The app will relaunch automatically.
          </p>
        {:else if st.kind === 'error'}
          <p class="status error-text">Couldn't check for updates:</p>
          <pre class="error-msg">{st.message}</pre>
        {/if}
      </div>

      <footer>
        {#if st.kind === 'idle' || st.kind === 'up-to-date' || st.kind === 'error'}
          <button class="primary" onclick={runCheck}>Check now</button>
        {:else if st.kind === 'available'}
          <button class="primary" onclick={install}>Install update</button>
        {/if}
        {#if st.kind !== 'downloading'}
          <button class="cancel" onclick={closeModal}>Close</button>
        {/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: grid;
    place-items: center;
    z-index: 320;
    backdrop-filter: blur(2px);
  }
  .update-panel {
    width: min(480px, 92vw);
    max-height: 86vh;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background:
      linear-gradient(var(--bg-1), var(--bg-1)),
      var(--glass-fill);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 500;
    color: var(--fg-0);
  }
  .close {
    background: transparent;
    border: 0;
    color: var(--fg-2);
    font-size: 20px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .close:hover { color: var(--fg-0); }

  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--fg-1);
  }
  .label {
    color: var(--fg-2);
  }
  .value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-0);
    background: var(--bg-2);
    padding: 2px 8px;
    border-radius: 4px;
  }
  .value.highlight {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .status {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--fg-1);
    line-height: 1.4;
  }
  .status.ok { color: #82d99c; }
  .status.error-text { color: #ff8080; }

  .notes {
    margin-top: 6px;
  }
  .notes-label {
    font-family: var(--font-sans);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-2);
    margin-bottom: 4px;
  }
  .notes pre {
    margin: 0;
    background: var(--bg-2);
    color: var(--fg-1);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    padding: 10px 12px;
    font-family: var(--font-sans);
    font-size: 12px;
    line-height: 1.4;
    white-space: pre-wrap;
    max-height: 200px;
    overflow-y: auto;
  }

  .progress {
    width: 100%;
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
    accent-color: var(--accent);
  }
  .progress-text {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-2);
    text-align: center;
  }

  .error-msg {
    margin: 0;
    background: rgba(255, 110, 110, 0.08);
    border: 1px solid rgba(255, 110, 110, 0.3);
    color: #ffb0a8;
    border-radius: 6px;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
    max-height: 120px;
    overflow-y: auto;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  footer button {
    background: var(--glass-fill);
    border: 1px solid var(--glass-border);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12px;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
  }
  footer button:hover { color: var(--fg-0); }
  footer .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  footer .primary:hover { color: #fff; filter: brightness(1.08); }
</style>
