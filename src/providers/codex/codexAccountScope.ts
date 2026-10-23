import { createHmac } from 'node:crypto';

export const CODEX_ACCOUNT_SCOPE_TTL_MS = 30_000;
export const CODEX_ACCOUNT_SCOPE_MAX_ACCOUNT_ID_LENGTH = 512;
export const CODEX_ACCOUNT_SCOPE_MAX_SOURCE_LENGTH = 4096;
export const CODEX_ACCOUNT_SCOPE_MIN_SALT_LENGTH = 32;
export const CODEX_ACCOUNT_SCOPE_MAX_SALT_LENGTH = 512;

export interface CodexAccountScopeSnapshot {
  accountScopeKey: string;
  sourceScopeKey: string;
  observedAtMs: number;
  expiresAtMs: number;
  basis: 'official-usage-snapshot';
  usageOwnership: 'unproven';
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    value.trim() === value && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
}

function validTime(now: number): boolean {
  return Number.isSafeInteger(now) && now >= 0 &&
    now <= Number.MAX_SAFE_INTEGER - CODEX_ACCOUNT_SCOPE_TTL_MS;
}

/**
 * Runtime-only metadata from a supplied official usage snapshot. This cannot
 * establish ownership of local usage, logs or quota history. No transport or
 * credential lookup is provided. All time and machine salt are caller supplied.
 */
export class CodexAccountScopeCache {
  #machineSalt: string;
  #generation = 0;
  #sourceScopeKey: string | null = null;
  #lastNow: number | null = null;
  #request: { generation: number; startedAtMs: number } | null = null;
  #snapshot: Readonly<CodexAccountScopeSnapshot> | null = null;

  constructor(machineSalt: string) {
    if (!boundedString(machineSalt, CODEX_ACCOUNT_SCOPE_MAX_SALT_LENGTH) ||
        machineSalt.length < CODEX_ACCOUNT_SCOPE_MIN_SALT_LENGTH) {
      throw new RangeError('A bounded machine salt of at least 32 characters is required');
    }
    this.#machineSalt = machineSalt;
  }

  /** Revokes both cached metadata and every pending request, even when empty. */
  clear(): void {
    // Saturation permanently fails closed instead of ever reusing a generation.
    this.#generation = Math.min(Number.MAX_SAFE_INTEGER, this.#generation + 1);
    this.#sourceScopeKey = null;
    this.#lastNow = null;
    this.#request = null;
    this.#snapshot = null;
  }

  /** Begin before an asynchronous request; only its current generation may reply. */
  begin(enabled: boolean, source: unknown, now: number): number | null {
    // Every begin supersedes any earlier request. A bad clock cannot start one.
    const regressed = this.#lastNow !== null && now < this.#lastNow;
    this.clear();
    if (regressed || !this.#context(enabled, source, now)) {
      return null;
    }
    this.#request = { generation: this.#generation, startedAtMs: now };
    return this.#generation;
  }

  /**
   * Without a generation this is a synchronous snapshot observation (fixtures).
   * Any future asynchronous caller must pass the token returned by begin().
   * A generation is single-use; stale replies never read the response object.
   */
  observe(
    enabled: boolean,
    source: unknown,
    reply: unknown,
    now: number,
    expectedGeneration?: number,
  ): CodexAccountScopeSnapshot | null {
    if (enabled !== true) {
      this.clear();
      return null;
    }
    // Reject stale replies before even validating their old source or timestamp:
    // an old reply must not revoke a newer request or a newer valid snapshot.
    if (expectedGeneration !== undefined &&
        (!this.#request || expectedGeneration !== this.#request.generation)) {
      return null;
    }
    if (!this.#context(enabled, source, now)) {
      return null;
    }
    // Never let an unbound observation race an outstanding bound request.
    if (expectedGeneration === undefined && this.#request) {
      this.clear();
      return null;
    }
    const generation = this.#generation;
    const sourceScopeKey = this.#sourceScopeKey;
    const request = this.#request;
    const snapshot = this.#snapshot;
    const stillCurrent = () => generation === this.#generation &&
      sourceScopeKey === this.#sourceScopeKey && now === this.#lastNow &&
      request === this.#request && snapshot === this.#snapshot;

    let accountId: unknown;
    try {
      // Do not spread, enumerate, stringify, retain or inspect other reply fields.
      if (reply !== null && typeof reply === 'object' && !Array.isArray(reply)) {
        accountId = (reply as { accountId?: unknown }).accountId;
      }
    } catch {
      if (stillCurrent()) {
        this.clear();
      }
      return null;
    }
    // A supplied getter/proxy may synchronously revoke or supersede this request.
    if (!stillCurrent()) {
      return null;
    }
    if (!boundedString(accountId, CODEX_ACCOUNT_SCOPE_MAX_ACCOUNT_ID_LENGTH)) {
      this.clear();
      return null;
    }

    this.#request = null;
    this.#snapshot = Object.freeze({
      accountScopeKey: this.#key('account', this.#sourceScopeKey!, accountId),
      sourceScopeKey: this.#sourceScopeKey!,
      observedAtMs: now,
      expiresAtMs: now + CODEX_ACCOUNT_SCOPE_TTL_MS,
      basis: 'official-usage-snapshot',
      usageOwnership: 'unproven',
    });
    return { ...this.#snapshot };
  }

  read(enabled: boolean, source: unknown, now: number): CodexAccountScopeSnapshot | null {
    return this.#context(enabled, source, now) && this.#snapshot
      ? { ...this.#snapshot }
      : null;
  }

  #key(domain: 'source' | 'account', ...parts: string[]): string {
    // Versioned domains and a structured encoding prevent ambiguous concatenation
    // and collisions with pseudonyms generated for other purposes.
    return createHmac('sha256', this.#machineSalt)
      .update(JSON.stringify(['codex-official-usage-scope-v1', domain, ...parts]))
      .digest('hex');
  }

  #context(enabled: boolean, source: unknown, now: number): boolean {
    if (enabled !== true || !boundedString(source, CODEX_ACCOUNT_SCOPE_MAX_SOURCE_LENGTH) ||
        !validTime(now) || this.#generation === Number.MAX_SAFE_INTEGER ||
        (this.#lastNow !== null && now < this.#lastNow) ||
        (this.#snapshot !== null && now >= this.#snapshot.expiresAtMs) ||
        (this.#request !== null && now - this.#request.startedAtMs >= CODEX_ACCOUNT_SCOPE_TTL_MS)) {
      this.clear();
      return false;
    }
    const sourceScopeKey = this.#key('source', source);
    if (this.#sourceScopeKey !== null && sourceScopeKey !== this.#sourceScopeKey) {
      this.clear();
      return false;
    }
    this.#sourceScopeKey = sourceScopeKey;
    this.#lastNow = now;
    return true;
  }
}
