<script lang="ts">
  // The Settings window: sections on the left, option cards on the right,
  // and a search box that looks across every section. Cards are rendered
  // from lib/settings-catalog.ts; each shows a small animated depiction of
  // what the option does.
  import { onMount } from 'svelte';
  import { activeModal, closeModal, openModal } from '../stores/modals';
  import { settings, resetSettings } from '../stores/settings';
  import { addToast } from '../stores/toasts';
  import { defaultAppStatus, makeDefaultApp, type DefaultAppStatus } from '../lib/tauri-api';
  import { OPTIONS, SECTIONS, searchOptions, type OptionDef, type SectionId } from '../lib/settings-catalog';
  import OptionCard from './settings/OptionCard.svelte';

  let section = $state<SectionId>('appearance');
  let query = $state('');
  let version = $state<string | null>(null);
  let searchEl = $state<HTMLInputElement | null>(null);

  onMount(async () => {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      version = await getVersion();
    } catch {
      // outside Tauri
    }
  });

  // Default-app status. Re-checked when the window opens and whenever the
  // app regains focus — the user finishes the job in Windows' own UI and
  // then comes back here.
  let defaultApp = $state<DefaultAppStatus | null>(null);
  const isDefault = $derived(!!defaultApp && defaultApp.md && defaultApp.markdown);

  async function refreshDefaultApp() {
    try {
      defaultApp = await defaultAppStatus();
    } catch {
      defaultApp = null;
    }
  }

  const isOpen = $derived($activeModal?.kind === 'settings');

  $effect(() => {
    if (isOpen) void refreshDefaultApp();
  });

  function onWindowFocus() {
    if (isOpen) void refreshDefaultApp();
  }

  async function onMakeDefault() {
    try {
      await makeDefaultApp();
    } catch {
      addToast({
        kind: 'error',
        message: "Couldn't set that up automatically. Right-click any .md file → Open with → Choose another app → remarkdown, and choose Always.",
        persistent: true,
      });
    }
  }

  function applies(o: OptionDef): boolean {
    if (o.visible && !o.visible($settings)) return false;
    if (o.id === 'setting-default-app' && !defaultApp?.supported) return false;
    return true;
  }

  const searching = $derived(query.trim().length > 0);
  const shown = $derived(
    searching
      ? searchOptions(query).filter(applies)
      : OPTIONS.filter((o) => o.section === section && applies(o)),
  );
  const sectionTitle = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.title ?? '';

  function onKeydown(e: KeyboardEvent) {
    if (!isOpen || e.key !== 'Escape') return;
    if (e.target === searchEl && query) {
      query = '';
      return;
    }
    closeModal();
  }

  function pickSection(id: SectionId) {
    section = id;
    query = '';
  }
</script>

