# remarkdown — Plan 1: Reader MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Tauri+Svelte project and ship a working markdown viewer — open a `.md` file from disk and see it rendered beautifully. Sidecar I/O, schema, and Rust commands are fully implemented and tested, but the UI has no annotation layers yet (Plan 2's job).

**Architecture:** Tauri 2 host exposes a tight set of allowlisted commands; Svelte 5 frontend invokes them through a typed wrapper. All filesystem access lives in Rust; the frontend is pure rendering. Pure TS modules (schema, sidecar, markdown rendering) are unit-tested exhaustively before any UI is wired. The spec at `docs/superpowers/specs/2026-04-21-remarkdown-design.md` is the source of truth — when in doubt, consult it.

**Tech Stack:** Tauri 2.x, Svelte 5 (runes + `writable` stores), Vite, TypeScript, markdown-it (+ footnote, task-lists, @vscode/markdown-it-katex), Shiki 1.x (WASM, github-dark), Zod, Vitest, @testing-library/svelte, Playwright (scaffolded, used in Plan 3).

**Out of scope for this plan:** highlights, notes, drawings, anchoring, orphan panel, recent-files UI, error matrix UX, E2E tests. Those are Plans 2 and 3.

**Deliberate Plan 1 simplifications vs. the spec:**
- Asset-protocol scope is `["**"]` instead of per-doc dynamic scope. The security boundary is the user's file picker selection. Per-doc scope tightening is a Plan 3 hardening item.
- `GlassMenu` only exposes "Open…" — "Open Recent", "Orphaned Annotations…", and "Settings" come in Plans 2–3.
- No "saved" pulse UX (nothing to save yet in this plan).

---

## File Structure (Plan 1 scope)

```
remarkdown/
├── package.json                        [new]
├── tsconfig.json                       [new]
├── tsconfig.node.json                  [new]
├── svelte.config.js                    [new]
├── vite.config.ts                      [new]
├── vitest.config.ts                    [new]
├── index.html                          [new]
├── .gitignore                          [modify — add node_modules, target, dist]
├── src/
│   ├── main.ts                         [new — entry]
│   ├── App.svelte                      [new — root layout]
│   ├── app.d.ts                        [new — ambient types]
│   ├── components/
│   │   ├── GlassMenu.svelte            [new — hamburger + Open action]
│   │   └── Viewer.svelte               [new — scroll container + HTML sink]
│   ├── lib/
│   │   ├── schema.ts                   [new — Zod schemas + TS types]
│   │   ├── sidecar.ts                  [new — load/serialize]
│   │   ├── MarkdownRenderer.ts         [new — render pipeline]
│   │   └── tauri-api.ts                [new — typed invoke wrapper]
│   └── stores/
│       ├── doc.ts                      [new]
│       └── recent.ts                   [new — populated, UI uses minimally]
├── src/styles/
│   ├── theme-dark.css                  [new — CSS variables + base]
│   └── glass.css                       [new — glass mixins]
├── src-tauri/
│   ├── Cargo.toml                      [new]
│   ├── tauri.conf.json                 [new]
│   ├── build.rs                        [new]
│   ├── src/
│   │   ├── main.rs                     [new — entry + builder]
│   │   ├── commands.rs                 [new — invoke handlers]
│   │   ├── sidecar.rs                  [new — atomic writes]
│   │   └── recent.rs                   [new — recent files persistence]
│   └── icons/                          [new — placeholders]
├── tests/
│   ├── unit/
│   │   ├── schema.test.ts              [new]
│   │   ├── sidecar.test.ts             [new]
│   │   └── MarkdownRenderer.test.ts    [new]
│   ├── component/
│   │   ├── GlassMenu.test.ts           [new]
│   │   └── Viewer.test.ts              [new]
│   └── fixtures/
│       ├── simple.md                   [new]
│       ├── code.md                     [new]
│       ├── math.md                     [new]
│       ├── tables.md                   [new]
│       ├── sidecar-valid.json          [new]
│       ├── sidecar-empty.json          [new]
│       └── sidecar-malformed.json      [new]
└── README.md                           [new]
```

**Boundary:** Svelte code never touches the filesystem — every read/write goes through `tauri-api.ts` → Tauri command. This stays true across all three plans.

---

## Phase 1 — Scaffolding (Tasks 1–5)

### Task 1: Create root manifests

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `svelte.config.js`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/app.d.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "remarkdown",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.1.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "@vscode/markdown-it-katex": "^1.1.0",
    "katex": "^0.16.11",
    "markdown-it": "^14.1.0",
    "markdown-it-footnote": "^4.0.0",
    "markdown-it-task-lists": "^2.1.1",
    "shiki": "^1.24.0",
    "svelte": "^5.0.0",
    "ulid": "^2.3.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@tauri-apps/cli": "^2.1.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/svelte": "^5.2.4",
    "@testing-library/user-event": "^14.5.2",
    "@tsconfig/svelte": "^5.0.4",
    "@types/markdown-it": "^14.1.2",
    "@types/node": "^22.5.0",
    "@vitest/coverage-v8": "^2.1.0",
    "jsdom": "^25.0.1",
    "svelte-check": "^4.0.0",
    "tslib": "^2.7.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "resolveJsonModule": true,
    "allowJs": false,
    "checkJs": false,
    "isolatedModules": true,
    "moduleDetection": "force",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "tests/**/*.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Write `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Write `svelte.config.js`**

```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
};
```

- [ ] **Step 5: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
  },
});
```

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.ts'],
    },
  })
);
```

- [ ] **Step 7: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/src/assets/logo.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>remarkdown</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 8: Write `src/app.d.ts`**

```ts
/// <reference types="svelte" />
/// <reference types="vite/client" />
```

- [ ] **Step 9: Update `.gitignore`**

Open `.gitignore` and append (keep existing lines):

```
# deps / build output
node_modules/
dist/
coverage/

# Rust
src-tauri/target/
src-tauri/gen/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
```

- [ ] **Step 10: Write `tests/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json tsconfig.node.json svelte.config.js vite.config.ts vitest.config.ts index.html src/app.d.ts tests/setup.ts .gitignore
git commit -m "chore: add JS/TS project manifests"
```

---

### Task 2: Create Tauri Rust skeleton

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/commands.rs` (stub), `src-tauri/src/sidecar.rs` (stub), `src-tauri/src/recent.rs` (stub), `src-tauri/icons/` (placeholder)

- [ ] **Step 1: Write `src-tauri/Cargo.toml`**

```toml
[package]
name = "remarkdown"
version = "0.1.0"
description = "Markdown reader with PDF-style annotations"
edition = "2021"
rust-version = "1.77"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"
tempfile = "3"
thiserror = "2"
directories = "6"
tokio = { version = "1", features = ["sync"] }

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

- [ ] **Step 2: Write `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 3: Write `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "remarkdown",
  "version": "0.1.0",
  "identifier": "com.remarkdown.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "remarkdown",
        "width": 1100,
        "height": 780,
        "minWidth": 600,
        "minHeight": 400,
        "decorations": true,
        "transparent": false
      }
    ],
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": ["**"]
      }
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **Step 4: Generate placeholder icons**

Run:

```bash
npx @tauri-apps/cli icon --help
```

Then use any 1024x1024 PNG as the source (a temporary solid-color square is fine for v0.1):

```bash
# From the repo root, after creating a placeholder source PNG at src-tauri/icons/source.png:
npx @tauri-apps/cli icon src-tauri/icons/source.png -o src-tauri/icons
```

If you don't have a source PNG, write a 1024x1024 solid dark-purple PNG using any tool. Acceptable to commit a minimal source image. Icons are regenerated when we have a real logo.

Expected: `src-tauri/icons/` contains `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`.

- [ ] **Step 5: Write `src-tauri/src/commands.rs` (stub)**

```rust
// All invoke handlers live here. Populated in Tasks 13–16.
// Keeping this file present in Task 2 so main.rs references resolve cleanly.
```

