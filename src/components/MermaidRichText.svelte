<script lang="ts">
  import TextB from 'phosphor-svelte/lib/TextB';
  import TextItalic from 'phosphor-svelte/lib/TextItalic';
  import {
    parseRich,
    serializeRich,
    runsToHtml,
    htmlToRuns,
  } from '../lib/editor/mermaid/rich-text';

  // A one-line (optionally multi-line) rich-text field for diagram
  // labels: bold / italic via the B / I buttons or Ctrl+B / Ctrl+I,
  // never via typed asterisks. `value` is the label's markdown
  // (rich-text.ts); the field shows it formatted and hands markdown back
  // on commit (blur / Enter). Escape reverts.
  interface Props {
    value: string;
    placeholder?: string;
    multiline?: boolean;
    className?: string;
    ariaLabel?: string;
    onCommit: (markdown: string) => void;
    // Enter: commit, then this (popovers close on it).
    onEnter?: () => void;
    onEscape?: () => void;
  }
  let { value, placeholder = '', multiline = false, className = '', ariaLabel = 'Text', onCommit, onEnter, onEscape }: Props = $props();

  let field: HTMLDivElement | null = $state(null);
  let bold = $state(false);
  let italic = $state(false);
  let empty = $state(true);
  // The markdown the field was last filled from: re-fill only when the
  // value changes from outside, never under the caret while typing.
  let shown: string | null = null;

  $effect(() => {
    const v = value;
    if (!field || v === shown) return;
    if (document.activeElement === field && shown !== null) return;
    field.innerHTML = runsToHtml(parseRich(v));
    shown = v;
    empty = field.textContent === '';
  });

  function current(): string {
    return field ? serializeRich(htmlToRuns(field)) : value;
  }

  function commit() {
    const md = current();
    shown = md;
    if (md !== value) onCommit(md);
  }

  function revert() {
    if (field) field.innerHTML = runsToHtml(parseRich(value));
    shown = value;
  }

  function format(cmd: 'bold' | 'italic') {
    field?.focus();
    // execCommand is deprecated but still the one thing every webview
    // implements for toggling formatting on the selection.
    document.execCommand?.(cmd);
    refreshState();
  }

  function refreshState() {
    bold = !!document.queryCommandState?.('bold');
    italic = !!document.queryCommandState?.('italic');
    empty = (field?.textContent ?? '') === '';
  }

  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      format('bold');
    } else if (mod && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      format('italic');
    } else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
      e.preventDefault();
      commit();
      onEnter?.();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand?.('insertLineBreak');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      revert();
      onEscape?.();
    }
  }

  // Pasting brings formatting from elsewhere; keep only the text.
  function onPaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    document.execCommand?.('insertText', false, multiline ? text : text.replace(/\r?\n/g, ' '));
  }
</script>

<div class="mermaid-rich">
  <div
    bind:this={field}
    class="mermaid-rich-field {className}"
    class:empty
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-label={ariaLabel}
    aria-multiline={multiline}
    data-placeholder={placeholder}
    onblur={commit}
    onkeydown={onKey}
    onkeyup={refreshState}
    onmouseup={refreshState}
    oninput={refreshState}
    onpaste={onPaste}
  ></div>
  <button type="button" class="mermaid-rich-btn" class:active={bold} title="Bold (Ctrl+B)" aria-label="Bold"
    onmousedown={(e) => e.preventDefault()} onclick={() => format('bold')}>
    <TextB size={13} weight="bold" />
  </button>
  <button type="button" class="mermaid-rich-btn" class:active={italic} title="Italic (Ctrl+I)" aria-label="Italic"
    onmousedown={(e) => e.preventDefault()} onclick={() => format('italic')}>
    <TextItalic size={13} />
  </button>
</div>

<style>
  .mermaid-rich {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .mermaid-rich-field {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    font-family: var(--font-sans);
    min-width: 140px;
    max-width: 260px;
    min-height: 1.4em;
    outline: none;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    cursor: text;
  }
  .mermaid-rich-field:focus { border-color: var(--accent); }
  .mermaid-rich-field.empty::before {
    content: attr(data-placeholder);
    color: var(--fg-2);
    pointer-events: none;
  }
  .mermaid-rich-btn {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 5px;
    border-radius: 4px;
    cursor: pointer;
  }
  .mermaid-rich-btn:hover { background: var(--bg-2); color: var(--fg-0); }
  .mermaid-rich-btn.active { background: var(--accent-soft); color: var(--accent); }
</style>
