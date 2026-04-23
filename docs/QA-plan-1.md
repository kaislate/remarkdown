# Plan 1 Manual QA Checklist

Run `npm run tauri dev` and confirm each of the following.

## Launch
- [ ] Native window opens with title "remarkdown".
- [ ] Background is dark; subtle glow visible.
- [ ] Hamburger glass button appears top-left.
- [ ] Empty-state text "Open a markdown file to start reading." is centered.

## Open a simple file
- [ ] Click hamburger → popover opens with "Open…".
- [ ] Click Open… → native file picker appears filtered to .md / .markdown.
- [ ] Select `tests/fixtures/simple.md` → window shows rendered heading + paragraphs + list.
- [ ] `data-block-id` attrs exist on top-level blocks (inspect in DevTools).

## Open a fixture with code + math
- [ ] Select `tests/fixtures/code.md` → TS and Rust fences are colorized via Shiki (github-dark theme).
- [ ] Select `tests/fixtures/math.md` → inline and display math render via KaTeX.

## Open with an image
- [ ] Create a quick `~/tmp/pic-test.md` containing `![pic](./pic.png)` alongside any `pic.png`.
- [ ] Open it → image displays.

## Reopen latest
- [ ] Close and restart dev.
- [ ] `list_recent` has recorded the last opened path (verify via `console.log(await listRecent())` in DevTools; UI for this lands in Plan 3).

## Bad input
- [ ] Create a binary file renamed to `.md`, try to open → error toast or console error (spec's "not UTF-8" handling lands in Plan 3; for now an error surfaces in DevTools is acceptable).

## Close
- [ ] Close the window cleanly. No Rust panic in the console.
