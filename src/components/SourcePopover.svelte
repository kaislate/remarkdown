<script lang="ts" module>
  // State for the popover that edits a piece of a document kept as its
  // own text — a formula (math-node-view.ts) or a file's document
  // details (front-matter-node-view.ts). The node view owns the store.
  export interface SourcePopoverState {
    open: boolean;
    title: string; // "Formula", "Document details"
    text: string;
    x: number;
    y: number;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import type { Readable } from 'svelte/store';
  import Trash from 'phosphor-svelte/lib/Trash';

  // NOTE: not named `state` (it would collide with the `$state` rune).
  interface Props {
    stateStore: Readable<SourcePopoverState>;
    // What the text looks like, drawn under the box as you type; returns
    // HTML, or null for no preview.
    preview?: (text: string) => string | null;
    placeholder?: string;
    hint?: string;
    onSave: (text: string) => void;
    onDelete: () => void;
    onClose: () => void;
  }
  let { stateStore, preview, placeholder = '', hint = '', onSave, onDelete, onClose }: Props = $props();

  let current: SourcePopoverState | null = $state(null);
  $effect(() => stateStore.subscribe((v) => (current = v)));

  let draft = $state('');
  let box: HTMLTextAreaElement | null = $state(null);
  let root: HTMLElement | null = $state(null);
  let lastOpen = false;
  $effect(() => {
    if (!current) return;
    if (current.open && !lastOpen) {
      draft = current.text;
      void tick().then(() => {
        box?.focus();
        box?.select();
      });
    }
    lastOpen = current.open;
  });

  const previewHtml = $derived.by(() => {
    const c = current as SourcePopoverState | null;
    return preview && c?.open ? preview(draft) : null;
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSave(draft);
    }
  }

  // A click anywhere else closes it (without saving).
  $effect(() => {
    if (!current?.open) return;
    const away = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => window.addEventListener('pointerdown', away, true));
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', away, true);
    };
  });
</script>

{#if current?.open}
  <div
    class="source-popover"
    style="left: {current.x}px; top: {current.y}px;"
    role="dialog"
    aria-label={`Edit ${current.title.toLowerCase()}`}
    bind:this={root}
  >
    <header>
      <span class="title">{current.title}</span>
      <button
        type="button"
        class="delete-btn"
        aria-label={`Remove ${current.title.toLowerCase()}`}
        onmousedown={(e) => e.preventDefault()}
        onclick={onDelete}
      >
        <Trash size={14} />
      </button>
    </header>
    <textarea
      bind:this={box}
      bind:value={draft}
      rows={Math.min(10, Math.max(2, draft.split('\n').length + 1))}
      spellcheck="false"
      {placeholder}
      onkeydown={onKeydown}
    ></textarea>
    {#if previewHtml !== null && previewHtml !== undefined}
      <div class="preview" aria-label="Preview">{@html previewHtml}</div>
    {/if}
    <div class="actions">
      {#if hint}<span class="hint">{hint}</span>{/if}
      <button type="button" class="cancel-btn" onclick={onClose}>Cancel</button>
      <button type="button" class="save-btn" onmousedown={(e) => e.preventDefault()} onclick={() => onSave(draft)}>Save</button>
    </div>
  </div>
{/if}

<style>
  .source-popover {
    position: absolute;
    z-index: 90;
    width: 360px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    font-family: var(--font-sans);
    font-size: 12px;
  }
  header { display: flex; align-items: center; justify-content: space-between; }
  .title {
    font-weight: 600;
    color: var(--fg-1);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11px;
  }
  .delete-btn {
    background: transparent;
    border: 0;
    color: var(--fg-2);
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .delete-btn:hover { color: var(--danger, #f0a0a0); background: var(--bg-2); }
  textarea {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
    resize: vertical;
  }
  textarea:focus { border-color: var(--accent); }
  .preview {
    padding: 8px;
    border-radius: 4px;
    background: var(--bg-0);
    color: var(--fg-0);
    overflow-x: auto;
    text-align: center;
    font-size: 14px;
  }
  .actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
  .hint { flex: 1 1 auto; color: var(--fg-2); font-size: 11px; }
  .save-btn,
  .cancel-btn {
    border-radius: 4px;
    padding: 4px 10px;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .save-btn { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-soft); }
  .save-btn:hover { background: var(--accent); color: var(--bg-0); }
  .cancel-btn { background: transparent; color: var(--fg-2); border: 1px solid var(--glass-border); }
  .cancel-btn:hover { color: var(--fg-0); }
</style>
