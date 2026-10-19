<script lang="ts">
  // Tabs: one per open document (session), either in the title band between
  // the wordmark and the window controls (Notepad-style flat tabs) or as a
  // sidebar down the left edge (settings.tabPosition). While tabs are shown
  // the title band turns solid; the body classes set below let the page and
  // the floating chrome make room for it (see styles/tabs-layout.css).
  //
  // The band's empty space stays a window-drag region (and double-click
  // still maximises), like the .titlebar-drag band underneath it.
  //
  // Motion: tabs grow in / shrink out (rows slide in / out on the left),
  // neighbours glide (flip), and the accent line slides to the active tab.
  // All of it collapses to instant under prefers-reduced-motion.
  import { get, readable } from 'svelte/store';
  import { flip } from 'svelte/animate';
  import { backOut, cubicIn } from 'svelte/easing';
  import { tick } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { sessions, activeSession, type DocSession } from '../stores/sessions';
  import {
    activateSession,
    closeSession,
    closeOtherSessions,
    closeSessionsAfter,
    cycleSession,
  } from '../stores/tabs';
  import { openViaDialog } from '../lib/open-files';
  import { showInFolder, copyPath } from '../lib/file-actions';
  import { settings, updateSettings } from '../stores/settings';
  import { activeModal } from '../stores/modals';
  import { readerMode } from '../stores/reader-mode';
  import ContextMenu, { type ContextMenuEntry } from './ContextMenu.svelte';

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
  const left = $derived($settings.tabPosition === 'left');
  const pinned = $derived($settings.tabSidebarPinned);

  // Layout signals for the rest of the window: the page starts below the
  // solid band (and right of the sidebar); the floating buttons move over.
  $effect(() => {
    const body = document.body;
    body.classList.toggle('has-tab-band', visible);
    body.classList.toggle('tabs-left', visible && left);
    body.classList.toggle('tab-sidebar-pinned', visible && left && pinned);
    return () => body.classList.remove('has-tab-band', 'tabs-left', 'tab-sidebar-pinned');
  });

  // People who don't know what markdown is shouldn't have to see ".md".
  function label(path: string): string {
    const base = path.split(/[\\/]/).pop() ?? path;
    return base.replace(/\.(md|markdown)$/i, '');
  }

  // The sidebar's badge: the first letter or digit of the name.
  function initial(name: string): string {
    const ch = name.match(/[\p{L}\p{N}]/u)?.[0] ?? name.charAt(0);
    return ch.toLocaleUpperCase();
  }

  function reducedMotion(): boolean {
    return typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }

  // Top tabs grow sideways; sidebar rows slide open downwards.
  function grow(node: HTMLElement) {
    if (reducedMotion()) return { duration: 0 };
    if (left) {
      const h = node.offsetHeight;
      return {
        duration: 180,
        easing: backOut,
        css: (t: number) => `max-height: ${Math.max(0, t) * h}px; opacity: ${Math.min(1, t)}; transform: translateY(${(1 - t) * -6}px);`,
      };
    }
    const w = node.offsetWidth;
    return {
      duration: 180,
      easing: backOut,
      css: (t: number) => `max-width: ${Math.max(0, t) * w}px; opacity: ${Math.min(1, t)};`,
    };
  }

  function shrink(node: HTMLElement) {
    if (reducedMotion()) return { duration: 0 };
    if (left) {
      const h = node.offsetHeight;
      return {
        duration: 140,
        easing: cubicIn,
        css: (t: number) => `max-height: ${t * h}px; opacity: ${t};`,
      };
    }
    const w = node.offsetWidth;
    return {
      duration: 140,
      easing: cubicIn,
      css: (t: number) => `max-width: ${t * w}px; opacity: ${t};`,
    };
  }

  const flipDuration = () => (reducedMotion() ? 0 : 160);

  // --- Accent line (top tabs) ---------------------------------------------
  let stripEl = $state<HTMLDivElement | null>(null);
  const tabEls: Record<string, HTMLElement> = {};
  let indicator = $state({ x: 0, w: 0, shown: false });
  let overflowing = $state(false);

  function measure() {
    const el = tabEls[get(activeSession).id];
    if (!el || !stripEl || left) {
      indicator = { ...indicator, shown: false };
      return;
    }
    indicator = { x: el.offsetLeft + 10, w: Math.max(0, el.offsetWidth - 20), shown: true };
    overflowing = stripEl.scrollWidth > stripEl.clientWidth + 1;
  }

  $effect(() => {
    void $activeSession;
    void $tabItems;
    void left;
    if (!visible) return;
    void tick().then(() => {
      measure();
      tabEls[get(activeSession).id]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  });

  // Tabs grow / shrink / get squeezed — keep the accent line glued on.
  $effect(() => {
    if (!stripEl || typeof ResizeObserver === 'undefined') return;
    const items = $tabItems;
    // Forget elements of closed tabs (bind:this leaves them as null).
    const live = new Set(items.map((t) => t.session.id));
    for (const id of Object.keys(tabEls)) if (!live.has(id) || !tabEls[id]) delete tabEls[id];
    const ro = new ResizeObserver(() => measure());
    ro.observe(stripEl);
    for (const el of Object.values(tabEls)) if (el) ro.observe(el);
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
    const next = left ? 'ArrowDown' : 'ArrowRight';
    const prev = left ? 'ArrowUp' : 'ArrowLeft';
    if (e.key === next || e.key === prev) {
      e.preventDefault();
      tabs[(index + (e.key === next ? 1 : -1) + tabs.length) % tabs.length]?.focus();
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
    // A dialog owns the keyboard (e.g. "Clear all annotations?" confirms on
    // Enter — switching tabs underneath it would aim it at another doc).
    if (e.defaultPrevented || get(activeModal)) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    const key = e.key.toLowerCase();
    if (e.key === 'Tab') {
      e.preventDefault();
      void cycleSession(e.shiftKey ? -1 : 1);
    } else if (get(readerMode)) {
      // Reader mode shows nothing but the page: Ctrl+Tab (above) still
      // flips between documents, but nothing closes or opens tabs out of
      // sight.
      return;
    } else if (key === 'w' && !e.shiftKey) {
      e.preventDefault();
      if (e.repeat) return; // holding Ctrl+W must not close tab after tab
      const active = get(activeSession);
      if (get(active.doc) === null) return;
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

  // --- Right-click menu ---------------------------------------------------
  let menu = $state.raw<{ item: TabItem; x: number; y: number } | null>(null);

  function onTabContextMenu(e: MouseEvent, item: TabItem) {
    e.preventDefault();
    menu = { item, x: e.clientX, y: e.clientY };
  }

  function menuItems(item: TabItem): ContextMenuEntry[] {
    const list = $tabItems;
    const i = list.findIndex((t) => t.session.id === item.session.id);
    const id = item.session.id;
    return [
      { label: 'Close', hint: 'Middle-click', onSelect: () => void closeSession(id) },
      { label: 'Close others', disabled: list.length < 2, onSelect: () => void closeOtherSessions(id) },
      {
        label: left ? 'Close tabs below' : 'Close tabs to the right',
        disabled: i < 0 || i === list.length - 1,
        onSelect: () => void closeSessionsAfter(id),
      },
      'separator',
      { label: 'Show in folder', onSelect: () => void showInFolder(item.path) },
      { label: 'Copy path', onSelect: () => void copyPath(item.path) },
    ];
  }

  function togglePinned() {
    updateSettings({ tabSidebarPinned: !pinned });
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet closeButton(item: TabItem)}
  <button
    class="close"
    aria-label={`Close ${label(item.path)}`}
    tabindex="-1"
    onclick={(e) => onClose(e, item)}
  >
    <span aria-hidden="true">&#x00D7;</span>
  </button>
{/snippet}

{#if visible}
  <!-- The solid title band: purely a backdrop. The hamburger, wordmark,
       tabs and window controls all sit on top of it, and the drag region
       underneath (TitleBar) keeps working through it. -->
  <div class="tab-band" aria-hidden="true"></div>

  {#if !left}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tabbar"
      onpointerdown={onBarPointerDown}
      ondblclick={onBarDoubleClick}
    >
      <!-- Not ".strip": global edit/reader-mode rules hide the colour strip
           by that class name. -->
      <div
        class="tab-strip"
        class:overflowing
        role="tablist"
        aria-label="Open documents"
        aria-orientation="horizontal"
        bind:this={stripEl}
        onwheel={onWheel}
      >
        {#each $tabItems as item, i (item.session.id)}
          {@const active = item.session === $activeSession}
          <div
            class="tab"
            class:active
            role="tab"
            tabindex={active ? 0 : -1}
            aria-selected={active}
            title={item.path}
            bind:this={tabEls[item.session.id]}
            onclick={() => onTabClick(item)}
            onauxclick={(e) => onAuxClick(e, item)}
            onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
            oncontextmenu={(e) => onTabContextMenu(e, item)}
            onkeydown={(e) => onTabKeydown(e, i)}
            in:grow
            out:shrink
            animate:flip={{ duration: flipDuration() }}
          >
            <span class="label">{label(item.path)}</span>
            {@render closeButton(item)}
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
  {:else}
    <!-- Not ".rail": global edit/reader-mode rules hide the tool rail by
         that class name. -->
    <nav class="tab-sidebar" class:pinned aria-label="Tabs">
      <div
        class="side-list"
        role="tablist"
        aria-label="Open documents"
        aria-orientation="vertical"
        bind:this={stripEl}
      >
        {#each $tabItems as item, i (item.session.id)}
          {@const active = item.session === $activeSession}
          {@const name = label(item.path)}
          <div
            class="tab side-tab"
            class:active
            role="tab"
            tabindex={active ? 0 : -1}
            aria-selected={active}
            title={item.path}
            bind:this={tabEls[item.session.id]}
            onclick={() => onTabClick(item)}
            onauxclick={(e) => onAuxClick(e, item)}
            onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
            oncontextmenu={(e) => onTabContextMenu(e, item)}
            onkeydown={(e) => onTabKeydown(e, i)}
            in:grow
            out:shrink
            animate:flip={{ duration: flipDuration() }}
          >
            <span class="tab-initial" aria-hidden="true">{initial(name)}</span>
            <span class="label">{name}</span>
            {@render closeButton(item)}
          </div>
        {/each}
        <button
          class="side-row side-new"
          aria-label="Open a file in a new tab"
          title="Open a file (Ctrl+O)"
          onclick={() => void openViaDialog()}
        >
          <span class="tab-initial" aria-hidden="true">+</span>
          <span class="label">Open a file</span>
        </button>
      </div>
      <button
        class="side-row pin-toggle"
        aria-label={pinned ? 'Collapse the sidebar' : 'Keep the sidebar open'}
        aria-pressed={pinned}
        title={pinned ? 'Collapse the sidebar' : 'Keep the sidebar open'}
        onclick={togglePinned}
      >
        <span class="pin-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
            <path d="M6 2.5v11" />
            {#if pinned}
              <path d="M11 6l-2 2 2 2" />
            {:else}
              <path d="M9 6l2 2-2 2" />
            {/if}
          </svg>
        </span>
        <span class="label">{pinned ? 'Collapse' : 'Keep open'}</span>
      </button>
    </nav>
  {/if}
{/if}

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    label={`${label(menu.item.path)} actions`}
    items={menuItems(menu.item)}
    onclose={() => (menu = null)}
  />
{/if}

<style>
  /* Full-width solid band behind the title area. Below the drag region
     (z:50) and everything that sits in the band. */
  .tab-band {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--tab-band-h, 40px);
    box-sizing: border-box;
    background: var(--chrome);
    border-bottom: 1px solid var(--glass-border);
    z-index: 49;
    pointer-events: none;
  }

  /* ---- Top tabs ---------------------------------------------------------- */
  .tabbar {
    position: fixed;
    top: 0;
    /* Right of the hamburger + wordmark (fixed, so the strip doesn't jump
       when the wordmark morphs on hover — "remarkdown" ends at 133px);
       left of the window controls. */
    left: 142px;
    right: 140px;
    height: 40px;
    /* Above .titlebar-drag (z:50) whose job it takes over here; below the
       menu backdrop (z:125) so an open menu dims it. */
    z-index: 55;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding: 0 4px;
    box-sizing: border-box;
  }
  /* The pre-release tag sits after the wordmark in the band. */
  :global(body:has(.pre-tag)) .tabbar {
    left: 188px;
  }

  .tab-strip {
    position: relative;
    display: flex;
    align-items: flex-end;
    min-width: 0;
    height: 100%;
    padding-top: 6px;
    box-sizing: border-box;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .tab-strip::-webkit-scrollbar {
    display: none;
  }
  .tab-strip.overflowing {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%);
  }

  /* Flat, Notepad-style: inactive tabs are plain text with thin dividers;
     the active one is filled with the page colour so it opens straight
     into the document below. */
  .tab {
    position: relative;
    flex: 0 1 auto;
    min-width: 96px;
    max-width: 200px;
    height: 34px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 14px;
    box-sizing: border-box;
    border-radius: 8px 8px 0 0;
    cursor: pointer;
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
    transition:
      color 0.18s ease,
      background-color 0.18s ease;
  }
  .tab + .tab::before {
    content: '';
    position: absolute;
    left: 0;
    top: 9px;
    bottom: 9px;
    width: 1px;
    background: var(--glass-border);
    transition: opacity 0.18s ease;
  }
  .tab.active::before,
  .tab.active + .tab::before,
  .tab:hover::before,
  .tab:hover + .tab::before {
    opacity: 0;
  }
  .tab:hover {
    color: var(--fg-1);
    background: var(--glass-fill);
  }
  .tab.active {
    color: var(--fg-0);
    background: var(--bg-0);
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
    border-radius: 5px;
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

  /* The accent line along the active tab's top edge; slides between tabs. */
  .indicator {
    position: absolute;
    left: 0;
    top: 6px;
    height: 2px;
    border-radius: 0 0 2px 2px;
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
    align-self: center;
    margin-top: 4px;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--fg-2);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    transition: color 0.15s ease, background-color 0.15s ease;
  }
  .new-tab:hover {
    color: var(--fg-0);
    background: var(--glass-fill);
  }

  /* ---- Left sidebar ------------------------------------------------------ */
  /* Below the band, down the left edge. Collapsed it shows only the
     initials (52px) and opens over the page on hover; pinned it stays
     open and the page moves over (--tab-side-w, tabs-layout.css). Above
     the floating buttons (z:100–110) it overlaps when open, below the
     hamburger menu (z:130). */
  .tab-sidebar {
    position: fixed;
    top: var(--tab-band-h, 40px);
    left: 0;
    bottom: 0;
    width: 52px;
    z-index: 115;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    box-sizing: border-box;
    overflow: hidden;
    background: var(--chrome);
    border-right: 1px solid var(--glass-border);
    font-family: var(--font-sans);
    transition:
      width 0.22s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.22s ease;
  }
  .tab-sidebar.pinned,
  .tab-sidebar:hover,
  .tab-sidebar:has(:focus-visible) {
    width: 200px;
  }
  .tab-sidebar:not(.pinned):hover,
  .tab-sidebar:not(.pinned):has(:focus-visible) {
    box-shadow: 10px 0 28px rgba(0, 0, 0, 0.45);
    /* Hover intent: a pointer passing by on its way to the page doesn't
       fling the sidebar open. */
    transition-delay: 120ms;
  }

  .side-list {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .side-list::-webkit-scrollbar {
    display: none;
  }

  .side-tab,
  .side-row {
    flex: 0 0 auto;
    min-width: 0;
    max-width: none;
    width: 100%;
    height: 32px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 4px 0 7px;
    box-sizing: border-box;
    border-radius: 7px;
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
  }
  .tab-sidebar .tab::before {
    display: none;
  }
  .side-tab:hover {
    color: var(--fg-0);
  }
  .side-tab.active {
    color: var(--fg-0);
    background: var(--bg-0);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .tab-initial {
    flex: 0 0 22px;
    height: 22px;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border-radius: 6px;
    border: 1px solid var(--glass-border);
    background: var(--glass-fill);
    color: var(--fg-1);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
  }
  .side-tab.active .tab-initial {
    color: var(--accent);
  }

  /* Labels and close buttons only show while the sidebar is open. */
  .tab-sidebar .label,
  .tab-sidebar .close {
    transition: opacity 0.15s ease;
  }
  .tab-sidebar:not(.pinned):not(:hover):not(:has(:focus-visible)) .label,
  .tab-sidebar:not(.pinned):not(:hover):not(:has(:focus-visible)) .close {
    opacity: 0;
  }

  .side-row {
    border: 0;
    background: transparent;
    color: var(--fg-2);
    text-align: left;
    cursor: pointer;
    transition: color 0.15s ease, background-color 0.15s ease;
  }
  .side-row:hover {
    color: var(--fg-0);
    background: var(--glass-fill);
  }
  .side-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .side-new .tab-initial {
    font-size: 14px;
    font-weight: 400;
    color: var(--fg-2);
  }

  .pin-toggle {
    margin-top: auto;
  }
  .pin-icon {
    flex: 0 0 22px;
    height: 22px;
    display: grid;
    place-items: center;
  }
  .pin-icon svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (prefers-reduced-motion: reduce) {
    .indicator,
    .tab,
    .tab::before,
    .close,
    .new-tab,
    .tab-sidebar,
    .tab-sidebar .label,
    .side-row {
      transition: none;
    }
  }
</style>
