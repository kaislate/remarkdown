<script lang="ts">
  import { doc } from '../stores/doc';
  import { currentViewerRoot } from '../stores/annots';
  import { viewerScroll } from '../stores/viewport';
  import HighlightLayer from './HighlightLayer.svelte';
  import NoteLayer from './NoteLayer.svelte';
  import DrawLayer from './DrawLayer.svelte';

  let articleEl = $state<HTMLElement | null>(null);
  let scrollEl = $state<HTMLElement | null>(null);

  $effect(() => {
    if (articleEl) currentViewerRoot.set(articleEl);
    return () => currentViewerRoot.set(null);
  });

  $effect(() => {
    if (scrollEl) viewerScroll.set(scrollEl);
    return () => viewerScroll.set(null);
  });
</script>

<div class="scroll" bind:this={scrollEl}>
  {#if $doc === null}
    <div class="empty">
      <p>Open a markdown file to start reading.</p>
    </div>
  {:else}
    <div class="content">
      <article class="viewer" bind:this={articleEl}>
        {@html $doc.html}
      </article>
      <HighlightLayer />
      <NoteLayer />
      <DrawLayer />
    </div>
  {/if}
</div>

<style>
  .scroll {
    height: 100vh;
    width: 100vw;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    justify-content: center;
  }
  .empty {
    margin-top: 40vh;
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 14px;
    text-align: center;
  }
  .content {
    position: relative;
    max-width: 720px;
    width: 100%;
  }
  .content .viewer {
    max-width: none;
    width: 100%;
  }
  .viewer {
    max-width: 720px;
    width: 100%;
    padding: 96px 48px 160px;
    color: var(--fg-0);
  }
  .viewer :global(h1),
  .viewer :global(h2),
  .viewer :global(h3) {
    font-family: var(--font-sans);
    color: var(--fg-0);
    letter-spacing: -0.01em;
  }
  .viewer :global(h1) { font-size: 2rem; margin-top: 2.2em; }
  .viewer :global(h2) { font-size: 1.5rem; margin-top: 2em; }
  .viewer :global(p) { margin: 1em 0; }
  .viewer :global(a) { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-soft); }
  .viewer :global(code) { font-family: var(--font-mono); font-size: 0.92em; background: var(--bg-2); padding: 0.1em 0.3em; border-radius: 4px; }
  .viewer :global(pre) { background: var(--bg-2); padding: 14px 16px; border-radius: 10px; overflow-x: auto; border: 1px solid var(--glass-border); }
  .viewer :global(pre code) { background: transparent; padding: 0; }
  .viewer :global(blockquote) { border-left: 3px solid var(--accent); padding-left: 14px; margin-left: 0; color: var(--fg-1); }
  .viewer :global(img) { max-width: 100%; border-radius: 6px; }
  .viewer :global(table) { border-collapse: collapse; margin: 1em 0; }
  .viewer :global(th), .viewer :global(td) { border: 1px solid var(--glass-border); padding: 6px 10px; }
</style>