- [ ] **Step 6: Write `src-tauri/src/sidecar.rs` (stub)**

```rust
// Atomic write helpers. Implemented in Task 15.
```

- [ ] **Step 7: Write `src-tauri/src/recent.rs` (stub)**

```rust
// Recent-files persistence. Implemented in Task 16.
```

- [ ] **Step 8: Write `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod recent;
mod sidecar;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 9: Commit**

```bash
git add src-tauri/
git commit -m "chore: add Tauri 2 Rust skeleton"
```

---

### Task 3: Create Svelte entry point and theme

**Files:**
- Create: `src/main.ts`, `src/App.svelte`, `src/styles/theme-dark.css`, `src/styles/glass.css`

- [ ] **Step 1: Write `src/styles/theme-dark.css`**

```css
:root {
  color-scheme: dark;

  --bg-0: #0b0a12;
  --bg-1: #13111d;
  --bg-2: #1a1826;

  --fg-0: #e8e6f2;
  --fg-1: #b7b4c7;
  --fg-2: #7a7790;

  --accent: #8b7fff;
  --accent-soft: rgba(139, 127, 255, 0.18);

  --glow-1: rgba(139, 127, 255, 0.06);
  --glow-2: rgba(95, 155, 255, 0.04);

  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-fill: rgba(255, 255, 255, 0.04);

  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-serif: 'Charter', 'Georgia', serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg-0);
  color: var(--fg-0);
  font-family: var(--font-serif);
  font-size: 17px;
  line-height: 1.6;
  overflow: hidden;
  height: 100vh;
}

body {
  background:
    radial-gradient(circle at 20% 20%, var(--glow-1), transparent 50%),
    radial-gradient(circle at 80% 80%, var(--glow-2), transparent 50%),
    var(--bg-0);
}

#app {
  height: 100vh;
  width: 100vw;
  position: relative;
}
```

- [ ] **Step 2: Write `src/styles/glass.css`**

```css
.glass {
  background: var(--glass-fill);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 10px 32px rgba(0, 0, 0, 0.35);
  border-radius: 14px;
}

.glass-pill {
  border-radius: 999px;
}
```

- [ ] **Step 3: Write `src/App.svelte`**

```svelte
<script lang="ts">
  import './styles/theme-dark.css';
  import './styles/glass.css';
</script>

<main>
  <h1>remarkdown</h1>
  <p>Scaffold online.</p>
</main>

<style>
  main {
    padding: 2rem;
    color: var(--fg-0);
  }
</style>
```

- [ ] **Step 4: Write `src/main.ts`**

```ts
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
```

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

Expected: packages install cleanly, no peer-dep errors. Svelte 5 and Tauri 2.x should be on lockfile.

- [ ] **Step 6: Launch dev server via Tauri**

```bash
npm run tauri dev
```

Expected: Rust compiles (first build takes 3–8 min; subsequent ones ~5s), a native window opens showing "remarkdown — Scaffold online." on the dark background. No console errors in Tauri's DevTools.

If the window doesn't appear, check `src-tauri/tauri.conf.json` paths and that `dist/` isn't stale.

- [ ] **Step 7: Commit**

```bash
git add src/ index.html
git commit -m "feat: add Svelte 5 entry and dark theme scaffold"
```

---

### Task 4: Install test tooling and verify harness

**Files:**
- Create: `tests/unit/smoke.test.ts`

- [ ] **Step 1: Write smoke test**

```ts
// tests/unit/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs a trivial assertion', () => {
    expect(2 + 2).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: 1 test passing, no Vite/TS errors.

- [ ] **Step 3: Verify `svelte-check` is clean**

```bash
npm run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/smoke.test.ts
git commit -m "test: add Vitest harness smoke test"
```

---

### Task 5: Tag scaffold checkpoint

- [ ] **Step 1: Tag**

```bash
git tag v0.1.0-scaffold
```

End of Phase 1. At this point the app boots to a blank dark window, `npm test` works, and `npm run check` is clean.

---

## Phase 2 — Pure TS modules (Tasks 6–12)

All modules are pure, no DOM, no Tauri. They are the unit-test heavy core.

### Task 6: Zod schema + TS types

**Files:**
- Create: `src/lib/schema.ts`, `tests/unit/schema.test.ts`, `tests/fixtures/sidecar-valid.json`, `tests/fixtures/sidecar-empty.json`, `tests/fixtures/sidecar-malformed.json`

- [ ] **Step 1: Write fixtures**

`tests/fixtures/sidecar-empty.json`:
```json
{
  "_comment": "remarkdown annotations for: empty.md",
  "$schema": "remarkdown/v1",
  "document": {
    "path": "empty.md",
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "lastSeenBytes": 0
  },
  "annotations": []
}
```

`tests/fixtures/sidecar-valid.json`:
```json
{
  "_comment": "remarkdown annotations for: on-reading-well.md",
  "$schema": "remarkdown/v1",
  "document": {
    "path": "on-reading-well.md",
    "sha256": "7ac1bc4a5e4b7a9f2e8c1f5a6d3b8c2e4f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c",
    "lastSeenBytes": 4821
  },
  "annotations": [
    {
      "id": "01HP8XYZABCDEFGHJKMNPQRSTV",
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
      "id": "01HP8ABCABCDEFGHJKMNPQRSTV",
      "type": "note",
      "anchor": {
        "text": "thesis",
        "prefix": "This is the ",
        "suffix": " of the whole essay.",
        "blockHint": "p:4"
      },
      "body": "This is the thesis of the whole essay.",
      "createdAt": "2026-04-21T14:33:00Z",
      "updatedAt": "2026-04-21T14:33:00Z"
    },
    {
      "id": "01HP8DEFABCDEFGHJKMNPQRSTV",
      "type": "drawing",
      "anchorBlock": "p:4",
      "caption": "arrow pointing at 'dialogue'",
      "strokes": [
        { "color": "#d6336c", "width": 2, "points": [[12, 40], [13, 41], [20, 60]] }
      ],
      "createdAt": "2026-04-21T14:34:00Z",
      "updatedAt": "2026-04-21T14:34:00Z"
    }
  ]
}
```

`tests/fixtures/sidecar-malformed.json` (invalid — missing required `anchor`):
```json
{
  "_comment": "broken",
  "$schema": "remarkdown/v1",
  "document": { "path": "x.md", "sha256": "0", "lastSeenBytes": 0 },
  "annotations": [
    { "id": "01X", "type": "highlight", "color": "#fff" }
  ]
}
```

- [ ] **Step 2: Write failing test for `schema.ts`**

`tests/unit/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SidecarSchema } from '../../src/lib/schema';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures', name), 'utf-8');

describe('SidecarSchema', () => {
  it('accepts an empty-annotations sidecar', () => {
    const data = JSON.parse(fixture('sidecar-empty.json'));
    const result = SidecarSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts a sidecar with highlight + note + drawing', () => {
    const data = JSON.parse(fixture('sidecar-valid.json'));
    const result = SidecarSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.annotations).toHaveLength(3);
      expect(result.data.annotations[0].type).toBe('highlight');
      expect(result.data.annotations[1].type).toBe('note');
      expect(result.data.annotations[2].type).toBe('drawing');
    }
  });

  it('rejects a highlight missing its anchor', () => {
    const data = JSON.parse(fixture('sidecar-malformed.json'));
    const result = SidecarSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('preserves unknown top-level fields', () => {
    const data = {
      _comment: 'x',
      $schema: 'remarkdown/v1',
      document: { path: 'a.md', sha256: 'abc', lastSeenBytes: 1 },
      annotations: [],
      futureField: { hello: 'world' },
    };
    const result = SidecarSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).futureField).toEqual({ hello: 'world' });
    }
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run tests/unit/schema.test.ts
```

Expected: FAIL — `Cannot find module '../../src/lib/schema'`.

