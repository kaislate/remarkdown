<script lang="ts">
  import BookOpen from 'phosphor-svelte/lib/BookOpen';
  import { readerMode, toggleReaderMode } from '../stores/reader-mode';

  function handleClick() {
    toggleReaderMode();
  }
</script>

<button
  class="reader-mode-toggle glass glass-pill"
  class:active={$readerMode}
  aria-label={$readerMode ? 'Exit reader mode' : 'Enter reader mode'}
  aria-pressed={$readerMode}
  title={$readerMode ? 'Exit reader mode (Esc)' : 'Reader mode — hide chrome for distraction-free reading'}
  onclick={handleClick}
>
  <BookOpen size={20} weight={$readerMode ? 'fill' : 'regular'} />
</button>

<style>
  /* Bottom of the top-left button stack: hamburger (top:14), EditMode
     (top:60), ToC (top:106), this Focus toggle (top:152 = 106 + 38 + 8). */
  .reader-mode-toggle {
    position: fixed;
    top: 152px;
    left: 14px;
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    color: var(--fg-1);
    cursor: pointer;
    padding: 0;
    z-index: 100;
    transition:
      opacity 0.2s ease,
      color 0.2s ease,
      transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
      border-color 0.2s ease,
      background 0.2s ease;
  }
  .reader-mode-toggle:hover {
    color: var(--accent);
    border-color: var(--accent-soft);
    background: rgba(139, 127, 255, 0.08);
    transform: scale(1.05);
  }
  /* When reader mode is ON, the button itself reads as "active" — its
     icon flips to the filled phosphor variant via the aria/state, and
     the border/colour swap to accent so the button signals its own
     state. */
  .reader-mode-toggle.active {
    color: var(--accent);
    border-color: var(--accent-soft);
    background: rgba(139, 127, 255, 0.12);
  }
  /* While reader mode is on, fade this button down so it doesn't
     compete with the article. Hover restores full opacity so the
     user can see they're about to exit. The body class is set in
     App.svelte's reader-mode effect. */
  :global(body.reader-mode) .reader-mode-toggle {
    opacity: 0.3;
  }
  :global(body.reader-mode) .reader-mode-toggle:hover {
    opacity: 1;
  }
</style>
