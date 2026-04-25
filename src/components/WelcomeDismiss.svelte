<script lang="ts">
  import { isWelcomeDocOpen } from '../stores/welcome';
  import { settings, updateSettings } from '../stores/settings';

  function toggle() {
    updateSettings({ dontShowWelcomeOnLaunch: !$settings.dontShowWelcomeOnLaunch });
  }
</script>

{#if $isWelcomeDocOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dismiss"
    class:applied={$settings.dontShowWelcomeOnLaunch}
    onclick={toggle}
    role="button"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
    title="Click to toggle whether welcome.md opens on every launch"
  >
    <div>Don't show welcome.md</div>
    <div>on launch</div>
  </div>
{/if}

<style>
  /* Plain two-line accent-coloured text. No pill, no checkbox — the
     surrounding UI (an open welcome doc + a clickable two-line link sitting
     above the zoom controls) is enough to communicate intent.
     Stacks ABOVE the NotesPanel pill so they don't collide when the
     welcome doc has any notes attached: ZoomControls at 22 + NotesPanel
     at 68 + this at 116. */
  .dismiss {
    position: fixed;
    bottom: 116px;
    left: 22px;
    z-index: 100;
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.3;
    color: var(--accent);
    cursor: pointer;
    user-select: none;
    transition: opacity 0.15s ease, color 0.15s ease;
  }
  .dismiss:hover { filter: brightness(1.15); }
  .dismiss:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 4px;
    border-radius: 4px;
  }
  /* When the setting is on (the welcome will not show again), dim the
     hint so the affordance reads as "already applied — click to revert"
     without disappearing entirely. */
  .dismiss.applied {
    opacity: 0.45;
    text-decoration: line-through;
  }
  /* While the tutorial overlay is up, this hint sits in the same lower-left
     region as the re.marks tip and visually competes with it. Blur it out
     and disable interaction until the tutorial is dismissed — the hint is
     re-readable as soon as the user clicks "Got it" or "Hide forever". */
  :global(body.tutorial-active) .dismiss {
    filter: blur(3px);
    opacity: 0.55;
    pointer-events: none;
    transition: filter 0.2s ease, opacity 0.2s ease;
  }
</style>