- [ ] **Step 4: Implement `src/lib/schema.ts`**

```ts
import { z } from 'zod';

export const AnchorSchema = z.object({
  text: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  blockHint: z.string(),
});

export const HighlightSchema = z.object({
  id: z.string(),
  type: z.literal('highlight'),
  color: z.string(),
  anchor: AnchorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const NoteSchema = z.object({
  id: z.string(),
  type: z.literal('note'),
  anchor: AnchorSchema,
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const StrokeSchema = z.object({
  color: z.string(),
  width: z.number(),
  points: z.array(z.tuple([z.number(), z.number()]).rest(z.number())),
});

export const DrawingSchema = z.object({
  id: z.string(),
  type: z.literal('drawing'),
  anchorBlock: z.string(),
  caption: z.string().optional(),
  strokes: z.array(StrokeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AnnotationSchema = z.discriminatedUnion('type', [
  HighlightSchema,
  NoteSchema,
  DrawingSchema,
]);

export const DocumentMetaSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  lastSeenBytes: z.number().int().nonnegative(),
});

// passthrough() preserves unknown fields for forward compatibility.
export const SidecarSchema = z
  .object({
    _comment: z.string().optional(),
    $schema: z.string(),
    document: DocumentMetaSchema,
    annotations: z.array(AnnotationSchema),
  })
  .passthrough();

export type Anchor = z.infer<typeof AnchorSchema>;
export type Highlight = z.infer<typeof HighlightSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type Stroke = z.infer<typeof StrokeSchema>;
export type Drawing = z.infer<typeof DrawingSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;
export type Sidecar = z.infer<typeof SidecarSchema>;

export type Tool = 'cursor' | 'highlight' | 'note' | 'draw';
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run tests/unit/schema.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schema.ts tests/unit/schema.test.ts tests/fixtures/sidecar-*.json
git commit -m "feat: add Zod schema for sidecar JSON"
```

---

### Task 7: `sidecar.ts` load/serialize

**Files:**
- Create: `src/lib/sidecar.ts`, `tests/unit/sidecar.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/sidecar.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSidecar, serializeSidecar, emptySidecar } from '../../src/lib/sidecar';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures', name), 'utf-8');

describe('sidecar', () => {
  it('loads a valid sidecar JSON string', () => {
    const result = loadSidecar(fixture('sidecar-valid.json'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.annotations).toHaveLength(3);
    }
  });

  it('returns an error for malformed JSON', () => {
    const result = loadSidecar('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
    }
  });

  it('returns an error for schema-invalid sidecar', () => {
    const result = loadSidecar(fixture('sidecar-malformed.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('schema');
    }
  });

  it('round-trips valid sidecar without losing unknown fields', () => {
    const original = JSON.parse(fixture('sidecar-valid.json'));
    original.futureField = { flavor: 'strawberry' };
    const loaded = loadSidecar(JSON.stringify(original));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const reserialized = JSON.parse(serializeSidecar(loaded.value));
      expect(reserialized.futureField).toEqual({ flavor: 'strawberry' });
    }
  });

  it('emptySidecar produces a valid, minimal sidecar', () => {
    const s = emptySidecar({ path: 'a.md', sha256: 'abc', lastSeenBytes: 42 });
    const json = serializeSidecar(s);
    const reloaded = loadSidecar(json);
    expect(reloaded.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/sidecar.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/sidecar.ts`**

```ts
import { SidecarSchema, type Sidecar, type DocumentMeta } from './schema';

export type LoadError =
  | { kind: 'parse'; message: string }
  | { kind: 'schema'; message: string };

export type LoadResult =
  | { ok: true; value: Sidecar }
  | { ok: false; error: LoadError };

export function loadSidecar(json: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: { kind: 'parse', message: (e as Error).message } };
  }
  const validated = SidecarSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: { kind: 'schema', message: validated.error.message },
    };
  }
  return { ok: true, value: validated.data };
}

export function serializeSidecar(sidecar: Sidecar): string {
  return JSON.stringify(sidecar, null, 2) + '\n';
}

export function emptySidecar(doc: DocumentMeta): Sidecar {
  return {
    _comment: `remarkdown annotations for: ${doc.path}`,
    $schema: 'remarkdown/v1',
    document: doc,
    annotations: [],
  };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run tests/unit/sidecar.test.ts
```

Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sidecar.ts tests/unit/sidecar.test.ts
git commit -m "feat: add sidecar load/serialize with schema validation"
```

---

### Task 8: MarkdownRenderer — core + block-id tagging

**Files:**
- Create: `src/lib/MarkdownRenderer.ts`, `tests/unit/MarkdownRenderer.test.ts`, `tests/fixtures/simple.md`

- [ ] **Step 1: Write fixture**

`tests/fixtures/simple.md`:
```markdown
# Heading

First paragraph with **bold** and *italic*.

Second paragraph.

- one
- two
- three
```

- [ ] **Step 2: Write failing tests**

```ts
// tests/unit/MarkdownRenderer.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '../../src/lib/MarkdownRenderer';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures', name), 'utf-8');

