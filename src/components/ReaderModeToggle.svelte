<script lang="ts">
  import BookOpen from 'phosphor-svelte/lib/BookOpen';
  import { toggleReaderMode } from '../stores/reader-mode';
</script>

<!-- Entry only: reader mode hides this button with the rest of the chrome
     (styles/reader-mode.css), and Esc is the way back out. -->
<button
  class="reader-mode-toggle glass glass-pill"
  aria-label="Reader mode"
  title="Reader mode — nothing but the page (Esc to leave)"
  onclick={toggleReaderMode}
>
  <BookOpen size={20} />
</button>

<style>
  /* Bottom of the top-left button stack: hamburger (top:14), EditMode
     (top:60), ToC (top:106), this Reader toggle (top:152 = 106 + 38 + 8). */
  .reader-mode-toggle {
    position: fixed;
    top: calc(152px + var(--chrome-inset-top));
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
</style>
