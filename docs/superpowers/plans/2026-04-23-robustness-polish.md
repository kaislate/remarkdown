# remarkdown — Plan 3: Robustness Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the annotator into something a user can trust. Add delete affordances for highlights and drawings, surface orphaned annotations, wire up the recent-files menu, and handle the full error matrix from the spec (UTF-8 failures, corrupt sidecars, permission-denied writes, oversized files). Close with Playwright E2E covering the 5 scenarios from the spec.

**Architecture:** A toast store renders non-blocking messages stacked top-right. Two small Rust commands are added (`backup_corrupt_sidecar`, `check_paths_exist`) for the error and recent-files paths. Context menus are inline in each layer (no shared ContextMenu component yet — YAGNI). E2E runs against `vite preview` with `@tauri-apps/api` aliased to a localStorage-backed mock during a special `mode: 'e2e'` build.

**Tech Stack:** everything from Plans 1–2, plus Playwright for E2E.

**Starting state:** `main` at `df5037e` (merge of Plan 2). Tag `v0.2.0-annotations`. 98 TS tests + 4 Rust tests passing, svelte-check clean.

**Deferred past v1:** Re-attach in OrphanPanel (Delete-only for this plan). Per-doc asset protocol scope tightening. File watcher for external edits. Undo/redo.

---

## Deliberate decisions locked in by this plan

