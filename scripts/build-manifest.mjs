#!/usr/bin/env node
// Build the Tauri updater manifest (latest.json) for the current
// version. Reads the version from package.json, picks up the signed
// NSIS installer + .sig file from src-tauri/target/release/bundle/nsis,
// and writes a single-platform manifest to the chosen output path.
//
// Usage:
//   node scripts/build-manifest.mjs [--notes "Release notes here"] \
//                                   [--out path/to/latest.json]
//
// The signature included in the manifest is the contents of the .sig
// file produced by `tauri build` (with bundle.createUpdaterArtifacts:
// true and TAURI_SIGNING_PRIVATE_KEY_PATH pointing at your private key).
//
// The URL in the manifest assumes the installer is published as a
// GitHub release asset under https://github.com/kaislate/remarkdown.
// Adjust REPO_OWNER / REPO_NAME below if you fork.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const REPO_OWNER = 'kaislate';
const REPO_NAME = 'remarkdown';

function parseArgs(argv) {
  const args = { notes: '', out: 'latest.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--notes') args.notes = argv[++i] ?? '';
    else if (a === '--out') args.out = argv[++i] ?? 'latest.json';
    else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: node scripts/build-manifest.mjs ' +
        '[--notes "Release notes"] [--out latest.json]',
      );
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const pkg = JSON.parse(
    await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
  );
  const version = pkg.version;
  if (!version) throw new Error('No version in package.json');

  const nsisDir = join(REPO_ROOT, 'src-tauri/target/release/bundle/nsis');
  const exeName = `remarkdown_${version}_x64-setup.exe`;
  const exePath = join(nsisDir, exeName);
  const sigPath = `${exePath}.sig`;

  if (!existsSync(exePath)) {
    throw new Error(
      `Installer not found: ${exePath}\n` +
      `Did you run \`npm run tauri build\` with TAURI_SIGNING_PRIVATE_KEY_PATH set?`,
    );
  }
  if (!existsSync(sigPath)) {
    throw new Error(
      `Signature not found: ${sigPath}\n` +
      `Verify bundle.createUpdaterArtifacts is true in tauri.conf.json and ` +
      `that TAURI_SIGNING_PRIVATE_KEY_PATH was set during the build.`,
    );
  }

  const signature = (await readFile(sigPath, 'utf8')).trim();

  const manifest = {
    version,
    notes: args.notes,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        url:
          `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/` +
          `v${version}/${exeName}`,
      },
    },
  };

  const outPath = resolve(REPO_ROOT, args.out);
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${outPath}`);
  console.log(`  version:   ${version}`);
  console.log(`  installer: ${exeName}`);
  console.log(`  url:       ${manifest.platforms['windows-x86_64'].url}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
