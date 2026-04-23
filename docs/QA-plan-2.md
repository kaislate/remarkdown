# Plan 2 Manual QA Checklist

Run `npm run tauri dev` and walk through each item.

## Prereqs
- [ ] App launches cleanly, shows empty reader state.
- [ ] Open a fixture `.md` — content renders correctly (Plan 1 regression check).

## Tool rail
- [ ] Bottom-center glass pill appears with 4 buttons: Cursor, Highlight, Note, Draw.
- [ ] Active tool button is visibly highlighted.
- [ ] Clicking each tool updates the active state.
- [ ] Color strip appears above the rail when Highlight or Draw is selected; hidden for Cursor/Note.

## Highlights
- [ ] Select Highlight tool.
- [ ] Drag-select a phrase in the document — a translucent yellow highlight appears.
- [ ] Switch colors via ColorStrip — subsequent highlights use the new color.
- [ ] Select Cursor tool — existing highlights remain visible; text selection works normally (can copy).
- [ ] Switch back to Highlight and create overlapping highlights — browser handles overlap rendering cleanly.

## Notes
- [ ] Select Note tool.
- [ ] Click inside a paragraph — a small amber pin appears on the right edge at the clicked line.
- [ ] A popover opens for typing; type some text.
- [ ] Click elsewhere — popover closes.
- [ ] Click the pin — popover reopens with typed text intact.
- [ ] Click Delete in the popover — pin disappears.

## Drawings
- [ ] Select Draw tool.
- [ ] Draw a squiggle over a paragraph with the mouse.
- [ ] After 3 seconds of no movement, the squiggle is finalized (persists).
- [ ] Switch to Cursor tool mid-draw — pending stroke finalizes immediately.
- [ ] Switch back to Draw with a different color — next stroke uses the new color.

## Persistence round-trip
- [ ] Make one of each: highlight, note, drawing.
- [ ] Observe a brief "saved" text pulse near the hamburger (within 500ms of last change).
- [ ] Close the app window.
- [ ] Reopen the app; use hamburger → Open… to load the same `.md` file.
- [ ] All three annotations reappear in their original positions.
- [ ] Open the `.md.remarkdown.json` file next to the source in a text editor — it's readable, has `_comment`, and lists all three annotations.

## Orphans (preserved silently)
- [ ] With a highlight saved, open the `.md` in a text editor and delete the highlighted phrase entirely. Save.
- [ ] Reopen in remarkdown. The highlight does not render. No UI surfaces it (that's Plan 3).
- [ ] Create a new, unrelated annotation. Save.
- [ ] Open `.md.remarkdown.json` — the orphaned annotation is STILL THERE alongside the new one.

## Regressions
- [ ] `npm test` is green. `cargo test` is green. `npm run check` is clean.
