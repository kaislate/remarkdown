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
- [ ] Close button dismisses modal; Escape key also dismisses.

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
- [ ] `npm run test:e2e` runs and all 6 tests pass (1 smoke + 5 scenarios).

## Regressions
- [ ] `npm test` green, `cargo test` green, `npm run check` clean.
