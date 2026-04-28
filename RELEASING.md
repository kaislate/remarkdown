# Releasing remarkdown

This document covers the end-to-end process for cutting a tagged release
that installed copies of remarkdown can pick up via the in-app update
checker.

## One-time setup

The signing key already exists at
`~/.tauri/remarkdown-updater.key`. **Back it up.** If this file is lost
the public key in `tauri.conf.json` becomes orphaned and every installed
copy will reject all future updates as unsigned. Treat it like a
production secret — copy it into a password manager / encrypted backup
volume / safe deposit box.

The corresponding public key is committed to `tauri.conf.json` under
`plugins.updater.pubkey` and shipped with every build. Don't change it
without expecting all currently-installed copies to be unable to update.

## Cutting a release

### 1. Bump the version

Update the version number in three files (they must match):

- `package.json` → `"version": "0.5.0"`
- `src-tauri/Cargo.toml` → `version = "0.5.0"`
- `src-tauri/tauri.conf.json` → `"version": "0.5.0"`

`Cargo.lock` will pick up automatically on the next build.

### 2. Build with signing enabled

The build needs the private key so it can produce signed `.sig` files
alongside each installer. Tauri 2 reads it from `TAURI_SIGNING_PRIVATE_KEY`,
which accepts EITHER a path to the key file OR the key contents directly.

```bash
# Bash / zsh / Git Bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/remarkdown-updater.key"
npm run tauri build
```

```powershell
# PowerShell
$env:TAURI_SIGNING_PRIVATE_KEY = "$HOME\.tauri\remarkdown-updater.key"
npm run tauri build
```

If the key has a password, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

> **Note:** older Tauri 1.x docs (and an earlier draft of this file) used
> `TAURI_SIGNING_PRIVATE_KEY_PATH`. That variant still works in some CLI
> versions, but `TAURI_SIGNING_PRIVATE_KEY` is the canonical Tauri 2 name
> — if a build complains "A public key has been found, but no private
> key", you've hit the wrong variable.

After ~3-8 minutes (cold) you'll have a signed installer in
`src-tauri/target/release/bundle/nsis/`:

```
remarkdown_<version>_x64-setup.exe
remarkdown_<version>_x64-setup.exe.sig
```

### 2a. Pre-release builds — NSIS-only

Stable releases (e.g. `0.5.0`, `1.0.0`) bundle BOTH NSIS and MSI by
default. Pre-release versions with an alphanumeric semver suffix
(`0.5.0-beta`, `0.5.0-rc1`, …) cannot be MSI-bundled because Windows
MSI's `ProductVersion` field only accepts numeric prerelease
identifiers ≤ 65535.

For pre-releases, edit `src-tauri/tauri.conf.json` and set:

```jsonc
"bundle": {
  "active": true,
  "targets": ["nsis"],   // was: "all"
  ...
}
```

…and revert to `"all"` for the next stable. The current `tauri.conf.json`
in this repo already targets NSIS-only because it was last cut for the
`0.5.0-beta` release.

### 3. Generate the updater manifest

```bash
node scripts/build-manifest.mjs --notes "Release notes for 0.5.0"
```

This writes `latest.json` at the repo root. Inspect it — the `version`
should match what you bumped to, and `signature` should be a long
single-line minisign string.

The manifest format:

```json
{
  "version": "0.5.0",
  "notes": "...",
  "pub_date": "2026-04-25T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "url": "https://github.com/kaislate/remarkdown/releases/download/v0.5.0/remarkdown_0.5.0_x64-setup.exe"
    }
  }
}
```

### 4. Commit + tag

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore: bump to 0.5.0"
git tag -a v0.5.0 -m "remarkdown 0.5.0"
git push origin main v0.5.0
```

### 5. Create the GitHub release

For STABLE releases (NSIS + MSI):
```bash
gh release create v0.5.0 \
  --title "remarkdown 0.5.0" \
  --notes "Release notes here" \
  src-tauri/target/release/bundle/nsis/remarkdown_0.5.0_x64-setup.exe \
  src-tauri/target/release/bundle/nsis/remarkdown_0.5.0_x64-setup.exe.sig \
  src-tauri/target/release/bundle/msi/remarkdown_0.5.0_x64_en-US.msi \
  src-tauri/target/release/bundle/msi/remarkdown_0.5.0_x64_en-US.msi.sig \
  latest.json
