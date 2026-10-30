# Changelog

What changed in each version of remarkdown, newest first. The same notes appear in the app's update window and on the [Releases page](https://github.com/kaislate/remarkdown/releases).

---

## Unreleased — 🍎🐧 remarkdown on Mac and Linux

**Nothing changes on Windows.** remarkdown now also comes for Mac and Linux, and the same reader, annotator and editor work on all three.

### ⬇️ What you download

- **Mac:** a `.dmg` for Apple silicon and Intel (macOS 12 or later). It isn't signed with an Apple Developer ID yet, so the first time you open it macOS blocks it. Try to open it once, then go to **System Settings → Privacy & Security**, scroll down, click **Open Anyway** and confirm. You only do this once.
- **Linux:** an **AppImage** for most distros, and an **rpm** for Fedora (`sudo dnf install ./remarkdown-*.rpm`). The AppImage adds itself to your app launcher the first time it runs, and never makes itself your default app.
- Updates install in place from **Menu → Check for updates…** on both, and on the Mac.

### 🍎 On a Mac

- The window has the native red, yellow and green buttons.
- Shortcuts show ⌘ where they show Ctrl elsewhere.
- Smooth scrolling is off by default, because a Mac already scrolls smoothly. You can turn it on in Settings.
- **⌘Q** saves any pending edit before it quits.

### 🐧 On Linux

- On tiling desktops such as Hyprland, remarkdown hides its own window buttons. On GNOME they show.
- With smooth scrolling on, one wheel notch glides an eighth of a page.

### 📂 Show in folder

- **Show in folder** now opens Finder on a Mac and your file manager on Linux, as it opens Explorer on Windows.

### 🔧 Fixes

- Running the tests in WebKit (the engine Mac and Linux use) found a few problems. The one you'd notice: **Paste** from the editor's right-click menu now goes where the caret was.

---

## 0.8.0 — 📖 Reader mode, and every diagram editable

