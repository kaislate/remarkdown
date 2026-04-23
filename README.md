# remarkdown

A standalone desktop app for reading markdown documents with PDF-style annotation.

## Status

**Plan 3 — Robustness polish (v0.3.0)**: right-click delete for highlights and drawings, orphan panel, Open Recent menu with missing-file detection, full error matrix (UTF-8 / corrupt sidecar / write retry / size warning), Playwright E2E. The v1 reader is feature-complete at this tag.

## Development

Prereqs: Node 20+, Rust stable toolchain, platform prerequisites for Tauri 2 (see https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

Unit + component tests:

```bash
npm test
```

Rust tests:

```bash
cd src-tauri && cargo test
```

Type check:

```bash
npm run check
```

## Layout

- `src/` — Svelte 5 frontend
- `src-tauri/` — Rust host (commands, sidecar atomic writes, recent files)
- `tests/` — Vitest unit + component tests
- `docs/superpowers/specs/` — design spec
- `docs/superpowers/plans/` — implementation plans