describe('MarkdownRenderer.render (core)', () => {
  it('returns html, plaintext, and blocks for a simple document', async () => {
    const result = await render(fixture('simple.md'));
    expect(result.html).toContain('<h1');
    expect(result.html).toContain('Heading');
    expect(result.plaintext).toContain('First paragraph with bold and italic.');
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('tags top-level children with data-block-id', async () => {
    const { html } = await render('# A\n\nB\n\nC');
    // Expect something like id="h:1", "p:2", "p:3"
    expect(html).toMatch(/data-block-id="h:1"/);
    expect(html).toMatch(/data-block-id="p:2"/);
    expect(html).toMatch(/data-block-id="p:3"/);
  });

  it('block ids are stable across renders of the same input', async () => {
    const a = await render(fixture('simple.md'));
    const b = await render(fixture('simple.md'));
    expect(a.blocks).toEqual(b.blocks);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run tests/unit/MarkdownRenderer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement minimal renderer (core only; plugins added in Tasks 9–12)**

```ts
// src/lib/MarkdownRenderer.ts
import MarkdownIt from 'markdown-it';

export interface RenderResult {
  html: string;
  plaintext: string;
  blocks: string[]; // e.g., ["h:1", "p:2", "ul:3"]
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
});

const BLOCK_TAG_TO_KIND: Record<string, string> = {
  H1: 'h', H2: 'h', H3: 'h', H4: 'h', H5: 'h', H6: 'h',
  P: 'p',
  UL: 'ul', OL: 'ol',
  BLOCKQUOTE: 'bq',
  PRE: 'pre',
  HR: 'hr',
  TABLE: 'table',
  DIV: 'div',
  FIGURE: 'fig',
};

function tagTopLevelBlocks(html: string): { html: string; blocks: string[] } {
  // Use a DOMParser in environments that have one (jsdom in tests, webview at runtime).
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return { html, blocks: [] };

  const blocks: string[] = [];
  let idx = 0;
  for (const child of Array.from(root.children)) {
    idx += 1;
    const kind = BLOCK_TAG_TO_KIND[child.tagName] ?? child.tagName.toLowerCase();
    const id = `${kind}:${idx}`;
    child.setAttribute('data-block-id', id);
    blocks.push(id);
  }
  return { html: root.innerHTML, blocks };
}

function extractPlaintext(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export async function render(markdown: string): Promise<RenderResult> {
  const rawHtml = md.render(markdown);
  const { html, blocks } = tagTopLevelBlocks(rawHtml);
  const plaintext = extractPlaintext(html);
  return { html, plaintext, blocks };
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run tests/unit/MarkdownRenderer.test.ts
```

Expected: 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/MarkdownRenderer.ts tests/unit/MarkdownRenderer.test.ts tests/fixtures/simple.md
git commit -m "feat: add markdown renderer with block-id tagging"
```

---

### Task 9: MarkdownRenderer — footnotes + task lists + tables

**Files:**
- Modify: `src/lib/MarkdownRenderer.ts`
- Modify: `tests/unit/MarkdownRenderer.test.ts`
- Create: `tests/fixtures/tables.md`

- [ ] **Step 1: Write fixture**

`tests/fixtures/tables.md`:
```markdown
# Features

- [x] Done item
- [ ] Pending item

A footnote reference.[^1]

| Col A | Col B |
|-------|-------|
| 1     | 2     |
| 3     | 4     |

[^1]: Here is the footnote body.
```

- [ ] **Step 2: Add failing tests**

Append to `tests/unit/MarkdownRenderer.test.ts`:

```ts
describe('MarkdownRenderer.render (plugins: footnote/tasklist/tables)', () => {
  it('renders task-list checkboxes as input[type=checkbox]', async () => {
    const { html } = await render(fixture('tables.md'));
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toMatch(/<input[^>]*type="checkbox"(?![^>]*checked)/);
  });

  it('renders footnote references and footnote section', async () => {
    const { html } = await render(fixture('tables.md'));
    expect(html).toMatch(/footnote-ref/);
    expect(html).toMatch(/footnotes/);
  });

  it('renders GFM tables', async () => {
    const { html } = await render(fixture('tables.md'));
    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<tbody');
  });
});
```

- [ ] **Step 3: Run to verify failures**

```bash
npx vitest run tests/unit/MarkdownRenderer.test.ts
```

Expected: 3 new tests fail (core markdown-it handles tables but footnote + task-lists require plugins).

- [ ] **Step 4: Wire up plugins in `MarkdownRenderer.ts`**

Replace the top of the file (imports + `md` construction):

```ts
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
})
  .use(footnote)
  .use(taskLists, { enabled: true, label: false });
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run tests/unit/MarkdownRenderer.test.ts
```

Expected: all tests passing (core + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/MarkdownRenderer.ts tests/unit/MarkdownRenderer.test.ts tests/fixtures/tables.md
git commit -m "feat: enable footnote and task-list plugins in renderer"
```

---

### Task 10: MarkdownRenderer — KaTeX math

**Files:**
- Modify: `src/lib/MarkdownRenderer.ts`
- Modify: `tests/unit/MarkdownRenderer.test.ts`
- Create: `tests/fixtures/math.md`

- [ ] **Step 1: Write fixture**

`tests/fixtures/math.md`:
```markdown
# Math

Inline: $E = mc^2$ in the middle of a line.

Display block:

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$
```

- [ ] **Step 2: Add failing tests**

Append to `tests/unit/MarkdownRenderer.test.ts`:

```ts
describe('MarkdownRenderer.render (KaTeX)', () => {
  it('renders inline math as KaTeX HTML', async () => {
    const { html } = await render(fixture('math.md'));
    expect(html).toMatch(/class="katex"/);
  });

  it('renders display math in a block container', async () => {
    const { html } = await render(fixture('math.md'));
    expect(html).toMatch(/katex-display/);
  });
});
```

- [ ] **Step 3: Run to verify failures**

```bash
npx vitest run tests/unit/MarkdownRenderer.test.ts
```

Expected: 2 new tests fail.

- [ ] **Step 4: Add KaTeX plugin and global styles**

Add to `MarkdownRenderer.ts`:

```ts
import katex from '@vscode/markdown-it-katex';
```

And update the chained `.use` calls:

```ts
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
})
  .use(footnote)
  .use(taskLists, { enabled: true, label: false })
  .use(katex.default ?? katex);
```

Note: `@vscode/markdown-it-katex` may export as `default` or as the module itself depending on version. The `katex.default ?? katex` guards against both.

- [ ] **Step 5: Import KaTeX CSS globally**

Append to `src/styles/theme-dark.css`:

```css
@import 'katex/dist/katex.min.css';
```

- [ ] **Step 6: Run to verify it passes**

```bash
npx vitest run tests/unit/MarkdownRenderer.test.ts
```

Expected: all tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/MarkdownRenderer.ts src/styles/theme-dark.css tests/unit/MarkdownRenderer.test.ts tests/fixtures/math.md
git commit -m "feat: add KaTeX math rendering"
```

---

### Task 11: MarkdownRenderer — Shiki code highlighting

**Files:**
- Modify: `src/lib/MarkdownRenderer.ts`
- Modify: `tests/unit/MarkdownRenderer.test.ts`
- Create: `tests/fixtures/code.md`

- [ ] **Step 1: Write fixture**

`tests/fixtures/code.md`:
````markdown
# Code

```ts
const hello = (name: string): string => `hello, ${name}`;
```

```rust
fn main() {
    println!("Hello, world!");
}
```

```
plain fence with no language
```
````

- [ ] **Step 2: Add failing tests**

Append to `tests/unit/MarkdownRenderer.test.ts`:

```ts
describe('MarkdownRenderer.render (Shiki)', () => {
  it('highlights a TypeScript code fence with Shiki output (pre.shiki class)', async () => {
    const { html } = await render(fixture('code.md'));
    expect(html).toMatch(/class="shiki[^"]*github-dark/);
    expect(html).toMatch(/<span[^>]*style="color:/);
  });

  it('falls back to a plain <pre><code> for fences without a language', async () => {
    const { html } = await render('```\njust text\n```\n');
    expect(html).toMatch(/<pre><code>just text\n<\/code><\/pre>/);
  });
});
```

- [ ] **Step 3: Run to verify failures**

```bash
npx vitest run tests/unit/MarkdownRenderer.test.ts
```

Expected: new tests fail (fences currently render with default markdown-it).

- [ ] **Step 4: Wire Shiki as a custom fence renderer**

Add to `MarkdownRenderer.ts`:

```ts
import { getSingletonHighlighter, type Highlighter } from 'shiki';

// Preload common languages lazily the first time render() is called.
const SUPPORTED_LANGS = [
  'typescript', 'javascript', 'tsx', 'jsx', 'rust', 'python', 'go',
  'bash', 'shell', 'json', 'yaml', 'toml', 'sql', 'html', 'css',
  'markdown', 'svelte',
];

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = getSingletonHighlighter({
      themes: ['github-dark'],
      langs: SUPPORTED_LANGS,
    });
  }
  return highlighterPromise;
}

async function highlightFences(html: string): Promise<string> {
  // Replace all <pre><code class="language-xyz">…</code></pre> with Shiki output.
  const fenceRe = /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g;
  const matches = [...html.matchAll(fenceRe)];
  if (matches.length === 0) return html;

  const highlighter = await getHighlighter();
  let out = html;
  for (const m of matches) {
    const lang = m[1];
    const raw = decodeEntities(m[2]);
    const resolvedLang = highlighter.getLoadedLanguages().includes(lang as never)
      ? lang
      : 'text';
    const replaced = highlighter.codeToHtml(raw, { lang: resolvedLang, theme: 'github-dark' });
    out = out.replace(m[0], replaced);
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
```

Then update `render()`:

```ts
export async function render(markdown: string): Promise<RenderResult> {
  const rawHtml = md.render(markdown);
  const highlightedHtml = await highlightFences(rawHtml);
  const { html, blocks } = tagTopLevelBlocks(highlightedHtml);
  const plaintext = extractPlaintext(html);
  return { html, plaintext, blocks };
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run tests/unit/MarkdownRenderer.test.ts
```

Expected: all tests passing. Shiki's first call may take a couple seconds in tests (WASM init).

If test time blows up, increase Vitest hook timeout in `vitest.config.ts`: `test: { ..., testTimeout: 15000 }`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/MarkdownRenderer.ts tests/unit/MarkdownRenderer.test.ts tests/fixtures/code.md vitest.config.ts
git commit -m "feat: highlight code fences with Shiki (github-dark)"
```

---

### Task 12: MarkdownRenderer — image `src` rewriting

**Files:**
- Modify: `src/lib/MarkdownRenderer.ts`
- Modify: `tests/unit/MarkdownRenderer.test.ts`

The renderer takes an optional `baseDir` and rewrites relative `<img src>` paths to absolute `asset://` URLs via Tauri's `convertFileSrc`. The function accepts a pluggable `toAssetUrl` so tests can verify behavior without Tauri loaded.

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/MarkdownRenderer.test.ts`:

```ts
describe('MarkdownRenderer.render (image src rewriting)', () => {
  it('rewrites relative image srcs using the provided toAssetUrl function', async () => {
    const md = '![pic](./img/a.png)\n\n![other](../sibling/b.jpg)';
    const calls: string[] = [];
    const { html } = await render(md, {
      baseDir: '/tmp/doc',
      toAssetUrl: (abs) => {
        calls.push(abs);
        return `asset://localhost/${abs.replace(/^\//, '')}`;
      },
    });
    expect(html).toContain('asset://localhost/tmp/doc/img/a.png');
    expect(html).toContain('asset://localhost/tmp/sibling/b.jpg');
    expect(calls).toContain('/tmp/doc/img/a.png');
  });

  it('leaves absolute URLs (http/https/asset/data) untouched', async () => {
    const md = '![a](https://example.com/x.png)\n\n![b](data:image/png;base64,AAAA)';
    const { html } = await render(md, { baseDir: '/tmp/doc', toAssetUrl: () => 'NEVER' });
    expect(html).toContain('https://example.com/x.png');
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).not.toContain('NEVER');
  });

  it('leaves images as-is when no baseDir is provided', async () => {
    const { html } = await render('![x](./p.png)');
    expect(html).toContain('src="./p.png"');
  });
});
```

- [ ] **Step 2: Run to verify failures**

```bash
npx vitest run tests/unit/MarkdownRenderer.test.ts
```

Expected: 3 new tests fail — current signature is `render(markdown)`.

- [ ] **Step 3: Update `render` signature and implement src rewriting**

Replace the exported `render` and add helpers:

```ts
export interface RenderOptions {
  baseDir?: string;
  toAssetUrl?: (absolutePath: string) => string;
}

function isAbsoluteUrl(src: string): boolean {
  return /^(https?:|asset:|data:|file:)/i.test(src) || src.startsWith('/');
  // Note: leading slash is treated as already-absolute within the webview.
}

function joinPath(baseDir: string, rel: string): string {
  // Minimal POSIX-style join (our stored paths are normalized to forward slashes).
  const parts = (baseDir + '/' + rel).split('/').filter(Boolean);
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return '/' + stack.join('/');
}

function rewriteImageSrcs(html: string, opts: RenderOptions): string {
  if (!opts.baseDir || !opts.toAssetUrl) return html;
  const { baseDir, toAssetUrl } = opts;
  return html.replace(/<img([^>]*?)src="([^"]+)"([^>]*)>/g, (m, pre, src, post) => {
    if (isAbsoluteUrl(src)) return m;
    const abs = joinPath(baseDir, src);
    return `<img${pre}src="${toAssetUrl(abs)}"${post}>`;
  });
}

export async function render(markdown: string, options: RenderOptions = {}): Promise<RenderResult> {
  const rawHtml = md.render(markdown);
  const highlightedHtml = await highlightFences(rawHtml);
  const withImages = rewriteImageSrcs(highlightedHtml, options);
  const { html, blocks } = tagTopLevelBlocks(withImages);
  const plaintext = extractPlaintext(html);
  return { html, plaintext, blocks };
}
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/MarkdownRenderer.test.ts
```

Expected: all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/MarkdownRenderer.ts tests/unit/MarkdownRenderer.test.ts
git commit -m "feat: rewrite relative image srcs via injectable toAssetUrl"
```

End of Phase 2. All pure modules are implemented and tested. Next is Rust.

---

## Phase 3 — Rust host commands (Tasks 13–17)

Commands are implemented with unit tests in Rust. They accept and return `serde_json`-friendly types.

### Task 13: Rust — `open_file_dialog` command

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Write `commands.rs`**

```rust
use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, thiserror::Error, Serialize)]
pub enum CommandError {
    #[error("dialog cancelled")]
    Cancelled,
    #[error("io error: {0}")]
    Io(String),
    #[error("file not utf-8")]
    NotUtf8,
    #[error("sidecar malformed: {0}")]
    SidecarMalformed(String),
}

impl From<std::io::Error> for CommandError {
    fn from(e: std::io::Error) -> Self { CommandError::Io(e.to_string()) }
}

#[tauri::command]
pub async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, CommandError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    match rx.await {
        Ok(Some(path)) => Ok(Some(path)),
        Ok(None) => Ok(None),
        Err(_) => Err(CommandError::Cancelled),
    }
}
```

(Dependencies are already in `Cargo.toml` from Task 2; no changes needed here.)

- [ ] **Step 2: Register command in `main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod recent;
mod sidecar;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_file_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify the Rust compiles**

```bash
cd src-tauri && cargo check
```

Expected: clean compile (warnings for unused `recent`/`sidecar` modules are fine — they're filled in later tasks).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(rust): add open_file_dialog command"
```

---

### Task 14: Rust — `read_document` command

Reads file contents, computes SHA256, reads the sidecar next to it if present, returns everything to the frontend as one JSON struct.

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add `read_document` to `commands.rs`**

Append:

```rust
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

fn sidecar_path_for(md_path: &Path) -> PathBuf {
    let mut s = md_path.as_os_str().to_owned();
    s.push(".remarkdown.json");
    PathBuf::from(s)
}

#[derive(Debug, Serialize)]
pub struct ReadDocumentResult {
    pub path: String,
    pub dir: String,
    pub markdown: String,
    pub sidecar_raw: Option<String>, // raw JSON string or null; frontend validates
    pub sha256: String,
    pub bytes: u64,
}

#[tauri::command]
pub fn read_document(path: String) -> Result<ReadDocumentResult, CommandError> {
    let md_path = PathBuf::from(&path);
    let bytes = fs::read(&md_path)?;
    let markdown = String::from_utf8(bytes.clone()).map_err(|_| CommandError::NotUtf8)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256 = format!("{:x}", hasher.finalize());

    let sc_path = sidecar_path_for(&md_path);
    let sidecar_raw = if sc_path.exists() {
        Some(fs::read_to_string(&sc_path)?)
    } else {
        None
    };

    let dir = md_path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    Ok(ReadDocumentResult {
        path: md_path.to_string_lossy().into_owned(),
        dir,
        markdown,
        sidecar_raw,
        sha256,
        bytes: bytes.len() as u64,
    })
}
```

- [ ] **Step 2: Register in `main.rs`**

Update `invoke_handler`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::open_file_dialog,
    commands::read_document,
])
```

- [ ] **Step 3: Add Rust unit test**

Append to `commands.rs` (or create `src-tauri/src/commands/tests.rs`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn read_document_returns_markdown_and_sha() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();

        let result = read_document(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.markdown, "# Hello\n");
        assert_eq!(result.bytes, 8);
        assert_eq!(result.sidecar_raw, None);
        assert_eq!(result.sha256.len(), 64);
    }

    #[test]
    fn read_document_returns_sidecar_if_present() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        let sc = dir.path().join("a.md.remarkdown.json");
        fs::write(&md, b"# Hello\n").unwrap();
        fs::write(&sc, b"{\"x\":1}").unwrap();

        let result = read_document(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.sidecar_raw.as_deref(), Some("{\"x\":1}"));
    }

    #[test]
    fn read_document_rejects_non_utf8() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, &[0xff, 0xfe, 0xfd]).unwrap();

        let result = read_document(md.to_string_lossy().into_owned());
        assert!(matches!(result, Err(CommandError::NotUtf8)));
    }
}
```

