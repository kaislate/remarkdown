# remarkdown — Project State (live reference)

> **Purpose of this doc:** Onboard a fresh agent (or a returning one after a long gap) on what `remarkdown` is, where it stands today, the running architecture, where to find things, and which conventions / patterns you should follow when you make changes. **Read this first before you touch code.**
>
> If something here disagrees with what `git log` and the code say, **the code is the source of truth** — but please update this document when you find drift.

---

## What it is

A standalone desktop reader for Markdown documents with PDF-style annotations: highlights, sticky notes, freehand drawings. Annotations save next to the source `.md` as a JSON sidecar (`<file>.md.remarkdown.json`) — git-friendly, human/LLM-readable.

- Stack: **Tauri 2** (Rust host) + **Svelte 5** (runes) + **Vite** + **TypeScript**
- Markdown: **markdown-it** (+ footnote, task-lists, KaTeX) + **Shiki** (github-dark, WASM)
- Validation: **Zod**
- Tests: **Vitest** (unit + component) + **Playwright** (E2E) + Rust `cargo test`
- Platform target: **Windows primary**; macOS/Linux via Tauri's cross-platform build (untested)
- Repo: https://github.com/kaislate/remarkdown — public, alpha
- Working directory: `C:\Documents\NEw project\Project 7\remarkdown`
- Default branch: `main`

---

## Current version & roadmap

| Tag | What landed |
|-----|-------------|
| `v0.1.0-scaffold` | Tauri+Svelte project scaffold |
| `v0.1.0-reader-mvp` | Plan 1 — open + render markdown (Shiki / KaTeX / images / footnotes) |
| `v0.2.0-annotations` | Plan 2 — anchoring, highlights, notes, drawings, sidecar round-trip |
| `v0.3.0` | Plan 3 — orphan panel, Open Recent, error matrix (corrupt sidecar / write retry / size warning), Playwright E2E |
| _(untagged head)_ | Iterative UI polish: minimap (VS Code-style), frameless window with custom title bar, zoom controls, eraser tool, file drop, splash screen |

**The v1 spec** (`docs/superpowers/specs/2026-04-21-remarkdown-design.md`) is feature-complete or explicitly deferred. Post-v0.3.0 work is iterative polish driven by manual user testing — no formal plan docs for these.

**Most recent commits (newest first):**

```
ba46587 style(splash): make ark/own elevated baseline intentional
e5dfd94 feat: splash screen — Re.md morphing into Remarkdown
bfc1bf0 feat: open .md files dropped from the OS file explorer
0324cf2 fix(eraser): pin clicks now work; eraser also deletes highlights
415a0de feat: eraser tool — single-click delete for drawings and notes
c6d8772 fix(DrawLayer): left-button only; right-click delete reaches margins
e40de22 feat: zoom controls for the reading canvas (minimap stays accurate)
11b9517 fix(viewer): cap text-frame left margin (wide windows)
… (PR #6) UI polish: drag fix, wider minimap with toggle, content card
… (PR #5) frameless window + custom title bar
… (PR #4) VS Code-style minimap
```

---

## Test counts (as of head)

- **TS unit + component (Vitest):** 213 passing in 32 files
- **Rust tests:** 6 passing
- **Playwright E2E:** 6 passing (1 smoke + 5 spec scenarios)
- **svelte-check:** 0 errors, 0 warnings (203 files)

The user expects all four to stay green on every change. **Always run them after edits.**

---

## Repo layout

