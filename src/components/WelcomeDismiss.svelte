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
     above the zoom controls) is enough to communicate intent. Sits at
     bottom: 68px / left: 22px so it stacks cleanly above the ZoomControls
     pill (bottom: 22px, ~38px tall + an 8px gap). */
  .dismiss {
    position: fixed;
    bottom: 68px;
    left: 22px;
    z-index: 100;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.25;
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
</style>
