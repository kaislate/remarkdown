<script lang="ts">
  import { setCursorActive, setCursorPressed, collapseCursor } from '../stores/cursor';

  let { open = false, onclose }: { open?: boolean; onclose?: () => void } = $props();

  // Collapse the X-cursor at click time, not on the next mousemove.
  // onmouseleave only fires once the pointer moves off the element, so
  // a stationary click would otherwise leave the cursor visible until
  // the user wiggles the mouse.
  function handleClick() {
    collapseCursor();
    onclose?.();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="menu-overlay"
  class:open
  onmousemove={() => setCursorActive(true)}
  onmouseleave={() => { setCursorActive(false); setCursorPressed(false); }}
  onmousedown={() => setCursorPressed(true)}
  onmouseup={() => setCursorPressed(false)}
  onclick={handleClick}
  aria-hidden="true"
></div>

<style>
  .menu-overlay {
    position: fixed;
    inset: 0;
    background-color: rgba(11, 10, 18, 0.6);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    cursor: none;
    transition: var(--animation-overlay);
    transition-property: opacity, visibility;
    z-index: 95;
    /* Below GlassMenu's popover (z:100 by inheritance from .menu-root)
       but above all other chrome so the menu floats over a dimmed app. */
  }
  .menu-overlay.open {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }
</style>
