<script lang="ts" module>
  // Exported state shape so the NodeView (footnote-node-view.ts) can
  // type its writable store identically. Module-level so it is usable
  // as a TS type import from the .svelte file.
  export interface FootnotePopoverState {
    open: boolean;
    label: string;
    body: string;
    x: number;
    y: number;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import type { Readable } from 'svelte/store';
  import Trash from 'phosphor-svelte/lib/Trash';

  // Props are sourced from a Svelte store so the NodeView (plain TS,
  // outside any Svelte component context) can update them imperatively
  // by calling store.set(...). Same pattern as MermaidNotePopover.
  //
  // NOTE: do not name this prop `state` — Svelte's legacy store
  // auto-subscribe syntax (`$state` -> auto-subscribed value of a
  // store named `state`) collides with the `$state` rune and the
  // compiler will rewrite our rune calls into store-accessor calls.
  // `stateStore` keeps both the prop and the rune unambiguous.
  interface Props {
    stateStore: Readable<FootnotePopoverState>;
    onSave: (next: { label: string; body: string }) => void;
    onDelete: () => void;
  }
  let { stateStore, onSave, onDelete }: Props = $props();

  // Mirror the store value into local reactive state so all template
  // bindings re-run on store updates.
  let current: FootnotePopoverState | null = $state(null);
  $effect(() => {
    const unsub = stateStore.subscribe((v) => {
      current = v;
    });
    return unsub;
  });

  // Local drafts: separate from the store so typing is responsive and
  // doesn't race with reactive effects when the parent updates the store
  // (e.g., switching to a different footnote node). lastSeed re-seeds
  // the inputs only when the underlying (open, label, body) tuple
  // actually changes.
  let labelDraft: string = $state('');
  let bodyDraft: string = $state('');
  let labelInputEl: HTMLInputElement | null = $state(null);
  let lastSeed = '';
  $effect(() => {
    if (!current) return;
    const seed = `${current.open ? 'o' : 'c'}::${current.label}::${current.body}`;
    if (seed !== lastSeed) {
      labelDraft = current.label;
      bodyDraft = current.body;
      lastSeed = seed;
    }
  });

  // Auto-focus the label input when the popover opens.
  let lastOpen = false;
  $effect(() => {
    if (!current) return;
    if (current.open && !lastOpen) {
      void tick().then(() => labelInputEl?.focus());
    }
    lastOpen = current.open;
  });

  function save() {
    onSave({ label: labelDraft, body: bodyDraft });
  }

  function deleteFn() {
    onDelete();
  }
</script>

{#if current?.open}
  <div
    class="footnote-popover glass"
    style="left: {current.x}px; top: {current.y}px;"
    role="dialog"
    aria-label="Edit footnote"
  >
    <header>
      <span class="title">Footnote</span>
      <button
        type="button"
        class="delete-btn"
        data-action="delete"
        aria-label="Delete footnote"
        onmousedown={(e) => e.preventDefault()}
        onclick={deleteFn}
      >
        <Trash size={14} />
      </button>
    </header>
    <label class="row">
      <span>Label</span>
      <input
        type="text"
        data-field="label"
        bind:this={labelInputEl}
        bind:value={labelDraft}
        placeholder="1, note, ..."
      />
    </label>
    <label class="row">
      <span>Body</span>
      <textarea
        data-field="body"
        bind:value={bodyDraft}
        rows="4"
        placeholder="Footnote text..."
      ></textarea>
    </label>
    <div class="actions">
      <button
        type="button"
        class="save-btn"
        data-action="save"
        onmousedown={(e) => e.preventDefault()}
        onclick={save}
      >Save</button>
    </div>
  </div>
{/if}

<style>
  .footnote-popover {
    position: absolute;
    z-index: 90;
    width: 320px;
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
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
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
  .row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .row > span {
    font-size: 11px;
    color: var(--fg-2);
  }
  .row input,
  .row textarea {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 4px 6px;
    font-family: inherit;
    font-size: 12px;
    outline: none;
    resize: vertical;
  }
  .row input:focus,
  .row textarea:focus {
    border-color: var(--accent);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .save-btn {
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid var(--accent-soft);
    border-radius: 4px;
    padding: 4px 10px;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .save-btn:hover { background: var(--accent); color: var(--bg-0); }
</style>