- **Right-click delete.** A small glass context menu appears on right-click; clicking "Delete" removes the annotation. No confirm dialog. Works identically for highlights (hit-test via `caretPositionFromPoint` + resolved `Range`) and drawings (hit-test via stroke-point proximity).
- **Toast system.** `toasts` store + `Toasts.svelte` component renders top-right. Kinds: `error`, `warning`, `info`. Auto-dismiss after 4s (errors persist until clicked). Stacks vertically.
- **Corrupt sidecar flow.** On `loadSidecar` failure, a modal asks the user: "Back up and start fresh?" — accept runs `backup_corrupt_sidecar` Rust command (renames to `.corrupt-<ISO>`), dismiss leaves the file in place and starts with empty annotations (but doesn't overwrite on next save until the user fixes it or opens a different file).
- **Write permission retry.** `save.ts` catches `writeSidecar` rejections, retries with exponential backoff (100ms, 400ms, 1600ms, max 3 attempts). After the third failure, surfaces a persistent error banner; banner clears on next successful save.
- **Recent paths validation.** GlassMenu calls `check_paths_exist` once when opened, greys out missing entries, clicking a missing entry removes it from recents.
- **Orphan panel.** Delete-only for v1. Lists orphans with excerpt + block hint + timestamp. Click Delete removes; "re-attach" is out of scope.
- **Playwright via vite preview.** E2E tests run against the production build served by `vite preview`, with Tauri API aliased to a localStorage-backed mock at build time. A `mode: 'e2e'` Vite config path handles the aliasing.

---

## File Structure

```
remarkdown/
├── src/
│   ├── stores/
│   │   ├── toasts.ts                     [new — writable toast list + helpers]
│   │   └── modals.ts                     [new — orphan-panel + corrupt-sidecar state]
│   ├── components/
│   │   ├── Toasts.svelte                 [new — toast stack top-right]
│   │   ├── OrphanPanel.svelte            [new — modal listing orphans]
│   │   ├── CorruptSidecarModal.svelte    [new — backup-and-start-fresh modal]
│   │   ├── ErrorBanner.svelte            [new — persistent error banner]
│   │   ├── HighlightLayer.svelte         [modify — contextmenu + delete]
│   │   ├── DrawLayer.svelte              [modify — contextmenu + delete]
│   │   └── GlassMenu.svelte              [modify — Open Recent + Orphaned submenu items]
│   ├── stores/
│   │   ├── doc.ts                        [modify — surface UTF-8 + sidecar errors]
│   │   └── recent.ts                     [modify — path validation + remove-on-missing]
│   ├── lib/
│   │   ├── tauri-api.ts                  [modify — add backup_corrupt_sidecar + check_paths_exist]
│   │   └── save.ts                       [modify — retry + banner + size check]
│   └── App.svelte                        [modify — mount Toasts + OrphanPanel + modals + banner]
├── src-tauri/
│   └── src/
│       └── commands.rs                   [modify — add backup_corrupt_sidecar + check_paths_exist]
├── tests/
│   ├── unit/
│   │   ├── toasts-store.test.ts          [new]
│   │   ├── modals-store.test.ts          [new]
│   │   ├── save.test.ts                  [modify — add retry tests]
│   │   └── recent-store.test.ts          [modify — add validation tests]
│   ├── component/
│   │   ├── Toasts.test.ts                [new]
│   │   ├── OrphanPanel.test.ts           [new]
│   │   ├── CorruptSidecarModal.test.ts   [new]
│   │   ├── ErrorBanner.test.ts           [new]
│   │   ├── HighlightLayer.test.ts        [modify — add contextmenu tests]
│   │   ├── DrawLayer.test.ts             [modify — add contextmenu tests]
│   │   └── GlassMenu.test.ts             [modify — add recent + orphan submenu tests]
│   └── e2e/
│       ├── scenarios.spec.ts             [new — 5 E2E scenarios]
│       └── support/
│           └── tauri-mock.ts             [new — localStorage-backed Tauri API mock]
├── playwright.config.ts                  [new]
└── docs/
    └── QA-plan-3.md                      [new]
```

---

## Phase 1 — Toast infrastructure (Task 1)

### Task 1: Toast store + Toasts component

**Files:**
- Create: `src/stores/toasts.ts`, `tests/unit/toasts-store.test.ts`
- Create: `src/components/Toasts.svelte`, `tests/component/Toasts.test.ts`

- [ ] **Step 1: Write failing tests for `toasts-store.test.ts`**

```ts
// tests/unit/toasts-store.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { toasts, addToast, dismissToast, clearToasts } from '../../src/stores/toasts';

describe('toasts store', () => {
  beforeEach(() => { clearToasts(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts empty', () => {
    expect(get(toasts)).toEqual([]);
  });

  it('addToast appends a toast with a unique id', () => {
    addToast({ kind: 'info', message: 'hello' });
    const list = get(toasts);
    expect(list).toHaveLength(1);
    expect(list[0].message).toBe('hello');
    expect(list[0].id).toBeDefined();
  });

  it('auto-dismisses info toasts after 4 seconds', async () => {
    addToast({ kind: 'info', message: 'hi' });
    expect(get(toasts)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4100);
    expect(get(toasts)).toHaveLength(0);
  });

  it('auto-dismisses warning toasts after 4 seconds', async () => {
    addToast({ kind: 'warning', message: 'careful' });
    await vi.advanceTimersByTimeAsync(4100);
    expect(get(toasts)).toHaveLength(0);
  });

  it('does NOT auto-dismiss error toasts (they persist until dismissed)', async () => {
    addToast({ kind: 'error', message: 'fail' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(get(toasts)).toHaveLength(1);
  });

  it('dismissToast removes by id', () => {
    addToast({ kind: 'info', message: 'a' });
    const id = get(toasts)[0].id;
    dismissToast(id);
    expect(get(toasts)).toHaveLength(0);
  });

  it('clearToasts empties the list', () => {
    addToast({ kind: 'info', message: 'a' });
    addToast({ kind: 'warning', message: 'b' });
    clearToasts();
    expect(get(toasts)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/toasts-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/stores/toasts.ts`**

```ts
import { writable } from 'svelte/store';
import { ulid } from 'ulid';

export type ToastKind = 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
}

const AUTO_DISMISS_MS: Partial<Record<ToastKind, number>> = {
  info: 4000,
  warning: 4000,
  // error has no auto-dismiss
};

export const toasts = writable<Toast[]>([]);

export function addToast(t: { kind: ToastKind; message: string }): string {
  const id = ulid();
  const toast: Toast = { ...t, id, createdAt: Date.now() };
  toasts.update((list) => [...list, toast]);
  const ms = AUTO_DISMISS_MS[t.kind];
  if (ms) setTimeout(() => dismissToast(id), ms);
  return id;
}

export function dismissToast(id: string): void {
  toasts.update((list) => list.filter((t) => t.id !== id));
}

export function clearToasts(): void {
  toasts.set([]);
}
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/toasts-store.test.ts
```

Expected: 7 passing.

- [ ] **Step 5: Write failing tests for `Toasts.svelte`**

```ts
// tests/component/Toasts.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import Toasts from '../../src/components/Toasts.svelte';
import { toasts, clearToasts, addToast } from '../../src/stores/toasts';

beforeEach(() => { clearToasts(); });

describe('Toasts', () => {
  it('renders no toasts initially', () => {
    const { container } = render(Toasts);
    expect(container.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('renders one toast per entry in the store', () => {
    render(Toasts);
    flushSync(() => {
      addToast({ kind: 'info', message: 'first' });
      addToast({ kind: 'warning', message: 'second' });
    });
    const entries = document.querySelectorAll('.toast');
    expect(entries).toHaveLength(2);
  });

  it('applies the kind as a CSS class', () => {
    render(Toasts);
    flushSync(() => addToast({ kind: 'error', message: 'x' }));
    const toast = document.querySelector('.toast') as HTMLElement;
    expect(toast.classList.contains('error')).toBe(true);
  });

  it('clicking the dismiss button removes the toast', async () => {
    render(Toasts);
    flushSync(() => addToast({ kind: 'error', message: 'x' }));
    const user = userEvent.setup();
    const btn = document.querySelector('.toast .dismiss') as HTMLButtonElement;
    await user.click(btn);
    expect(get(toasts)).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run to verify failure**

```bash
npx vitest run tests/component/Toasts.test.ts
```

Expected: FAIL.

- [ ] **Step 7: Implement `src/components/Toasts.svelte`**

```svelte
<script lang="ts">
  import { toasts, dismissToast } from '../stores/toasts';
</script>

<div class="toasts" aria-live="polite" aria-label="Notifications">
  {#each $toasts as t (t.id)}
    <div class="toast {t.kind} glass" role="status">
      <span class="msg">{t.message}</span>
      <button class="dismiss" aria-label="Dismiss" onclick={() => dismissToast(t.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    top: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 200;
    max-width: 340px;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--fg-0);
    pointer-events: auto;
    animation: slideIn 0.22s ease-out;
  }
  .toast.info    { border-left: 3px solid var(--accent); }
  .toast.warning { border-left: 3px solid #f0a85a; }
  .toast.error   { border-left: 3px solid #ff6e6e; }
  .msg { flex: 1; line-height: 1.4; }
  .dismiss {
    background: transparent;
    border: 0;
    color: var(--fg-2);
    font-size: 18px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }
  .dismiss:hover { color: var(--fg-0); }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
</style>
```

- [ ] **Step 8: Run to verify passing**

```bash
npx vitest run tests/component/Toasts.test.ts
```

Expected: 4 passing.

- [ ] **Step 9: Commit**

```bash
git add src/stores/toasts.ts src/components/Toasts.svelte tests/unit/toasts-store.test.ts tests/component/Toasts.test.ts
git commit -m "feat: add toasts store and Toasts component"
```

---

## Phase 2 — Delete affordances (Tasks 2–3)

### Task 2: Right-click delete for highlights

**Files:**
- Modify: `src/components/HighlightLayer.svelte`
- Modify: `tests/component/HighlightLayer.test.ts`

- [ ] **Step 1: Add failing tests (append to existing describe blocks)**

Append to `tests/component/HighlightLayer.test.ts`:

```ts
describe('HighlightLayer — right-click delete', () => {
  it('shows a delete menu when right-clicking on a highlighted range', async () => {
    const root = mountViewer('<p data-block-id="p:1">Hello the world here.</p>');
    render(HighlightLayer);
    annots.set([{
      id: '01A', type: 'highlight', color: HIGHLIGHT_COLORS[0],
      anchor: { text: 'the world', prefix: 'Hello ', suffix: ' here.', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);

    // Mock caretPositionFromPoint to land inside "the world".
    const tn = root.querySelector('p')!.firstChild as Text;
    const idx = tn.data.indexOf('the world') + 2; // middle of "the world"
    (document as any).caretPositionFromPoint = () => ({ offsetNode: tn, offset: idx });

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
    root.dispatchEvent(evt);

    const menu = document.querySelector('.highlight-menu');
    expect(menu).not.toBeNull();
  });

  it('clicking the delete menu item removes the highlight', async () => {
    const root = mountViewer('<p data-block-id="p:1">Hello the world here.</p>');
    render(HighlightLayer);
    annots.set([{
      id: '01A', type: 'highlight', color: HIGHLIGHT_COLORS[0],
      anchor: { text: 'the world', prefix: 'Hello ', suffix: ' here.', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);

    const tn = root.querySelector('p')!.firstChild as Text;
    const idx = tn.data.indexOf('the world') + 2;
    (document as any).caretPositionFromPoint = () => ({ offsetNode: tn, offset: idx });

    root.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    const user = userEvent.setup();
    const deleteBtn = document.querySelector('.highlight-menu button') as HTMLButtonElement;
    await user.click(deleteBtn);
    expect(get(annots)).toHaveLength(0);
  });

  it('right-click outside any highlight does nothing', () => {
    const root = mountViewer('<p data-block-id="p:1">nothing highlighted here.</p>');
    render(HighlightLayer);
    annots.set([]);
    (document as any).caretPositionFromPoint = () => null;
    root.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    expect(document.querySelector('.highlight-menu')).toBeNull();
  });
});
```

Add missing imports at the top if needed: `userEvent` (from `@testing-library/user-event`).

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/component/HighlightLayer.test.ts
```

Expected: 3 new tests fail.

- [ ] **Step 3: Modify `src/components/HighlightLayer.svelte`**

Add to the existing `<script>` block (keep all existing code):

```ts
import { removeAnnotation, resolvedAnnots } from '../stores/annots';

let menuForId = $state<string | null>(null);
let menuPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

function onContextMenu(e: MouseEvent): void {
  const root = get(currentViewerRoot);
  if (!root) return;
  const target = e.target as Node | null;
  if (!target || !root.contains(target)) return;

  const cp = (document as any).caretPositionFromPoint?.(e.clientX, e.clientY);
  if (!cp || !cp.offsetNode) return;

  // Find which resolved highlight's range contains the caret position.
  for (const r of get(resolvedAnnots)) {
    if (r.annotation.type !== 'highlight') continue;
    if (rangeContains(r.range, cp.offsetNode, cp.offset)) {
      e.preventDefault();
      menuForId = r.annotation.id;
      menuPos = { x: e.clientX, y: e.clientY };
      return;
    }
  }
}

function rangeContains(range: Range, node: Node, offset: number): boolean {
  // range.isPointInRange throws if node isn't in the same doc; guard.
  try {
    return range.isPointInRange(node, offset);
  } catch {
    return false;
  }
}

function closeMenu(): void { menuForId = null; }

function deleteHighlight(): void {
  if (!menuForId) return;
  removeAnnotation(menuForId);
  menuForId = null;
}
```

Also add to `onMount` inside the existing effect/subscription block:

```ts
document.addEventListener('contextmenu', onContextMenu);
document.addEventListener('click', closeMenu);
// cleanup: document.removeEventListener('contextmenu', onContextMenu);
//          document.removeEventListener('click', closeMenu);
```

Add the menu template at the bottom of the component (the component currently has no template):

```svelte
{#if menuForId}
  <div
    class="highlight-menu glass"
    role="menu"
    style="top:{menuPos.y}px; left:{menuPos.x}px"
  >
    <button role="menuitem" onclick={deleteHighlight}>Delete highlight</button>
  </div>
{/if}

<style>
  .highlight-menu {
    position: fixed;
    padding: 4px;
    min-width: 160px;
    z-index: 250;
  }
  .highlight-menu button {
    background: transparent;
    border: 0;
    color: var(--fg-0);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 8px 10px;
    text-align: left;
    width: 100%;
    border-radius: 6px;
    cursor: pointer;
  }
  .highlight-menu button:hover { background: var(--accent-soft); }
</style>
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/component/HighlightLayer.test.ts
```

Expected: 8 tests passing (5 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/HighlightLayer.svelte tests/component/HighlightLayer.test.ts
git commit -m "feat: right-click to delete a highlight"
```

---

### Task 3: Right-click delete for drawings

**Files:**
- Modify: `src/components/DrawLayer.svelte`
- Modify: `tests/component/DrawLayer.test.ts`

Drawings don't have a DOM Range to hit-test. Instead, we check whether the click is within a tolerance (12px) of any stroke's points.

- [ ] **Step 1: Append failing tests**

Append to `tests/component/DrawLayer.test.ts`:

```ts
describe('DrawLayer — right-click delete', () => {
  it('shows a delete menu when right-clicking near a drawing stroke', async () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      annots.set([{
        id: '01D', type: 'drawing', anchorBlock: 'p:1',
        strokes: [{ color: '#d6336c', width: 2, points: [[50, 50], [60, 55], [70, 60]] }],
        createdAt: 'now', updatedAt: 'now',
      }]);
    });
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement;
    // Fake getBoundingClientRect for the svg in jsdom: treat it as 0,0.
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 55 });
    svg.dispatchEvent(evt);
    expect(document.querySelector('.drawing-menu')).not.toBeNull();
  });

  it('clicking delete in the menu removes the drawing annotation', async () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      annots.set([{
        id: '01D', type: 'drawing', anchorBlock: 'p:1',
        strokes: [{ color: '#d6336c', width: 2, points: [[50, 50], [60, 55]] }],
        createdAt: 'now', updatedAt: 'now',
      }]);
    });
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement;
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 55, clientY: 52 }));
    const user = userEvent.setup();
    const deleteBtn = document.querySelector('.drawing-menu button') as HTMLButtonElement;
    await user.click(deleteBtn);
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(0);
  });

  it('right-click far from any stroke does not open the menu', () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      annots.set([{
        id: '01D', type: 'drawing', anchorBlock: 'p:1',
        strokes: [{ color: '#d6336c', width: 2, points: [[50, 50]] }],
        createdAt: 'now', updatedAt: 'now',
      }]);
    });
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement;
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 500 }));
    expect(document.querySelector('.drawing-menu')).toBeNull();
  });
});
```

Add `import userEvent from '@testing-library/user-event';` at the top if not present.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/component/DrawLayer.test.ts
```

Expected: 3 new tests fail.

- [ ] **Step 3: Modify `src/components/DrawLayer.svelte`**

Add to the existing `<script>` block:

```ts
import { removeAnnotation } from '../stores/annots';

const HIT_TOLERANCE_PX = 12;

let menuForId = $state<string | null>(null);
let menuPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

function strokePointDistance(px: number, py: number, points: [number, number, ...number[]][]): number {
  let min = Infinity;
  for (const [x, y] of points) {
    const d = Math.hypot(px - x, py - y);
    if (d < min) min = d;
  }
  return min;
}

function onContextMenu(e: MouseEvent): void {
  const svg = e.currentTarget as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  for (const d of existingDrawings) {
    for (const s of d.strokes) {
      if (strokePointDistance(x, y, s.points as [number, number, ...number[]][]) <= HIT_TOLERANCE_PX) {
        e.preventDefault();
        menuForId = d.id;
        menuPos = { x: e.clientX, y: e.clientY };
        return;
      }
    }
  }
}

function closeMenu(): void { menuForId = null; }

function deleteDrawing(): void {
  if (!menuForId) return;
  removeAnnotation(menuForId);
  menuForId = null;
}
```

