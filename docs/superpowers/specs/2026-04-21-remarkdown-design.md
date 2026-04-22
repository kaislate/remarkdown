# remarkdown — Design Spec

**Date:** 2026-04-21
**Status:** Approved — ready for implementation planning

## Overview

remarkdown is a standalone desktop app for reading markdown documents with PDF-style annotation: highlights, sticky notes, and freehand drawings layered on top of the rendered document. Annotations persist in a human- and LLM-readable side-car JSON file stored next to the source `.md`, so notes can be read back by Claude (or any tool) in future sessions.

It is a **reader-first** personal study tool, not a collaborative review tool and not a markdown editor.

## Goals

- Open any `.md` file on disk, render it beautifully (dark liquid-glass UI), and let the user annotate on top as they read.
- Store annotations in a side-car JSON that is plain text, git-friendly, and semantically rich enough for an LLM to understand each annotation without the source document loaded.
- Ship as a native installable app (Windows primary, macOS/Linux via Tauri's cross-platform build).
- Keep the UI chrome minimal so reading space dominates.

## Non-goals (deferred past v1)

- Editing markdown source inside the app
- Folder/vault browsing, tabs, multi-document workspaces
- Collaboration / real-time sync / multi-user annotations
- Undo/redo stack
- File-watcher for external edits while a doc is open
- Concurrent-window edits on the same file
- Mermaid diagrams (add when a real document needs them)
- Wiki-links, Obsidian-style callouts, custom themes (light mode is acceptable later; dark is v1)
- PDF / HTML export of annotated documents
- Cross-document search or "summarize highlights across N files" features

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Shell | Tauri 2.x | ~5–10 MB installer, native file dialogs, Rust host |
| UI framework | Svelte 5 + Vite | Compiles away, small runtime, clean state stores, official Tauri template |
| Markdown | `markdown-it` + plugins (footnote, task-lists, KaTeX) | Mature, plugin-rich, easy to extend |
| Syntax highlight | Shiki (WASM, `github-dark` theme) | Uses real VS Code themes, dark-friendly |
| Math | KaTeX via `markdown-it-katex` | Fast, no server |
| Draw surface | SVG overlay (pointer events) | Vector, small serialization, pressure-capable later |
| Anchoring | W3C-style text quote selector (text + prefix + suffix + blockHint) | Robust to edits, graceful orphaning |
| JSON schema | Zod | Runtime-validated loads, typed TS output |
| Test | Vitest + @testing-library/svelte + Playwright | Unit / component / e2e |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Tauri Rust host (src-tauri/)                        │
│  Commands (allowlisted):                            │
│   • open_file_dialog() → path                       │
│   • read_document(path) → { markdown, sidecar, sha }│
│   • write_sidecar(path, json)                       │
│   • push_recent(path) / list_recent() / clear_recent│
│   • open_settings_dir() (for future extension)      │
│  Owns:                                              │
│   • recent-files store (JSON in app data dir)       │
│   • atomic writes (.tmp → fsync → rename)           │
└────────────▲────────────────────────────────────────┘
             │ Tauri invoke() (async, typed via tauri-api.ts)
┌────────────┴────────────────────────────────────────┐
│ Svelte frontend (src/)                              │
│                                                      │
│  Components                                         │
│    App → Viewer → { MarkdownRenderer, HighlightLayer│
│                     NoteLayer, DrawLayer }          │
│                → GlassMenu, ToolRail, ColorStrip    │
│                                                      │
│  Stores                                             │
│    doc     { path, sha256, markdown, html, blocks } │
│    annots  Annotation[]                             │
│    tool    { mode: "cursor"|"highlight"|"note"|"draw"│
│              color }                                 │
│    recent  string[]                                 │
│                                                      │
│  Utility modules (pure, unit-tested)                │
│    anchoring.ts  (anchor + resolve)                 │
│    sidecar.ts    (load/save + schema validation)    │
│    tauri-api.ts  (typed wrapper around invoke)      │
└─────────────────────────────────────────────────────┘
```

**Boundary invariant**: the Svelte frontend never touches the filesystem directly — every read/write goes through a Tauri command. This keeps the security allowlist tight and makes the frontend testable without a real OS.

**Two files per document on disk**:

```
~/papers/on-reading-well.md                    ← source, never modified by remarkdown
~/papers/on-reading-well.md.remarkdown.json    ← annotations, atomically rewritten
```

## UI / visual design

Layout **C** approved: tiny glass hamburger in top-left, floating glass pill tool-rail centered at the bottom. Dark-mode-first (near-black canvas with subtle purple/blue ambient glow for glass refraction).

- Menu (glass, popover on click): **Open…** / **Open Recent** (list of 10 most recent, grey out missing files) / **Orphaned Annotations…** (appears when the current doc has orphans) / **Settings**.
- Tool rail (glass pill, bottom-center): **Cursor** / **Highlight** / **Sticky Note** / **Draw**. Cursor mode disables annotation gestures so text can be selected for copy.
- Color strip (glass, appears above rail when Highlight or Draw is active): five preset colors; selection persists per-tool.
- Highlights: soft translucent color fill with an inset glow.
- Sticky notes: small amber round pin at anchor position; click to open glass popover with inline textarea + delete.
- Drawings: SVG strokes rendered above the document content. SVG has `pointer-events: none` unless Draw tool is active, so text selection is preserved.
- Subtle "saved" pulse near the menu whenever the sidecar is written.

## Components

| Component | Responsibility | Consumes |
|---|---|---|
| `App.svelte` | Root layout, mounts viewer + chrome | All stores |
| `Viewer.svelte` | Scroll container, hosts rendered HTML + layers | `doc` |
| `HighlightLayer.svelte` | Wraps resolved ranges in `<mark>`; creates on select | `annots`, `tool` |
| `NoteLayer.svelte` | Renders pins; opens/edits NotePopover | `annots`, `tool` |
| `NotePopover.svelte` | Inline textarea for note body; delete button | props from NoteLayer |
| `DrawLayer.svelte` | SVG overlay, captures strokes when Draw active | `annots`, `tool` |
| `GlassMenu.svelte` | Hamburger + popover menu | `recent`, `doc`, triggers commands |
| `ToolRail.svelte` | Glass pill with 4 tool buttons | `tool` |
| `ColorStrip.svelte` | Color picker shown above rail | `tool` |
| `OrphanPanel.svelte` | Modal listing orphaned annotations for re-attach/delete | `annots` |

Pure modules (no DOM):

- `MarkdownRenderer.ts` — `render(md: string): { html, plaintext, blocks }`
- `anchoring.ts` — `anchor(range, doc): AnchorObj` / `resolve(anchor, doc): Range | null`
- `sidecar.ts` — `load(json: string): Sidecar | Error` / `serialize(annots): string`
- `tauri-api.ts` — typed wrapper around every `invoke()` call

## Data model

### Sidecar JSON (`<file>.md.remarkdown.json`)

The file is strict JSON. A `_comment` string at the top serves as the human-readable preamble you or Claude see when opening the file raw.

```json
{
  "_comment": "remarkdown annotations for: on-reading-well.md — edit with care",
  "$schema": "remarkdown/v1",
  "document": {
    "path": "on-reading-well.md",
    "sha256": "7ac1…",
    "lastSeenBytes": 4821
  },
  "annotations": [
    {
      "id": "01HP8XYZ…",                         // ULID, sortable by time
      "type": "highlight",
      "color": "#ffd25a",
      "anchor": {
        "text": "must read slowly, and with care",
        "prefix": "The reader who would truly understand ",
        "suffix": ", turning the pages back when needed.",
        "blockHint": "p:3"
      },
      "createdAt": "2026-04-21T14:32:00Z",
      "updatedAt": "2026-04-21T14:32:00Z"
    },
    {
      "id": "01HP8ABC…",
      "type": "note",
      "anchor": { "text": "…", "prefix": "…", "suffix": "…", "blockHint": "p:4" },
      "body": "This is the thesis of the whole essay.",
      "createdAt": "…",
      "updatedAt": "…"
    },
    {
      "id": "01HP8DEF…",
      "type": "drawing",
      "anchorBlock": "p:4",
      "caption": "arrow pointing at 'dialogue'",
      "strokes": [
        { "color": "#d6336c", "width": 2, "points": [[12,40],[13,41],[20,60]] }
      ],
      "createdAt": "…",
      "updatedAt": "…"
    }
  ]
}
```

Fields are validated with Zod on load. Unknown fields are preserved but not acted on (forward compatibility).

### Anchoring strategy

Every text annotation stores:

- `text` — the actual annotated text (the main anchor)
- `prefix` — 32 chars of plaintext immediately before
- `suffix` — 32 chars of plaintext immediately after
- `blockHint` — the `data-block-id` of the containing block (e.g., `"p:3"`, `"h:2"`, `"li:5"`)

On load, `resolve()` runs per annotation:

1. **Fast path** — if `document.sha256` matches the current file hash, assume anchors resolve trivially. Resolve by direct text search scoped to `blockHint` block.
2. **Slow path** — file has changed:
   1. Find all occurrences of `text` in the doc plaintext.
   2. Score each by prefix+suffix similarity (Levenshtein or longest common substring, windowed).
   3. If the best score exceeds a threshold (`0.7` default) and the next-best is meaningfully lower → accept.
   4. Otherwise → **orphan** the annotation (preserve it in the JSON, surface in `OrphanPanel`).

Drawings anchor by `anchorBlock` only; if the block still exists, the drawing renders over it. If the block is gone, the drawing is orphaned.

### Store types (TypeScript)

```ts
type Tool = "cursor" | "highlight" | "note" | "draw";

interface Anchor {
  text: string;
  prefix: string;
  suffix: string;
  blockHint: string;
}

interface BaseAnnotation {
  id: string;          // ULID
  createdAt: string;
  updatedAt: string;
}

interface Highlight extends BaseAnnotation {
  type: "highlight";
  color: string;       // hex
  anchor: Anchor;
}

interface Note extends BaseAnnotation {
  type: "note";
  anchor: Anchor;
  body: string;
}

interface Drawing extends BaseAnnotation {
  type: "drawing";
  anchorBlock: string;
  caption?: string;
  strokes: { color: string; width: number; points: [number, number, number?][] }[];
}

type Annotation = Highlight | Note | Drawing;
```

## Data flow

### Open document

1. User clicks menu → Open…
2. Svelte calls `invoke("open_file_dialog")` → path
3. Svelte calls `invoke("read_document", { path })` → `{ markdown, sidecar | null, sha256 }`
4. `render(markdown)` → `{ html, plaintext, blocks }`
5. For each annotation in sidecar, run `resolve()` against the rendered doc.
6. Partition into `resolved` and `orphaned`. Commit to `annots` store.
7. `invoke("push_recent", { path })` (best-effort).
8. Viewer re-renders reactively.

Open Recent skips step 2.

### Create annotation

All three follow: **gesture → anchor → append to `annots` → debounced save**.

- **Highlight** — tool=highlight, selection finished → build anchor from range, push `Highlight{ color: activeColor }`.
- **Note** — tool=note, click in viewer → expand click to nearest word, build anchor, push `Note{ body: "" }`, open popover immediately.
- **Drawing** — tool=draw, pointer strokes captured into SVG; on tool-change or N=3s idle, completed strokes grouped into a `Drawing` annotation with `anchorBlock` = block containing stroke centroid.

### Save (debounced 500ms)

```
annots change → scheduleSave()
  → invoke("write_sidecar", { path, json: serialize(annots) })
  → Rust: .tmp write → fsync → atomic rename
  → UI shows "saved" pulse
```

No explicit Save button. Window close triggers a synchronous final flush before Tauri closes the window.

### Edit / delete

- Note body: edit inline; debounce save.
- Delete: right-click or popover "…" menu → confirm → remove from `annots`.
- Drawings: not movable in v1 (delete + redraw).

## Rendering pipeline

```
markdown string
  → markdown-it (core + footnote + task-lists + katex)
  → code-fence block renderer: shiki.codeToHtml(code, { lang, theme: "github-dark" })
  → post-process: tag top-level children with data-block-id ("h:1", "p:2", "ul:3", …)
  → post-process: rewrite <img src> from relative → convertFileSrc(absolute)
HTML string  → set innerHTML on viewer root
```

- Block IDs are derived at render time by walking the root's top-level children in order. Not stored in the markdown source.
- Shiki uses the WASM highlighter (no external process). ~20ms overhead per load, acceptable since rendering happens only on open.
- Image `src` rewriting uses Tauri's `convertFileSrc()`. The document's directory is allowlisted as a filesystem scope at open time and revoked on next open (scope is per-doc).

## Error handling

| Failure | Behavior |
|---|---|
| File not UTF-8 | Toast: "remarkdown only supports UTF-8 `.md` files" |
| Sidecar JSON malformed | Modal: "Annotations couldn't be loaded. Back up and start fresh?" — on confirm, rename to `.remarkdown.json.corrupt-<ISO-timestamp>`, start with empty annotations |
| `.md` exists, sidecar absent | Normal — empty annotations |
| Write permission denied | Toast + exponential backoff (max 3×); if still failing, non-dismissable error banner until resolved |
| Recent file path missing | Greyed out in list; clicking removes it from recent |
| Anchor fails to resolve | Marked `orphaned`; listed in OrphanPanel with original anchor text for manual re-attach or delete |
| Close with pending save | Force-flush on `CloseRequested`; block close until save returns |
| Sidecar > 2 MB | Non-blocking toast: "Annotations are unusually large — drawings dominate the file size" |

## Testing

Three layers:

### Unit (Vitest)

- `anchoring.ts`: round-trip anchoring under document edits (insert before, insert after, insert within, delete surrounding, duplicate phrase, reflowed paragraphs). Goal: anchoring is the correctness core; test it exhaustively.
- `MarkdownRenderer`: golden-file tests against a corpus of fixture `.md` files (GFM, KaTeX, fenced code in several langs, footnotes, images, task lists, tables).
- `sidecar.ts`: schema validation accepts/rejects.

### Component (Vitest + @testing-library/svelte)

- `HighlightLayer`: given annots + fake viewer DOM, renders correct `<mark>` wrappers.
- `NoteLayer`: pins land at expected positions; click opens popover; edit updates store.
- `DrawLayer`: pointer events produce expected stroke data.
- `GlassMenu`: recent files render; greyed out state for missing files.

### End-to-end (Playwright against Tauri dev build)

5 smoke scenarios:

1. Open a fixture `.md` → content renders.
2. Highlight a phrase → close app → reopen → highlight persists.
3. Add a note → close → reopen → note persists with body intact.
4. Draw strokes with the draw tool → close → reopen → strokes persist.
5. Externally edit the `.md` (shifting a highlight's anchor text) → reopen → orphan appears in OrphanPanel.

## Project structure

```
remarkdown/
├── src-tauri/                 # Rust host
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands.rs        # invoke handlers
│   │   ├── sidecar.rs         # atomic write helpers
│   │   └── recent.rs          # recent files persistence
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                       # Svelte frontend
│   ├── App.svelte
│   ├── components/
│   │   ├── Viewer.svelte
│   │   ├── HighlightLayer.svelte
│   │   ├── NoteLayer.svelte
│   │   ├── NotePopover.svelte
│   │   ├── DrawLayer.svelte
│   │   ├── GlassMenu.svelte
│   │   ├── ToolRail.svelte
│   │   ├── ColorStrip.svelte
│   │   └── OrphanPanel.svelte
│   ├── lib/
│   │   ├── anchoring.ts
│   │   ├── MarkdownRenderer.ts
│   │   ├── sidecar.ts
│   │   ├── tauri-api.ts
│   │   └── schema.ts          # Zod schema + TS types
│   ├── stores/
│   │   ├── doc.ts
│   │   ├── annots.ts
│   │   ├── tool.ts
│   │   └── recent.ts
│   ├── styles/
│   │   ├── glass.css          # shared glass mixins
│   │   └── theme-dark.css
│   └── main.ts
├── tests/
│   ├── unit/
│   ├── component/
│   ├── e2e/
│   └── fixtures/              # sample .md files + sidecars
├── docs/superpowers/specs/
│   └── 2026-04-21-remarkdown-design.md   ← this file
├── package.json
├── vite.config.ts
└── README.md
```

## Open questions / future work

- **Light theme** — architecture supports it (CSS variables), but not in v1.
- **Drawing drag/resize** — add when freehand becomes a pain point.
- **Undo/redo** — add an action-log in the `annots` store to enable it later.
- **External-edit reconciliation** — v1 does re-resolve on reload but doesn't watch while open. A file watcher is the natural v1.1 addition.
- **Export / share** — a "bake annotations into HTML" export would be valuable and cheap to add.
- **Cross-document commands** (e.g., "Claude, summarize highlights across these three files") — the sidecar shape already supports this; needs only a file-picker + aggregation UI.
