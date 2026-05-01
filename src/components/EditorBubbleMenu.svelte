<script lang="ts">
  import TextB from 'phosphor-svelte/lib/TextB';
  import TextItalic from 'phosphor-svelte/lib/TextItalic';
  import Code from 'phosphor-svelte/lib/Code';
  import Link from 'phosphor-svelte/lib/Link';

  type MarkName = 'strong' | 'em' | 'code' | 'link';

  interface Props {
    visible: boolean;
    x: number;
    y: number;
    onMark: (name: MarkName) => void;
    activeMarks: Set<string>;
  }
  let { visible, x, y, onMark, activeMarks }: Props = $props();
</script>

<div
  class="editor-bubble-menu glass"
  hidden={!visible}
  style="left: {x}px; top: {y}px;"
  role="toolbar"
  aria-label="Selection formatting"
>
  <button
    type="button"
    class="bubble-btn"
    data-mark="strong"
    aria-pressed={activeMarks.has('strong')}
    title="Bold (Ctrl+B)"
    aria-label="Bold"
    onclick={() => onMark('strong')}
  >
    <TextB size={16} weight="bold" />
  </button>
  <button
    type="button"
    class="bubble-btn"
    data-mark="em"
    aria-pressed={activeMarks.has('em')}
    title="Italic (Ctrl+I)"
    aria-label="Italic"
    onclick={() => onMark('em')}
  >
    <TextItalic size={16} weight="bold" />
  </button>
  <button
    type="button"
    class="bubble-btn"
    data-mark="code"
    aria-pressed={activeMarks.has('code')}
    title="Inline code (Ctrl+`)"
    aria-label="Inline code"
    onclick={() => onMark('code')}
  >
    <Code size={16} weight="bold" />
  </button>
  <button
    type="button"
    class="bubble-btn"
    data-mark="link"
    aria-pressed={activeMarks.has('link')}
    title="Link"
    aria-label="Link"
    onclick={() => onMark('link')}
  >
    <Link size={16} weight="bold" />
  </button>
</div>

<style>
  .editor-bubble-menu {
    position: absolute;
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    z-index: 50;
    pointer-events: auto;
    transform: translate(-50%, calc(-100% - 8px));
  }
  .bubble-btn {
    background: transparent;
    border: 0;
    color: var(--fg-1);
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .bubble-btn:hover { background: var(--bg-2); color: var(--fg-0); }
  .bubble-btn[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
