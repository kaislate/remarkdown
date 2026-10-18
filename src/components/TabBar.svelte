<script lang="ts">
  // Tab strip in the title band, between the wordmark and the window
  // controls. One tab per open document (session). The strip's empty space
  // stays a window-drag region (and double-click still maximises), like the
  // .titlebar-drag band underneath it.
  //
  // Motion: tabs grow in / shrink out, neighbours glide (flip), and an
  // accent underline slides to the active tab. All of it collapses to
  // instant under prefers-reduced-motion.
  import { get, readable } from 'svelte/store';
  import { flip } from 'svelte/animate';
  import { backOut, cubicIn } from 'svelte/easing';
  import { tick } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { sessions, activeSession, type DocSession } from '../stores/sessions';
  import { activateSession, closeSession, cycleSession } from '../stores/tabs';
  import { openViaDialog } from '../lib/open-files';
  import { settings } from '../stores/settings';

  interface TabItem {
    session: DocSession;
    path: string;
  }

  // Sessions whose document is loaded, kept in sync with each session's
  // own doc store (a tab's path can change when its file is reloaded).
  const tabItems = readable<TabItem[]>([], (set) => {
    let docUnsubs: Array<() => void> = [];
    const unsubList = sessions.subscribe((list) => {
      docUnsubs.forEach((u) => u());
      const update = () => {
        set(
          list
            .map((session) => ({ session, doc: get(session.doc) }))
            .filter((x) => x.doc !== null)
            .map((x) => ({ session: x.session, path: x.doc!.path })),
        );
      };
      docUnsubs = list.map((s) => s.doc.subscribe(update));
      update();
    });
    return () => {
      unsubList();
      docUnsubs.forEach((u) => u());
    };
  });

  const visible = $derived(
    $tabItems.length > 1 || ($settings.openMode === 'tabs' && $tabItems.length === 1),
  );

  // People who don't know what markdown is shouldn't have to see ".md".
  function label(path: string): string {
    const base = path.split(/[\\/]/).pop() ?? path;
    return base.replace(/\.(md|markdown)$/i, '');
  }

  function reducedMotion(): boolean {
    return typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }

  function grow(node: HTMLElement) {
    if (reducedMotion()) return { duration: 0 };
    const w = node.offsetWidth;
    return {
      duration: 180,
      easing: backOut,
      css: (t: number) => `max-width: ${Math.max(0, t) * w}px; opacity: ${Math.min(1, t)};`,
    };
  }

  function shrink(node: HTMLElement) {
    if (reducedMotion()) return { duration: 0 };
    const w = node.offsetWidth;
    return {
      duration: 140,
      easing: cubicIn,
      css: (t: number) => `max-width: ${t * w}px; opacity: ${t};`,
    };
  }

  const flipDuration = () => (reducedMotion() ? 0 : 160);

  // --- Accent underline ---------------------------------------------------
  let stripEl = $state<HTMLDivElement | null>(null);
  const tabEls: Record<string, HTMLElement> = {};
  let indicator = $state({ x: 0, w: 0, shown: false });
  let overflowing = $state(false);

  function measure() {
    const el = tabEls[get(activeSession).id];
    if (!el || !stripEl) {
      indicator = { ...indicator, shown: false };
      return;
    }
    indicator = { x: el.offsetLeft + 10, w: Math.max(0, el.offsetWidth - 20), shown: true };
    overflowing = stripEl.scrollWidth > stripEl.clientWidth + 1;
  }

  $effect(() => {
    void $activeSession;
    void $tabItems;
    if (!visible) return;
    void tick().then(() => {
      measure();
      tabEls[get(activeSession).id]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  });

  // Tabs grow / shrink / get squeezed — keep the underline glued on.
  $effect(() => {
    if (!stripEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(stripEl);
    for (const el of Object.values(tabEls)) ro.observe(el);
    void $tabItems;
    return () => ro.disconnect();
  });

  // --- Interaction --------------------------------------------------------
  function onTabClick(item: TabItem) {
    void activateSession(item.session.id);
  }

  function onClose(e: MouseEvent, item: TabItem) {
    e.stopPropagation();
    void closeSession(item.session.id);
  }

  function onAuxClick(e: MouseEvent, item: TabItem) {
    if (e.button !== 1) return;
    e.preventDefault();
    void closeSession(item.session.id);
  }

  function onTabKeydown(e: KeyboardEvent, index: number) {
    const tabs = Array.from(stripEl?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      next?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const item = $tabItems[index];
      if (item) void activateSession(item.session.id);
    }
  }

  function onWheel(e: WheelEvent) {
    if (!stripEl || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    stripEl.scrollLeft += e.deltaY;
    e.preventDefault();
  }

  // Window shortcuts. Ignored while typing in a form field; the editor
  // surface (contenteditable) doesn't bind these, so they work there too.
  function onWindowKeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    const key = e.key.toLowerCase();
    if (e.key === 'Tab') {
      e.preventDefault();
      void cycleSession(e.shiftKey ? -1 : 1);
    } else if (key === 'w' && !e.shiftKey) {
      const active = get(activeSession);
      if (get(active.doc) === null) return;
      e.preventDefault();
      void closeSession(active.id);
    } else if (key === 'o' && !e.shiftKey) {
      e.preventDefault();
      void openViaDialog();
    }
  }

  // Empty strip space drags the window. Like TitleBar, only start the OS
  // drag once the pointer actually moves, so double-click (maximise) still
  // reaches us.
  function onBarPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.tab, .new-tab')) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (m: PointerEvent) => {
      const dx = m.clientX - startX;
      const dy = m.clientY - startY;
      if (dx * dx + dy * dy < 16) return;
      cleanup();
      void Promise.resolve().then(() => getCurrentWindow().startDragging()).catch(() => {});
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
  }

  function onBarDoubleClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.tab, .new-tab')) return;
    void Promise.resolve().then(() => getCurrentWindow().toggleMaximize()).catch(() => {});
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tabbar"
    onpointerdown={onBarPointerDown}
    ondblclick={onBarDoubleClick}
  >
    <div
      class="strip"
      class:overflowing
      role="tablist"
      aria-label="Open documents"
      bind:this={stripEl}
      onwheel={onWheel}
    >
      {#each $tabItems as item, i (item.session.id)}
        {@const active = item.session === $activeSession}
        <div
          class="tab glass glass-pill"
          class:active
          role="tab"
          tabindex={active ? 0 : -1}
          aria-selected={active}
          title={item.path}
          bind:this={tabEls[item.session.id]}
          onclick={() => onTabClick(item)}
          onauxclick={(e) => onAuxClick(e, item)}
          onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
          onkeydown={(e) => onTabKeydown(e, i)}
          in:grow
          out:shrink
          animate:flip={{ duration: flipDuration() }}
        >
          <span class="label">{label(item.path)}</span>
          <button
            class="close"
            aria-label={`Close ${label(item.path)}`}
            tabindex="-1"
            onclick={(e) => onClose(e, item)}
          >
            <span aria-hidden="true">&#x00D7;</span>
          </button>
        </div>
      {/each}
      <span
        class="indicator"
        class:shown={indicator.shown}
        style:transform={`translateX(${indicator.x}px)`}
        style:width={`${indicator.w}px`}
        aria-hidden="true"
      ></span>
    </div>
    <button
      class="new-tab"
      aria-label="Open a file in a new tab"
      title="Open a file (Ctrl+O)"
      onclick={() => void openViaDialog()}
    >
      <span aria-hidden="true">+</span>
    </button>
  </div>
{/if}

<style>
  .tabbar {
    position: fixed;
    /* Same row as the hamburger (top:14, 38px tall) so the tabs line up
       with the menu button and wordmark rather than the window controls. */
    top: 14px;
    /* Right of the hamburger + wordmark (fixed, so the strip doesn't jump
       when the wordmark morphs on hover); left of the window controls. */
    left: 190px;
    right: 140px;
    height: 38px;
    /* Above .titlebar-drag (z:50) whose job it takes over here; below the
       menu backdrop (z:125) so an open menu dims it. */
    z-index: 55;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
  }

  .strip {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .strip.overflowing {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%);
  }

  .tab {
    position: relative;
    flex: 0 1 auto;
    min-width: 96px;
    max-width: 200px;
    height: 28px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px 0 12px;
    box-sizing: border-box;
    cursor: pointer;
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
    /* Quieter than the floating glass buttons — tabs sit in a row. */
    box-shadow: none;
    transition:
      color 0.18s ease,
      background-color 0.18s ease,
      border-color 0.18s ease;
  }
  .tab:hover {
    color: var(--fg-0);
  }
  .tab.active {
    color: var(--fg-0);
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .close {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease, background-color 0.15s ease;
  }
  .tab:hover .close,
  .tab.active .close,
  .close:focus-visible {
    opacity: 0.75;
  }
  .close:hover {
    opacity: 1;
    background: var(--glass-border);
  }

  .indicator {
    position: absolute;
    left: 0;
    bottom: 3px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
    opacity: 0;
    pointer-events: none;
    transition:
      transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
      width 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
      opacity 150ms ease;
  }
  .indicator.shown {
    opacity: 1;
  }

  .new-tab {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--fg-2);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
  }
  .new-tab:hover {
    color: var(--fg-0);
    background: var(--glass-fill);
    border-color: var(--glass-border);
  }

  @media (prefers-reduced-motion: reduce) {
    .indicator,
    .tab,
    .close,
    .new-tab {
      transition: none;
    }
  }
</style>
