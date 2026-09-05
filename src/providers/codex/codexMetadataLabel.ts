const MAX_CODEX_METADATA_LABEL_LENGTH = 120;

const UUID_LABEL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PSEUDONYMOUS_SESSION_KEY_LABEL = /^[0-9a-f]{64}$/i;
const ABSOLUTE_WINDOWS_PATH = /^[a-z]:[\\/]/i;
const URL_SCHEME = /^(?:file|https?|ssh):/i;
const SAFE_LABEL_CHARACTERS = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._+()'’-]*$/u;

/**
 * Keeps human-readable Codex metadata labels while rejecting values that look
 * like locations or full identities. Rejection is fail-closed: callers should
 * omit the field or use their neutral fallback, never persist the raw value.
 */
export function sanitizeCodexMetadataLabel(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) {
    return undefined;
  }
  const label = value.trim();
  if (
    label.length === 0 ||
    label.length > MAX_CODEX_METADATA_LABEL_LENGTH ||
    label.startsWith('/') ||
    label.startsWith('\\\\') ||
    ABSOLUTE_WINDOWS_PATH.test(label) ||
    URL_SCHEME.test(label) ||
    /[\\/]/.test(label) ||
    UUID_LABEL.test(label) ||
    PSEUDONYMOUS_SESSION_KEY_LABEL.test(label) ||
    !SAFE_LABEL_CHARACTERS.test(label)
  ) {
    return undefined;
  }
  return label;
}