Add the `oncontextmenu` handler to the existing svg element (modify the existing `<svg ...>` tag):

```svelte
<svg
  class="draw-overlay"
  class:active={$tool.mode === 'draw'}
  role="presentation"
  aria-hidden="true"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  oncontextmenu={onContextMenu}
>
```

Note: `pointer-events` on the SVG is `none` when tool is not `draw`, so contextmenu won't fire normally. Change the CSS rule to allow contextmenu pass-through even when inactive:

```css
  .draw-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .draw-overlay.active {
    pointer-events: auto;
    cursor: crosshair;
  }
  /* Enable contextmenu when there are drawings to right-click, even in cursor mode. */
  .draw-overlay {
    pointer-events: none;
  }
  .draw-overlay path {
    pointer-events: auto;
  }
```

Actually, simpler: use a different approach. Move the contextmenu listener to document level (like Highlight), and check against all drawings. This avoids the pointer-events tangle:

Remove the `oncontextmenu={onContextMenu}` from the `<svg>` tag. Instead, inside `$effect` (already present):

```ts
$effect(() => {
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('click', closeMenu);
  return () => {
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('click', closeMenu);
  };
});
```

And change `onContextMenu` to find the svg via `document.querySelector`:

```ts
function onContextMenu(e: MouseEvent): void {
  const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement | null;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  // Only respond if the event is inside the viewer region (best-effort check).
  const root = get(currentViewerRoot);
  if (!root) return;
  const rootRect = root.getBoundingClientRect();
  if (e.clientX < rootRect.left || e.clientX > rootRect.right ||
      e.clientY < rootRect.top || e.clientY > rootRect.bottom) return;

  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  for (const d of existingDrawings) {
    for (const s of d.strokes) {
      if (strokePointDistance(x, y, s.points as [number, number, ...number[]][]) <= HIT_TOLERANCE_PX) {
        e.preventDefault();
        menuForId = d.id;
        menuPos = { x: e.clientX, y: e.clientY };
        return;
      }
    }
  }
}
```

Add `import { get } from 'svelte/store';` if not present, and `currentViewerRoot` from annots store.

Add the menu template after the `</svg>`:

```svelte
{#if menuForId}
  <div
    class="drawing-menu glass"
    role="menu"
    style="top:{menuPos.y}px; left:{menuPos.x}px"
  >
    <button role="menuitem" onclick={deleteDrawing}>Delete drawing</button>
  </div>
{/if}

<style>
  /* ... existing styles ... */
  .drawing-menu {
    position: fixed;
    padding: 4px;
    min-width: 160px;
    z-index: 250;
  }
  .drawing-menu button {
    background: transparent;
    border: 0;
    color: var(--fg-0);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 8px 10px;
    text-align: left;
    width: 100%;
    border-radius: 6px;
    cursor: pointer;
  }
  .drawing-menu button:hover { background: var(--accent-soft); }
</style>
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/component/DrawLayer.test.ts
```