- [ ] **Step 4: Run Rust tests**

```bash
cd src-tauri && cargo test
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(rust): add read_document command with SHA256 and sidecar pickup"
```

---

### Task 15: Rust — `write_sidecar` with atomic rename

**Files:**
- Modify: `src-tauri/src/sidecar.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Implement atomic write in `sidecar.rs`**

```rust
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

pub fn atomic_write(target: &Path, contents: &[u8]) -> std::io::Result<()> {
    let dir = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "target has no parent")
    })?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".remarkdown-tmp-")
        .tempfile_in(dir)?;
    tmp.write_all(contents)?;
    tmp.as_file().sync_all()?;
    // persist performs a rename; on Windows this replaces existing atomically when supported.
    tmp.persist(target).map_err(|e| e.error)?;
    // fsync the directory on unix for durability (best-effort).
    #[cfg(unix)]
    if let Ok(dir_file) = File::open(dir) {
        let _ = dir_file.sync_all();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn atomic_write_creates_and_replaces() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("a.md.remarkdown.json");
        atomic_write(&target, b"first").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "first");
        atomic_write(&target, b"second").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "second");
    }
}
```

- [ ] **Step 2: Add `write_sidecar` command in `commands.rs`**

```rust
#[tauri::command]
pub fn write_sidecar(md_path: String, json: String) -> Result<(), CommandError> {
    let md = PathBuf::from(md_path);
    let sc = sidecar_path_for(&md);
    crate::sidecar::atomic_write(&sc, json.as_bytes())?;
    Ok(())
}
```

- [ ] **Step 3: Register in `main.rs`**

Update `invoke_handler`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::open_file_dialog,
    commands::read_document,
    commands::write_sidecar,
])
```

