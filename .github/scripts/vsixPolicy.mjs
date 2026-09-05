const ROOT_METADATA_ENTRIES = new Set([
  '[Content_Types].xml',
  'extension.vsixmanifest',
]);

const REQUIRED_ENTRIES = [
  ...ROOT_METADATA_ENTRIES,
  'extension/package.json',
  'extension/out/extension.js',
  'extension/out/webview.js',
  'extension/out/codexView.js',
];

const FORBIDDEN_ENTRY_PATTERNS = [
  /^extension\/(?:src|tests|docs|\.github|\.codex|\.claude|\.agents|\.superpowers)(?:\/|$)/i,
  /^extension\/out\/test(?:\/|$)/i,
  /^extension\/AGENTS(?:\.zh-CN)?\.md$/i,
  /^extension\/node_modules(?:\/|$)/i,
  /^extension\/issue87-.*\.cjs$/i,
  /^extension\/out\/claudeIncrementalPrototype\.js$/i,
  /(?:^|\/)\.env(?:\.|$)/i,
  /\.(?:pem|key|p12|pfx)$/i,
];

const REQUIRED_BUNDLE_MARKERS = [
  { label: "provider === 'codex'", present: (bundle) => bundle.includes("provider === 'codex'") },
  { label: 'renderTodayData(provider)', present: (bundle) => bundle.includes('renderTodayData(provider)') },
  { label: 'renderSessionData(provider)', present: (bundle) => bundle.includes('renderSessionData(provider)') },
  { label: 'renderSettingsPanel(provider)', present: (bundle) => bundle.includes('renderSettingsPanel(provider)') },
  { label: 'data-provider-target', present: (bundle) => bundle.includes('data-provider-target') },
];

const RETIRED_BUNDLE_MARKERS = [
  'ccu.codex.ui.v1',
  'data-codex-tab-button="recent"',
  'data-codex-tab-button="7d"',
  'data-codex-tab-button="30d"',
  'data-codex-tab-button="all"',
  'data-codex-tab-button="threads"',
  'data-codex-tab-button="projects"',
  'data-codex-tab-button="behavior"',
  'data-codex-tab-button="settings"',
  'data-codex-page="overview"',
  'data-codex-page="explore"',
  'data-codex-page="recommendations"',
  'data-codex-action',
  'hostState.codexUi = nextState',
];

function assertCanonicalEntry(entry) {
  if (typeof entry !== 'string' || entry.length === 0 || entry.includes('\0') ||
      entry.includes('\\') || entry.startsWith('/') || /^[A-Za-z]:/.test(entry) ||
      entry.endsWith('/')) {
    throw new Error(`unsafe VSIX entry: ${String(entry)}`);
  }
  if (entry.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`unsafe VSIX entry: ${entry}`);
  }
  if (!ROOT_METADATA_ENTRIES.has(entry) && !entry.startsWith('extension/')) {
    throw new Error(`unsafe VSIX entry: ${entry}`);
  }
}

export function assertSafeVsixEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('VSIX entries must be an array');
  }

  const seen = new Set();
  for (const entry of entries) {
    assertCanonicalEntry(entry);
    const collisionKey = entry.toLowerCase();
    if (seen.has(collisionKey)) {
      throw new Error(`duplicate VSIX entry: ${entry}`);
    }
    seen.add(collisionKey);
    if (FORBIDDEN_ENTRY_PATTERNS.some((pattern) => pattern.test(entry))) {
      throw new Error(`forbidden VSIX entry: ${entry}`);
    }
  }

  for (const required of REQUIRED_ENTRIES) {
    if (!seen.has(required.toLowerCase())) {
      throw new Error(`missing required VSIX entry: ${required}`);
    }
  }
}

export function assertCodexBundleMarkers(bundle) {
  if (typeof bundle !== 'string') {
    throw new Error('bundle must be text');
  }
  for (const marker of REQUIRED_BUNDLE_MARKERS) {
    if (!marker.present(bundle)) {
      throw new Error(`missing bundle marker: ${marker.label}`);
    }
  }
  for (const marker of RETIRED_BUNDLE_MARKERS) {
    if (bundle.includes(marker)) {
      throw new Error(`retired bundle marker: ${marker}`);
    }
  }
}
