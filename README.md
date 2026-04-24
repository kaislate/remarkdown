# 📚 remarkdown

> **A desktop reader for markdown documents with PDF-style annotations** — highlight, sticky-note, and doodle on top of your docs. Annotations save as a human-readable JSON sidecar next to the source file.

![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4)
![Built with Tauri 2](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri)
![Built with Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte)
![License: TBD](https://img.shields.io/badge/license-TBD-lightgrey)

> ⚠️ **Alpha software.** remarkdown is a personal project in active development. It works — the full v1 feature set is shipped and tested — but expect rough edges, missing polish, and occasional breakage. Not yet recommended for mission-critical reading workflows. Use on a copy of your documents first.

---

## ✨ Why remarkdown?

When you're reading a technical spec, a paper, or a book chapter in markdown, you often want to **highlight key passages**, **scribble in the margins**, and **leave sticky notes** — the same mental model you'd use with a paper book or a PDF. Most markdown viewers are read-only, and most annotation tools require converting to PDF first.

remarkdown reads plain markdown from disk, renders it in a clean dark UI, and lets you annotate on top. Your annotations save **alongside** the source file as a plain-text JSON sidecar — so they stay with your notes, survive document edits where possible, and can be read back by any tool (including LLMs) without the original document loaded.

---

## 🎨 Features

- **🖍 Highlights** in 5 preset colors, rendered via the CSS Custom Highlight API — no DOM mutation, handles overlaps cleanly
- **📝 Sticky notes** with inline textarea popovers, pinned to the right margin of anchored text
- **✏️ Freehand drawings** with SVG strokes, 5 ink colors, auto-finalized after 3 seconds of idle
- **🔎 Robust anchoring** — W3C-style text-quote selectors with fast path (matching block) and slow path (cross-block similarity scoring); annotations re-resolve after edits where possible
- **👻 Orphan panel** — when an edit moves a phrase beyond recognition, the annotation goes to an "orphaned" list instead of being lost
- **💾 Atomic sidecar writes** with debounced 500ms saves; retry with exponential backoff on write failures; synchronous flush on window close
- **🔄 Open Recent** menu with missing-file detection and grey-out
- **🌓 Dark liquid-glass UI** with a minimal hamburger + bottom tool rail, designed to disappear while you read
- **🧪 Battle-tested** — 146 unit/component tests, 6 Rust tests, 6 Playwright E2E scenarios, zero svelte-check warnings

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

Produces platform-native installers in `src-tauri/target/release/bundle/`.

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

The file is git-friendly, human-editable, and semantically rich enough for an LLM to understand every annotation without needing the source document loaded.

---

## 🎛 Tools

| Tool | Activation | Behavior |
|------|-----------|----------|
| 🎯 **Cursor** | Default | Normal text selection; copy works |
| 🖍 **Highlight** | Tool rail | Drag-select text → highlight in current color. Right-click an existing highlight → Delete |
| 📝 **Note** | Tool rail | Click in text → amber pin + inline popover for typing. Popover has a Delete button |
| ✏️ **Draw** | Tool rail | Freehand stroke capture. 3s idle or tool-change finalizes. Right-click an existing drawing → Delete |

Color strip appears above the rail when **Highlight** or **Draw** is active (5 presets each).

---

## 🗺 Roadmap

### ✅ v1 (shipped)
- Reader MVP with Shiki syntax highlighting + KaTeX math + footnotes + task lists + tables + relative images
- All three annotation types with save/load round-trip
- Anchoring with orphan detection and panel
- Full error matrix: UTF-8 toast, corrupt-sidecar backup modal, write-retry banner, 2MB size warning
- Right-click delete for highlights and drawings
- Open Recent menu with existence validation
- Playwright E2E coverage of the 5 spec scenarios

### 🔮 v1.1+ (deferred, not started)
- **Re-attach** orphaned annotations to their new locations
- **File watcher** for external edits while reading
- **Undo/redo** action log
- **Light theme** (architecture supports it via CSS variables)
- **Per-doc asset protocol scope** tightening (security hardening)
- **Mermaid** diagrams, Obsidian-style callouts, wiki-links
- **PDF/HTML export** with baked-in annotations
- **Cross-document commands** — *"summarize highlights across these N files"*
- **Collaboration** — real-time sync / multi-user annotations

See the full non-goals list in [`docs/superpowers/specs/2026-04-21-remarkdown-design.md`](docs/superpowers/specs/2026-04-21-remarkdown-design.md).

---

## 🧪 Testing

```bash
npm test              # 146 Vitest unit + component tests
npm run check         # svelte-check (0 errors, 0 warnings)
npm run test:e2e      # 6 Playwright end-to-end scenarios
cd src-tauri && cargo test   # 6 Rust tests
```

Manual QA checklists for each shipped plan live in [`docs/QA-plan-1.md`](docs/QA-plan-1.md), [`QA-plan-2.md`](docs/QA-plan-2.md), and [`QA-plan-3.md`](docs/QA-plan-3.md).

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
│   └── styles/              # Dark theme + glass mixins + CSS highlight rules
├── src-tauri/               # Rust host
│   └── src/                 # Invoke commands, atomic sidecar writes, recent-files persistence
├── tests/
│   ├── unit/                # Vitest unit tests
│   ├── component/           # @testing-library/svelte component tests
│   └── e2e/                 # Playwright end-to-end + support/
├── docs/
│   ├── superpowers/         # Design spec + implementation plans
│   └── QA-plan-*.md         # Manual QA checklists per shipped plan
└── README.md                # This file
```

---

## 🏗 Development philosophy

remarkdown was built iteratively over three self-contained plans, each producing a shippable milestone:

1. **Plan 1 — Reader MVP** (`v0.1.0-reader-mvp`): scaffold + rendering pipeline + sidecar I/O infrastructure
2. **Plan 2 — Annotation engine** (`v0.2.0-annotations`): anchoring + highlights + notes + drawings + tool rail + save/load
3. **Plan 3 — Robustness polish** (`v0.3.0`): orphan panel + Open Recent + error matrix + Playwright E2E

Each plan is in [`docs/superpowers/plans/`](docs/superpowers/plans/) as a reviewable artifact describing exactly what was built, why, and how it's tested. They're a reasonable onboarding ramp if you want to understand the codebase.

---

## 🤝 Contributing

remarkdown is a personal project right now. If you find a bug or want a feature, please open an issue **before** opening a PR so we can talk about scope — plan documents move faster than code.

---

## 📜 License

TBD. Will settle on a license before a stable `v1.0` tag ships.

---

<div align="center">

🖍 · 📝 · ✏️

*Read well. Mark well. Keep your thoughts where your source lives.*

</div>