- [ ] **Step 4: Run Rust tests**

```bash
cd src-tauri && cargo test
```

Expected: 4 tests passing (3 from Task 14 + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sidecar.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(rust): add atomic write_sidecar command"
```

---

### Task 16: Rust — recent files store

**Files:**
- Modify: `src-tauri/src/recent.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

A small helper that keeps the 10 most recent paths in `{app_data_dir}/recent.json`.

- [ ] **Step 1: Implement `recent.rs`**

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const MAX_RECENT: usize = 10;

#[derive(Serialize, Deserialize, Default)]
struct RecentFile { paths: Vec<String> }

fn recent_path(app: &tauri::AppHandle) -> Result<PathBuf, crate::commands::CommandError> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| {
        crate::commands::CommandError::Io(format!("no app_data_dir: {e}"))
    })?;
    fs::create_dir_all(&dir).map_err(|e| crate::commands::CommandError::Io(e.to_string()))?;
    Ok(dir.join("recent.json"))
}

fn load(app: &tauri::AppHandle) -> Result<RecentFile, crate::commands::CommandError> {
    let p = recent_path(app)?;
    if !p.exists() { return Ok(RecentFile::default()); }
    let raw = fs::read_to_string(&p).map_err(|e| crate::commands::CommandError::Io(e.to_string()))?;
    let parsed = serde_json::from_str::<RecentFile>(&raw).unwrap_or_default();
    Ok(parsed)
}

fn save(app: &tauri::AppHandle, r: &RecentFile) -> Result<(), crate::commands::CommandError> {
    let p = recent_path(app)?;
    let json = serde_json::to_string_pretty(r).map_err(|e| crate::commands::CommandError::Io(e.to_string()))?;
    crate::sidecar::atomic_write(&p, json.as_bytes()).map_err(|e| crate::commands::CommandError::Io(e.to_string()))?;
    Ok(())
}

pub fn push(app: &tauri::AppHandle, path: String) -> Result<Vec<String>, crate::commands::CommandError> {
    let mut r = load(app)?;
    r.paths.retain(|p| p != &path);
    r.paths.insert(0, path);
    r.paths.truncate(MAX_RECENT);
    save(app, &r)?;
    Ok(r.paths.clone())
}

pub fn list(app: &tauri::AppHandle) -> Result<Vec<String>, crate::commands::CommandError> {
    Ok(load(app)?.paths)
}

pub fn clear(app: &tauri::AppHandle) -> Result<(), crate::commands::CommandError> {
    save(app, &RecentFile::default())
}
```

- [ ] **Step 2: Add commands wrapping `recent` in `commands.rs`**

```rust
#[tauri::command]
pub fn push_recent(app: tauri::AppHandle, path: String) -> Result<Vec<String>, CommandError> {
    crate::recent::push(&app, path)
}

#[tauri::command]
pub fn list_recent(app: tauri::AppHandle) -> Result<Vec<String>, CommandError> {
    crate::recent::list(&app)
}

#[tauri::command]
pub fn clear_recent(app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::recent::clear(&app)
}
```

- [ ] **Step 3: Register in `main.rs`**

```rust
.invoke_handler(tauri::generate_handler![
    commands::open_file_dialog,
    commands::read_document,
    commands::write_sidecar,
    commands::push_recent,
    commands::list_recent,
    commands::clear_recent,
])
```

- [ ] **Step 4: Verify compile**

```bash
cd src-tauri && cargo check
```

Expected: clean. (We don't unit-test the AppHandle-using code here; it's integration-tested via the smoke run.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/recent.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(rust): add recent-files commands (push/list/clear)"
```

---

### Task 17: `tauri-api.ts` — typed invoke wrapper

**Files:**
- Create: `src/lib/tauri-api.ts`
- Create: `tests/unit/tauri-api.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/tauri-api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the @tauri-apps/api modules so tests run without a Tauri runtime.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import { invoke } from '@tauri-apps/api/core';
import { openFileDialog, readDocument, writeSidecar, pushRecent, listRecent, toAssetUrl } from '../../src/lib/tauri-api';

describe('tauri-api wrapper', () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it('openFileDialog calls "open_file_dialog" and returns the path', async () => {
    vi.mocked(invoke).mockResolvedValue('/tmp/x.md');
    const result = await openFileDialog();
    expect(invoke).toHaveBeenCalledWith('open_file_dialog');
    expect(result).toBe('/tmp/x.md');
  });

  it('readDocument passes the path arg and returns typed result (snake_case from Rust)', async () => {
    // Rust serde serializes fields as snake_case by default — test with that shape.
    vi.mocked(invoke).mockResolvedValue({
      path: '/tmp/x.md',
      dir: '/tmp',
      markdown: '# hi',
      sidecar_raw: null,
      sha256: 'abc',
      bytes: 4,
    });
    const result = await readDocument('/tmp/x.md');
    expect(invoke).toHaveBeenCalledWith('read_document', { path: '/tmp/x.md' });
    expect(result.markdown).toBe('# hi');
    expect(result.sidecarRaw).toBeNull();
  });

  it('readDocument surfaces sidecar_raw content', async () => {
    vi.mocked(invoke).mockResolvedValue({
      path: '/tmp/x.md',
      dir: '/tmp',
      markdown: '',
      sidecar_raw: '{"annotations":[]}',
      sha256: 'abc',
      bytes: 0,
    });
    const result = await readDocument('/tmp/x.md');
    expect(result.sidecarRaw).toBe('{"annotations":[]}');
  });

  it('writeSidecar forwards mdPath and json', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await writeSidecar('/tmp/x.md', '{}');
    expect(invoke).toHaveBeenCalledWith('write_sidecar', { mdPath: '/tmp/x.md', json: '{}' });
  });

  it('pushRecent returns the updated list', async () => {
    vi.mocked(invoke).mockResolvedValue(['/a', '/b']);
    const result = await pushRecent('/a');
    expect(invoke).toHaveBeenCalledWith('push_recent', { path: '/a' });
    expect(result).toEqual(['/a', '/b']);
  });

  it('listRecent returns a list', async () => {
    vi.mocked(invoke).mockResolvedValue(['/a']);
    const result = await listRecent();
    expect(invoke).toHaveBeenCalledWith('list_recent');
    expect(result).toEqual(['/a']);
  });

  it('toAssetUrl delegates to convertFileSrc', () => {
    expect(toAssetUrl('/tmp/x.png')).toBe('asset://localhost//tmp/x.png');
  });
});
```

