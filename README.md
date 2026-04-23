# remarkdown

A standalone desktop app for reading markdown documents with PDF-style annotation.

## Status

**Plan 1 — Reader MVP**: an opener and a viewer. No annotations yet. See `docs/superpowers/plans/` for the full roadmap and `docs/superpowers/specs/` for the v1 design spec.

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
