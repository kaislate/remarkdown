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
  /* Fixed strip down the left edge. Full viewport height; the rotated text
     inside is anchored at the strip's center via absolute positioning so its
     layout is predictable regardless of filename length. The strip itself
     does NOT clip overflow — the rotated text spills past top/bottom of the
     viewport for typical filenames, which is the desired cut-off effect. */
  .left-title {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: 130px;
    pointer-events: none;
    z-index: 1;
  }
  /* Anchor the text at the absolute center of the strip, then rotate around
     that point. This works the same for short ("foo") and long
     ("very-long-filename") basenames — the visible text is always centered
     vertically in the viewport. The rotated bounding box (font-size wide,
     text-length tall) bleeds past the viewport top/bottom for longer names,
     which is the intended margin-watermark look. */
  .text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-90deg);
    transform-origin: center;
    font-family: var(--font-sans);
    font-weight: 800;
    font-size: 130px;
    letter-spacing: -0.04em;
    line-height: 1;
    color: var(--fg-0);
    opacity: 0.08;
    white-space: nowrap;
    user-select: none;
  }
</style>
