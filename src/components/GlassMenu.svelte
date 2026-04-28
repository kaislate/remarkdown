<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { getVersion } from '@tauri-apps/api/app';
  import { derivePreReleaseLabel } from '../lib/prerelease';
  import { openFileDialog } from '../lib/tauri-api';
  import { availableUpdate } from '../stores/updates';
  import { loadDocument } from '../stores/doc';
  import { recent, recordRecent, recentExistence, markMissing, removeFromRecent, clearAllRecent } from '../stores/recent';
  import { readingProgress } from '../stores/reading-progress';
  import { orphanedAnnots, annots } from '../stores/annots';
  import { openModal } from '../stores/modals';
  import { addToast } from '../stores/toasts';
  import MenuOverlay from './MenuOverlay.svelte';

  let open = $state(false);

  // Pre-release tag rendered under the wordmark while the build is not
  // yet 1.0 stable (zero-major) OR has any semver pre-release suffix
  // (-alpha / -beta / -rc / -dev).
  let preTagLabel = $state<string | null>(null);
  onMount(async () => {
    try {
      const v = await getVersion();
      preTagLabel = derivePreReleaseLabel(v);
    } catch {
      // Outside Tauri (vitest, storybook) — skip the tag.
    }
  });

  function toggle() { open = !open; }

  async function handleOpen() {
    open = false;
    const path = await openFileDialog();
    if (!path) return;
    await loadDocument(path);
    await recordRecent(path);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }

  function basename(p: string): string {
    return p.split(/[\\/]/).pop() ?? p;
  }

  async function openRecent(path: string) {
    open = false;
    if (get(recentExistence)[path] === false) {
      addToast({ kind: 'warning', message: `File not found: ${basename(path)}` });
      return;
    }
    try {
      await loadDocument(path);
      await recordRecent(path);
    } catch (e) {
      markMissing(path);
      addToast({ kind: 'error', message: `Could not open ${basename(path)}: ${(e as Error).message}` });
    }
  }

  async function removeRecentItem(path: string, e: MouseEvent) {
    // Stop the click from bubbling to the row's openRecent handler.
    e.stopPropagation();
    e.preventDefault();
    try {
      await removeFromRecent(path);
    } catch (err) {
      addToast({ kind: 'error', message: `Could not remove from recents: ${(err as Error).message}` });
    }
  }

  async function clearAll() {
    try {
      await clearAllRecent();
      addToast({ kind: 'info', message: 'Recent files list cleared.' });
    } catch (err) {
      addToast({ kind: 'error', message: `Could not clear recents: ${(err as Error).message}` });
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<MenuOverlay open={open} onclose={() => open = false} />

<div class="menu-root">
  <button class="hamburger glass" aria-label="Menu" aria-expanded={open} onclick={toggle}>
    <span class="bar"></span>
    <span class="bar"></span>
    <span class="bar"></span>
  </button>

  <!-- Brand mark next to the hamburger. pointer-events:none so window
       dragging still works through the wordmark area. The wordmark
       morphs from "re.md" to "remarkdown" while the hamburger is
       hovered (or while the menu popover is open) — same dot-collapse
       + ark/own unfold choreography as the splash, just driven by
       hover transitions instead of a one-shot animation. -->
  <span class="wordmark" aria-hidden="true"
    ><span class="seg re">re</span><!--
    --><span class="seg dot">.</span><!--
    --><span class="seg m">m</span><!--
    --><span class="seg ark">ark</span><!--
    --><span class="seg d">d</span><!--
    --><span class="seg own">own</span></span>

  {#if preTagLabel}
    <!-- Animated pre-release tag. aria-hidden so screen readers
         don't double-read the version (the actual version string is
         exposed via the Settings/Update modal). -->
    <span class="pre-tag" aria-hidden="true">
      <span class="pre-tag-text">{preTagLabel}</span>
      <span class="pre-tag-shine" aria-hidden="true"></span>
    </span>
  {/if}

  {#if open}
    <div class="popover glass" role="menu">
      <button role="menuitem" class="item" onclick={handleOpen}>Open…</button>
      <button
        role="menuitem"
        class="item"
        disabled={$orphanedAnnots.length === 0}
        onclick={() => { open = false; openModal({ kind: 'orphans' }); }}
      >
        Orphaned Annotations{$orphanedAnnots.length > 0 ? ` (${$orphanedAnnots.length})` : ''}
      </button>
      <button
        role="menuitem"
        class="item"
        onclick={() => { open = false; openModal({ kind: 'settings' }); }}
      >
        Settings…
      </button>
      <button
        role="menuitem"
        class="item update-check"
        class:has-update={$availableUpdate !== null}
        onclick={() => { open = false; openModal({ kind: 'check-update' }); }}
      >
        {#if $availableUpdate}
          <span class="update-label">Update available — v{$availableUpdate.version}</span>
          <span class="update-shine" aria-hidden="true"></span>
        {:else}
          Check for updates…
        {/if}
      </button>
      <button
        role="menuitem"
        class="item danger"
        disabled={$annots.length === 0}
        onclick={() => { open = false; openModal({ kind: 'confirm-clear-annots' }); }}
      >
        Clear all annotations…{$annots.length > 0 ? ` (${$annots.length})` : ''}
      </button>
      {#if $recent.length > 0}
        <div class="separator" role="separator"></div>
        <div class="submenu-label">Open Recent</div>
        {#each $recent as path (path)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="recent-row"
            class:missing={$recentExistence[path] === false}
            role="menuitem"
            tabindex="-1"
            title={path}
            onclick={(e) => {
              // Defensive guard: even though removeRecentItem stops
              // propagation, check the click target so the row never
              // mistakenly opens the file when the user meant to remove.
              if ((e.target as HTMLElement).closest?.('.recent-remove')) return;
              openRecent(path);
            }}
          >
            <span class="recent-name">
              {basename(path)}{$recentExistence[path] === false ? ' (missing)' : ''}
            </span>
            {#if ($readingProgress.documents[path]?.scrollRatio ?? 0) > 0.01}
              <span class="recent-progress">
                {Math.round($readingProgress.documents[path].scrollRatio * 100)}% read
              </span>
            {/if}
            <button
              class="recent-remove"
              aria-label={`Remove ${basename(path)} from recents`}
              title="Remove from recents"
              onclick={(e) => removeRecentItem(path, e)}
            >×</button>
          </div>
        {/each}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="clear-recents"
          role="menuitem"
          tabindex="0"
          onclick={clearAll}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clearAll(); } }}
        >Clear recents</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .menu-root {
    position: fixed;
    top: 14px;
    left: 14px;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .hamburger {
    width: 38px;
    height: 38px;
    display: grid;
    grid-auto-flow: row;
    gap: 5px;
    align-content: center;
    justify-items: center;
    background: var(--glass-fill);
    border: 1px solid var(--glass-border);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition:
      transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
      border-color 0.2s ease,
      box-shadow 0.2s ease,
      background 0.2s ease;
  }
  .hamburger:hover {
    transform: scale(1.05);
    border-color: var(--accent-soft);
    background: rgba(139, 127, 255, 0.08);
    box-shadow: 0 2px 10px rgba(139, 127, 255, 0.25);
  }
  .hamburger[aria-expanded='true'] {
    border-color: var(--accent-soft);
    background: var(--accent-soft);
  }

  .wordmark {
    font-family: var(--font-sans);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--fg-0);
    line-height: 1;
    user-select: none;
    pointer-events: none;
    /* Accommodate the wider 'remarkdown' shape on hover so the rest of
       the chrome doesn't reflow when the morph plays. */
    white-space: nowrap;
  }
  .wordmark .seg {
    display: inline-block;
    vertical-align: baseline;
  }
  .wordmark .dot {
    color: var(--accent);
    max-width: 0.45em;
    transform: translateY(0) scale(1);
    opacity: 1;
    transition:
      max-width 0.35s cubic-bezier(0.5, 0, 0.7, 0.4),
      opacity 0.35s ease,
      transform 0.35s cubic-bezier(0.5, 0, 0.7, 0.4);
  }
  /* "ark" and "own" are hidden in the resting state; on hover they
     unfold from zero width left-to-right, the same way the splash
     morph plays. clip-path (rather than overflow:hidden) keeps the
     surrounding letters on the natural baseline. */
  .wordmark .ark,
  .wordmark .own {
    max-width: 0;
    opacity: 0.4;
    clip-path: inset(0 100% 0 0);
    transition:
      max-width 0.5s cubic-bezier(0.2, 0.7, 0.2, 1),
      clip-path 0.5s cubic-bezier(0.2, 0.7, 0.2, 1),
      opacity 0.5s ease;
  }
  .wordmark .own {
    /* Slight stagger so the two segments feel sequential rather than
       simultaneous, matching the splash. */
    transition-delay: 0.08s;
  }

  /* The morph fires on hover OR when the menu popover is open — the
     latter so the wordmark stays "remarkdown" while the user is
     actively browsing menu items. */
  .hamburger:hover ~ .wordmark .dot,
  .hamburger[aria-expanded='true'] ~ .wordmark .dot {
    max-width: 0;
    opacity: 0;
    transform: translateY(0.4em) scale(0.6);
  }
  .hamburger:hover ~ .wordmark .ark,
  .hamburger:hover ~ .wordmark .own,
  .hamburger[aria-expanded='true'] ~ .wordmark .ark,
  .hamburger[aria-expanded='true'] ~ .wordmark .own {
    max-width: 4.5ch;
    opacity: 1;
    clip-path: inset(0 0 0 0);
  }
  /* Animated pre-release tag (BETA / ALPHA / RC / DEV) shown to the
     right of the wordmark. Three layers of animation:
       1. A slow accent-coloured glow pulse on the box-shadow so the
          tag always reads as "alive" without being distracting.
       2. A diagonal shine that sweeps across the tag every ~3.5s,
          like a glint on a metal pin.
       3. A subtle hue-shift on the gradient stops via animated
          background-position so the gradient itself drifts. */
  .pre-tag {
    /* Sits as an absolutely-positioned pin under the wordmark so the
       hamburger:hover ~ .wordmark sibling-combinator selectors stay
       intact (wrapping the wordmark in a column flex container would
       break that chain). top:30 lands the pin in the gap between the
       wordmark text and the popover top edge at top:46. */
    position: absolute;
    top: 30px;
    left: 50px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 7px 3px;
    border-radius: 4px;
    overflow: hidden;
    pointer-events: none;
    background:
      linear-gradient(
        110deg,
        var(--accent) 0%,
        #b59cff 35%,
        var(--accent) 70%,
        #8b7fff 100%
      );
    background-size: 220% 100%;
    background-position: 0% 50%;
    color: #fff;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 1;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.25);
    box-shadow:
      0 1px 5px rgba(139, 127, 255, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.18);
    animation:
      pre-tag-pulse 2.6s ease-in-out infinite,
      pre-tag-drift 7s linear infinite;
  }
  .pre-tag-text {
    position: relative;
    z-index: 2;
  }
  /* Diagonal shine that sweeps across the tag periodically. The 80%
     blank tail of the keyframe is what gives the impression of "wait
     a beat, then sweep" instead of a continuous loop. */
  .pre-tag-shine {
    position: absolute;
    top: 0;
    left: -60%;
    width: 50%;
    height: 100%;
    background: linear-gradient(
      105deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.45) 50%,
      rgba(255, 255, 255, 0) 100%
    );
    transform: skewX(-18deg);
    z-index: 1;
    animation: pre-tag-shine 3.4s ease-in-out infinite;
  }
  @keyframes pre-tag-pulse {
    0%, 100% {
      box-shadow:
        0 1px 5px rgba(139, 127, 255, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.18);
    }
    50% {
      box-shadow:
        0 2px 12px rgba(139, 127, 255, 0.7),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }
  }
  @keyframes pre-tag-drift {
    0%   { background-position: 0%   50%; }
    100% { background-position: 200% 50%; }
  }
  @keyframes pre-tag-shine {
    0%   { left: -60%; }
    35%  { left: 130%; }
    100% { left: 130%; }
  }
  /* Respect reduced-motion preferences — kill the pulse + shine but
     keep the gradient + shadow so the tag is still recognisable. */
  @media (prefers-reduced-motion: reduce) {
    .pre-tag,
    .pre-tag-shine {
      animation: none;
    }
  }

  .bar {
    width: 16px;
    height: 1.5px;
    background: var(--fg-1);
    border-radius: 1px;
  }
  .popover {
    position: absolute;
    top: 46px;
    left: 0;
    min-width: 200px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    z-index: 100;
  }
  .item {
    background: transparent;
    border: 0;
    padding: 10px 12px;
    border-radius: 8px;
    color: var(--fg-0);
    text-align: left;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 14px;
  }
  .item:hover {
    background: var(--accent-soft);
  }
  .item[disabled] {
    color: var(--fg-2);
    cursor: default;
    opacity: 0.5;
  }
  .item[disabled]:hover { background: transparent; }

  /* When an update is waiting for the user, the "Check for updates…"
     menu item flips to "Update available — vX.Y.Z" in accent purple
     with a periodic diagonal shine sweep — same visual language as the
     BETA pin. position:relative + overflow:hidden contain the shine
     pseudo-band; the inner .update-shine element rides under the text
     via a lower z-index. */
  .item.update-check.has-update {
    position: relative;
    overflow: hidden;
    color: var(--accent);
    font-weight: 600;
  }
  .item.update-check.has-update:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .item.update-check .update-label {
    position: relative;
    z-index: 2;
  }
  .item.update-check .update-shine {
    position: absolute;
    top: 0;
    left: -60%;
    width: 50%;
    height: 100%;
    background: linear-gradient(
      105deg,
      rgba(139, 127, 255, 0)   0%,
      rgba(139, 127, 255, 0.45) 50%,
      rgba(139, 127, 255, 0)   100%
    );
    transform: skewX(-18deg);
    z-index: 1;
    pointer-events: none;
    animation: update-shine 3.4s ease-in-out infinite;
  }
  @keyframes update-shine {
    0%   { left: -60%; }
    35%  { left: 130%; }
    100% { left: 130%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .item.update-check .update-shine {
      animation: none;
      opacity: 0;
    }
  }
  /* Destructive items (Clear all annotations) hint at their consequence
     by warming the text on hover — same pattern as the Delete button in
     the orphan panel. */
  .item.danger:not([disabled]):hover {
    background: rgba(192, 57, 43, 0.18);
    color: #ffb0a8;
  }
  .separator {
    height: 1px;
    background: var(--glass-border);
    margin: 4px 0;
  }
  .submenu-label {
    font-family: var(--font-sans);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-2);
    padding: 4px 10px;
  }
  /* A recent entry is a flex row so the filename can ellipsis-truncate
     while the remove (×) button stays anchored to the right and only
     reveals on row hover. The row itself is a div (not a button) so we
     can nest the secondary remove button inside it without tripping the
     "no nested buttons" HTML rule. */
  .recent-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 8px 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    color: var(--fg-0);
    font-family: var(--font-sans);
    font-size: 14px;
    max-width: 260px;
  }
  .recent-row:hover {
    background: var(--accent-soft);
  }
  .recent-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent-progress {
    font-size: 11px;
    color: var(--fg-2);
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .recent-row.missing .recent-name {
    color: var(--fg-2);
    font-style: italic;
  }
  .recent-remove {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border: 0;
    background: transparent;
    color: var(--fg-2);
    font-size: 14px;
    line-height: 1;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
    padding: 0;
  }
  .recent-row:hover .recent-remove,
  .recent-remove:focus-visible {
    opacity: 1;
  }
  .recent-remove:hover {
    background: rgba(192, 57, 43, 0.2);
    color: #ffb0a8;
  }

  /* Footer link styled like the WelcomeDismiss affordance — accent
     colour, small text, no chrome. Sits at the bottom of the recents
     list as a quiet "wipe everything" action (no confirmation needed
     since recents are just metadata). */
  .clear-recents {
    margin: 4px 10px 2px;
    padding: 4px 0;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    cursor: pointer;
    user-select: none;
    transition: filter 0.12s ease;
  }
  .clear-recents:hover { filter: brightness(1.15); }
  .clear-recents:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 4px;
    border-radius: 4px;
  }
</style>
