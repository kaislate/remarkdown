<script lang="ts">
  import { doc } from '../stores/doc';

  function basename(path: string): string {
    const last = path.split(/[\\/]/).pop() ?? path;
    return last.replace(/\.(md|markdown)$/i, '');
  }
</script>

{#if $doc}
  <div class="left-title" aria-hidden="true">
    <span class="text">{basename($doc.path)}</span>
  </div>
{/if}

<style>
  /* Fixed strip down the left edge. Width ~ the typical left margin so the
     rotated text stays out of the article column on standard windows. The
     watermark is purely decorative (aria-hidden, pointer-events:none) and
     sits below most chrome so it never intercepts interaction. */
  .left-title {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: 130px;
    display: grid;
    place-items: center;
    pointer-events: none;
    overflow: hidden;
    z-index: 1;
  }
  /* Rotated counterclockwise so the text reads bottom-to-top along the
     left edge. The strip width after rotation equals the font-size, so we
     tune font-size to fit comfortably inside the margin band above. */
  .text {
    font-family: var(--font-sans);
    font-weight: 800;
    font-size: 110px;
    letter-spacing: -0.04em;
    line-height: 1;
    color: var(--fg-0);
    opacity: 0.045;
    transform: rotate(-90deg);
    transform-origin: center;
    white-space: nowrap;
    user-select: none;
  }
</style>