<svelte:window onkeydown={onKeydown} onfocus={onWindowFocus} />

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="scrim" onclick={closeModal} role="presentation">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="settings-window glass"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <header>
        <h2>Settings</h2>
        <input
          class="search"
          type="search"
          placeholder="Search settings"
          aria-label="Search settings"
          bind:value={query}
          bind:this={searchEl}
        />
        <button class="close" aria-label="Close" onclick={closeModal}>×</button>
      </header>

      <div class="panes">
        <nav aria-label="Settings sections" class:dim={searching}>
          {#each SECTIONS as s (s.id)}
            <button
              aria-current={!searching && section === s.id ? 'true' : undefined}
              onclick={() => pickSection(s.id)}
            >{s.title}</button>
          {/each}
        </nav>

        <div class="cards" role="region" aria-label={searching ? 'Search results' : sectionTitle(section)}>
          {#if searching}
            {#if shown.length === 0}
              <p class="empty">No settings match “{query.trim()}”.</p>
            {/if}
            {#each shown as o, i (o.id)}
              {#if i === 0 || shown[i - 1].section !== o.section}
                <h3>{sectionTitle(o.section)}</h3>
              {/if}
              {@render card(o)}
            {/each}
          {:else}
            <h3>{sectionTitle(section)}</h3>
            {#each shown as o (o.id)}
              {@render card(o)}
            {/each}
            {#if section === 'about'}
              <div class="about">
                <div class="about-row">
                  <div>
                    <div class="about-title">remarkdown {version ?? ''}</div>
                    <p class="about-desc">A reader and editor for documents written in markdown, for people who'd rather not think about markdown.</p>
                  </div>
                  <button class="action" onclick={() => openModal({ kind: 'check-update' })}>Check for updates now</button>
                </div>
                <div class="about-row">
                  <div>
                    <div class="about-title">Start over</div>
                    <p class="about-desc">Put every setting back the way it was when you installed remarkdown.</p>
                  </div>
                  <button class="action subtle" onclick={() => resetSettings()}>Reset all settings</button>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </div>

      <footer>
        <button class="primary" onclick={closeModal}>Done</button>
      </footer>
    </div>
  </div>
{/if}

{#snippet card(o: OptionDef)}
  {#if o.control.type === 'custom' && o.control.id === 'default-app'}
    <OptionCard option={o}>
      {#snippet custom()}
        <div class="default-app">
          <span class="status" class:ok={isDefault}>
            {isDefault ? 'remarkdown is your default' : "remarkdown isn't your default yet"}
          </span>
          {#if !isDefault}
            <button class="action" onclick={onMakeDefault}>Make remarkdown the default…</button>
          {/if}
        </div>
      {/snippet}
    </OptionCard>
  {:else}
    <OptionCard option={o} />
  {/if}
{/snippet}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: grid;
    place-items: center;
    z-index: 300;
    backdrop-filter: blur(2px);
  }
  .settings-window {
    width: min(880px, 94vw);
    height: min(660px, 88vh);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    background:
      linear-gradient(var(--bg-1), var(--bg-1)),
      var(--glass-fill);
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px 12px 20px;
    border-bottom: 1px solid var(--glass-border);
  }
  h2 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 16px;
    font-weight: 600;
    color: var(--fg-0);
    flex: 0 0 auto;
  }
  .search {
    flex: 1 1 auto;
    max-width: 320px;
    margin-left: auto;
    font: 13px var(--font-sans);
    color: var(--fg-0);
    background: var(--bg-0);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    padding: 7px 10px;
  }
  .search:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .close {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 0;
    background: transparent;
    color: var(--fg-1);
    font-size: 18px;
    cursor: pointer;
  }
  .close:hover { background: var(--glass-fill); color: var(--fg-0); }

  .panes {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    min-height: 0;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 10px;
    border-right: 1px solid var(--glass-border);
    background: color-mix(in srgb, var(--bg-2) 45%, transparent);
    overflow-y: auto;
    transition: opacity 0.2s ease;
  }
  nav.dim { opacity: 0.55; }
  nav button {
    text-align: left;
    font: 13px var(--font-sans);
    color: var(--fg-1);
    background: transparent;
    border: 0;
    border-radius: 7px;
    padding: 8px 10px;
    cursor: pointer;
  }
  nav button:hover { color: var(--fg-0); background: var(--glass-fill); }
  nav button[aria-current='true'] {
    color: var(--fg-0);
    background: var(--bg-0);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  nav button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  .cards {
    overflow-y: auto;
    padding: 6px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h3 {
    margin: 12px 0 2px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-2);
  }
  .empty {
    margin: 24px 0;
    font: 13px var(--font-sans);
    color: var(--fg-2);
  }
  .default-app { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
  .status { font: 12px var(--font-sans); color: var(--fg-2); }
  .status.ok { color: #4cc38a; }
  .action {
    font: 500 12px var(--font-sans);
    color: var(--fg-0);
    background: var(--accent-soft);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 7px;
    padding: 6px 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .action:hover { filter: brightness(1.12); }
  .action.subtle { background: transparent; border-color: var(--glass-border); color: var(--fg-1); }
  .about { display: flex; flex-direction: column; gap: 10px; }
  .about-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--glass-border);
    background: var(--bg-0);
  }
  .about-title { font: 600 13.5px var(--font-sans); color: var(--fg-0); }
  .about-desc { margin: 3px 0 0; font: 12px/1.45 var(--font-sans); color: var(--fg-2); }

  footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 16px;
    border-top: 1px solid var(--glass-border);
  }
  footer .primary {
    font: 600 12.5px var(--font-sans);
    color: #fff;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 7px;
    padding: 7px 18px;
    cursor: pointer;
  }
  footer .primary:hover { filter: brightness(1.08); }

  @media (max-width: 640px) {
    .panes { grid-template-columns: 1fr; }
    nav { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--glass-border); }
  }
</style>