```
remarkdown/
├── src/
│   ├── App.svelte                 # root: mounts every chrome component
│   ├── main.ts                    # Svelte mount + beforeunload save flush
│   ├── lib/
│   │   ├── anchoring.ts           # W3C text-quote anchor + resolve (correctness core)
│   │   ├── MarkdownRenderer.ts    # markdown-it + Shiki + KaTeX + block-id tagging + img-src rewrite
│   │   ├── schema.ts              # Zod schemas + TS types (Annotation, Sidecar, Tool union)
│   │   ├── sidecar.ts             # loadSidecar / serializeSidecar / emptySidecar
│   │   ├── save.ts                # debounced (500ms) save + 3× retry + persistentSaveError + size warn
│   │   ├── tauri-api.ts           # typed wrapper around invoke() — snake→camel for read_document
│   │   ├── positioning.ts         # pinPosition() helper
│   │   ├── minimap-math.ts        # PURE geometry for minimap: scale, translate, indicator
│   │   └── file-drop.ts           # OS-level drag-drop → loadDocument
│   ├── stores/
│   │   ├── doc.ts                 # current doc + loader (parses sidecar, bumps docEpoch)
│   │   ├── annots.ts              # writable<Annotation[]> + CRUD + resolved/orphaned partitions
│   │   ├── tool.ts                # ToolState (mode + per-tool color)
│   │   ├── recent.ts              # recent-files list + existence check
│   │   ├── toasts.ts              # info/warning/error toasts (errors persist; rest auto-dismiss 4s)
│   │   ├── modals.ts              # activeModal: 'orphans' | 'corrupt-sidecar' | null
│   │   ├── viewport.ts            # viewerScroll element ref (Minimap subscribes)
│   │   └── ui.ts                  # minimapShown + zoomLevel (persisted to localStorage)
│   ├── components/
│   │   ├── Viewer.svelte          # .scroll → .content → .text-frame (+ HighlightLayer + NoteLayer) + DrawLayer
│   │   ├── HighlightLayer.svelte  # CSS Custom Highlight API; selection→create; right-click & eraser delete
│   │   ├── NoteLayer.svelte       # absolute-positioned amber pins + popovers; eraser deletes on click
│   │   ├── NotePopover.svelte     # textarea + Delete
│   │   ├── DrawLayer.svelte       # SVG overlay; pointer-capture stroke; idle-finalize; right-click & eraser delete
│   │   ├── ToolRail.svelte        # bottom-center glass pill (5 tools: cursor, highlight, note, draw, eraser)
│   │   ├── ColorStrip.svelte      # color picker (highlight & draw modes only)
│   │   ├── GlassMenu.svelte       # top-left hamburger: Open, Orphaned Annotations, Open Recent
│   │   ├── OrphanPanel.svelte     # modal lists orphaned annotations + delete
│   │   ├── CorruptSidecarModal.svelte  # backup-and-start-fresh flow
│   │   ├── ErrorBanner.svelte     # persistent banner when save retries exhaust
│   │   ├── Toasts.svelte          # top-right stack
│   │   ├── TitleBar.svelte        # frameless drag strip + window control buttons
│   │   ├── Minimap.svelte         # VS Code-style scaled clone with viewport indicator + toggle pill
│   │   ├── ZoomControls.svelte    # bottom-left −/100%/+ pill
│   │   └── Splash.svelte          # Re.md → Remarkdown reveal animation
│   └── styles/
│       ├── theme-dark.css         # CSS vars, fonts, --zoom drives root font-size
│       ├── glass.css              # .glass + .glass-pill mixins
│       ├── highlights.css         # ::highlight(rmd-hl-N) rules per preset color
│       └── article.css            # SHARED .md-rendered styles (viewer + minimap clone)
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                # tauri::Builder, plugin init, invoke handlers
│   │   ├── commands.rs            # open_file_dialog, read_document, write_sidecar, push/list/clear_recent,
│   │   │                          # check_paths_exist, backup_corrupt_sidecar
│   │   ├── sidecar.rs             # atomic_write helper (tempfile::persist + unix dir fsync)
│   │   └── recent.rs              # JSON list at app_data_dir, MAX_RECENT=10, atomic_write
│   ├── capabilities/
│   │   └── default.json           # GRANTS window/drag/min/max/close perms — REQUIRED for window controls
│   ├── tauri.conf.json            # decorations:false (frameless), assetProtocol scope:["**"]
│   └── Cargo.toml                 # tauri 2.x + protocol-asset feature, sha2, tempfile, etc.
├── tests/
│   ├── unit/                      # Vitest unit tests (lib + stores)
│   ├── component/                 # Vitest @testing-library/svelte
│   ├── e2e/
│   │   ├── scenarios.spec.ts      # 5 spec scenarios from Plan 3
│   │   ├── smoke.spec.ts          # app loads
│   │   └── support/tauri-mock.ts  # localStorage-backed @tauri-apps/api/core mock for vite-preview
│   ├── fixtures/                  # sample .md files + sidecars
│   └── setup.ts                   # jest-dom + CSS Custom Highlight API shim
├── docs/
│   ├── superpowers/
│   │   ├── specs/2026-04-21-remarkdown-design.md     # original v1 spec (source of truth for v1)
│   │   └── plans/                                    # 3 plan docs, executed
│   ├── QA-plan-{1,2,3}.md         # manual QA checklists per plan
│   └── PROJECT-STATE.md           # this file
├── playwright.config.ts
├── vite.config.ts                 # mode==='e2e' aliases @tauri-apps/api/core to the mock
├── vitest.config.ts               # standalone (NOT mergeConfig from vite.config; vite is now a callback)
├── package.json                   # scripts: dev / build / build:e2e / preview / preview:e2e / test / test:e2e / check / tauri
└── README.md                      # GitHub landing page (alpha-flagged)
```

