<script lang="ts">
  import { tick } from 'svelte';
  import TextB from 'phosphor-svelte/lib/TextB';
  import TextItalic from 'phosphor-svelte/lib/TextItalic';
  import TextStrikethrough from 'phosphor-svelte/lib/TextStrikethrough';
  import TextSubscript from 'phosphor-svelte/lib/TextSubscript';
  import TextSuperscript from 'phosphor-svelte/lib/TextSuperscript';
  import Code from 'phosphor-svelte/lib/Code';
  import Link from 'phosphor-svelte/lib/Link';

  type MarkName = 'strong' | 'em' | 'strike' | 'code' | 'sub' | 'sup';

  interface Props {
    visible: boolean;
    x: number;
    y: number;
    // For non-link marks (toggle behaviour). The link button opens the
    // inline popover below instead — keeping the URL UI inside this
    // component so clicks inside it count as "still in the bubble" for
    // the click-outside dismissal handler in Editor.svelte.
    onMark: (name: MarkName) => void;
    // Applies the link mark across the current PM selection. An empty
    // string removes any existing link mark.
    onApplyLink: (url: string) => void;
    activeMarks: Set<string>;
    // Pre-fill value when opening the popover. Empty string when the
    // selection has no link mark, or has a link mark only across part
    // of the range.
    linkHref: string;
  }
  let {
    visible,
    x,
    y,
    onMark,
    onApplyLink,
    activeMarks,
    linkHref,
  }: Props = $props();

  let linkOpen = $state(false);
  let linkValue = $state('');
  let linkInputEl = $state<HTMLInputElement | null>(null);

  // Close the popover whenever the bubble itself goes away (e.g. user
  // clicked outside the editor surface). Without this the popover
  // would re-appear at the next selection because linkOpen would still
  // be true.
  $effect(() => {
    if (!visible) linkOpen = false;
  });

  async function openLinkPopover() {
    linkValue = linkHref;
    linkOpen = true;
    await tick();
    linkInputEl?.focus();
    linkInputEl?.select();
  }

  function applyLink(e: SubmitEvent) {
    e.preventDefault();
    onApplyLink(linkValue.trim());
    linkOpen = false;
  }

  function removeLink() {
    onApplyLink('');
    linkOpen = false;
  }

  function onLinkKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      linkOpen = false;
    }
  }
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
    onmousedown={(e) => e.preventDefault()}
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
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onMark('em')}
  >
    <TextItalic size={16} weight="bold" />
  </button>
  <button
    type="button"
    class="bubble-btn"
    data-mark="strike"
    aria-pressed={activeMarks.has('strike')}
    title="Strikethrough"
    aria-label="Strikethrough"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onMark('strike')}
  >
    <TextStrikethrough size={16} weight="bold" />
  </button>
  <button
    type="button"
    class="bubble-btn"
    data-mark="sub"
    aria-pressed={activeMarks.has('sub')}
    title="Subscript (Ctrl+,)"
    aria-label="Subscript"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onMark('sub')}
  >
    <TextSubscript size={16} weight="bold" />
  </button>
  <button
    type="button"
    class="bubble-btn"
    data-mark="sup"
    aria-pressed={activeMarks.has('sup')}
    title="Superscript (Ctrl+.)"
    aria-label="Superscript"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onMark('sup')}
  >
    <TextSuperscript size={16} weight="bold" />
  </button>
  <button
    type="button"
    class="bubble-btn"
    data-mark="code"
    aria-pressed={activeMarks.has('code')}
    title="Inline code (Ctrl+`)"
    aria-label="Inline code"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onMark('code')}
  >
    <Code size={16} weight="bold" />
  </button>
  <button
    type="button"
    class="bubble-btn"
    data-mark="link"
    aria-pressed={activeMarks.has('link') || linkOpen}
    title="Link"
    aria-label="Link"
    onmousedown={(e) => e.preventDefault()}
    onclick={openLinkPopover}
  >
    <Link size={16} weight="bold" />
  </button>
  {#if linkOpen}
    <!-- Popover lives INSIDE the bubble's stacking context so clicks
         here still satisfy the `target.closest('.editor-bubble-menu')`
         allow-list in Editor.svelte's onAnyMouseDown — without that
         allowance the bubble (and this popover) would dismiss the
         instant the user mouses into the input. -->
    <form class="link-popover" onsubmit={applyLink}>
      <input
        type="url"
        class="link-input"
        bind:value={linkValue}
        bind:this={linkInputEl}
        placeholder="https://..."
        onkeydown={onLinkKeydown}
      />
      <button type="submit" class="link-action">Apply</button>
      {#if linkHref}
        <button
          type="button"
          class="link-action link-remove"
          onmousedown={(e) => e.preventDefault()}
          onclick={removeLink}
        >Remove</button>
      {/if}
    </form>
  {/if}
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
  /* The `hidden` HTML attribute defaults to display:none in the user-
     agent stylesheet, but the rule above (display: flex) has higher
     specificity and was overriding it — so `hidden=true` was set on
     the element while it kept rendering visibly. Explicit override
     here re-asserts display:none when hidden. */
  .editor-bubble-menu[hidden] {
    display: none;
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

  /* Link URL popover. Lives directly under the link button in the
     bubble menu's flex layout — when present it grows the bubble's
     width to fit the input. Sits in the same row as the buttons so
     the visual weight matches the rest of the bubble. */
  .link-popover {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 4px;
    padding-left: 6px;
    border-left: 1px solid var(--glass-border);
  }
  .link-input {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    font-family: var(--font-sans);
    width: 220px;
    outline: none;
  }
  .link-input:focus {
    border-color: var(--accent);
  }
  .link-action {
    background: transparent;
    color: var(--fg-1);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .link-action:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .link-action[type='submit'] {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent-soft);
  }
  .link-action[type='submit']:hover {
    background: var(--accent);
    color: var(--bg-0);
  }
  .link-remove:hover {
    color: var(--danger, #f0a0a0);
  }
</style>