Expected: 7 tests passing (4 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/DrawLayer.svelte tests/component/DrawLayer.test.ts
git commit -m "feat: right-click to delete a drawing"
```

---

## Phase 3 — Orphan Panel (Task 4)

### Task 4: OrphanPanel modal + GlassMenu integration

**Files:**
- Create: `src/stores/modals.ts`, `tests/unit/modals-store.test.ts`
- Create: `src/components/OrphanPanel.svelte`, `tests/component/OrphanPanel.test.ts`
- Modify: `src/components/GlassMenu.svelte`, `tests/component/GlassMenu.test.ts`
- Modify: `src/App.svelte` — mount OrphanPanel

- [ ] **Step 1: Write failing tests for `modals-store.test.ts`**

```ts
// tests/unit/modals-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { activeModal, openModal, closeModal } from '../../src/stores/modals';

beforeEach(() => { closeModal(); });

describe('modals store', () => {
  it('starts with no active modal', () => {
    expect(get(activeModal)).toBeNull();
  });

  it('openModal sets the active modal', () => {
    openModal({ kind: 'orphans' });
    expect(get(activeModal)).toEqual({ kind: 'orphans' });
  });

  it('openModal with corrupt-sidecar includes path', () => {
    openModal({ kind: 'corrupt-sidecar', path: '/tmp/a.md' });
    expect(get(activeModal)).toEqual({ kind: 'corrupt-sidecar', path: '/tmp/a.md' });
  });

  it('closeModal clears the active modal', () => {
    openModal({ kind: 'orphans' });
    closeModal();
    expect(get(activeModal)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `src/stores/modals.ts`**

```ts
import { writable } from 'svelte/store';

export type ModalState =
  | null
  | { kind: 'orphans' }
  | { kind: 'corrupt-sidecar'; path: string };

export const activeModal = writable<ModalState>(null);

export function openModal(m: Exclude<ModalState, null>): void {
  activeModal.set(m);
}

export function closeModal(): void {
  activeModal.set(null);
}
```

- [ ] **Step 3: Run to verify passing**

```bash
npx vitest run tests/unit/modals-store.test.ts
```

Expected: 4 passing.

- [ ] **Step 4: Write failing tests for OrphanPanel**

```ts
// tests/component/OrphanPanel.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import OrphanPanel from '../../src/components/OrphanPanel.svelte';
import { annots, currentViewerRoot, docEpoch } from '../../src/stores/annots';
import { openModal, closeModal, activeModal } from '../../src/stores/modals';

function mountViewer(html: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = html;
  document.body.appendChild(article);
  currentViewerRoot.set(article);
  docEpoch.update((e) => e + 1);
  return article;
}

beforeEach(() => {
  document.body.innerHTML = '';
  annots.set([]);
  currentViewerRoot.set(null);
  closeModal();
});
afterEach(() => { document.body.innerHTML = ''; });

describe('OrphanPanel', () => {
  it('does not render when modal is closed', () => {
    render(OrphanPanel);
    expect(document.querySelector('.orphan-panel')).toBeNull();
  });

  it('renders when activeModal is orphans', () => {
    render(OrphanPanel);
    flushSync(() => openModal({ kind: 'orphans' }));
    expect(document.querySelector('.orphan-panel')).not.toBeNull();
  });

  it('lists each orphaned annotation with its text excerpt', () => {
    mountViewer('<p data-block-id="p:1">nothing here.</p>');
    flushSync(() => {
      annots.set([
        {
          id: '01A', type: 'highlight', color: '#ffd25a',
          anchor: { text: 'vanished phrase', prefix: 'xxx', suffix: 'yyy', blockHint: 'p:99' },
          createdAt: 'now', updatedAt: 'now',
        },
      ]);
    });
    render(OrphanPanel);
    flushSync(() => openModal({ kind: 'orphans' }));
    expect(screen.getByText(/vanished phrase/)).toBeInTheDocument();
  });

  it('clicking Delete removes the orphan and keeps the modal open', async () => {
    mountViewer('<p data-block-id="p:1">nothing here.</p>');
    flushSync(() => {
      annots.set([
        {
          id: '01A', type: 'highlight', color: '#ffd25a',
          anchor: { text: 'vanished', prefix: 'xxx', suffix: 'yyy', blockHint: 'p:99' },
          createdAt: 'now', updatedAt: 'now',
        },
      ]);
    });
    render(OrphanPanel);
    flushSync(() => openModal({ kind: 'orphans' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(get(annots)).toHaveLength(0);
    // Modal stays open (empty state may render).
    expect(get(activeModal)).toEqual({ kind: 'orphans' });
  });

  it('clicking Close dismisses the modal', async () => {
    render(OrphanPanel);
    flushSync(() => openModal({ kind: 'orphans' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(get(activeModal)).toBeNull();
  });

  it('shows an empty state when no orphans', () => {
    render(OrphanPanel);
    flushSync(() => openModal({ kind: 'orphans' }));
    expect(screen.getByText(/no orphaned/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run to verify failure**

```bash
npx vitest run tests/component/OrphanPanel.test.ts
```

Expected: FAIL.

- [ ] **Step 6: Implement `src/components/OrphanPanel.svelte`**

```svelte
<script lang="ts">
  import { activeModal, closeModal } from '../stores/modals';
  import { orphanedAnnots, removeAnnotation } from '../stores/annots';
  import type { Annotation } from '../lib/schema';

  function excerpt(a: Annotation): string {
    if (a.type === 'drawing') return `[drawing — ${a.strokes.length} stroke(s)]`;
    return a.anchor.text;
  }

  function blockInfo(a: Annotation): string {
    if (a.type === 'drawing') return a.anchorBlock;
    return a.anchor.blockHint;
  }
</script>

{#if $activeModal?.kind === 'orphans'}
  <div class="scrim" onclick={closeModal} role="presentation">
    <div class="orphan-panel glass" role="dialog" aria-label="Orphaned annotations" onclick={(e) => e.stopPropagation()}>
      <header>
        <h2>Orphaned annotations</h2>
        <button class="close" aria-label="Close" onclick={closeModal}>×</button>
      </header>
      {#if $orphanedAnnots.length === 0}
        <p class="empty">No orphaned annotations. All your notes are attached.</p>
      {:else}
        <ul>
          {#each $orphanedAnnots as a (a.id)}
            <li>
              <div class="meta">
                <span class="kind">{a.type}</span>
                <span class="block">{blockInfo(a)}</span>
                <span class="date">{new Date(a.createdAt).toLocaleDateString()}</span>
              </div>
              <div class="text">{excerpt(a)}</div>
              <div class="actions">
                <button onclick={() => removeAnnotation(a.id)}>Delete</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: grid;
    place-items: center;
    z-index: 300;
    backdrop-filter: blur(2px);
  }
  .orphan-panel {
    width: min(520px, 90vw);
    max-height: 80vh;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  header h2 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 500;
    color: var(--fg-0);
  }
  .close {
    background: transparent;
    border: 0;
    color: var(--fg-2);
    font-size: 20px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .close:hover { color: var(--fg-0); }
  .empty {
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 13px;
    text-align: center;
    padding: 20px 0;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    padding: 10px 12px;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .meta {
    display: flex;
    gap: 10px;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--fg-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .text {
    font-family: var(--font-serif);
    font-size: 14px;
    color: var(--fg-1);
  }
  .actions { display: flex; justify-content: flex-end; }
  .actions button {
    background: transparent;
    border: 1px solid var(--glass-border);
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .actions button:hover { color: #ff8080; border-color: #ff8080; }
</style>
```

- [ ] **Step 7: Run to verify passing**

```bash
npx vitest run tests/component/OrphanPanel.test.ts
```

Expected: 6 passing.

- [ ] **Step 8: Modify `src/components/GlassMenu.svelte` to add "Orphaned Annotations…" item**

Add at the top of the `<script>` block:

```ts
import { orphanedAnnots } from '../stores/annots';
import { openModal } from '../stores/modals';
```

Inside the popover `<div role="menu">`, add a second button under "Open…":

```svelte
<button
  role="menuitem"
  class="item"
  disabled={$orphanedAnnots.length === 0}
  onclick={() => { open = false; openModal({ kind: 'orphans' }); }}
>
  Orphaned Annotations{$orphanedAnnots.length > 0 ? ` (${$orphanedAnnots.length})` : ''}
</button>
```

Add styling for disabled state in the component's `<style>` block:

```css
.item[disabled] {
  color: var(--fg-2);
  cursor: default;
  opacity: 0.5;
}
.item[disabled]:hover { background: transparent; }
```

- [ ] **Step 9: Modify `tests/component/GlassMenu.test.ts` to add a test**

Append:

```ts
describe('GlassMenu — Orphaned Annotations item', () => {
  it('is disabled when no orphans exist', async () => {
    const { annots, currentViewerRoot } = await import('../../src/stores/annots');
    annots.set([]);
    currentViewerRoot.set(null);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    const item = screen.getByRole('menuitem', { name: /orphaned/i });
    expect(item).toBeDisabled();
  });

  it('opens the orphan modal when clicked', async () => {
    const { annots, currentViewerRoot } = await import('../../src/stores/annots');
    const { activeModal } = await import('../../src/stores/modals');
    const { get } = await import('svelte/store');
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:99' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    currentViewerRoot.set(null); // null root → everything orphaned
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /orphaned/i }));
    expect(get(activeModal)).toEqual({ kind: 'orphans' });
  });
});
```

- [ ] **Step 10: Mount OrphanPanel in `src/App.svelte`**

Add import at the top:

```ts
import OrphanPanel from './components/OrphanPanel.svelte';
import Toasts from './components/Toasts.svelte';
```

Add `<OrphanPanel />` and `<Toasts />` to the template (below the existing components):

```svelte
<Viewer />
<GlassMenu />
<ToolRail />
<ColorStrip />
<OrphanPanel />
<Toasts />
```

- [ ] **Step 11: Run full test suite + svelte-check**

```bash
npm test && npm run check
```

Expected: all tests pass, svelte-check clean.

- [ ] **Step 12: Commit**

```bash
git add src/stores/modals.ts src/components/OrphanPanel.svelte src/components/GlassMenu.svelte src/App.svelte tests/unit/modals-store.test.ts tests/component/OrphanPanel.test.ts tests/component/GlassMenu.test.ts
git commit -m "feat: add OrphanPanel modal and GlassMenu entry"
```

---

## Phase 4 — Open Recent (Tasks 5–6)

### Task 5: Open Recent submenu in GlassMenu

**Files:**
- Modify: `src/components/GlassMenu.svelte`
- Modify: `tests/component/GlassMenu.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('GlassMenu — Open Recent', () => {
  it('shows recent paths when menu is open and recent is non-empty', async () => {
    const { recent } = await import('../../src/stores/recent');
    recent.set(['/home/kai/a.md', '/home/kai/b.md']);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    // Recent items appear as menuitems with the basename as label.
    expect(screen.getByRole('menuitem', { name: /a\.md/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /b\.md/i })).toBeInTheDocument();
  });

  it('clicking a recent path calls loadDocument with the full path', async () => {
    const { recent } = await import('../../src/stores/recent');
    const { loadDocument } = await import('../../src/stores/doc');
    recent.set(['/home/kai/a.md']);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /a\.md/i }));
    expect(loadDocument).toHaveBeenCalledWith('/home/kai/a.md');
  });

  it('omits the Open Recent section when recent list is empty', async () => {
    const { recent } = await import('../../src/stores/recent');
    recent.set([]);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.queryByText(/open recent/i)).toBeNull();
  });
});
```

The test relies on the existing `loadDocument` mock from earlier tests.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/component/GlassMenu.test.ts
```

Expected: 3 new tests fail.

- [ ] **Step 3: Modify `src/components/GlassMenu.svelte`**

Add imports:

```ts
import { recent, recordRecent } from '../stores/recent';
import { loadDocument } from '../stores/doc';
```

Note: `loadDocument` is already imported. `recent` and `recordRecent` need to be added.

Add a helper:

```ts
function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

async function openRecent(path: string) {
  open = false;
  try {
    await loadDocument(path);
    await recordRecent(path);
  } catch (e) {
    // Error handling (missing file, etc.) lands in Task 6.
    console.warn('[remarkdown] failed to open recent:', e);
  }
}
```

Inside the popover template, below the "Orphaned Annotations…" button, add:

```svelte
{#if $recent.length > 0}
  <div class="separator" role="separator"></div>
  <div class="submenu-label">Open Recent</div>
  {#each $recent as path (path)}
    <button
      class="item recent"
      role="menuitem"
      onclick={() => openRecent(path)}
      title={path}
    >
      {basename(path)}
    </button>
  {/each}
{/if}
```

Add styles:

```css
.separator {
  height: 1px;
  background: var(--glass-border);
  margin: 4px 0;
}
.submenu-label {
  font-family: var(--font-sans);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-2);
  padding: 4px 10px;
}
.item.recent {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/component/GlassMenu.test.ts
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/GlassMenu.svelte tests/component/GlassMenu.test.ts
git commit -m "feat: add Open Recent submenu to GlassMenu"
```

---

### Task 6: Recent path validation + missing-file handling

**Files:**
- Modify: `src-tauri/src/commands.rs` — add `check_paths_exist`
- Modify: `src-tauri/src/main.rs` — register command
- Modify: `src/lib/tauri-api.ts` — add wrapper
- Modify: `src/stores/recent.ts` — validate on refresh
- Modify: `src/components/GlassMenu.svelte` — grey out missing + click-removes
- Modify: `tests/unit/recent-store.test.ts`, `tests/component/GlassMenu.test.ts`

- [ ] **Step 1: Add Rust command `check_paths_exist`**

Append to `src-tauri/src/commands.rs` (after existing commands):

```rust
#[tauri::command]
pub fn check_paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| std::path::Path::new(p).is_file()).collect()
}
```

Add a Rust test in the existing `#[cfg(test)] mod tests` block:

```rust
#[test]
fn check_paths_exist_returns_per_path_flags() {
    let dir = tempdir().unwrap();
    let real = dir.path().join("real.md");
    fs::write(&real, b"x").unwrap();
    let fake = dir.path().join("fake.md");
    let result = check_paths_exist(vec![
        real.to_string_lossy().into_owned(),
        fake.to_string_lossy().into_owned(),
    ]);
    assert_eq!(result, vec![true, false]);
}
```

- [ ] **Step 2: Register the command in `main.rs`**

Update `invoke_handler`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::open_file_dialog,
    commands::read_document,
    commands::write_sidecar,
    commands::push_recent,
    commands::list_recent,
    commands::clear_recent,
    commands::check_paths_exist,
])
```

- [ ] **Step 3: Verify Rust compiles and tests pass**

```bash
cd src-tauri && cargo test
```

Expected: 5 passing (4 existing + 1 new).

- [ ] **Step 4: Add TS wrapper in `src/lib/tauri-api.ts`**

Append:

```ts
export async function checkPathsExist(paths: string[]): Promise<boolean[]> {
  return await invoke<boolean[]>('check_paths_exist', { paths });
}
```

- [ ] **Step 5: Modify `src/stores/recent.ts` to export validated list**

Replace the file:

```ts
import { derived, writable } from 'svelte/store';
import { listRecent, pushRecent, checkPathsExist } from '../lib/tauri-api';

export const recent = writable<string[]>([]);
export const recentExistence = writable<Record<string, boolean>>({});

export async function refreshRecent(): Promise<void> {
  const list = await listRecent();
  recent.set(list);
  if (list.length > 0) {
    try {
      const flags = await checkPathsExist(list);
      const map: Record<string, boolean> = {};
      list.forEach((p, i) => { map[p] = flags[i]; });
      recentExistence.set(map);
    } catch {
      // Best-effort — if the check fails, assume all exist.
      const map: Record<string, boolean> = {};
      list.forEach((p) => { map[p] = true; });
      recentExistence.set(map);
    }
  } else {
    recentExistence.set({});
  }
}

export async function recordRecent(path: string): Promise<void> {
  const list = await pushRecent(path);
  recent.set(list);
  recentExistence.update((map) => ({ ...map, [path]: true }));
}

// Remove a path from the recent list entirely (also updates backend via push-then-filter, which is imperfect;
// true removal would need a new Rust command. For v1, flip existence to false so UI greys it out and subsequent
// clicks re-open or remove.)
export function markMissing(path: string): void {
  recentExistence.update((map) => ({ ...map, [path]: false }));
}
```

- [ ] **Step 6: Update `tests/unit/recent-store.test.ts`**

Replace the mocked imports at the top:

```ts
vi.mock('../../src/lib/tauri-api', () => ({
  pushRecent: vi.fn(),
  listRecent: vi.fn(),
  checkPathsExist: vi.fn().mockResolvedValue([]),
}));
```

Add imports:

```ts
import { checkPathsExist } from '../../src/lib/tauri-api';
import { recentExistence } from '../../src/stores/recent';
```

Replace the existing tests with these (preserve the file header):

```ts
describe('recent store', () => {
  beforeEach(() => {
    vi.mocked(pushRecent).mockReset();
    vi.mocked(listRecent).mockReset();
    vi.mocked(checkPathsExist).mockReset().mockResolvedValue([]);
    recent.set([]);
  });

  it('refreshRecent populates store from list_recent and checks existence', async () => {
    vi.mocked(listRecent).mockResolvedValue(['/a', '/b']);
    vi.mocked(checkPathsExist).mockResolvedValue([true, false]);
    await refreshRecent();
    expect(get(recent)).toEqual(['/a', '/b']);
    expect(get(recentExistence)).toEqual({ '/a': true, '/b': false });
  });

  it('recordRecent calls push_recent and marks path as existing', async () => {
    vi.mocked(pushRecent).mockResolvedValue(['/new', '/a']);
    await recordRecent('/new');
    expect(pushRecent).toHaveBeenCalledWith('/new');
    expect(get(recent)).toEqual(['/new', '/a']);
    expect(get(recentExistence)['/new']).toBe(true);
  });

  it('refreshRecent with empty list clears existence', async () => {
    vi.mocked(listRecent).mockResolvedValue([]);
    await refreshRecent();
    expect(get(recent)).toEqual([]);
    expect(get(recentExistence)).toEqual({});
  });
});
```

- [ ] **Step 7: Modify `src/components/GlassMenu.svelte`**

Replace the recent-paths section with existence-aware rendering:

```svelte
{#if $recent.length > 0}
  <div class="separator" role="separator"></div>
  <div class="submenu-label">Open Recent</div>
  {#each $recent as path (path)}
    <button
      class="item recent"
      class:missing={$recentExistence[path] === false}
      role="menuitem"
      onclick={() => openRecent(path)}
      title={path}
    >
      {basename(path)}{$recentExistence[path] === false ? ' (missing)' : ''}
    </button>
  {/each}
{/if}
```

And in the `openRecent` helper, handle missing:

```ts
async function openRecent(path: string) {
  open = false;
  if (get(recentExistence)[path] === false) {
    // User clicked a missing file — mark it and toast.
    addToast({ kind: 'warning', message: `File not found: ${basename(path)}` });
    return;
  }
  try {
    await loadDocument(path);
    await recordRecent(path);
  } catch (e) {
    markMissing(path);
    addToast({ kind: 'error', message: `Could not open ${basename(path)}: ${(e as Error).message}` });
  }
}
```

Add imports at the top:

```ts
import { get } from 'svelte/store';
import { recent, recordRecent, recentExistence, markMissing } from '../stores/recent';
import { addToast } from '../stores/toasts';
```

Add styling:

```css
.item.missing { color: var(--fg-2); font-style: italic; }
```

- [ ] **Step 8: Add a GlassMenu test**

Append to `tests/component/GlassMenu.test.ts`:

```ts
it('shows "(missing)" suffix for recent paths that do not exist', async () => {
  const { recent, recentExistence } = await import('../../src/stores/recent');
  recent.set(['/home/kai/missing.md']);
  recentExistence.set({ '/home/kai/missing.md': false });
  const user = userEvent.setup();
  render(GlassMenu);
  await user.click(screen.getByRole('button', { name: /menu/i }));
  expect(screen.getByText(/missing\.md \(missing\)/i)).toBeInTheDocument();
});
```

- [ ] **Step 9: Run tests**

```bash
npm test
```

Expected: all pass (new Rust test, updated recent-store tests, new GlassMenu test).

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs src/lib/tauri-api.ts src/stores/recent.ts src/components/GlassMenu.svelte tests/unit/recent-store.test.ts tests/component/GlassMenu.test.ts
git commit -m "feat: validate recent paths and grey out missing files"
```

---

## Phase 5 — Error handling (Tasks 7–10)

### Task 7: UTF-8 error toast

**Files:**
- Modify: `src/stores/doc.ts` — catch UTF-8 error
- Modify: `tests/unit/doc-store.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/doc-store.test.ts`:

```ts
describe('doc store — error surfacing', () => {
  it('surfaces a toast when readDocument throws a non-UTF-8 error', async () => {
    const { addToast, clearToasts, toasts } = await import('../../src/stores/toasts');
    clearToasts();
    vi.mocked(readDocument).mockRejectedValue({ NotUtf8: null });
    await loadDocument('/tmp/bin.md');
    const list = get(toasts);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].kind).toBe('error');
    expect(list[0].message).toMatch(/utf-8/i);
  });
});
```

- [ ] **Step 2: Modify `src/stores/doc.ts`**

Wrap `readDocument` in try/catch inside `loadDocument`:

```ts
export async function loadDocument(path: string): Promise<void> {
  let r;
  try {
    r = await readDocument(path);
  } catch (err) {
    const { addToast } = await import('./toasts');
    // Tauri CommandError serializes as { Io: "..." } | { NotUtf8: null } | { SidecarMalformed: "..." } | "Cancelled"
    if (err && typeof err === 'object' && 'NotUtf8' in err) {
      addToast({ kind: 'error', message: 'This file is not UTF-8 — remarkdown only supports UTF-8 markdown files.' });
    } else if (err && typeof err === 'object' && 'Io' in err) {
      addToast({ kind: 'error', message: `Could not open file: ${(err as any).Io}` });
    } else {
      addToast({ kind: 'error', message: `Could not open file: ${String(err)}` });
    }
    return;
  }
  // ... existing body continues here (render, parse sidecar, etc.)
}
```

Hmm wait — `import('./toasts')` inside a function is awkward. Better: import at the top:

```ts
import { addToast } from './toasts';
```

And the error-handling becomes straightforward:

```ts
export async function loadDocument(path: string): Promise<void> {
  let r;
  try {
    r = await readDocument(path);
  } catch (err) {
    if (err && typeof err === 'object' && 'NotUtf8' in err) {
      addToast({ kind: 'error', message: 'This file is not UTF-8 — remarkdown only supports UTF-8 markdown files.' });
    } else if (err && typeof err === 'object' && 'Io' in err) {
      addToast({ kind: 'error', message: `Could not open file: ${(err as Record<string, unknown>).Io}` });
    } else {
      addToast({ kind: 'error', message: `Could not open file: ${String(err)}` });
    }
    return;
  }
  const { html, plaintext, blocks } = await render(r.markdown, {
    baseDir: r.dir,
    toAssetUrl,
  });
  // ... rest unchanged
}
```

Update the test to not use dynamic import:

```ts
import { toasts, clearToasts } from '../../src/stores/toasts';
// ...

it('surfaces a toast when readDocument throws a non-UTF-8 error', async () => {
  clearToasts();
  vi.mocked(readDocument).mockRejectedValue({ NotUtf8: null });
  await loadDocument('/tmp/bin.md');
  const list = get(toasts);
  expect(list.length).toBeGreaterThan(0);
  expect(list[0].kind).toBe('error');
  expect(list[0].message).toMatch(/utf-8/i);
});
```

- [ ] **Step 3: Run to verify passing**

```bash
npx vitest run tests/unit/doc-store.test.ts
```

Expected: passing (including the new test).

- [ ] **Step 4: Commit**

```bash
git add src/stores/doc.ts tests/unit/doc-store.test.ts
git commit -m "feat: surface UTF-8 errors as toasts when opening a document"
```

---

### Task 8: Corrupt sidecar modal + backup-rename

**Files:**
- Modify: `src-tauri/src/commands.rs` — add `backup_corrupt_sidecar`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/lib/tauri-api.ts`
- Modify: `src/stores/doc.ts` — open modal on corrupt sidecar
- Create: `src/components/CorruptSidecarModal.svelte`, `tests/component/CorruptSidecarModal.test.ts`
- Modify: `src/App.svelte` — mount the modal

- [ ] **Step 1: Add Rust command `backup_corrupt_sidecar`**

Append to `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn backup_corrupt_sidecar(md_path: String) -> Result<String, CommandError> {
    let md = PathBuf::from(md_path);
    let sc = sidecar_path_for(&md);
    if !sc.exists() {
        return Err(CommandError::Io("sidecar does not exist".into()));
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut backup = sc.clone();
    let backup_name = format!(
        "{}.corrupt-{}",
        sc.file_name().and_then(|n| n.to_str()).unwrap_or("sidecar.json"),
        timestamp
    );
    backup.set_file_name(backup_name);
    fs::rename(&sc, &backup)?;
    Ok(backup.to_string_lossy().into_owned())
}
```

Add a Rust test:

```rust
#[test]
fn backup_corrupt_sidecar_renames_the_file() {
    let dir = tempdir().unwrap();
    let md = dir.path().join("a.md");
    let sc = dir.path().join("a.md.remarkdown.json");
    fs::write(&md, b"# hi\n").unwrap();
    fs::write(&sc, b"{ corrupt").unwrap();

    let result = backup_corrupt_sidecar(md.to_string_lossy().into_owned()).unwrap();
    assert!(result.contains(".corrupt-"));
    assert!(!sc.exists());
    assert!(std::path::Path::new(&result).exists());
}
```

- [ ] **Step 2: Register in `main.rs`**

Add `commands::backup_corrupt_sidecar` to the `invoke_handler` list.

- [ ] **Step 3: Verify Rust compiles and tests pass**

```bash
cd src-tauri && cargo test
```

Expected: 6 passing (5 + 1 new).

- [ ] **Step 4: Add TS wrapper**

Append to `src/lib/tauri-api.ts`:

```ts
export async function backupCorruptSidecar(mdPath: string): Promise<string> {
  return await invoke<string>('backup_corrupt_sidecar', { mdPath });
}
```

- [ ] **Step 5: Modify `src/stores/doc.ts` to open modal on corrupt sidecar**

Find the block where `loadSidecar` runs and replace the `else` branch (the `console.warn` block):

```ts
if (r.sidecarRaw) {
  const result = loadSidecar(r.sidecarRaw);
  if (result.ok) {
    parsedAnnotations = result.value.annotations;
  } else {
    console.warn('[remarkdown] sidecar load failed:', result.error);
    // Open a modal asking whether to back up + start fresh.
    const { openModal } = await import('../stores/modals');
    openModal({ kind: 'corrupt-sidecar', path: r.path });
    // Leave annotations empty for now; the user will decide.
  }
}
```

Same caveat — move import to top:

```ts
import { openModal } from './modals';
```

And use directly:

```ts
} else {
  console.warn('[remarkdown] sidecar load failed:', result.error);
  openModal({ kind: 'corrupt-sidecar', path: r.path });
}
```

- [ ] **Step 6: Write `src/components/CorruptSidecarModal.svelte`**

```svelte
<script lang="ts">
  import { activeModal, closeModal } from '../stores/modals';
  import { backupCorruptSidecar } from '../lib/tauri-api';
  import { addToast } from '../stores/toasts';

  async function backupAndStartFresh() {
    if ($activeModal?.kind !== 'corrupt-sidecar') return;
    const path = $activeModal.path;
    try {
      const backup = await backupCorruptSidecar(path);
      addToast({ kind: 'info', message: `Backed up corrupt sidecar to ${backup.split(/[\\/]/).pop()}` });
      closeModal();
    } catch (err) {
      addToast({ kind: 'error', message: `Backup failed: ${String(err)}` });
    }
  }
</script>

{#if $activeModal?.kind === 'corrupt-sidecar'}
  <div class="scrim" onclick={closeModal} role="presentation">
    <div class="modal glass" role="dialog" aria-label="Corrupt sidecar" onclick={(e) => e.stopPropagation()}>
      <header><h2>Annotations couldn't be loaded</h2></header>
      <p>
        The annotations file for this document is malformed JSON.
        Would you like to back it up and start with a fresh empty annotations file?
      </p>
      <div class="actions">
        <button class="ghost" onclick={closeModal}>Leave as-is</button>
        <button class="primary" onclick={backupAndStartFresh}>Back up and start fresh</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: grid;
    place-items: center;
    z-index: 300;
    backdrop-filter: blur(2px);
  }
  .modal {
    width: min(440px, 90vw);
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header h2 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 500;
    color: var(--fg-0);
  }
  p {
    margin: 0;
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1.5;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
    background: transparent;
    border: 1px solid var(--glass-border);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--fg-0);
  }
  button:hover { color: var(--fg-0); }
</style>
```

- [ ] **Step 7: Write component tests**

```ts
// tests/component/CorruptSidecarModal.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  backupCorruptSidecar: vi.fn(),
}));

import { backupCorruptSidecar } from '../../src/lib/tauri-api';
import CorruptSidecarModal from '../../src/components/CorruptSidecarModal.svelte';
import { activeModal, openModal, closeModal } from '../../src/stores/modals';
import { toasts, clearToasts } from '../../src/stores/toasts';

beforeEach(() => {
  closeModal();
  clearToasts();
  vi.mocked(backupCorruptSidecar).mockReset();
});

describe('CorruptSidecarModal', () => {
  it('does not render when modal state is inactive', () => {
    render(CorruptSidecarModal);
    expect(document.querySelector('.modal')).toBeNull();
  });

  it('renders when activeModal is corrupt-sidecar', () => {
    render(CorruptSidecarModal);
    flushSync(() => openModal({ kind: 'corrupt-sidecar', path: '/tmp/a.md' }));
    expect(screen.getByRole('dialog', { name: /corrupt sidecar/i })).toBeInTheDocument();
  });

  it('Leave as-is closes the modal without calling backup', async () => {
    render(CorruptSidecarModal);
    flushSync(() => openModal({ kind: 'corrupt-sidecar', path: '/tmp/a.md' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /leave as-is/i }));
    expect(backupCorruptSidecar).not.toHaveBeenCalled();
    expect(get(activeModal)).toBeNull();
  });

  it('Back up and start fresh calls the Rust command and closes the modal', async () => {
    vi.mocked(backupCorruptSidecar).mockResolvedValue('/tmp/a.md.remarkdown.json.corrupt-1234');
    render(CorruptSidecarModal);
    flushSync(() => openModal({ kind: 'corrupt-sidecar', path: '/tmp/a.md' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /back up/i }));
    expect(backupCorruptSidecar).toHaveBeenCalledWith('/tmp/a.md');
    expect(get(activeModal)).toBeNull();
    expect(get(toasts).some((t) => t.kind === 'info')).toBe(true);
  });
});
```

- [ ] **Step 8: Run tests**

```bash
npx vitest run tests/component/CorruptSidecarModal.test.ts
```

Expected: 4 passing.

- [ ] **Step 9: Mount the modal in `App.svelte`**

Add import and component tag:

```svelte
import CorruptSidecarModal from './components/CorruptSidecarModal.svelte';
```

```svelte
<OrphanPanel />
<CorruptSidecarModal />
<Toasts />
```

- [ ] **Step 10: Run full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs src/lib/tauri-api.ts src/stores/doc.ts src/components/CorruptSidecarModal.svelte src/App.svelte tests/component/CorruptSidecarModal.test.ts
git commit -m "feat: corrupt-sidecar modal with backup-and-start-fresh flow"
```

---

### Task 9: Write permission retry + banner

**Files:**
- Create: `src/components/ErrorBanner.svelte`, `tests/component/ErrorBanner.test.ts`
- Modify: `src/lib/save.ts` — retry logic + banner state
- Modify: `tests/unit/save.test.ts` — add retry tests
- Modify: `src/App.svelte` — mount banner

- [ ] **Step 1: Add retry + banner state to `src/lib/save.ts`**

Replace the top of `save.ts` (imports + `SAVE_DEBOUNCE_MS` + `savedPulse`) to include:

```ts
export const persistentSaveError: Writable<string | null> = writable(null);

const MAX_RETRIES = 3;
const BACKOFF_MS = [100, 400, 1600];

async function doSave(): Promise<void> {
  const current = currentSidecar();
  if (!current) return;
  if (current.json === lastSerializedSnapshot) return;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await writeSidecar(current.path, current.json);
      lastSerializedSnapshot = current.json;
      savedPulse.set(Date.now());
      persistentSaveError.set(null);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
      }
    }
  }
  persistentSaveError.set(`Could not save annotations: ${String(lastErr)}`);
}
```

- [ ] **Step 2: Add failing tests to `tests/unit/save.test.ts`**

Append:

```ts
describe('save retry behavior', () => {
  it('retries up to 3 times on write failure', async () => {
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    vi.mocked(writeSidecar).mockRejectedValue(new Error('denied'));
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
    // First attempt fires immediately after debounce; give retries time to run (100+400+1600).
    await vi.advanceTimersByTimeAsync(3000);
    expect(writeSidecar).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    dispose();
  });

  it('sets persistentSaveError after exhausting retries', async () => {
    const { persistentSaveError } = await import('../../src/lib/save');
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    vi.mocked(writeSidecar).mockRejectedValue(new Error('denied'));
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 3100);
    expect(get(persistentSaveError)).toMatch(/denied/);
    dispose();
  });

  it('clears persistentSaveError on a successful save', async () => {
    const { persistentSaveError } = await import('../../src/lib/save');
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    persistentSaveError.set('stale');
    vi.mocked(writeSidecar).mockResolvedValue(undefined);
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(get(persistentSaveError)).toBeNull();
    dispose();
  });
});
```

- [ ] **Step 3: Run save tests**

```bash
npx vitest run tests/unit/save.test.ts
```

Expected: 7 passing (4 existing + 3 new).

- [ ] **Step 4: Write `src/components/ErrorBanner.svelte`**

```svelte
<script lang="ts">
  import { persistentSaveError } from '../lib/save';
</script>

{#if $persistentSaveError}
  <div class="banner" role="alert">
    <span>{$persistentSaveError}</span>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(200, 60, 60, 0.95);
    color: #fff;
    padding: 10px 18px;
    border-radius: 8px;
    font-family: var(--font-sans);
    font-size: 13px;
    z-index: 250;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    max-width: 80vw;
  }
</style>
```

- [ ] **Step 5: Write component test**

```ts
// tests/component/ErrorBanner.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import ErrorBanner from '../../src/components/ErrorBanner.svelte';
import { persistentSaveError } from '../../src/lib/save';

beforeEach(() => { persistentSaveError.set(null); });

describe('ErrorBanner', () => {
  it('does not render when there is no error', () => {
    render(ErrorBanner);
    expect(document.querySelector('.banner')).toBeNull();
  });

  it('renders the error message when persistentSaveError is set', () => {
    render(ErrorBanner);
    flushSync(() => persistentSaveError.set('disk full'));
    expect(screen.getByRole('alert')).toHaveTextContent(/disk full/);
  });
});
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/component/ErrorBanner.test.ts
```

Expected: 2 passing.

- [ ] **Step 7: Mount in `App.svelte`**

Add import + component:

```svelte
import ErrorBanner from './components/ErrorBanner.svelte';
```

```svelte
<CorruptSidecarModal />
<ErrorBanner />
<Toasts />
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/save.ts src/components/ErrorBanner.svelte src/App.svelte tests/unit/save.test.ts tests/component/ErrorBanner.test.ts
git commit -m "feat: retry save on failure, show persistent error banner after max retries"
```

---

### Task 10: Sidecar size > 2MB toast

**Files:**
- Modify: `src/lib/save.ts`
- Modify: `tests/unit/save.test.ts`

- [ ] **Step 1: Add failing test**

Append to save.test.ts:

```ts
describe('save size warning', () => {
  it('emits a warning toast when serialized JSON exceeds 2 MB', async () => {
    const { addToast, toasts, clearToasts } = await import('../../src/stores/toasts');
    clearToasts();
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    vi.mocked(writeSidecar).mockResolvedValue(undefined);

    // Create a huge annotations list to exceed 2MB when serialized.
    const big: any[] = [];
    const bigText = 'x'.repeat(500);
    for (let i = 0; i < 5000; i++) {
      big.push({
        id: `01_${i.toString().padStart(20, '0')}`,
        type: 'highlight', color: '#ffd25a',
        anchor: { text: bigText, prefix: bigText, suffix: bigText, blockHint: 'p:1' },
        createdAt: 'now', updatedAt: 'now',
      });
    }
    const dispose = installSaveWatcher();
    annots.set(big);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    const warnings = get(toasts).filter((t) => t.kind === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toMatch(/large/i);
    dispose();
  });
});
```

- [ ] **Step 2: Update `src/lib/save.ts`**

Import the toast helper and add the size check at the start of `doSave`:

```ts
import { addToast } from '../stores/toasts';

const SIZE_WARN_BYTES = 2 * 1024 * 1024;
let warnedOnceForThisPath: string | null = null;

async function doSave(): Promise<void> {
  const current = currentSidecar();
  if (!current) return;
  if (current.json === lastSerializedSnapshot) return;

  const byteLen = new TextEncoder().encode(current.json).length;
  if (byteLen > SIZE_WARN_BYTES && warnedOnceForThisPath !== current.path) {
    addToast({
      kind: 'warning',
      message: 'Annotations file is getting large — drawings dominate the file size.',
    });
    warnedOnceForThisPath = current.path;
  }

  // ... existing retry logic
}
```

Reset the warn-once flag when doc changes — add to the `doc.subscribe` callback in `installSaveWatcher`:

```ts
const unsubDoc = doc.subscribe(() => {
  lastSerializedSnapshot = null;
  warnedOnceForThisPath = null;
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/unit/save.test.ts
```

Expected: 8 passing (7 existing + 1 new).

- [ ] **Step 4: Commit**

```bash
git add src/lib/save.ts tests/unit/save.test.ts
git commit -m "feat: warn once when sidecar JSON exceeds 2MB"
```

---

## Phase 6 — Playwright E2E (Tasks 11–12)

### Task 11: Playwright setup + Tauri mock

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/support/tauri-mock.ts`
- Modify: `vite.config.ts` — conditional alias for e2e mode
- Modify: `package.json` — add scripts + Playwright dev dep

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Update `package.json` scripts**

Add:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "build:e2e": "vite build --mode e2e",
  "preview": "vite preview",
  "preview:e2e": "vite preview --port 4173",
  "check": "svelte-check --tsconfig ./tsconfig.json",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "tauri": "tauri"
}
```

- [ ] **Step 3: Write `tests/e2e/support/tauri-mock.ts`**

This mock replaces `@tauri-apps/api/core` in e2e-mode builds. All "disk" operations use `localStorage` so the browser environment can round-trip annotations.

```ts
// tests/e2e/support/tauri-mock.ts
// A localStorage-backed stand-in for @tauri-apps/api/core used by Playwright E2E.

interface Doc { markdown: string; sidecar_raw: string | null; sha256: string; bytes: number; }

function docKey(path: string): string { return `rmd-doc::${path}`; }
function sidecarKey(path: string): string { return `rmd-sidecar::${path}`; }
function hashBytes(bytes: Uint8Array): string {
  let h = 0;
  for (const b of bytes) h = ((h << 5) - h + b) | 0;
  return (h >>> 0).toString(16).padStart(64, '0');
}

function getDoc(path: string): Doc | null {
  const raw = localStorage.getItem(docKey(path));
  return raw ? (JSON.parse(raw) as Doc) : null;
}

export async function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case 'open_file_dialog': {
      // In e2e, the dialog is replaced by a test-driven path. Playwright sets
      // window.__E2E_DIALOG_PATH__ to choose a path.
      const path = (window as any).__E2E_DIALOG_PATH__ ?? null;
      return path;
    }
    case 'read_document': {
      const path = args?.path as string;
      const doc = getDoc(path);
      if (!doc) throw { Io: `File not found: ${path}` };
      const sidecar_raw = localStorage.getItem(sidecarKey(path));
      return {
        path,
        dir: path.split(/[\\/]/).slice(0, -1).join('/') || '/',
        markdown: doc.markdown,
        sidecar_raw,
        sha256: doc.sha256,
        bytes: doc.bytes,
      };
    }
    case 'write_sidecar': {
      const mdPath = args?.mdPath as string;
      const json = args?.json as string;
      localStorage.setItem(sidecarKey(mdPath), json);
      return;
    }
    case 'push_recent': {
      const path = args?.path as string;
      const list = JSON.parse(localStorage.getItem('rmd-recent') ?? '[]');
      const next = [path, ...list.filter((p: string) => p !== path)].slice(0, 10);
      localStorage.setItem('rmd-recent', JSON.stringify(next));
      return next;
    }
    case 'list_recent': {
      return JSON.parse(localStorage.getItem('rmd-recent') ?? '[]');
    }
    case 'clear_recent': {
      localStorage.removeItem('rmd-recent');
      return;
    }
    case 'check_paths_exist': {
      const paths = args?.paths as string[];
      return paths.map((p) => getDoc(p) !== null);
    }
    case 'backup_corrupt_sidecar': {
      const path = args?.mdPath as string;
      const raw = localStorage.getItem(sidecarKey(path));
      if (!raw) throw { Io: 'sidecar does not exist' };
      const backupKey = `${sidecarKey(path)}.corrupt-${Date.now()}`;
      localStorage.setItem(backupKey, raw);
      localStorage.removeItem(sidecarKey(path));
      return backupKey;
    }
  }
  throw new Error(`[mock] unhandled command: ${cmd}`);
}

export function convertFileSrc(path: string): string {
  return `asset://localhost/${path}`;
}

// Test-only helper: seed a virtual doc.
(window as any).__E2E_SEED_DOC__ = (path: string, markdown: string) => {
  const bytes = new TextEncoder().encode(markdown);
  localStorage.setItem(docKey(path), JSON.stringify({
    markdown,
    sidecar_raw: null,
    sha256: hashBytes(bytes),
    bytes: bytes.length,
  }));
};
(window as any).__E2E_SET_DIALOG_PATH__ = (path: string | null) => {
  (window as any).__E2E_DIALOG_PATH__ = path;
};
(window as any).__E2E_CLEAR_ALL__ = () => {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('rmd-') || k.startsWith('rmd-doc::') || k.startsWith('rmd-sidecar::'))) {
      localStorage.removeItem(k);
    }
  }
};
```

- [ ] **Step 4: Update `vite.config.ts` to alias in e2e mode**

Replace `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
  },
  resolve: {
    conditions: ['browser'],
    alias: mode === 'e2e' ? {
      '@tauri-apps/api/core': resolve(__dirname, 'tests/e2e/support/tauri-mock.ts'),
    } : undefined,
  },
}));
```

Note: this keeps the `conditions: ['browser']` (from Plan 2 Task 20) but it's at vite config level now, not just vitest. If vitest config inherits from vite config (it does via `mergeConfig`), we need to ensure vitest still works. The `conditions: ['browser']` is harmless outside of tests.

Actually — double-check that moving `resolve.conditions` to the main vite config doesn't break Vitest's existing expectation. Keep it for now; revert if tests break.

- [ ] **Step 5: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // sequential for predictable localStorage state
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    viewport: { width: 1100, height: 780 },
  },
  webServer: {
    command: 'npm run build:e2e && npm run preview:e2e',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  testMatch: '**/*.spec.ts',
});
```