```

For PRE-RELEASE builds (NSIS-only, attach `--prerelease` so GitHub's
`/latest/` redirect skips it and stable users don't auto-update to a beta):
```bash
gh release create v0.5.0-beta \
  --prerelease \
  --title "remarkdown 0.5.0-beta" \
  --notes "Release notes here" \
  src-tauri/target/release/bundle/nsis/remarkdown_0.5.0-beta_x64-setup.exe \
  src-tauri/target/release/bundle/nsis/remarkdown_0.5.0-beta_x64-setup.exe.sig \
  latest.json
```

The `latest.json` file **must** be attached to the release for the
in-app updater to find it. The endpoint baked into the binary is
`https://github.com/kaislate/remarkdown/releases/latest/download/latest.json`,
which GitHub redirects to the most recent published (non-prerelease)
release's asset of that name. Pre-releases (`--prerelease`) are skipped
by that redirect, so installed copies running stable won't see them.

### 6. Verify

On a machine running an older version of remarkdown:

1. Open the app
2. Hamburger menu → Check for updates… (Stage C UI — not yet built)
3. Confirm the available version matches what you just released
4. Click Install — the app should download, replace itself, and
   relaunch into the new version

Until the in-app UI lands, you can also check the manifest URL
directly in a browser:

```
https://github.com/kaislate/remarkdown/releases/latest/download/latest.json
```

## Pre-release channel (full implementation TBD)

The `receivePrereleaseUpdates` setting (added in 0.5.x) currently only affects
which releases appear in the Update modal's aggregated changelog. Auto-installing
pre-release builds via the in-app updater requires either:

### Option A: Maintained `latest-prerelease` tag

1. After every pre-release cut (e.g., `v1.1.0-beta`), force-update a moving
   `latest-prerelease` git tag to point at the same commit:
   ```
   git tag -f latest-prerelease v1.1.0-beta
   git push origin latest-prerelease --force
   ```
2. Configure `tauri.conf.json` `plugins.updater.endpoints` with both URLs:
   ```jsonc
   "endpoints": [
     "https://github.com/kaislate/remarkdown/releases/download/latest-prerelease/latest.json",
     "https://github.com/kaislate/remarkdown/releases/latest/download/latest.json"
   ]
   ```
3. Tauri tries them in order; the first valid newer manifest wins. **Note:** this
   means ALL users would see pre-releases by default — to honour the user's setting,
   we'd need a custom Rust command that picks the appropriate URL.

### Option B: Custom Rust update command

Bypass `tauri-plugin-updater`'s `check()` entirely and implement our own:
1. Custom `check_for_update_with_channel(channel: &str)` Rust command
2. Fetches the appropriate manifest URL (stable vs prerelease) using `reqwest`
3. Verifies signatures with `minisign-verify`
4. Returns a manifest the frontend installs via the existing plugin's `Update.downloadAndInstall`
   (or a parallel custom install command)

Option B is cleaner but ~2x the engineering work. Defer until a stable v1.0
ships and we have actual stable users wanting to opt into pre-releases.

## Troubleshooting

**`Installer not found` from build-manifest.mjs.**
The build either failed or the version in `package.json` doesn't match
the filename in the bundle directory. Re-run `npm run tauri build` and
check that the version was bumped consistently in all three files.

**`Signature not found` from build-manifest.mjs.**
The build ran but didn't produce `.sig` files. Verify
`bundle.createUpdaterArtifacts` is `true` in `tauri.conf.json` AND that
`TAURI_SIGNING_PRIVATE_KEY_PATH` was set in the environment before
running the build. Without the env var, Tauri builds silently without
signing.

**Users report "update available" but install fails with a signature
error.**
The `.sig` file in the manifest doesn't match the `.exe` URL. Either
the manifest was hand-edited or the `.sig` was produced by a different
key. Regenerate the manifest from the original build artifacts.

**Switched signing keys.**
Once you change the public key in `tauri.conf.json`, every previously-
installed copy can no longer update — they verify against the OLD
public key. There is no recovery. The only option is to ship a new
unsigned installer and ask users to manually reinstall. Don't change
the key.
