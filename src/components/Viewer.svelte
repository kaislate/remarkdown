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
      <div class="text-frame">
        <article class="viewer md-rendered" bind:this={articleEl}>
          {@html $doc.html}
        </article>
        <HighlightLayer />
        <NoteLayer />
      </div>
      <!-- DrawLayer is a sibling of the text frame so the draw tool can paint
           across the full window width, not just within the text column. -->
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
    /* Keep flex children at their intrinsic cross-axis (height) so .content grows
       with the text beneath. Without this, default align-items: stretch clamps
       .content to 100vh and the DrawLayer SVG inside ends up viewport-height
       only — meaning you can't draw on content below the first screen. */
    align-items: flex-start;
    /* Reserve space on the right for the minimap (140px wide + 16px gutter) plus
       a comfortable buffer, so centered content doesn't overlap with it on
       typical windows. This also shifts content left from absolute-center,
       reducing the empty margin on the left side. */
    padding-right: 172px;
    /* Navigation happens via the minimap (and wheel/keyboard); native scrollbar is noise. */
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .scroll::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
  .empty {
    margin-top: 40vh;
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 14px;
    text-align: center;
  }
  /* Full-width container so the draw tool can paint anywhere on the canvas. */
  .content {
    position: relative;
    width: 100%;
    min-height: 100vh;
  }
  /* Text column — centered on narrower windows, capped to a max left margin
     on wider ones so content doesn't drift away from the left edge as the
     window grows. The right side absorbs the remaining space (auto margin)
     and the .scroll's right padding reserves the minimap region. */
  .text-frame {
    position: relative;
    max-width: 720px;
    width: 100%;
    margin-left: clamp(0px, calc((100% - 720px) / 2), 140px);
    margin-right: auto;
  }
  /* Layout only. Content styling lives in src/styles/article.css via the
     `md-rendered` class so the minimap clone gets the same layout. */
  .viewer {
    width: 100%;
    padding: 96px 48px 160px;
  }
</style>