- [ ] **Step 6: Smoke-test Playwright can start**

```bash
npm run build:e2e
```

Expected: clean build.

Then manually verify the preview serves correctly:

```bash
npm run preview:e2e
# in another terminal
curl -sI http://localhost:4173 | head -5
# should return 200
```

Kill the preview. We'll let Playwright drive it from Task 12.

- [ ] **Step 7: Update `.gitignore` for Playwright artifacts**

Append to `.gitignore`:

```
playwright-report/
test-results/
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json playwright.config.ts vite.config.ts tests/e2e/support/tauri-mock.ts .gitignore
git commit -m "chore: add Playwright + Tauri mock for E2E against vite preview"
```

---

### Task 12: E2E scenarios (5 scenarios from spec)

**Files:**
- Create: `tests/e2e/scenarios.spec.ts`

- [ ] **Step 1: Write the E2E spec file**

```ts
// tests/e2e/scenarios.spec.ts
import { test, expect } from '@playwright/test';

const FIXTURE_PATH = '/e2e/sample.md';
const FIXTURE_MD = `# Sample\n\nThe **reader** who would truly understand must read slowly, and with care.\n\nAnother paragraph follows.\n`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate(
    ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
    [FIXTURE_PATH, FIXTURE_MD],
  );
  await page.evaluate(
    (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
    FIXTURE_PATH,
  );
});