*Released 2026-10-20 · [v0.8.0](https://github.com/kaislate/remarkdown/releases/tag/v0.8.0)*

**Two big things this time.** Focus mode grows up into **reader mode**: nothing on screen but the page, on paper you can choose. And edit mode can now change **every kind of diagram** and make **every kind of block**: headings, lists, quotes, pictures and formulas, all without typing any markdown.

### 👋 Pick how you want to use it

- A new **"How do you want to use remarkdown?"** window offers three starting layouts, each with a real screenshot:
  - **Reader**: files open in reader mode on Textured paper, with no tools in the way. This is the recommended layout.
  - **Annotator**: highlighter, re.marks, pen and margin notes.
  - **Writer**: documents open ready to edit, with tabs in a sidebar.
- **Customize this layout** lets you adjust that layout's options before you start.
- **Updating starts you fresh.** The first launch of 0.8.0 resets your settings and closes your open tabs, so everyone begins with this window and the new defaults. Your annotations, recent files and reading progress are all kept, and your old settings are saved beside the new ones as `settings.before-0.8.0.json`.
- To see this window again later, go to **Settings → About → Choose a starting layout…**
- On a first run, Continue sends you into reader mode with a slow ink swap. The hand-drawn tutorial waits until you first leave reader mode.

### 📖 Reader mode

- **Nothing but the page.** The tool rail, toggles and banners are gone, and the menu shrinks to three quiet lines. The text is set as a comfortable ~62-character column with roomy lines. **Esc** leaves. If a popover is open, Esc closes that first.
- **Six page styles**:
  - **Default**.
  - **Paper**.
  - **Textured**: a cream page with fine grain, written in blue-black ink. It's new, and it's the default for the Reader layout.
  - **Sepia**.
  - **Night**.
  - **E-ink**: no motion at all.
- In every page style, diagrams, code, tables, callouts and formulas follow the page's colours.
- **Contents on the left** (the default) lists the headings beside the page, marks the section you're reading and shows the minutes left. You can switch it to a quiet line at the top. In windows too narrow for the list, the line comes back.
- **The minimap stays** beside the page, in the page's colours. You can turn it off.
- **The page dries in like ink.** Switching into or out of reader mode soaks the old view away in irregular ink blots instead of a hard cut. It's instant with reduced motion and on E-ink.
- **Ink from the pointer** (*Settings → Reading*):
  - **Leak** is the default: rest the mouse and a grey spot slowly spreads into the paper, then dries away once you move on.
  - **Trail** leaves drops along the pointer's path.
  - **Pen** draws a fine wet line.
  - **Off** turns it off.
- **Your annotations stay visible** in reader mode, read-only. Pins open their re.mark to read; nothing can be dragged or deleted by accident.

### 🧭 Moving around

- **Smooth scrolling, Microsoft Edge style.** Each wheel notch or arrow / Page key sets the page gliding, and it eases to a stop.
  - **Glide** sets how long that lasts: Short (Edge's own timing), Medium (the default) or Long.
  - Touchpads, Ctrl/Shift+wheel and scroll boxes inside the page are left alone.
- **Contents glide you to a section** instead of jumping. A marker slides to the heading you picked, and a drop of ink runs from the list to the heading and settles under it. Both can be turned off.
- **The minimap's box is exact** in reading and edit mode, even in documents full of diagrams.

### ✍️ Edit mode can make everything now

- **Text style menu** in the toolbar: Normal text, Heading 1–3, Bulleted list, Numbered list, Quote and Divider line. It always shows the style where the cursor is.
  - **Shortcuts:** `Ctrl+Alt+0`–`3`, plus `Ctrl+Shift+7` / `8` / `9` for numbered list, bulleted list and quote.
  - **Typing markdown works too.** `# `, `- `, `1. `, `> ` or `---` at the start of a line does the same, and Backspace undoes it.
- **🖼 Picture button.** Pick an image file; it's linked relative to your document (folders with spaces are fine) and shown in place. Click a picture to describe it for people who can't see it.
- **∑ Formula button.**
  - Select text to turn it into a formula, or use it on an empty line for a formula block.
  - Formulas are drawn as you edit; click one to change it, with a live preview.
- **Nothing gets mangled on save any more.**
  - Formulas (`$…$`, `$$…$$`), front matter and your list markers (`-`, `*`, `+`) are written back exactly as they were. Before, edit mode could turn front matter into a heading and squash formula blocks onto one line.
  - The reader folds front matter away under **Document details**.
- **Footnotes** get **Bold** / *Italic* buttons (`Ctrl+B` / `Ctrl+I`) and a preview of how they'll read.
- **Code colours follow the page:** light code on light pages, dark on dark, in the reader and the editor. Code inside callouts and lists is now coloured while you edit too.
- **Your words are never silently overwritten.**
  - If another program changes a file while you're editing it, saving stops and asks what to do: keep your version, use the other one, or save yours as a copy. That includes a tab editing in the background.
  - Whatever you pick, your own text is never lost.

### 🧜 Every diagram can be changed

- **Click a part and change it in plain words.** No diagram syntax needed, and only the lines you touched change. Every type except flowchart and sequence is new to visual editing in this release:
  - **Flowchart:** every shape, groups, colours, line styles, bold / italic labels.
  - **Sequence:** every arrow, blocks such as loop / alt / opt / par, activations, boxes, numbering.
  - **State:** forks, joins, choices, groups, notes.
  - **Class** and **Database (ER):** members, keys, relationships in plain words.
  - **Pie**, **Gantt** and **Timeline:** Gantt date formats picked by example.
  - **Mind map:** Tab and Shift+Tab to indent.
  - **Board (kanban):** columns, cards, assignee, ticket, priority.
- **Charts edit as tables.** **Bar & line**, **Journey**, **Quadrant**, **Radar**, **Flows (Sankey)** and **Packet** charts open a table of their values, steps, points, flows or fields.
- **The rest are edited through their text.** Git graphs, C4, architecture, block and requirement diagrams get **Edit diagram text**, with a live drawing beside the text.
  - A broken diagram offers **Fix the diagram text**, and says what's wrong.
  - The "coming soon" note is gone.
- **The Diagram menu** is a grid of 16 small drawings with plain names: flowchart, sequence, pie, timeline, gantt, states, classes, database, mind map, board, bar & line, journey, quadrant, radar, flows and packet. Most start with a small example to change.

### 🖍 Annotations

- **Undo and redo** for highlights, re.marks and drawings: `Ctrl+Z` / `Ctrl+Y`, or the right-click menu.
  - A message says what was undone.
  - Typing into a re.mark counts as one step.
  - Each tab keeps its own history.
- **Arrows and brackets are tidied up** when **Tidy up shapes** is on. That covers an arrow in one stroke or a line plus a separate head, and a bracket beside a passage.
- **Margin notes are out of preview.** They now appear in windows from 1000 px wide (before, it was 1440 px).
- **Highlights across paragraphs survive a reload.** They used to come back orphaned. Ones saved by older versions are recovered where their text is unique.
- **Highlights dragged across a diagram** no longer break when the diagram redraws.

### 🗂 Tabs, menus and settings

- **Tabs on the left:** a sidebar of names that shrinks to initials and opens when you point at it, or stays pinned open.
- **Hide the tabs** with `Ctrl+Shift+B` or from the menu; your documents stay open and `Ctrl+Tab` still switches. You can also have the tab bar appear only once a second document is open.
- **Right-click menus everywhere**, fitted to what you clicked. The browser's menu never shows.
  - **Tabs:** close others, close tabs to the right, show in folder, copy path.
  - **Recent files:** open in a new tab or window, remove from the list.
  - **Selected text:** copy, highlight, add a re.mark.
  - **The page:** undo / redo, edit, reader mode.
  - **Text boxes:** cut, copy, paste.
- **Middle-click a recent file** to open it in a new tab.
- **A new Settings window**:
  - Sections down the left and search across all of them.
  - A small moving picture of what every option does.
  - Plain-words names.
  - Version, update check and reset under **About**.
- **The tutorial points at the controls wherever they are.** Its hand-drawn arrows are drawn to each control's real position in any layout, and there are new tips for edit, contents, reader mode and tabs.
- **Crisp window buttons:** centred icons, flat colour on hover, and Maximize turns into Restore while the window is maximized.

### 🐞 Fixes

- The reading column keeps clear of the left-hand controls when tabs are on the left.
- Clicking the contents icon opens the list again.
- A settings file that fails to load is never replaced with defaults.
- The menu over a reader page is no longer dimmed along with the page.
- In reader mode, `Ctrl+W` and `Ctrl+O` no longer close or open tabs you can't see.

### 🧪 Under the hood

- 120+ commits since 0.7.0.
- Every diagram parser is checked against mermaid's own reading of the diagram, and every edit is property-tested: the lines you didn't touch stay byte-identical, and mermaid can still draw the result.
- 2,331 unit and component tests, 166 Playwright end-to-end tests, 26 Rust tests.

### ⬇️ Installers

- `remarkdown_0.8.0_x64-setup.exe` — NSIS installer (recommended)
- `remarkdown_0.8.0_x64_en-US.msi` — MSI for `msiexec` / Group Policy / silent installs

Installed copies from 0.5.0-beta on will offer this update automatically.

---

## 0.7.0 — Tabs, and your files open themselves

*Released 2026-10-18 · [v0.7.0](https://github.com/kaislate/remarkdown/releases/tag/v0.7.0)*

**Double-click a `.md` file and remarkdown opens *that file*.** Not the welcome page, not a blank window — the one you clicked. If remarkdown is already running, it comes to the front and opens it there.

### 🗂️ Tabs that really stay open

- Open several documents and switch between them in a **tab bar up in the title band**.
- Every tab keeps its **exact scroll position**, its **edit mode**, and its **undo history** — switch away mid-edit, come back, and `Ctrl+Z` still works. Nothing is reloaded when you switch.
- Tabs **grow in**, **shrink out**, neighbours glide into place, and an underline slides to the tab you pick. (All instant if Windows animations are turned off.)
- `Ctrl+Tab` / `Ctrl+Shift+Tab` to switch, `Ctrl+W` to close, `Ctrl+O` to open, middle-click to close, **+** to open another file.
- Your tabs **come back the next time you launch**.
- Prefer it the old way? **Settings → Startup & files → When opening a file**: in a new tab (default), replace the current document, or open a new window.

### 📌 Make remarkdown your default for `.md`

- The installer now **registers remarkdown for `.md` and `.markdown`** — it appears under right-click → *Open with*.
- **Settings → Startup & files** shows whether remarkdown is your default and has a **Make remarkdown the default…** button. Windows only lets *you* make that final click, so the button takes you straight there: on **Windows 11** to remarkdown's page in *Default apps*, on **Windows 10** to the *How do you want to open this file?* dialog.

### 🧜 Sturdier diagrams

- Diagrams now **follow theme switches** (no more dark diagrams on a light page).
- **Wide charts** (gantt, timeline, C4, packet) scroll sideways instead of shrinking to unreadable text.
- A broken diagram shows a **friendly message** with the technical details tucked away, and no longer leaves hidden junk in the page.
- **Editing a flowchart or sequence diagram changes only what you touched** — comments, styling directives, chains and everything else stay exactly as written. Typed `;`, `#`, `&` and `<` no longer break or cut off your text.
- Backspace next to a diagram selects it first (like a picture in Word) instead of quietly eating into it.

### 🍔 Fixes

- The hamburger menu unfolds out of its button and **no longer hides under the round buttons** beside it (#23).
- Double-clicked files open themselves (#24).

Thanks to **@jaynothin** for reporting #23 and #24 — keep them coming.

### ⬇️ Installers

- `remarkdown_0.7.0_x64-setup.exe` — NSIS installer (recommended)
- `remarkdown_0.7.0_x64_en-US.msi` — MSI for `msiexec` / Group Policy / silent installs

Installed copies of 0.6.0 will offer this update automatically.

---

## 0.6.0 — Edit Mode

*Released 2026-06-11 · [v0.6.0](https://github.com/kaislate/remarkdown/releases/tag/v0.6.0)*

**The biggest release remarkdown has ever shipped.** 145 commits, ten editor phases, and one headline: **remarkdown is no longer just a reader.**

Hit the pencil — or `Ctrl+E` — and the article you're reading becomes a live editor. No syntax. No split panes. No preview button. *A markdown editor for people who don't know what markdown is.* Toggle back, and every highlight, re.mark, and drawing re-anchors onto your edited text automatically.

### ✍️ What edit mode brings

- **🧜 A full visual mermaid diagram editor.** Click any **flowchart** node to rename it, switch between 8 shapes, connect it to other nodes (or spawn a brand-new connected node), or delete it. Click an edge to label it, restyle it (arrow / line / dotted / thick), or remove it. Flip the entire layout TD / LR / BT / RL from a floating direction picker. **Sequence diagrams** are editable too — participants, messages, and notes all get click-to-edit popovers, plus an action bar for adding new ones. Never write `A-->|Yes|B` by hand again.
- **📋 GFM table editing** — insert a table from the toolbar, type straight into cells, add/remove rows and columns from a floating actions menu. Serialized markdown comes back column-aligned and pretty.
- **💬 Obsidian-style callouts** — one-click insert, fully round-tripped.
- **💻 Code blocks** — live Shiki syntax highlighting *while you type*, with a language pill picker (aliases like `ts`, `py`, `rs` just work).
- **☑️ Task lists** — checkboxes toggle with a click, in read mode AND edit mode.
- **🦶 Footnotes** — insert from the toolbar, edit label + body in a popover, refs and definitions stay paired.
- **✨ Inline marks** — bold / italic / strikethrough / ~subscript~ / ^superscript^ from a floating bubble menu (`Ctrl+,` / `Ctrl+.` for sub/sup).
- **💾 Safe by design** — atomic, debounced autosave through the same battle-tested write path as annotation sidecars; the file watcher pauses while you edit and resumes when you're done.

### 🛡 Mermaid editing, hardened

The visual diagram editor went through a dedicated robustness pass before shipping:

- The serializer is now **validated against mermaid's own grammar** in the test suite — a popover edit can never commit source that mermaid refuses to render (empty labels, quotes, pipes: all covered).
- Diagram re-renders are **race-guarded** — rapid edits always settle on your last input, and popovers anchor to the rendered SVG instead of racing it.
- **Parallel edges** (two `A --> B` arrows) now select, edit, and delete independently; node ids with underscores resolve correctly.
- Edit-mode rendering moved to `securityLevel: strict`, matching read mode — no HTML-label/click-binding surface from untrusted documents.

### 📦 MSI installers are back

0.6.0 drops the `-beta` suffix from the version — and with a clean semver, **Windows `.msi` packages can be generated again** and ship alongside the NSIS `.exe`:

- `remarkdown_0.6.0_x64-setup.exe` — NSIS installer (recommended for most users)
- `remarkdown_0.6.0_x64_en-US.msi` — **new!** for `msiexec`, Group Policy, and silent-install workflows

Both are Ed25519-signed and verified by the in-app updater before installing.

### 🐧🍎 Linux & macOS — TESTERS WANTED

A full compatibility review found **no blockers** for Linux or macOS: the Rust backend has zero Windows-only code paths (the atomic-write code already carries dedicated Unix fsync handling), file watching uses the cross-platform `notify` crate, the frameless window is supported by Tauri on all three OSes, and the platform icons are already bundled.

What we need now is **real machines**: window-manager quirks, the CSS Custom Highlight API on WebKitGTK, drag-and-drop from different file managers, font fallbacks.

**Run Linux or macOS? [Open an issue](https://github.com/kaislate/remarkdown/issues) with your distro/OS version** and we'll get you a build. Once verified, remarkdown releases for all three platforms.

### 🔁 Updating

Installed 0.5.x? **Hamburger menu → Check for updates…** and 0.6.0 installs itself. Running 0.4.x or earlier (pre-updater)? Grab an installer above and run it once — every future release arrives automatically.

### 🧪 Under the hood

- 690+ Vitest unit/component tests (300 added since 0.5.4-beta), Playwright E2E, Rust tests, 0 svelte-check warnings
- New test infrastructure renders **real mermaid** in jsdom, so diagram click-routing is tested against mermaid's actual SVG output

---

*Read well. Mark well. **Edit well.** Keep your thoughts where your source lives.* 🖍 📝 ✏️ ✍️

---

## 0.5.4-beta

*Released 2026-04-30 · [v0.5.4-beta](https://github.com/kaislate/remarkdown/releases/tag/v0.5.4-beta)*

### 📜 Right-margin marginalia column [prototype]
**Settings → Highlights & re.marks → Marginalia column.** When enabled and the window is wide enough, every re.mark gets its own card in the right margin, vertically aligned with its anchor. Each card shows the sentence(s) of context around the anchor (using your existing 1–5 sentence-context setting) plus the re.mark's body, and clicking flips the card into a writing surface — autofocused, save-on-input, commits on Esc / Enter / click-outside. Anchors inside `<li>` items cap their context to the bullet by default (toggleable via **Cap context to a single bullet**).

### ✨ Liquid-glass cards with a flowing connector
Every marginalia card is a layered glass panel — radial top-left highlight, diagonal sheen, accent-purple wash, translucent dark base, with a multi-layer inset bevel that simulates a 2.5D waterfall edge. **No stroked border**, no harsh outline. Click to edit and a stream of luminous orbs flows from the in-document re.mark dot into the card, growing in size as they approach the anchor (eventually matching the pin's exact size). The textarea inside is a recessed paper-style notepad with faint accent ruling, custom caret, and a subtle pen-down spring on appear.

### 🪂 Push-down collision avoidance
re.marks that anchor close together no longer get hidden behind each other — the card below shoves down by enough to clear, and its connector becomes a soft diagonal slope from the in-doc pin to the card's accent dot. The active card pushes neighbours below it down further to clear the textarea, so a card you're editing never hides the next one. Earlier (top-of-page) cards stack above later ones; clicking any card brings it to the front of the stack.

### 🎯 Open new documents in Focus mode
**Settings → Reading → Open new documents in Focus mode.** When on, every doc you open auto-enters Focus mode (chrome hidden, distraction-free reading) instead of starting in chrome-visible mode. Edit-reload of the currently-open doc keeps your chrome state intact so an external edit doesn't yank the UI from under you mid-read.

### 🗺 Minimap popout in Focus mode
**Settings → Reading → Minimap popout in Focus mode.** When both Focus mode and the setting are on, the minimap stays available — slid offscreen by default, but a 24px-wide invisible peek-zone strip on the right edge of the screen reveals it on hover. Mouse leaves the minimap and it slides back out. The peek-zone overlaps the minimap by 8px so there's no hover-gap snap-back.

### 🎨 Title-bar window controls bloom on hover
The flat hover squares are gone. Each control now has a colour-coded glowing orb that scales up behind the icon, with an outer ripple ring that pulses outward. Each carries its own per-icon micro-animation:

- **Minimize** — warm amber orb; the dash slides down 4px
- **Maximize** — cool cyan orb; the square scales up 1.25×
- **Close** — vivid red orb; the X rotates 90° + glows + scales

`prefers-reduced-motion` users get fast 0.1s transitions instead of spring overshoots so the affordance still works without motion.

### ⚙️ Settings panel reorganized
Six balanced sections instead of four lopsided ones, with visible hairline separators and brighter section headings. Update settings now have their own home (instead of being squatters in *Reading*), Drawing settings split out from Highlights & re.marks, and the Welcome / Tutorial flags moved from *Reading* into a new *Startup & files* section.

### 🐞 Bug fixes
- **`Cap context to a single bullet`** — re.marks anchored inside list items used to walk back through earlier paragraphs to fill the sentence budget; they now stay within the bullet by default
- **Card vertical alignment** — every marginalia card was sitting 4px below its anchor due to a stale `DOT_OFFSET` constant after the glass redesign bumped padding from 8px to 12px

🐛 Bug reports welcome at https://github.com/kaislate/remarkdown/issues

---

## 0.5.3-beta

*Released 2026-04-28 · [v0.5.3-beta](https://github.com/kaislate/remarkdown/releases/tag/v0.5.3-beta)*

### 📑 Per-document reading progress
remarkdown now remembers where you stopped reading in every document. Open `notes.md`, scroll halfway, close it, come back next week — it lands you back at 50%. Progress also surfaces as a percentage badge in **Open Recent** so at a glance you can see which docs you're partway through and which you haven't started. Stored in a single `reading-progress.json` in the OS app-data dir; no per-file metadata leakage.

### 🗂 Table-of-contents popover
A new `ListBullets` pill above the Focus toggle opens a glass-styled list of every `h1`–`h4` in the active document. Click an entry to smooth-scroll to that heading. Useful for long specs / technical articles where the minimap alone isn't enough to find a specific section by name.

### 📰 Aggregated changelog when multiple versions behind
The Update modal now fetches GitHub Releases on open. If you're three versions behind, you see the changelog for **every** release you'd be skipping, oldest at the top. Pre-release entries are filtered out unless you enable **Settings → Updates → Include pre-release changelog entries**.

### 🍔 Hamburger menu backdrop + X-cursor
Opening the hamburger now dims the rest of the UI with a translucent backdrop and replaces your cursor with a small X-in-circle follower. Move toward the menu — the X collapses as it crosses onto the popover; click anywhere on the backdrop and the menu closes. Click-outside-to-close was the missing UX; the X-cursor is the [tucano.com](https://tucano.com) treatment, ported.

### 🌙 Animated re.marks dot
Hover the bottom-left **re.marks** pill: the period in the wordmark fades out and is replaced by an orbiting dot that traces an ellipse around the entire word — passing **in front of** the letters on the lower half of the orbit and **behind** them on the upper half. Same accent purple + soft halo as the in-document `.note-pin`. The pill itself moved next to the Table of Contents button and grew to match the 38px height of the rest of the bottom-left cluster.

### 🐞 Bug fixes
- **Mermaid in the minimap** — the minimap was re-rendering from raw HTML and never picked up the runtime mermaid → SVG swap, so the indicator would drift through diagram regions. The minimap now mirrors the live article DOM via a debounced `MutationObserver`; mermaid + any future runtime transform shows up at the correct scale and the scroll indicator tracks accurately.
- **Welcome screen always up to date** — older installs were stuck on a stale `welcome.md` from when they first launched (the bundled doc was only written if the file didn't exist). The bundled bytes are now diffed against the on-disk copy on every launch and re-synced when they don't match. Annotations on the welcome screen are intentionally dropped during the sync so the new content reads cleanly.
- **X-cursor responsiveness** — the cursor follower used to wait for a mousemove event to collapse, so a stationary click on the backdrop left it hanging. It now collapses immediately on click, and the shrink animation runs at half the duration of the grow.
- **Zoom rail height** — trimmed 2px so the bottom-left cluster (Zoom, Focus, ToC, re.marks) reads as one consistent height.

🐛 Bug reports welcome at https://github.com/kaislate/remarkdown/issues

---

## 0.5.2-beta

*Released 2026-04-27 · [v0.5.2-beta](https://github.com/kaislate/remarkdown/releases/tag/v0.5.2-beta)*

### 🧩 Mermaid diagrams
Fenced code blocks tagged ` ```mermaid ` now render as actual SVG diagrams. Same syntax Obsidian, GitHub, and Notion understand: flowcharts, sequence diagrams, state machines, mind maps, gantt charts, etc. Bad syntax falls back to a visible error message inside the diagram block. Mermaid is lazy-loaded (~600KB chunk only ships when a doc with diagrams is opened).

### 💬 Obsidian-style callouts
Blockquotes prefixed with `[!type]` render as themed colored boxes with type-specific icons. Supported: `note`, `info`, `tip`/`hint`, `success`/`done`, `question`/`help`/`faq`, `warning`/`caution`/`attention`, `failure`/`fail`/`missing`, `danger`/`error`, `bug`, `example`, `quote`/`cite`, `abstract`/`summary`/`tldr`. Foldable variants: `[!type]+` opens by default, `[!type]-` starts collapsed — click the chevron to toggle.

The welcome.md doc has been updated with a Diagrams + Callouts section so you can see them both in action.

### 🔄 Orphan re-attach
When an external edit moves text far enough that an annotation can't be re-anchored automatically, it goes to the Orphan panel as before — but each orphan now has a **Re-attach** button. Click it: the panel closes, an accent banner appears at the top of the article, the cursor flips to an I-beam, and the next text you select becomes the annotation's new home. Works for highlights, re.marks, and all 7 drawing shape variants. Esc cancels.

### 👁 File watcher
Open `note.md` in remarkdown. Edit it in VS Code. **Within ~1 second remarkdown reloads with the new content.** Annotations survive — those whose anchors still resolve stay put, those that don't go to the Orphan panel (where you can re-attach them via the new UI). A toast surfaces the delta: `File reloaded — N re-anchored, M orphaned`.

### 🟣 Update affordances
- **Hamburger menu** now shows **Update available — vX.Y.Z** in accent purple with a periodic shine when an update is waiting (instead of "Check for updates…").
- **The "Update available" toast no longer auto-dismisses** — it stays until you click the action button or the × dismiss.

🐛 Bug reports welcome at https://github.com/kaislate/remarkdown/issues

---

## 0.5.1-beta

*Released 2026-04-27 · [v0.5.1-beta](https://github.com/kaislate/remarkdown/releases/tag/v0.5.1-beta)*

This update is mostly polish and putting more knobs in your hands. Highlights:

### 🖍 Drawings now stay anchored to your text
Previously, drawings were stuck at the pixel position you drew them — zoom in or change reading width and they'd drift away. Now every drawing anchors to the text or block it covers and follows reflow + zoom faithfully. Existing drawings from earlier builds keep working (they migrate forward automatically).

### 📖 Reader mode
A new BookOpen pill next to the zoom controls toggles a clean reading view. Click it (or press `Esc` to exit) and every chrome layer hides — hamburger menu, watermark, tool rail, re.marks pill, minimap. The title-bar drag region and resize grip stay invisibly clickable so you can still move + resize the window without leaving reader mode.

### 🎨 Drawing roughness slider
**Settings → Annotation → Drawing roughness.** Slide to 0 for crisp clean lines, all the way up to 3 for very sketchy hand-drawn output. Default is 1.4 (the previous fixed look).

### ✨ Auto-transform drawings (opt-in)
By default your drawings now stay as you drew them. Flip on **Settings → Annotation → "Auto-transform drawings into shapes"** and the recognizer kicks in: closed loops around text become clean ellipses, lines under text become underlines, vertical lines in the margin become margin bars, and so on. Off by default so wobbly hand-drawn circles stay wobbly.

### ⌨️ Press `?` to toggle the welcome tutorial
Lost the tour? Press `?` anywhere (outside text inputs) and the hand-drawn overlay returns. Press it again to dismiss.

### 🐞 Bug fixes
- **re.marks pins now follow zoom changes** — they used to stick at their original screen position until the next window resize
- Welcome tutorial arrows correctly land on the chrome they're labelling
- Title bar double-click (toggle maximize) and resize-grip double-click (reset to 1100×780) work cleanly without consuming each other's input
- Tutorial overlay blurs the "Don't show welcome on launch" hint while it's up
- Tutorial dismiss buttons reordered: "Got it" pill on top, "Hide tutorial forever" link below

🐛 Bug reports welcome at https://github.com/kaislate/remarkdown/issues

---

## 0.5.0-beta

*Released 2026-04-25 · [v0.5.0-beta](https://github.com/kaislate/remarkdown/releases/tag/v0.5.0-beta)*

**0.5.0 Beta — first public beta.** Adds in-app auto-update with Ed25519-signed installer verification, the re.marks side panel with configurable 1–5-sentence context, a hand-drawn welcome tutorial overlay, an animated BETA pin on the splash + chrome, a bottom-right resize grip (double-click resets to 1100×780), and a hover morph that animates `re.md` → `remarkdown` on the wordmark. 320+ tests, NSIS installer only for this beta.

⚠️ **If you're on a pre-beta build (0.4.x or earlier):** auto-update wasn't shipped yet, so your installed copy can't pull this beta on its own. Download the installer below once and every release after this will arrive automatically via the in-app updater.

---

## 0.4.1-beta

*Released 2026-04-25 · [v0.4.1-beta](https://github.com/kaislate/remarkdown/releases/tag/v0.4.1-beta)*

Second beta. Adds a full **Settings module**, a **light theme**, and a **vertical filename watermark** in the left margin.

### Install

- **`remarkdown_0.4.1_x64-setup.exe`** — NSIS installer (lighter, recommended)
- **`remarkdown_0.4.1_x64_en-US.msi`** — MSI installer (for managed environments)

> ℹ️ Windows SmartScreen may show an "unrecognized publisher" warning the first time you run an unsigned beta build — click **More info → Run anyway** to proceed. A signed release is planned post-beta.

### What's new since 0.4.0-beta

#### ⚙️ Settings panel — 12 user preferences
Open from the hamburger menu → **Settings…**. Every setting persists to `%APPDATA%\com.remarkdown.app\data\settings.json` (atomic JSON write, Zod-validated on read) and applies live.

| Section | Settings |
|--|--|
| **Appearance** | theme (dark/light), splash on/off, watermark on/off, watermark opacity |
| **Reading** | default zoom, article column width, max recent files, reopen-last-on-launch |
| **Annotation** | default highlight color, default ink color, drawing idle finalize duration |
| **Save** | sidecar write debounce |

A "Reset to defaults" button restores everything in one click.

#### 🌗 Light theme
Full warm-paper palette under `[data-theme="light"]` — same token names as dark, no component branches. Theme switches instantly without reload.

#### 🪞 Vertical filename watermark
Extreme-size filename rotated 90° CCW down the left margin, very low opacity, fades toward the inner column. Toggle and tune the opacity from Settings.

#### Other fixes & polish
- SettingsModal panel switched to a near-opaque background so labels and values read cleanly against any backdrop
- README is now logo-first (the wordmark replaces the redundant H1)
- Zoom no longer persists across sessions — `settings.defaultZoom` is the launch value; within a session `Ctrl +/-/0` mutate it freely

#### Quality
- **246** Vitest unit/component tests (▲ from 213)
- 6 Rust tests, 6 Playwright E2E scenarios
- Zero `svelte-check` warnings across 207 files

### Known limitations

- Windows-only (Tauri 2 supports macOS / Linux; cross-platform builds are deferred)
- Installers are unsigned — expect a SmartScreen prompt
- Re-attaching orphaned annotations, file watching, undo/redo are still post-beta

See the [README](https://github.com/kaislate/remarkdown/blob/main/README.md) for the full feature list. Bug reports welcome via [issues](https://github.com/kaislate/remarkdown/issues).

**Full changelog:** https://github.com/kaislate/remarkdown/compare/v0.4.0-beta...v0.4.1-beta

---

## 0.4.0-beta

*Released 2026-04-24 · [v0.4.0-beta](https://github.com/kaislate/remarkdown/releases/tag/v0.4.0-beta)*

First public beta of **remarkdown** — a desktop reader for markdown documents with PDF-style annotations.

### Install

Download the installer for your preference and run it:

- **`remarkdown_0.4.0_x64-setup.exe`** — NSIS installer (lighter, recommended for most users)
- **`remarkdown_0.4.0_x64_en-US.msi`** — MSI installer (for managed/enterprise environments)

Both produce the same app. Launch **remarkdown** from the Start menu after installing — drop a `.md` file onto the window or use the menu to open one.

> ℹ️ Windows SmartScreen may show an "unrecognized publisher" warning the first time you run an unsigned beta build — click **More info → Run anyway** to proceed. A signed release is planned post-beta.

### What's in the beta

#### Annotation
- 🖍 Highlights in 5 preset colors (CSS Custom Highlight API — no DOM mutation, clean overlap handling)
- 📝 Sticky notes with inline textarea popovers, pinned to the right margin
- ✏️ Freehand drawings with SVG strokes, 5 ink colors, auto-finalize on idle
- 🧹 Eraser tool — single-click delete for any annotation, no confirmation
- 🔎 Robust W3C-style text-quote anchoring with orphan detection panel

#### Reading
- 📂 Drag-drop `.md` files from Explorer to open
- 🕘 Open Recent menu with missing-file detection
- 🗺 VS Code-style minimap for long documents
- 🔍 Zoom with `Ctrl + / - / 0`
- 🎬 Animated splash and frameless dark UI

#### Storage & resilience
- 💾 Atomic, debounced sidecar writes with retry-on-failure and synchronous flush on close
- 🛡 Full error matrix (UTF-8, corrupt sidecar, write retries, size warnings)

#### Quality
- 213 Vitest unit/component tests
- 6 Rust tests
- 6 Playwright E2E scenarios
- Zero `svelte-check` warnings

See the [README](https://github.com/kaislate/remarkdown/blob/main/README.md) for the full feature list and documentation.

### Known limitations

- Windows-only for this beta (Tauri 2 supports macOS / Linux; cross-platform builds are deferred)
- Installers are unsigned — expect a SmartScreen prompt
- Re-attaching orphaned annotations, file watching, undo/redo, and a light theme are deferred to post-beta

Bug reports and feedback welcome via the [issues page](https://github.com/kaislate/remarkdown/issues).
