<script lang="ts">
  import { isWelcomeDocOpen } from '../stores/welcome';
  import { settings, updateSettings } from '../stores/settings';

  function toggle() {
    updateSettings({ dontShowWelcomeOnLaunch: !$settings.dontShowWelcomeOnLaunch });
  }
</script>

{#if $isWelcomeDocOpen}
  <!-- svelte-ignore a11y_label_has_associated_control -->
  <label class="dismiss glass glass-pill" title="Stop loading welcome.md every time the app starts">
    <input
      type="checkbox"
      checked={$settings.dontShowWelcomeOnLaunch}
      onchange={toggle}
    />
    <span>Don't show welcome.md on launch</span>
  </label>
{/if}

<style>
  /* Floats just above the ZoomControls rail (bottom: 22px, ~38px tall).
     22 + 38 + 8 gap = 68px from bottom. Same left offset as the zoom
     pill so the two read as a stacked column. */
  .dismiss {
    position: fixed;
    bottom: 68px;
    left: 22px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px 6px 10px;
    z-index: 100;
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--fg-2);
    cursor: pointer;
    user-select: none;
    transition: color 0.15s ease;
  }
  .dismiss:hover { color: var(--fg-1); }
  .dismiss input[type="checkbox"] {
    width: 13px;
    height: 13px;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .dismiss span {
    line-height: 1;
  }
</style>
