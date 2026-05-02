<script lang="ts">
  import Note from 'phosphor-svelte/lib/Note';
  import Code from 'phosphor-svelte/lib/Code';
  import CheckSquare from 'phosphor-svelte/lib/CheckSquare';

  type ToolbarAction = 'callout' | 'code' | 'tasks' | 'table' | 'mermaid' | 'image';

  interface Props {
    onInsert: (action: ToolbarAction) => void;
  }
  let { onInsert }: Props = $props();
</script>

<div class="editor-toolbar" role="toolbar" aria-label="Editor toolbar">
  <button
    class="toolbar-btn"
    type="button"
    data-action="insert-callout"
    title="Insert callout"
    aria-label="Insert callout"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onInsert('callout')}
  >
    <Note size={18} weight="regular" />
    <span class="label">Callout</span>
  </button>
  <button
    class="toolbar-btn"
    type="button"
    data-action="code"
    title="Insert code block"
    aria-label="Insert code block"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onInsert('code')}
  >
    <Code size={18} weight="regular" />
    <span class="label">Code</span>
  </button>
  <button
    class="toolbar-btn"
    type="button"
    data-action="tasks"
    title="Insert task list"
    aria-label="Insert task list"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onInsert('tasks')}
  >
    <CheckSquare size={18} weight="regular" />
    <span class="label">Tasks</span>
  </button>
</div>

<style>
  .editor-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--glass-border);
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .toolbar-btn:hover {
    background: var(--bg-2);
    color: var(--fg-0);
    border-color: var(--glass-border);
  }
  .toolbar-btn .label {
    font-family: var(--font-sans);
  }
</style>
