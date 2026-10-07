# Optional guarded native diagnostic

These helpers are excluded from the VSIX. They do not replace a production
VSIX installation, manual F5, pixel inspection, long-history soak or Windows
acceptance. Production src/ and compiled runtime modules are not modified.

Compile normally. Call prepareNativeDiagnostic({ repository, sourceHead })
from prepare.cjs with the absolute repository and its verified local commit.
Preparation creates a fresh ccu-native-v242-* temporary root, copies regular
compiled .js files and the actual assets/ directory, excludes out/test and source maps, and seeds
six bounded anonymous synthetic JSONL files. It never launches an app, reads
normal provider homes, fetches dependencies or installs into daily Code.

The returned launchArguments explicitly isolate user, extensions, shared and
agent stores. The installed Code must support every option; check its local
CLI metadata before use. Start only a new instance with those exact arguments.
Use background launch to avoid unnecessary focus changes. In-memory
SecretStorage, no recent-folder entry, disabled crash reporting/experiments,
disabled telemetry/update/sync-related online entry points, and synthetic
provider paths complement (but do not replace) actual storage verification.
Do not set or repurpose HOME or CODEX_HOME.

bootstrap.cjs is the staged test-only main. It validates real Test-mode
ExtensionContext/config paths and symlink-free owned directories before any
globalState seed. Only then does it load and activate the production module.
It captures that host's own instance at the existing command-setup boundary,
restores the method immediately, and gives the test runner access to that
instance. This wrapper is not shipped as a release candidate.

runner.cjs uses the real native VS Code API, not a mocked webview. It exercises
the small synthetic cold scan, twenty explicit warm refreshes, twenty actual
WebviewPanel open/dispose cycles, achievement OFF/ON, and awaited production
disposal. Reports contain fixed stages, numeric process-memory samples and
anonymous resource counts, not credentials, logs, paths or instance objects.
A missing client-ready observation is not pixel acceptance. Process RSS includes
worker threads; samples are not instantaneous peaks or a post-GC leak verdict.

Before claiming non-disruption, inspect the normal instance's relevant storage
metadata/settings and installed-runtime hashes before/after. A separate window,
directory naming or this guard is not an OS sandbox. Changes during active
normal use may be natural; investigate rather than asserting all bytes stayed
unchanged. Do not close or restart daily Code, change its extension/profile,
stop unrelated processes, or weaken a failed isolation check.