---

## Architecture & key invariants

### The annotation pipeline

1. User opens a `.md` via menu / Open Recent / drag-drop → Rust `read_document` reads file + sha256 + sidecar.
2. `loadDocument(path)` (in `stores/doc.ts`) parses the sidecar through `loadSidecar()` (Zod-validated) and dumps the annotations into the `annots` store. Bumps `docEpoch`.
3. `Viewer` mounts the article, publishes `articleEl` to `currentViewerRoot` and `.scroll` to `viewerScroll`.
4. `resolvedAnnots` / `orphanedAnnots` derived stores re-resolve every annotation against the live DOM (via `anchoring.resolveAnchor` for highlights/notes, or `[data-block-id]` lookup for drawings). They re-run on `docEpoch` ticks so a re-render forces a refresh.
5. `HighlightLayer` registers ranges with `CSS.highlights`. `NoteLayer` renders absolute-positioned pins. `DrawLayer` renders SVG paths.
6. Any change to `annots` triggers `save.ts`'s subscriber → 500ms debounce → atomic write via Rust → `savedPulse` updates → "saved" pulse in the corner.

### Anchoring (the correctness core)

`src/lib/anchoring.ts`: W3C text-quote selector with `text + prefix + suffix + blockHint`. Two paths:
- **Fast:** scope to the hinted block, find single occurrence, return Range.
- **Slow:** scan all blocks, score candidates by `headMatch(suffix)` + `trailMatch(prefix)` (each n / max(a, b)). Reject if best score < 0.7 or doesn't beat second-best by ≥ 0.08. Returns null on ambiguity → annotation goes to `orphaned`.

**DO NOT** change the denominator from `Math.max` to `Math.min` — opus caught this once already; min normalization makes any 1-char punctuation match score 1.0, silently misanchoring.

### Tools (5)

```ts
type Tool = 'cursor' | 'highlight' | 'note' | 'draw' | 'eraser';
```

- **Cursor:** plain text selection works (for copy/paste).
- **Highlight:** drag-select → mouseup → creates annotation; CSS Custom Highlight API renders. Right-click for delete menu.
- **Note:** click → drops amber pin at the click word + opens popover for body. Click pin to toggle popover. Popover Delete removes.
- **Draw:** SVG stroke capture; finalizes after 3s idle OR tool change. Right-click stroke for delete menu. Anchored to block under stroke centroid.
- **Eraser:** **single-click** deletes drawings, notes, AND highlights. Routed via document-level capture handlers in DrawLayer + HighlightLayer (both check tool mode and stop propagation if they erase). Pin clicks are deferred to NoteLayer's pin onclick. Body gets `eraser-cursor` class for global cursor.

