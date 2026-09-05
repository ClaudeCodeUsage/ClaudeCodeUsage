import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertSafeVsixEntries,
  assertCodexBundleMarkers,
} from './vsixPolicy.mjs';

const MAX_UNZIP_OUTPUT = 16 * 1024 * 1024;

function parseRuntimeMain(main, label) {
  if (typeof main !== 'string' || !main.startsWith('./out/') || !main.endsWith('.js') ||
      main.includes('\\') || main.includes('\0')) {
    throw new Error(`invalid ${label} main: ${String(main)}`);
  }
  const relativeMain = main.slice(2);
  if (relativeMain.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`invalid ${label} main: ${main}`);
  }
  return relativeMain;
}

export function assertPackagedManifest(manifest, expectedVersion, expectedMain, entries) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('invalid packaged manifest');
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `VSIX version mismatch: expected ${expectedVersion}, got ${String(manifest.version)}`,
    );
  }

  parseRuntimeMain(expectedMain, 'source');
  const relativeMain = parseRuntimeMain(manifest.main, 'VSIX');
  if (manifest.main !== expectedMain) {
    throw new Error(
      `VSIX main mismatch: expected ${expectedMain}, got ${manifest.main}`,
    );
  }

  const mainEntry = `extension/${relativeMain}`;
  if (!entries.includes(mainEntry)) {
    throw new Error(`missing VSIX main entry: ${mainEntry}`);
  }
  return mainEntry;
}

function unzipText(vsixPath, entry) {
  return execFileSync('unzip', ['-p', vsixPath, entry], {
    encoding: 'utf8',
    maxBuffer: MAX_UNZIP_OUTPUT,
  });
}

export function verifyVsix(vsixPath, expectedVersion, expectedMain) {
  const entries = execFileSync('unzip', ['-Z1', vsixPath], {
    encoding: 'utf8',
    maxBuffer: MAX_UNZIP_OUTPUT,
  }).split(/\r?\n/).filter((entry) => entry.length > 0);

  assertSafeVsixEntries(entries);
  const packagedManifest = JSON.parse(unzipText(vsixPath, 'extension/package.json'));
  const main = assertPackagedManifest(packagedManifest, expectedVersion, expectedMain, entries);
  const javascriptEntries = entries.filter((entry) => /^extension\/out\/.*\.js$/.test(entry));
  const bundle = javascriptEntries.map((entry) => unzipText(vsixPath, entry)).join('\n');
  assertCodexBundleMarkers(bundle);

  const bytes = readFileSync(vsixPath);
  return {
    path: vsixPath,
    version: packagedManifest.version,
    main,
    files: entries.length,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function main() {
  const [, , requestedPath, requestedVersion] = process.argv;
  if (!requestedPath) {
    throw new Error('usage: node .github/scripts/verify-vsix.mjs <file.vsix> [expected-version]');
  }

  const vsixPath = resolve(requestedPath);
  const sourceManifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  const expectedVersion = requestedVersion ?? sourceManifest.version;
  process.stdout.write(`${JSON.stringify(
    verifyVsix(vsixPath, expectedVersion, sourceManifest.main),
    null,
    2,
  )}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