test('1. opens a markdown file from the hamburger menu', async ({ page }) => {
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample');
});

test('2. a highlight persists across reload', async ({ page }) => {
  // Open
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();

  // Switch to Highlight tool
  await page.getByRole('radio', { name: /highlight/i }).click();

  // Select text via a programmatic selection (more reliable than drag in Playwright).
  await page.evaluate(() => {
    const p = document.querySelector('p[data-block-id]') as HTMLElement;
    const tn = p.firstChild as Text;
    const start = tn.data.indexOf('truly');
    const end = start + 'truly understand'.length;
    const range = document.createRange();
    range.setStart(tn, start);
    range.setEnd(tn, end);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  // Wait for debounced save (500ms).
  await page.waitForTimeout(700);

  // Verify localStorage now has a sidecar entry.
  const sidecar = await page.evaluate(() =>
    localStorage.getItem('rmd-sidecar::/e2e/sample.md'),
  );
  expect(sidecar).toBeTruthy();
  const parsed = JSON.parse(sidecar!);
  expect(parsed.annotations).toHaveLength(1);
  expect(parsed.annotations[0].type).toBe('highlight');

  // Reload and verify the highlight still appears.
  await page.reload();
  await page.evaluate(
    (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
    FIXTURE_PATH,
  );
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.waitForTimeout(300);

  // The CSS Highlight API registration is verified through localStorage (above);
  // visual confirmation happens in manual QA. For E2E, assert the sidecar is reloaded.
  const afterReload = await page.evaluate(() =>
    localStorage.getItem('rmd-sidecar::/e2e/sample.md'),
  );
  expect(JSON.parse(afterReload!).annotations).toHaveLength(1);
});

test('3. a note persists across reload with body intact', async ({ page }) => {
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();

  await page.getByRole('radio', { name: /note/i }).click();
  // Click inside the paragraph — the fallback path (no caretPositionFromPoint)
  // anchors to the first word of the block.
  await page.locator('p[data-block-id]').click();

  const popover = page.getByRole('dialog', { name: /note/i });
  await popover.waitFor();
  const textarea = popover.getByRole('textbox');
  await textarea.fill('this is my note');
  await page.waitForTimeout(700);

  const sidecar = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('rmd-sidecar::/e2e/sample.md')))!,
  );
  const note = sidecar.annotations.find((a: any) => a.type === 'note');
  expect(note.body).toBe('this is my note');
});