### Frameless window & TitleBar

`tauri.conf.json` has `decorations: false`. `TitleBar.svelte` provides:
- `.titlebar-drag` — middle band at z:50 (BELOW hamburger z:100 so menu clicks aren't intercepted), uses explicit `getCurrentWindow().startDragging()` on pointerdown (not the `data-tauri-drag-region` attribute, which proved unreliable).
- `.titlebar-controls` — top-right minimize/maximize/close buttons in a glass pill at z:180.
- `.controls-aura` — subtle animated lavender gradient (9s loop, ±12px translate, 1↔1.08 scale) at z:170 to mark the controls area without a hard pill.

**Capabilities (`src-tauri/capabilities/default.json`) MUST grant** `core:window:allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close`, etc. Tauri 2 silently fails IPC calls without these.

### Minimap

`Minimap.svelte` renders a scaled clone of `$doc.html` at the right edge:
- 140px wide, floating with margins (top: 52px, right: 16px, bottom: 52px), fully rounded glass.
- Toggle pill on the left edge (slides minimap off-right when collapsed; persisted in `ui.ts`).
- The clone gets the SAME `padding: 96px 48px 160px` and `width: 720px` as the real article, so the clone's box totals 816px — must use `VIEWER_OUTER_WIDTH = 816` in the scale math (not 720, the content-only width).
- `minimap-math.ts` is pure: `computeMinimapLayout(scrollTop, scrollHeight, clientHeight, contentWidth, mapWidth, mapHeight) → { scale, translateY, indicatorTop, indicatorHeight }`. Tests pin all the edge cases.

**Both viewer article and minimap clone share the `md-rendered` class + `src/styles/article.css`.** Don't put article content styles inside `Viewer.svelte`'s scoped CSS — the clone won't inherit them and the indicator math breaks.

### Layout / drawing canvas

```
.scroll (100vw, 100vh, overflow-y:auto, flex justify-content:center, align-items:flex-start, padding-right:172px)
  .content (width:100%, min-height:100vh)
    .text-frame (max-width:720, margin-left: clamp(0, calc((100% - 720) / 2), 140px), margin-right:auto)
      article.viewer.md-rendered  (width:100%, padding:96px 48px 160px)
      <HighlightLayer/>  (CSS.highlights — no DOM)
      <NoteLayer/>       (absolute pins, z-index:5)
    <DrawLayer/>         (SVG covers full .content; pe:auto only when active=draw)
```

**Why these specifics matter:**
- `align-items: flex-start` so .content grows past 100vh for long docs (otherwise DrawLayer SVG was viewport-clipped).
- `padding-right: 172px` reserves the minimap region so centered content doesn't crash into it.
- `margin-left: clamp(...)` caps the left empty space to 140px on wide windows.
- DrawLayer is a **sibling** of `.text-frame`, not inside it, so the draw tool can paint across the full canvas (including margins outside the text column). Highlight/Note layers stay inside `.text-frame` because pin positioning depends on viewer-rect coords.
- `.note-pin { z-index: 5 }` defensive bump so pins stay clickable above DrawLayer in any mode.

### Zoom

`src/stores/ui.ts` exports a stepped `zoomLevel` (`[0.75, 0.85, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0]`). `App.svelte` subscribes and writes `--zoom` to `:root` style. `theme-dark.css` does `html { font-size: calc(17px * var(--zoom)) }`. All article styles in `article.css` use `rem` / `em` so they scale.

**The minimap stays accurate because the clone uses the same `md-rendered` class + the same `--zoom` (it's a root-level CSS var). Both viewer and clone reflow at the new zoom equally; `scale = innerWidth / 816` is constant.**

### Save flow

`src/lib/save.ts`:
- `installSaveWatcher()` subscribes to `annots`. Skips initial emit (`firstAnnots` flag).
- On change → `scheduleSave()` → 500ms debounce → `doSave()` → `writeSidecar` (atomic in Rust).
- Retries up to 3× with backoff `[100, 400, 1600]` ms.
- After max retries → `persistentSaveError` set → `ErrorBanner` shows.
- Success clears `persistentSaveError` and bumps `savedPulse`.
- Size check: warns once per doc when serialized JSON exceeds 2 MB.
- `flushSave()` is sync-equivalent and called from `main.ts`'s `beforeunload` listener (skipped under `MODE === 'e2e'`).

### File drop

`src/lib/file-drop.ts` subscribes to `getCurrentWebview().onDragDropEvent()`. Picks the first path matching `/\.(md|markdown)$/i`, calls `loadDocument` + `recordRecent`. Toasts on no-md or load failure. Wrapped in try/catch so it's a no-op outside Tauri.

### Splash

`src/components/Splash.svelte`. Animation timing in the file's constants. Skipped in e2e mode (`{#if import.meta.env.MODE !== 'e2e'}` in App.svelte) so Playwright doesn't sit through the 2.4s reveal on every test.

The "ark" and "own" sit slightly above the baseline — this is **intentional**, locked in via explicit `transform: translateY(-0.04em)`. Don't "fix" the alignment.

---

## Working conventions / gotchas

### svelte-check / TypeScript

`tsconfig.json` covers production scope (`src/`); `tsconfig.test.json` carries vitest globals + jest-dom types. References array was REMOVED from root tsconfig because svelte-check on Node 24 stack-overflowed on TS composite refs. Don't re-add.

### Svelte 5 runes

- Use `$state`, `$effect`, `$derived`, `$props` in `.svelte` files.
- Use `writable()` from `svelte/store` for cross-component state (rune-based modules + Svelte stores both work; we use stores for everything cross-component).
- `$effect` is async (microtask). For test synchronicity prefer `.subscribe()` over `$effect` when you need to react to store changes _and_ the test asserts immediately. Both `HighlightLayer` and `Minimap` use this pattern.
- `flushSync(() => store.set(...))` in tests forces template reactivity to commit before DOM queries.

### `userEvent` + fake timers

`userEvent` v14 hangs under `vi.useFakeTimers()`. Use `userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })` in tests that need both.

### jsdom gaps to be aware of

| Missing | Workaround |
|---|---|
| `PointerEvent` constructor | Synthesize via `new Event(type); e.button = 0; e.clientX = ...; e.pointerId = 1; e.pointerType = 'mouse'` (see `pe()` helper in DrawLayer test) |
| `CSS.highlights` / `Highlight` | `tests/setup.ts` shim — `Map`-based |
| `setPointerCapture` | `try { ... } catch {}` |
| `elementFromPoint` | Returns null/throws — `try { ... } catch {}` and fall back to `root.querySelector('[data-block-id]')` |
| Layout (clientWidth, scrollHeight) | Mock with `Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true })` |
| `getBoundingClientRect` | Override the method directly on the element under test |

### E2E (Playwright) setup

Runs against `vite preview --port 4173` in vanilla Chromium. `vite.config.ts` uses a `mode === 'e2e'` alias to swap `@tauri-apps/api/core` for `tests/e2e/support/tauri-mock.ts` — a localStorage-backed mock implementing `invoke('open_file_dialog'|'read_document'|'write_sidecar'|...)`.

Helpers exposed on `window` for tests to drive state: `__E2E_SEED_DOC__(path, md)`, `__E2E_SET_DIALOG_PATH__(path)`, `__E2E_CLEAR_ALL__()`.

In `App.svelte`/`main.ts`, several side-effects are guarded by `import.meta.env.MODE !== 'e2e'` to keep Playwright runs fast and deterministic: `beforeunload` flushSave, the `Splash` mount.

### CRLF warnings

The repo is Windows-side; `git add` always emits LF→CRLF warnings. Cosmetic, ignore.

### A user-content sidecar leak

The user has been annotating `docs/QA-plan-1.md` and `docs/QA-plan-2.md` while testing the app — those produce `.remarkdown.json` sidecars next to the QA docs that show up as untracked files. Ignore them in `git status` output; they're personal working state, not project artifacts.

---

## Tauri 2 idioms specific to this project

- **Capabilities are required for window IPC** — see `src-tauri/capabilities/default.json`. If a Tauri JS API silently does nothing, suspect a missing permission first.
- **Window flags:** `decorations:false`, `transparent:false`. Drag-drop is enabled by default (we don't override).
- **Plugins:** `tauri-plugin-dialog`, `tauri-plugin-fs` initialized in `main.rs`. We mostly route through our own custom Rust commands rather than plugin commands directly.
- **`@tauri-apps/api/window` vs `webview`:** `getCurrentWindow()` for window ops (drag, minimize, etc.); `getCurrentWebview()` for `onDragDropEvent`. Both work; just use the right import.

---

## Where to look for things first

| Question | Look at |
|---|---|
| Why is X behavior weird? | The component file for X (e.g., `DrawLayer.svelte`) — comments explain non-obvious choices |
| What's the spec of behavior X? | `docs/superpowers/specs/2026-04-21-remarkdown-design.md` |
| How was X built originally? | The plan doc in `docs/superpowers/plans/` for the relevant plan |
| Why does this CSS rule exist? | The PR description / commit message; or the comment near the rule |
| What's the data model? | `src/lib/schema.ts` (Zod source of truth) |
| Is there a test for X? | Match the file path: `src/foo/bar.ts` → `tests/unit/bar.test.ts` (or `tests/component/`) |
| How do annotations resolve? | `src/lib/anchoring.ts` + `src/stores/annots.ts` `partition()` |
| How does the minimap track? | `src/lib/minimap-math.ts` — pure helpers + `Minimap.svelte` updateLayout |
| How does saving work? | `src/lib/save.ts` — debounce, retry, size warn, snapshot dedup |

---

## Working agreements (observed from the user's preferences)

- **Tests are real.** Always run `npm test`, `npm run check`, `cd src-tauri && cargo test`, and `npm run test:e2e` after changes. The user expects a clean sweep.
- **Small, focused commits with good messages.** Multi-paragraph commit message body explaining WHY, not just WHAT.
- **Direct-to-main is OK for clear iterative tweaks.** PR-then-merge is reserved for larger feature batches. Recent UI polish has been direct-to-main.
- **Ask before risky/visible actions.** Public repo / merging visible PRs / breaking visible UX should be confirmed first.
- **Implement, then summarize.** When done, give a tight bullet list of what changed and what to look for. Avoid emojis unless the user asked (the README has them because they explicitly requested).
- **The user iterates from screenshots.** When they share `C:\Users\kaislate\Pictures\Screenshots\...`, read it before responding — it usually contains the precise failure mode.
- **The user is a thoughtful collaborator who gives focused feedback.** They notice details. Take them at their word.

---

## Currently-open follow-ups (none blocking)

Nothing critical is broken. Recent stable additions all have tests + green check. The user's last message acknowledged the splash's slightly-elevated `ark`/`own` baseline as a happy accident worth keeping (locked in via explicit `translateY(-0.04em)` per `ba46587`).

If you (the agent) just resumed and the user is asking for something new, **start by reading their message carefully and asking for clarification on anything ambiguous** — the user values precision over assumptions and is happy to answer questions before you start.

---

*Last updated: HEAD = `ba46587` on `main`. Update this file when you make material architectural changes or land features that change how a fresh agent should reason about the codebase.*
