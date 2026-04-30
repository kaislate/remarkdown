<!-- src/components/Editor.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { EditorView } from 'prosemirror-view';
  import { createEditorView } from '../lib/editor/view';

  interface Props {
    initialMarkdown: string;
    onChange: (markdown: string) => void;
  }
  let { initialMarkdown, onChange }: Props = $props();

  let parentEl = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;

  onMount(() => {
    if (!parentEl) return;
    view = createEditorView(parentEl, initialMarkdown, onChange);
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });
</script>

<div class="editor-surface" bind:this={parentEl}></div>

<style>
  /* The .ProseMirror class is added by EditorView itself. We style it
     to look like an article, not a textarea — same font/measure as the
     reader so toggling edit mode doesn't reflow. */
  .editor-surface {
    width: 100%;
  }
  :global(.editor-surface .ProseMirror) {
    outline: none;
    min-height: 60vh;
    font-family: var(--font-serif);
    font-size: 1rem;
    line-height: 1.6;
    color: var(--fg-0);
  }
  :global(.editor-surface .ProseMirror p) {
    margin: 0 0 1em;
  }
  :global(.editor-surface .ProseMirror h1) {
    font-size: 1.8em;
    font-weight: 700;
    margin: 1.2em 0 0.6em;
  }
  :global(.editor-surface .ProseMirror h2) {
    font-size: 1.4em;
    font-weight: 700;
    margin: 1em 0 0.5em;
  }
  :global(.editor-surface .ProseMirror h3) {
    font-size: 1.15em;
    font-weight: 700;
    margin: 0.9em 0 0.4em;
  }
  :global(.editor-surface .ProseMirror code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
    background: var(--bg-2);
    padding: 1px 4px;
    border-radius: 3px;
  }
  :global(.editor-surface .ProseMirror blockquote) {
    border-left: 3px solid var(--accent-soft);
    padding-left: 12px;
    color: var(--fg-1);
    margin: 0 0 1em;
  }
</style>