- [ ] **Step 2: Run to verify failures**

```bash
npx vitest run tests/unit/tauri-api.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tauri-api.ts`**

```ts
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

export interface ReadDocumentResult {
  path: string;
  dir: string;
  markdown: string;
  sidecarRaw: string | null;
  sha256: string;
  bytes: number;
}

// Tauri serializes snake_case Rust fields to camelCase by default; make that explicit in types.
// If Tauri is configured to preserve snake_case, add a mapping layer here.

export async function openFileDialog(): Promise<string | null> {
  const result = await invoke<string | null>('open_file_dialog');
  return result;
}

export async function readDocument(path: string): Promise<ReadDocumentResult> {
  // Rust returns fields with snake_case by default in tauri 2.x unless configured.
  // We remap once here so the rest of the frontend sees camelCase only.
  const raw = await invoke<any>('read_document', { path });
  return {
    path: raw.path,
    dir: raw.dir,
    markdown: raw.markdown,
    sidecarRaw: raw.sidecar_raw ?? raw.sidecarRaw ?? null,
    sha256: raw.sha256,
    bytes: raw.bytes,
  };
}

export async function writeSidecar(mdPath: string, json: string): Promise<void> {
  await invoke('write_sidecar', { mdPath, json });
}

export async function pushRecent(path: string): Promise<string[]> {
  return await invoke<string[]>('push_recent', { path });
}

export async function listRecent(): Promise<string[]> {
  return await invoke<string[]>('list_recent');
}

export async function clearRecent(): Promise<void> {
  await invoke('clear_recent');
}

export function toAssetUrl(absolutePath: string): string {
  return convertFileSrc(absolutePath);
}
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/tauri-api.test.ts
```

Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri-api.ts tests/unit/tauri-api.test.ts
git commit -m "feat: add typed tauri-api wrapper"
```

End of Phase 3. Rust is exposed via typed TS functions and all modules are tested.

---

## Phase 4 — Stores (Tasks 18–19)

### Task 18: `doc` store + loader

**Files:**
- Create: `src/stores/doc.ts`, `tests/unit/doc-store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/doc-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  readDocument: vi.fn(),
  toAssetUrl: (p: string) => `asset://localhost/${p}`,
}));

import { readDocument } from '../../src/lib/tauri-api';
import { doc, loadDocument, clearDocument } from '../../src/stores/doc';

