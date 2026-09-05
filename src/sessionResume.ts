// Pure (no vscode API) helpers for the "resume / copy session" actions.

/** True for valid session ids — strict to prevent shell injection. */
export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,200}$/.test(id);
}

/** True only for absolute filesystem paths usable as a terminal cwd. */
export function isUsableCwd(p: unknown): p is string {
  if (typeof p !== 'string' || p.trim() === '') { return false; }
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

/** The exact command to resume a session, or null if the id is unsafe. */
export function buildResumeCommand(sessionId: unknown): string | null {
  if (!isValidSessionId(sessionId)) { return null; }
  return `claude --resume ${sessionId}`;
}

/** True if `child` is the same as, or nested under, `parent` (separator-agnostic). */
export function isUnderDir(child: unknown, parent: unknown): boolean {
  if (typeof child !== 'string' || typeof parent !== 'string' || parent === '') { return false; }
  const norm = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + '/');
}