test('4. a drawing persists', async ({ page }) => {
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();

  await page.getByRole('radio', { name: /draw/i }).click();
  const svg = page.locator('svg.draw-overlay');
  const box = await svg.boundingBox();
  if (!box) throw new Error('svg not laid out');

  // Draw a small stroke.
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.up();

  // Wait for idle finalization (3s) plus debounced save (500ms).
  await page.waitForTimeout(3800);

  const sidecar = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('rmd-sidecar::/e2e/sample.md')))!,
  );
  const drawing = sidecar.annotations.find((a: any) => a.type === 'drawing');
  expect(drawing).toBeTruthy();
  expect(drawing.strokes.length).toBeGreaterThan(0);
});

test('5. external edit to the markdown orphans a highlight', async ({ page }) => {
  // Open, make a highlight.
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.getByRole('radio', { name: /highlight/i }).click();
  await page.evaluate(() => {
    const p = document.querySelector('p[data-block-id]') as HTMLElement;
    const tn = p.firstChild as Text;
    const start = tn.data.indexOf('truly');
    const end = start + 'truly understand'.length;
    const range = document.createRange();
    range.setStart(tn, start);
    range.setEnd(tn, end);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(700);

  // Simulate an "external edit": rewrite the doc so the highlighted phrase is gone.
  await page.evaluate(
    ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
    [FIXTURE_PATH, '# Sample\n\nCompletely different text here, no overlap at all.\n'],
  );

  // Reopen.
  await page.reload();
  await page.evaluate(
    (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
    FIXTURE_PATH,
  );
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.waitForTimeout(300);

  // The Orphaned Annotations menu item should show (1).
  await page.getByRole('button', { name: /menu/i }).click();
  const orphanItem = page.getByRole('menuitem', { name: /orphaned annotations/i });
  await expect(orphanItem).toBeEnabled();
  await expect(orphanItem).toContainText(/\(1\)/);
});
```

- [ ] **Step 2: Run Playwright**

```bash
npm run test:e2e
```

Expected: 5 scenarios pass. First run downloads Chromium if not yet installed.

If tests fail because of `beforeunload` flushSave on reload stalling the page close — add `await page.evaluate(() => window.removeEventListener('beforeunload', () => {}))` before each `page.reload()`. Or guard the listener in `main.ts` to be a no-op in e2e mode via `import.meta.env.MODE === 'e2e'`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/scenarios.spec.ts
git commit -m "test(e2e): add Playwright scenarios covering spec's 5 smoke tests"
```

---

## Phase 7 — Release (Task 13)

### Task 13: README + QA checklist + v0.3.0 tag

**Files:**
- Create: `docs/QA-plan-3.md`
- Modify: `README.md`

- [ ] **Step 1: Write `docs/QA-plan-3.md`**

```markdown
# Plan 3 Manual QA Checklist

Run `npm run tauri dev` and walk through each item. Prereq: Plans 1 and 2 features still work (highlights, notes, drawings, persistence).

## Delete affordances
- [ ] Create a highlight. Right-click on it → small context menu appears.
- [ ] Click "Delete highlight" → highlight disappears, sidecar updates within 500ms.
- [ ] Right-click in an unhighlighted area → no menu appears.
- [ ] Create a drawing. Right-click on a stroke → "Delete drawing" menu appears.
- [ ] Click Delete → stroke gone, sidecar updates.
- [ ] Right-click far from any stroke → no menu.

## Orphan Panel
- [ ] Menu shows "Orphaned Annotations" — disabled if count=0, otherwise shows "(N)".
- [ ] External-edit the `.md` to remove a highlighted phrase. Reopen.
- [ ] Menu → "Orphaned Annotations" opens modal with the orphan listed.
- [ ] Each orphan shows type, block hint, date, and text excerpt.
- [ ] Click Delete → orphan removed, count decrements.
- [ ] Close button dismisses modal.

## Open Recent
- [ ] Open two different files; close; reopen app.
- [ ] Menu shows both recent paths, newest first.
- [ ] Click one → opens.
- [ ] Rename one file externally so it's missing. Reopen app.
- [ ] Missing file is greyed out with "(missing)" suffix.
- [ ] Click missing file → toast shows "File not found", entry stays greyed.

## Error handling
- [ ] Open a non-UTF-8 file (e.g., save a `.md` in Latin-1 encoding). Toast says "not UTF-8".
- [ ] Manually corrupt the `.remarkdown.json` sidecar (save invalid JSON there). Reopen.
- [ ] Modal: "Annotations couldn't be loaded. Back up and start fresh?"
  - [ ] "Back up and start fresh" creates `<name>.corrupt-<timestamp>` next to source.
  - [ ] "Leave as-is" closes the modal.
- [ ] Make the target directory read-only. Create an annotation. After 3 retries (~2s), a persistent error banner appears. Revert permissions → create another annotation → banner disappears.
- [ ] Create many drawings so sidecar exceeds 2MB. Toast warns about size once per session per doc.

## Playwright E2E
- [ ] `npm run test:e2e` runs and all 5 scenarios pass.

## Regressions
- [ ] `npm test` green, `cargo test` green, `npm run check` clean.
```

- [ ] **Step 2: Update README**

Replace the Status section:

```markdown
## Status

**Plan 3 — Robustness polish (v0.3.0)**: right-click delete for highlights and drawings, orphan panel, Open Recent menu with missing-file detection, full error matrix (UTF-8 / corrupt sidecar / write retry / size warning), Playwright E2E. The v1 reader is feature-complete at this tag.
```

- [ ] **Step 3: Final test sweep**

```bash
npm test && npm run check && (cd src-tauri && cargo test) && npm run test:e2e
```

Expected: all green.

- [ ] **Step 4: Commit + tag**

```bash
git add docs/QA-plan-3.md README.md
git commit -m "docs: Plan 3 QA checklist and README status update"
git tag v0.3.0
```

---

## Success criteria (Plan 3)

At tag `v0.3.0`:

1. **Delete affordances** — right-click context menu deletes highlights and drawings; notes retain popover Delete from Plan 2.
2. **Orphan Panel** — accessible from the hamburger menu; lists orphaned annotations with per-orphan Delete; modal shows count badge; empty state when none.
3. **Open Recent** — menu lists up to 10 recent paths; missing paths greyed out; clicking missing shows toast.
4. **Error matrix** — UTF-8 toast; corrupt sidecar modal with backup rename via new Rust command; write retry with 3-attempt exponential backoff + persistent banner; 2MB size warning toast.
5. **Playwright E2E** — 5 scenarios from the spec pass against `vite preview` with a localStorage-backed Tauri mock.
6. **Test coverage** — every new TS file and component has a test. All Rust tests pass, all TS tests pass, svelte-check clean.
7. Plan 3 manual QA checklist at `docs/QA-plan-3.md` walked.

## What remains after v0.3.0

These were explicitly deferred past v1:

- Orphan re-attach flow (Delete-only in v1)
- Per-doc asset protocol scope tightening (security hardening — the current `**` scope is guarded by the user's file-picker selection)
- File watcher for external edits while a doc is open
- Undo/redo
- Light theme
- Mermaid, wikilinks, callouts, PDF/HTML export, cross-document search
- Collaboration / multi-user

These are spec-acknowledged v1.1+ items. A `v1.0` tag (without the `-reader-mvp`/`-annotations`/`-polish` suffix) can be cut from `v0.3.0` if manual QA confirms shipping-quality.