describe('doc store', () => {
  beforeEach(() => {
    vi.mocked(readDocument).mockReset();
    clearDocument();
  });

  it('starts as null', () => {
    expect(get(doc)).toBeNull();
  });

  it('loadDocument populates the store with rendered html', async () => {
    vi.mocked(readDocument).mockResolvedValue({
      path: '/tmp/a.md',
      dir: '/tmp',
      markdown: '# Hello\n',
      sidecarRaw: null,
      sha256: 'abc',
      bytes: 8,
    });
    await loadDocument('/tmp/a.md');
    const value = get(doc);
    expect(value).not.toBeNull();
    expect(value!.path).toBe('/tmp/a.md');
    expect(value!.html).toContain('Hello');
    expect(value!.sha256).toBe('abc');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/doc-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/stores/doc.ts`**

```ts
import { writable } from 'svelte/store';
import { readDocument, toAssetUrl } from '../lib/tauri-api';
import { render } from '../lib/MarkdownRenderer';

export interface DocState {
  path: string;
  dir: string;
  sha256: string;
  bytes: number;
  markdown: string;
  html: string;
  plaintext: string;
  blocks: string[];
  sidecarRaw: string | null;
}

export const doc = writable<DocState | null>(null);

export async function loadDocument(path: string): Promise<void> {
  const r = await readDocument(path);
  const { html, plaintext, blocks } = await render(r.markdown, {
    baseDir: r.dir,
    toAssetUrl,
  });
  doc.set({
    path: r.path,
    dir: r.dir,
    sha256: r.sha256,
    bytes: r.bytes,
    markdown: r.markdown,
    html,
    plaintext,
    blocks,
    sidecarRaw: r.sidecarRaw,
  });
}

export function clearDocument(): void {
  doc.set(null);
}
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/doc-store.test.ts
```

Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/stores/doc.ts tests/unit/doc-store.test.ts
git commit -m "feat: add doc store with loader"
```

---

### Task 19: `recent` store

**Files:**
- Create: `src/stores/recent.ts`, `tests/unit/recent-store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/recent-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  pushRecent: vi.fn(),
  listRecent: vi.fn(),
}));

import { pushRecent, listRecent } from '../../src/lib/tauri-api';
import { recent, refreshRecent, recordRecent } from '../../src/stores/recent';

describe('recent store', () => {
  beforeEach(() => {
    vi.mocked(pushRecent).mockReset();
    vi.mocked(listRecent).mockReset();
    recent.set([]);
  });

  it('refreshRecent populates store from list_recent', async () => {
    vi.mocked(listRecent).mockResolvedValue(['/a', '/b']);
    await refreshRecent();
    expect(get(recent)).toEqual(['/a', '/b']);
  });

  it('recordRecent calls push_recent and updates store', async () => {
    vi.mocked(pushRecent).mockResolvedValue(['/new', '/a']);
    await recordRecent('/new');
    expect(pushRecent).toHaveBeenCalledWith('/new');
    expect(get(recent)).toEqual(['/new', '/a']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/recent-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/stores/recent.ts`**

```ts
import { writable } from 'svelte/store';
import { listRecent, pushRecent } from '../lib/tauri-api';

export const recent = writable<string[]>([]);

export async function refreshRecent(): Promise<void> {
  const list = await listRecent();
  recent.set(list);
}

export async function recordRecent(path: string): Promise<void> {
  const list = await pushRecent(path);
  recent.set(list);
}
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/recent-store.test.ts
```

Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/stores/recent.ts tests/unit/recent-store.test.ts
git commit -m "feat: add recent store"
```

End of Phase 4.

---

## Phase 5 — UI chrome (Tasks 20–23)

### Task 20: GlassMenu — hamburger + Open action

**Files:**
- Create: `src/components/GlassMenu.svelte`, `tests/component/GlassMenu.test.ts`

- [ ] **Step 1: Write failing component test**

```ts
// tests/component/GlassMenu.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import GlassMenu from '../../src/components/GlassMenu.svelte';

vi.mock('../../src/lib/tauri-api', () => ({
  openFileDialog: vi.fn().mockResolvedValue('/tmp/x.md'),
}));

vi.mock('../../src/stores/doc', () => ({
  loadDocument: vi.fn(),
  clearDocument: vi.fn(),
}));

vi.mock('../../src/stores/recent', () => ({
  recordRecent: vi.fn(),
  recent: { subscribe: (fn: (v: string[]) => void) => { fn([]); return () => {}; } },
}));

import { openFileDialog } from '../../src/lib/tauri-api';
import { loadDocument } from '../../src/stores/doc';
import { recordRecent } from '../../src/stores/recent';

describe('GlassMenu', () => {
  it('starts closed', () => {
    render(GlassMenu);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu when the hamburger is clicked', async () => {
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /open/i })).toBeInTheDocument();
  });

  it('Open… triggers dialog, loadDocument, and recordRecent', async () => {
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /open/i }));
    expect(openFileDialog).toHaveBeenCalled();
    expect(loadDocument).toHaveBeenCalledWith('/tmp/x.md');
    expect(recordRecent).toHaveBeenCalledWith('/tmp/x.md');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/component/GlassMenu.test.ts
```

Expected: FAIL — component not found.

- [ ] **Step 3: Implement `GlassMenu.svelte`**

```svelte
<script lang="ts">
  import { openFileDialog } from '../lib/tauri-api';
  import { loadDocument } from '../stores/doc';
  import { recordRecent } from '../stores/recent';

  let open = $state(false);

  function toggle() { open = !open; }

  async function handleOpen() {
    open = false;
    const path = await openFileDialog();
    if (!path) return;
    await loadDocument(path);
    await recordRecent(path);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="menu-root">
  <button class="hamburger glass" aria-label="Menu" aria-expanded={open} onclick={toggle}>
    <span class="bar"></span>
    <span class="bar"></span>
    <span class="bar"></span>
  </button>

  {#if open}
    <div class="popover glass" role="menu">
      <button role="menuitem" class="item" onclick={handleOpen}>Open…</button>
      <!-- Open Recent lands in Plan 3. -->
    </div>
  {/if}
</div>

<style>
  .menu-root {
    position: fixed;
    top: 14px;
    left: 14px;
    z-index: 100;
  }
  .hamburger {
    width: 38px;
    height: 38px;
    display: grid;
    grid-auto-flow: row;
    gap: 5px;
    align-content: center;
    justify-items: center;
    background: var(--glass-fill);
    border: 1px solid var(--glass-border);
    cursor: pointer;
    padding: 0;
  }
  .bar {
    width: 16px;
    height: 1.5px;
    background: var(--fg-1);
    border-radius: 1px;
  }
  .popover {
    position: absolute;
    top: 46px;
    left: 0;
    min-width: 200px;
    padding: 6px;
    display: flex;
    flex-direction: column;
  }
  .item {
    background: transparent;
    border: 0;
    padding: 10px 12px;
    border-radius: 8px;
    color: var(--fg-0);
    text-align: left;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 14px;
  }
  .item:hover {
    background: var(--accent-soft);
  }
</style>
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/component/GlassMenu.test.ts
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/GlassMenu.svelte tests/component/GlassMenu.test.ts
git commit -m "feat: add GlassMenu with Open action"
```

---

### Task 21: Viewer component

**Files:**
- Create: `src/components/Viewer.svelte`, `tests/component/Viewer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/component/Viewer.test.ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { doc } from '../../src/stores/doc';
import Viewer from '../../src/components/Viewer.svelte';

describe('Viewer', () => {
  it('shows an empty-state hint when doc is null', () => {
    doc.set(null);
    render(Viewer);
    expect(screen.getByText(/Open a markdown file/i)).toBeInTheDocument();
  });

  it('renders the doc html when a doc is set', () => {
    doc.set({
      path: '/tmp/a.md',
      dir: '/tmp',
      sha256: 'abc',
      bytes: 0,
      markdown: '',
      html: '<h1 data-block-id="h:1">Hello</h1>',
      plaintext: 'Hello',
      blocks: ['h:1'],
      sidecarRaw: null,
    });
    render(Viewer);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hello').getAttribute('data-block-id')).toBe('h:1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/component/Viewer.test.ts
```

Expected: FAIL — component not found.

- [ ] **Step 3: Implement `Viewer.svelte`**

```svelte
<script lang="ts">
  import { doc } from '../stores/doc';
</script>

<div class="scroll">
  {#if $doc === null}
    <div class="empty">
      <p>Open a markdown file to start reading.</p>
    </div>
  {:else}
    <article class="viewer">
      {@html $doc.html}
    </article>
  {/if}
</div>

<style>
  .scroll {
    height: 100vh;
    width: 100vw;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    justify-content: center;
  }
  .empty {
    margin-top: 40vh;
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 14px;
    text-align: center;
  }
  .viewer {
    max-width: 720px;
    width: 100%;
    padding: 96px 48px 160px;
    color: var(--fg-0);
  }
  .viewer :global(h1),
  .viewer :global(h2),
  .viewer :global(h3) {
    font-family: var(--font-sans);
    color: var(--fg-0);
    letter-spacing: -0.01em;
  }
  .viewer :global(h1) { font-size: 2rem; margin-top: 2.2em; }
  .viewer :global(h2) { font-size: 1.5rem; margin-top: 2em; }
  .viewer :global(p) { margin: 1em 0; }
  .viewer :global(a) { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-soft); }
  .viewer :global(code) { font-family: var(--font-mono); font-size: 0.92em; background: var(--bg-2); padding: 0.1em 0.3em; border-radius: 4px; }
  .viewer :global(pre) { background: var(--bg-2); padding: 14px 16px; border-radius: 10px; overflow-x: auto; border: 1px solid var(--glass-border); }
  .viewer :global(pre code) { background: transparent; padding: 0; }
  .viewer :global(blockquote) { border-left: 3px solid var(--accent); padding-left: 14px; margin-left: 0; color: var(--fg-1); }
  .viewer :global(img) { max-width: 100%; border-radius: 6px; }
  .viewer :global(table) { border-collapse: collapse; margin: 1em 0; }
  .viewer :global(th), .viewer :global(td) { border: 1px solid var(--glass-border); padding: 6px 10px; }
</style>
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/component/Viewer.test.ts
```

Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/Viewer.svelte tests/component/Viewer.test.ts
git commit -m "feat: add Viewer component with dark typography"
```

---

### Task 22: Wire `App.svelte`

**Files:**
- Modify: `src/App.svelte`

- [ ] **Step 1: Replace `App.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import './styles/theme-dark.css';
  import './styles/glass.css';
  import Viewer from './components/Viewer.svelte';
  import GlassMenu from './components/GlassMenu.svelte';
  import { refreshRecent } from './stores/recent';

  onMount(async () => {
    try { await refreshRecent(); } catch { /* ignore on first launch */ }
  });
</script>

<Viewer />
<GlassMenu />
```

- [ ] **Step 2: Run svelte-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Run all unit/component tests**

```bash
npm test
```

Expected: every test passes.

- [ ] **Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: wire Viewer + GlassMenu in App root"
```

---

### Task 23: End-to-end smoke via `npm run tauri dev`

No automated E2E in Plan 1 (Playwright scaffolding lands in Plan 3). Instead, a human-run checklist.

**Files:**
- Create: `docs/QA-plan-1.md` (short manual QA doc)

- [ ] **Step 1: Write `docs/QA-plan-1.md`**

```markdown
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
```

- [ ] **Step 2: Run the checklist**

```bash
npm run tauri dev
```

Walk through each box. If any fails, file a followup — but don't block the commit on anything not in scope for Plan 1.

- [ ] **Step 3: Commit the QA doc**

```bash
git add docs/QA-plan-1.md
git commit -m "docs: add manual QA checklist for Reader MVP"
```

---

### Task 24: README and checkpoint tag

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Final test sweep**

```bash
npm test && npm run check && (cd src-tauri && cargo test) && (cd src-tauri && cargo check)
```

Expected: all green.

- [ ] **Step 3: Commit and tag**

```bash
git add README.md
git commit -m "docs: add README"
git tag v0.1.0-reader-mvp
```

Plan 1 complete.

---

## Success criteria (Plan 1)

At tag `v0.1.0-reader-mvp`:

1. `npm run tauri dev` opens a native window.
2. Hamburger → Open… picks a `.md` file and renders it with Shiki-highlighted code, KaTeX math, footnotes, task lists, tables, and relative images.
3. Every TS file in `src/lib` and `src/stores` has a test file under `tests/unit/` — all passing.
4. Every component in `src/components` has a test file under `tests/component/` — all passing.
5. Rust unit tests pass (`cargo test` in `src-tauri`).
6. `npm run check` is clean.
7. Sidecar infrastructure (`write_sidecar` Rust command, `sidecar.ts`, schema) is implemented and tested but no UI writes to it yet — Plan 2 will plug in.
8. Manual QA checklist in `docs/QA-plan-1.md` has been walked.

## What's next

- **Plan 2:** Annotation engine — anchoring module, highlight/note/draw layers, tool rail + color strip, save/load round-trip.
- **Plan 3:** Robustness — orphan panel, Open Recent UI, error matrix, Playwright E2E.
