<div align="center">
  <img src="assets/logo-remarkdown.svg" alt="remarkdown" width="600">
</div>

# remarkdown

> **A desktop reader for markdown documents with PDF-style annotations** — highlight, sticky-note, and doodle on top of your docs. Annotations save as a human-readable JSON sidecar next to the source file.

![Status: Beta](https://img.shields.io/badge/status-beta-2ea44f)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4)
![Built with Tauri 2](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri)
![Built with Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte)
![License: TBD](https://img.shields.io/badge/license-TBD-lightgrey)

> 🟢 **Beta.** The full v1 feature set is shipped, tested (246 unit/component tests + 6 Rust tests + 6 Playwright E2E scenarios, zero `svelte-check` warnings), and stable enough for daily reading. Polish is ongoing — bug reports welcome.

---

## ⬇️ Download

Pre-built Windows installers are published with each tagged release. Grab the latest from the **[Releases page](../../releases/latest)**:

- `remarkdown_<version>_x64-setup.exe` — NSIS installer (lighter, recommended)
- `remarkdown_<version>_x64_en-US.msi` — MSI installer (for managed environments)

Both produce the same app. After installing, launch **remarkdown** from the Start menu — drop a `.md` file onto the window or use the menu to open one.

> Prefer to build from source or run in dev mode? See [Getting started](#-getting-started) below.

---

## ✨ Why remarkdown?

When you're reading a technical spec, a paper, or a book chapter in markdown, you often want to **highlight key passages**, **scribble in the margins**, and **leave sticky notes** — the same mental model you'd use with a paper book or a PDF. Most markdown viewers are read-only, and most annotation tools require converting to PDF first.

remarkdown reads plain markdown from disk, renders it in a clean dark UI, and lets you annotate on top. Your annotations save **alongside** the source file as a plain-text JSON sidecar — so they stay with your notes, survive document edits where possible, and can be read back by any tool (including LLMs) without the original document loaded.

---

## 🎨 Features

### Annotation
- **🖍 Highlights** in 5 preset colors, rendered via the CSS Custom Highlight API — no DOM mutation, handles overlaps cleanly
- **📝 Sticky notes** with inline textarea popovers, pinned to the right margin of anchored text
- **✏️ Freehand drawings** with SVG strokes, 5 ink colors, auto-finalized after 3 seconds of idle
- **🧹 Eraser tool** — single-click delete for any highlight, note, or drawing without confirmation
- **🔎 Robust anchoring** — W3C-style text-quote selectors with fast path (matching block) and slow path (cross-block similarity scoring); annotations re-resolve after edits where possible
- **👻 Orphan panel** — when an edit moves a phrase beyond recognition, the annotation goes to an "orphaned" list instead of being lost

### Reading
- **📂 Drag-drop** any `.md` file from Explorer onto the window to open it
- **🕘 Open Recent** menu with missing-file detection and grey-out
- **🗺 VS Code-style minimap** in the right gutter for long-document navigation
- **🔍 Zoom** with `Ctrl +` / `Ctrl -` / `Ctrl 0` — scales the entire article (and minimap) via a single CSS variable
- **🌓 Dark or light liquid-glass UI** with a frameless custom title bar, hamburger menu, and bottom tool rail — designed to disappear while you read
- **🪞 Vertical filename watermark** in the left margin (extreme size, low opacity, fades toward the article column)
- **🎬 Animated splash** on launch (skipped in test runs)

### Settings
- **⚙️ Settings panel** (hamburger → Settings…) persists 12 user preferences to `settings.json` in the OS app-data dir
- **Appearance** — dark/light theme, splash on/off, watermark on/off, watermark opacity
- **Reading** — default zoom, article column width, max recent files, reopen-last-file on launch
- **Annotation** — default highlight color, default ink color, drawing idle-finalize duration
- **Save behaviour** — sidecar write debounce
- All settings apply live; "Reset to defaults" restores everything in one click

### Storage & resilience
- **💾 Atomic sidecar writes** with configurable debounced saves; retry with exponential backoff on write failures; synchronous flush on window close
- **🛡 Error matrix** — UTF-8 toast, corrupt-sidecar backup modal, write-retry banner, 2 MB size warning
- **🧪 Battle-tested** — 246 unit/component tests, 6 Rust tests, 6 Playwright E2E scenarios, zero svelte-check warnings

---

## 🎛 Tools

| Tool | Activation | Behavior |
|------|-----------|----------|
| 🎯 **Cursor** | Default | Normal text selection; copy works |
| 🖍 **Highlight** | Tool rail | Drag-select text → highlight in current color. Right-click an existing highlight → Delete |
| 📝 **Note** | Tool rail | Click in text → amber pin + inline popover for typing. Popover has a Delete button |
| ✏️ **Draw** | Tool rail | Freehand stroke capture. 3s idle or tool-change finalizes. Right-click an existing drawing → Delete |
| 🧹 **Eraser** | Tool rail | Click any annotation to delete it instantly — no confirmation |

Color strip appears above the rail when **Highlight** or **Draw** is active (5 presets each).

---

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl +` / `Ctrl =` | Zoom in |
| `Ctrl -` | Zoom out |
| `Ctrl 0` | Reset zoom |
| `Esc` | Close popover / cancel selection |

---

## 💡 How the sidecar works

For every markdown file `foo.md`, remarkdown writes annotations to a sibling file `foo.md.remarkdown.json`:

```jsonc
{
  "_comment": "remarkdown annotations for: foo.md",
  "$schema": "remarkdown/v1",
  "document": {
    "path": "foo.md",
    "sha256": "7ac1bc…",
    "lastSeenBytes": 4821
  },
  "annotations": [
    {
      "id": "01HP8XYZ…",
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
    }
  ]
}
```

The file is git-friendly, human-editable, and semantically rich enough for an LLM to understand every annotation without the source document loaded.

---

## 🚀 Getting started

### Prerequisites

- **Node.js 20+**
- **Rust** (stable toolchain)
- Tauri 2 platform prerequisites: https://v2.tauri.app/start/prerequisites/

### Run in development

```bash
git clone https://github.com/kaislate/remarkdown.git
cd remarkdown
npm install
npm run tauri dev
```

> ⏱ First cold build compiles the Rust toolchain + Tauri dependencies — expect **3–8 minutes**. Subsequent launches are ~5 seconds.

### Build a release installer

```bash
npm run tauri build
```

Produces platform-native installers in `src-tauri/target/release/bundle/`:
- `bundle/nsis/remarkdown_<version>_x64-setup.exe`
- `bundle/msi/remarkdown_<version>_x64_en-US.msi`

---

## 🗺 Roadmap

### ✅ Beta (current)
- Reader MVP with Shiki syntax highlighting + KaTeX math + footnotes + task lists + tables + relative images
- All four annotation types (highlight, note, drawing, eraser) with save/load round-trip
- Anchoring with orphan detection and panel
- Full error matrix and resilience: UTF-8 toast, corrupt-sidecar backup modal, write-retry banner, 2 MB size warning
- Drag-and-drop file opening, Open Recent menu, minimap, zoom, frameless window, splash screen
- Settings panel with persistent preferences (12 settings across appearance, reading, annotation, save behaviour)
- Dark and light themes
- Vertical filename watermark in the left margin
- Playwright E2E coverage of the spec scenarios

### 🔮 Post-beta (deferred)
- **Re-attach** orphaned annotations to their new locations
- **File watcher** for external edits while reading
- **Undo/redo** action log
- **Per-doc asset protocol scope** tightening (security hardening)
- **Mermaid** diagrams, Obsidian-style callouts, wiki-links
- **PDF/HTML export** with baked-in annotations
- **Cross-document commands** — *"summarize highlights across these N files"*
- **Collaboration** — real-time sync / multi-user annotations

---

## 🧪 Testing

```bash
npm test              # 246 Vitest unit + component tests
npm run check         # svelte-check (0 errors, 0 warnings)
npm run test:e2e      # 6 Playwright end-to-end scenarios
cd src-tauri && cargo test   # 6 Rust tests
```

---

## 🛠 Tech stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Shell | **Tauri 2.x** | ~5–10 MB installer, native file dialogs, Rust host, auto-updating WebView2 on Windows |
| UI framework | **Svelte 5** (runes) + Vite | Compiled away, small runtime, clean reactive primitives |
| Markdown | **markdown-it** + footnote + task-lists + KaTeX | Mature, plugin-rich, easy to extend |
| Syntax highlight | **Shiki** 1.x (WASM, github-dark) | Real VS Code themes, dark-friendly |
| Math | **KaTeX** via `@vscode/markdown-it-katex` | Fast, no server |
| Anchoring | W3C-style **text-quote selector** | Robust to edits, graceful orphaning |
| Validation | **Zod** | Runtime-validated loads, typed TS output |
| Highlights rendering | **CSS Custom Highlight API** | No DOM mutation, browser-native overlap handling |
| Tests | **Vitest** + `@testing-library/svelte` + **Playwright** | Unit / component / e2e |

---

## 📁 Project layout

```
remarkdown/
├── src/                     # Svelte 5 frontend
│   ├── lib/                 # Pure TS modules (anchoring, renderer, save, schema, …)
│   ├── components/          # Svelte components (Viewer, ToolRail, layers, modals, …)
│   ├── stores/              # Reactive state (doc, annots, tool, toasts, modals, …)
│   └── styles/              # Theme tokens (dark + light) + glass mixins + CSS highlight rules
├── src-tauri/               # Rust host
│   └── src/                 # Invoke commands, atomic sidecar writes, recent-files persistence
├── tests/
│   ├── unit/                # Vitest unit tests
│   ├── component/           # @testing-library/svelte component tests
│   └── e2e/                 # Playwright end-to-end + support/
└── README.md                # This file
```

---

## 🤝 Contributing

remarkdown is a personal project right now. If you find a bug or want a feature, please open an issue **before** opening a PR so we can talk about scope.

---

## 📜 License

TBD. Will settle on a license before a stable `v1.0` tag ships.

---

<div align="center">

🖍 · 📝 · ✏️ · 🧹

*Read well. Mark well. Keep your thoughts where your source lives.*

</div>
