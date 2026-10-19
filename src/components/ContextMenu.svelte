<script lang="ts" module>
  export interface ContextMenuItem {
    label: string;
    onSelect: () => void;
    hint?: string;      // right-aligned (e.g. a shortcut or "Middle-click")
    disabled?: boolean;
    danger?: boolean;
  }
  export type ContextMenuEntry = ContextMenuItem | 'separator';
</script>

<script lang="ts">
  // A right-click menu opened at the pointer. Keeps itself inside the
  // window, takes keyboard focus (arrows / Home / End / Enter / Esc) and
  // closes on any outside pointer, Esc, blur or scroll.
  import { onMount, tick } from 'svelte';

  interface Props {
    x: number;
    y: number;
    label: string;
    items: ContextMenuEntry[];
    onclose: () => void;
  }
  let { x, y, label, items, onclose }: Props = $props();

  let menuEl = $state<HTMLDivElement | null>(null);
  let pos = $state({ left: 0, top: 0 });

  function enabledButtons(): HTMLButtonElement[] {
    return Array.from(menuEl?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
  }

  function place() {
    const w = menuEl?.offsetWidth ?? 0;
    const h = menuEl?.offsetHeight ?? 0;
    const margin = 8;
    // Flip to the other side of the pointer when there's no room.
    const left = x + w + margin > window.innerWidth ? Math.max(margin, x - w) : x;
    const top = y + h + margin > window.innerHeight ? Math.max(margin, y - h) : y;
    pos = { left, top };
  }

  function run(item: ContextMenuItem) {
    if (item.disabled) return;
    onclose();
    item.onSelect();
  }

  function onMenuKeydown(e: KeyboardEvent) {
    const btns = enabledButtons();
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); btns[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1]?.focus(); }
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); }
  }

  function onWindowPointerDown(e: PointerEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) onclose();
  }

  function reducedMotion(): boolean {
    return typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }

  function pop(_node: Element) {
    if (reducedMotion()) return { duration: 0 };
    return {
      duration: 140,
      css: (t: number) => `opacity: ${t}; transform: scale(${0.94 + 0.06 * t});`,
    };
  }

  onMount(() => {
    place();
    void tick().then(() => enabledButtons()[0]?.focus());
  });
</script>

<svelte:window
  onkeydown={onWindowKeydown}
  onpointerdown={onWindowPointerDown}
  onblur={onclose}
  onresize={onclose}
/>

<div
  class="context-menu glass"
  role="menu"
  aria-label={label}
  tabindex="-1"
  bind:this={menuEl}
  style:left={`${pos.left}px`}
  style:top={`${pos.top}px`}
  onkeydown={onMenuKeydown}
  oncontextmenu={(e) => e.preventDefault()}
  in:pop
>
  {#each items as item, i (i)}
    {#if item === 'separator'}
      <div class="sep" role="separator"></div>
    {:else}
      <button
        role="menuitem"
        class="item"
        class:danger={item.danger}
        aria-disabled={item.disabled ? 'true' : undefined}
        tabindex="-1"
        onclick={() => run(item)}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(item); } }}
      >
        <span>{item.label}</span>
        {#if item.hint}<kbd>{item.hint}</kbd>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .context-menu {
    position: fixed;
    /* Above the hamburger menu (z:130) it is usually opened from, below
       dialogs (z:200+). */
    z-index: 140;
    min-width: 220px;
    padding: 5px;
    display: flex;
    flex-direction: column;
    transform-origin: top left;
    background:
      linear-gradient(var(--bg-1), var(--bg-1)),
      var(--glass-fill);
    border-radius: 10px;
  }
  .context-menu:focus { outline: none; }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    padding: 7px 10px;
    color: var(--fg-0);
    font-family: var(--font-sans);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .item:hover:not([aria-disabled='true']),
  .item:focus-visible {
    background: var(--accent-soft);
    outline: none;
  }
  .item[aria-disabled='true'] {
    color: var(--fg-2);
    cursor: default;
  }
  .item.danger { color: var(--danger); }
  kbd {
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--fg-2);
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--glass-border);
  }
</style>
