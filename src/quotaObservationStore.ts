import { createHmac, randomBytes } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import * as path from 'node:path';

import type { UsageProvider } from './providers/providerTypes';
import { acquireCodexIndexLease } from './providers/codex/codexIndexLease';
import type { ClaudeApiUsageResponse } from './types';
import { normalizeQuotaWindows } from './quotaWindows';
import type { WeeklyQuotaObservation } from './weeklyValue';

export const QUOTA_OBSERVATION_SCHEMA_VERSION = 2 as const;
export const QUOTA_OBSERVATION_FILE = 'quota-observations-v2.json';
export const QUOTA_OBSERVATION_RETENTION_DAYS = 180;
export const QUOTA_OBSERVATION_LIMIT_PER_SERIES = 512;

const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = DAY_MS;
const RESET_CLUSTER_MS = 5 * 60 * 1000;
const USAGE_DROP_THRESHOLD = 0.15;

export type QuotaPeriodType =
  | 'five-hour'
  | 'seven-day'
  | 'provider-scoped-seven-day';
export type QuotaAccountAttribution =
  | 'verified-local-signal'
  | 'profile-continuity'
  | 'unattributed';
export type QuotaObservationSource =
  | 'claude-official-api'
  | 'codex-official-api'
  | 'codex-local-structured-event';
export type QuotaEvidenceConfidence = 'high' | 'medium' | 'low';
export type QuotaCaptureReason =
  | 'refresh'
  | 'reset-at-change'
  | 'window-id-change'
  | 'usage-drop'
  | 'profile-change'
  | 'migration';
export type QuotaObservationFlag =
  | 'approximate-boundary'
  | 'low-log-coverage'
  | 'low-price-coverage'
  | 'account-ambiguous'
  | 'clock-anomaly';
export type QuotaResetEvidence =
  | 'reset-at-change'
  | 'window-id-change'
  | 'usage-drop';

/** Runtime-only input. Raw identity/window signals are HMACed and discarded. */
export interface QuotaCapture {
  provider: UsageProvider;
  stableIdentitySignal?: string;
  /** Caller-owned random epoch nonce for evidence without a safe account
   * identity. It is HMACed immediately and never persisted verbatim. */
  unattributedEpochSignal?: string;
  accountAttribution: QuotaAccountAttribution;
  observedAt: number;
  periodType: QuotaPeriodType;
  usedFraction: number;
  resetAt: number | null;
  source: QuotaObservationSource;
  /** A provider-supplied window identity only when its semantics are known.
   * It is HMACed before persistence. */
  sourceWindowId?: string;
  confidence: QuotaEvidenceConfidence;
  captureReason: QuotaCaptureReason;
  flags?: QuotaObservationFlag[];
}

export interface QuotaObservationV2 {
  schemaVersion: 2;
  provider: UsageProvider;
  accountFingerprint: string;
  accountAttribution: QuotaAccountAttribution;
  observedAt: number;
  periodType: QuotaPeriodType;
  usedFraction: number;
  remainingFraction: number;
  resetAt: number | null;
  source: QuotaObservationSource;
  windowId: string;
  providerWindowFingerprint: string | null;
  confidence: QuotaEvidenceConfidence;
  captureReason: QuotaCaptureReason;
  flags: QuotaObservationFlag[];
}

export interface QuotaObservationClearScope {
  provider?: UsageProvider;
  /** Internal machine-local HMAC. It must never cross into a Webview/export. */
  accountFingerprint?: string;
}

export interface QuotaResetEventV2 {
  schemaVersion: 2;
  provider: UsageProvider;
  periodType: QuotaPeriodType;
  detectedAt: number;
  boundaryAt: number;
  previousAccountFingerprint: string;
  nextAccountFingerprint: string;
  previousWindowId: string;
  nextWindowId: string;
  evidence: QuotaResetEvidence;
  confidence: QuotaEvidenceConfidence;
  flags: QuotaObservationFlag[];
}

export interface QuotaObservationStoreV2 {
  schemaVersion: 2;
  fingerprintAlgorithm: 'hmac-sha256-v1';
  observations: QuotaObservationV2[];
}

export interface MergeQuotaCaptureOptions {
  salt: string;
  now?: number;
  retentionDays?: number;
  limitPerSeries?: number;
  usageDropThreshold?: number;
}

export interface QuotaObservationLoadResult {
  store: QuotaObservationStoreV2;
  disposition: 'missing' | 'valid' | 'quarantined';
  quarantinePath?: string;
}

export class QuotaObservationScopedClearBlockedError extends Error {
  readonly code = 'quota-scoped-clear-blocked-by-quarantine' as const;

  constructor() {
    super('quota-observation-clear:scoped-clear-blocked-by-quarantine');
    this.name = 'QuotaObservationScopedClearBlockedError';
  }
}

const PERIOD_TYPES = new Set<QuotaPeriodType>([
  'five-hour',
  'seven-day',
  'provider-scoped-seven-day',
]);
const ATTRIBUTIONS = new Set<QuotaAccountAttribution>([
  'verified-local-signal',
  'profile-continuity',
  'unattributed',
]);
const SOURCES = new Set<QuotaObservationSource>([
  'claude-official-api',
  'codex-official-api',
  'codex-local-structured-event',
]);
const CONFIDENCES = new Set<QuotaEvidenceConfidence>(['high', 'medium', 'low']);
const CAPTURE_REASONS = new Set<QuotaCaptureReason>([
  'refresh',
  'reset-at-change',
  'window-id-change',
  'usage-drop',
  'profile-change',
  'migration',
]);
const FLAGS = new Set<QuotaObservationFlag>([
  'approximate-boundary',
  'low-log-coverage',
  'low-price-coverage',
  'account-ambiguous',
  'clock-anomaly',
]);
const RESET_EVIDENCE = new Set<QuotaResetEvidence>([
  'reset-at-change',
  'window-id-change',
  'usage-drop',
]);

function hmac(salt: string, value: string, prefix: string): string {
  return `${prefix}_${createHmac('sha256', salt).update(value).digest('hex').slice(0, 32)}`;
}

export function fingerprintForStableIdentity(
  salt: string,
  provider: UsageProvider,
  stableIdentitySignal: string,
): string {
  return hmac(
    salt,
    `account|v1|${provider}|${stableIdentitySignal}`,
    'acct',
  );
}

function providerWindowFingerprint(
  salt: string,
  capture: QuotaCapture,
): string | null {
  const raw = capture.sourceWindowId?.trim();
  return raw
    ? hmac(salt, `provider-window|${capture.provider}|${capture.periodType}|${raw}`, 'pwin')
    : null;
}

function observationIdentity(item: QuotaObservationV2): string {
  return [
    item.provider,
    item.accountFingerprint,
    item.periodType,
    item.windowId,
    item.observedAt,
    item.usedFraction,
    item.resetAt ?? '',
    item.source,
  ].join('|');
}

function orderedUniqueFlags(flags: readonly QuotaObservationFlag[] = []): QuotaObservationFlag[] {
  return [...new Set(flags.filter((flag) => FLAGS.has(flag)))].sort();
}

export function createEmptyQuotaObservationStore(): QuotaObservationStoreV2 {
  return {
    schemaVersion: QUOTA_OBSERVATION_SCHEMA_VERSION,
    fingerprintAlgorithm: 'hmac-sha256-v1',
    observations: [],
  };
}

function validCapture(capture: QuotaCapture, now: number): boolean {
  return (
    (capture.provider === 'claude' || capture.provider === 'codex') &&
    ATTRIBUTIONS.has(capture.accountAttribution) &&
    PERIOD_TYPES.has(capture.periodType) &&
    SOURCES.has(capture.source) &&
    CONFIDENCES.has(capture.confidence) &&
    CAPTURE_REASONS.has(capture.captureReason) &&
    Number.isFinite(capture.observedAt) &&
    capture.observedAt > 0 &&
    capture.observedAt <= now + FUTURE_SKEW_MS &&
    Number.isFinite(capture.usedFraction) &&
    capture.usedFraction >= 0 &&
    capture.usedFraction <= 1 &&
    (
      capture.resetAt === null ||
      (Number.isFinite(capture.resetAt) && capture.resetAt > 0)
    ) &&
    (
      capture.accountAttribution === 'unattributed'
        ? typeof capture.unattributedEpochSignal === 'string' &&
          capture.unattributedEpochSignal.length > 0
        :
      typeof capture.stableIdentitySignal === 'string' &&
        capture.stableIdentitySignal.length > 0
    )
  );
}

function latestBefore(
  observations: readonly QuotaObservationV2[],
  capture: QuotaCapture,
  stableFingerprint: string,
): QuotaObservationV2 | undefined {
  const eligible = observations
    .filter((item) =>
      item.provider === capture.provider &&
      item.periodType === capture.periodType &&
      item.source === capture.source &&
      item.accountAttribution === capture.accountAttribution &&
      item.observedAt <= capture.observedAt &&
      item.accountFingerprint === stableFingerprint,
    )
    .sort((left, right) =>
      left.observedAt - right.observedAt ||
      left.windowId.localeCompare(right.windowId),
    );
  return eligible[eligible.length - 1];
}

function latestAnonymousChannelBefore(
  observations: readonly QuotaObservationV2[],
  capture: QuotaCapture,
): QuotaObservationV2 | undefined {
  const eligible = observations
    .filter((item) =>
      item.provider === capture.provider &&
      item.periodType === capture.periodType &&
      item.source === capture.source &&
      item.accountAttribution === 'unattributed' &&
      item.observedAt <= capture.observedAt,
    )
    .sort((left, right) =>
      left.observedAt - right.observedAt ||
      left.windowId.localeCompare(right.windowId),
    );
  return eligible[eligible.length - 1];
}

function boundaryEvidence(
  previous: QuotaObservationV2 | undefined,
  capture: QuotaCapture,
  currentProviderWindowFingerprint: string | null,
  usageDropThreshold: number,
): QuotaResetEvidence | null {
  if (!previous) return null;
  if (
    previous.providerWindowFingerprint !== null &&
    currentProviderWindowFingerprint !== null &&
    previous.providerWindowFingerprint !== currentProviderWindowFingerprint
  ) {
    return 'window-id-change';
  }
  if (
    previous.resetAt !== null &&
    capture.resetAt !== null &&
    Math.abs(previous.resetAt - capture.resetAt) > RESET_CLUSTER_MS
  ) {
    return 'reset-at-change';
  }
  // An official identified counter decrease is a discontinuity, not necessarily
  // proof that a reset credit was consumed. Do not blend even a small decrease
  // into an old epoch. Preserve the historical threshold for other sources.
  if (
    (capture.source === 'codex-official-api' && previous.source === 'codex-official-api' &&
      previous.usedFraction > capture.usedFraction) ||
    previous.usedFraction - capture.usedFraction >= usageDropThreshold
  ) {
    return 'usage-drop';
  }
  return null;
}

function confidenceRank(value: QuotaEvidenceConfidence): number {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}

function lowerConfidence(
  left: QuotaEvidenceConfidence,
  right: QuotaEvidenceConfidence,
): QuotaEvidenceConfidence {
  return confidenceRank(left) <= confidenceRank(right) ? left : right;
}

function normalizedObservation(
  capture: QuotaCapture,
  salt: string,
  previous: QuotaObservationV2 | undefined,
  boundary: QuotaResetEvidence | null,
  currentProviderWindowFingerprint: string | null,
): QuotaObservationV2 {
  const stableFingerprint = capture.accountAttribution === 'unattributed'
    ? hmac(
        salt,
        `unattributed-account-epoch|${capture.provider}|${capture.unattributedEpochSignal}`,
        'anon',
      )
    : fingerprintForStableIdentity(
        salt,
        capture.provider,
        capture.stableIdentitySignal as string,
      );
  const keepPreviousWindow = previous !== undefined && boundary === null;
  const hasStructuredWindowIdentity =
    currentProviderWindowFingerprint !== null || capture.resetAt !== null;
  const epochSeed = boundary === 'usage-drop' || !hasStructuredWindowIdentity ||
    (capture.source === 'codex-official-api' && boundary !== null)
    ? [
        capture.provider,
        capture.periodType,
        currentProviderWindowFingerprint ?? '',
        capture.resetAt ?? '',
        capture.observedAt,
        boundary ?? 'initial',
      ].join('|')
    : [
        capture.provider,
        capture.periodType,
        currentProviderWindowFingerprint ?? '',
        capture.resetAt ?? '',
      ].join('|');
  const accountFingerprint = stableFingerprint;
  const windowId = keepPreviousWindow
    ? previous.windowId
    : hmac(
        salt,
        `window|${accountFingerprint}|${epochSeed}`,
        'win',
      );
  return {
    schemaVersion: QUOTA_OBSERVATION_SCHEMA_VERSION,
    provider: capture.provider,
    accountFingerprint,
    accountAttribution: capture.accountAttribution,
    observedAt: capture.observedAt,
    periodType: capture.periodType,
    usedFraction: capture.usedFraction,
    remainingFraction: Math.max(0, Math.min(1, 1 - capture.usedFraction)),
    resetAt: capture.resetAt,
    source: capture.source,
    windowId,
    providerWindowFingerprint: currentProviderWindowFingerprint,
    confidence: capture.confidence,
    captureReason: boundary ?? capture.captureReason,
    flags: orderedUniqueFlags(capture.flags),
  };
}

function compactBySeries(
  observations: QuotaObservationV2[],
  limit: number,
): QuotaObservationV2[] {
  const groups = new Map<string, QuotaObservationV2[]>();
  for (const item of observations) {
    const key = [item.provider, item.accountFingerprint, item.periodType].join('|');
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const retained: QuotaObservationV2[] = [];
  for (const group of groups.values()) {
    const ordered = group.sort((left, right) =>
      left.observedAt - right.observedAt ||
      left.usedFraction - right.usedFraction,
    );
    if (ordered.length <= limit) {
      retained.push(...ordered);
      continue;
    }
    const mandatory = new Map<string, QuotaObservationV2>();
    const windows = new Map<string, QuotaObservationV2[]>();
    for (const item of ordered) {
      const window = windows.get(item.windowId) ?? [];
      window.push(item);
      windows.set(item.windowId, window);
      if (item.captureReason !== 'refresh' || item.flags.length > 0) {
        mandatory.set(observationIdentity(item), item);
      }
    }
    for (const window of windows.values()) {
      mandatory.set(observationIdentity(window[0]), window[0]);
      mandatory.set(observationIdentity(window[window.length - 1]), window[window.length - 1]);
    }
    const selected: QuotaObservationV2[] = [];
    const selectedIds = new Set<string>();
    const retain = (item: QuotaObservationV2): void => {
      if (selected.length >= limit) return;
      const identity = observationIdentity(item);
      if (selectedIds.has(identity)) return;
      selected.push(item);
      selectedIds.add(identity);
    };
    // A one-row budget must retain the freshest fact. With any larger budget,
    // keep both ends of the series before prioritising flagged/migration and
    // per-window boundary observations. Otherwise a migration in which every
    // imported row is mandatory can evict the oldest baseline and make later
    // confidence calculations depend on an already-compacted middle slice.
    if (limit === 1) {
      retain(ordered[ordered.length - 1]);
    } else if (ordered.every(item => item.source === 'codex-official-api')) {
      // Official epoch identity is projected from each retained window's first
      // observation. Routine ambiguity flags must not evict that anchor in favor
      // of hundreds of newer flagged refreshes. Prioritize recent window bounds;
      // the current window's first and latest facts survive even a tiny budget.
      const byRecency = [...windows.values()].sort((left, right) =>
        right[right.length - 1].observedAt - left[left.length - 1].observedAt);
      for (const window of byRecency) {
        retain(window[0]);
        retain(window[window.length - 1]);
      }
    } else {
      retain(ordered[0]);
      retain(ordered[ordered.length - 1]);
    }
    for (const item of [...mandatory.values()].sort(
      (left, right) => right.observedAt - left.observedAt,
    )) {
      if (selected.length >= limit) break;
      retain(item);
    }
    for (const item of [...ordered].reverse()) {
      if (selected.length >= limit) break;
      retain(item);
    }
    retained.push(...selected);
  }
  return retained.sort((left, right) =>
    left.observedAt - right.observedAt ||
    left.provider.localeCompare(right.provider) ||
    left.periodType.localeCompare(right.periodType) ||
    left.windowId.localeCompare(right.windowId),
  );
}

function persistedBoundaryEvidence(
  previous: QuotaObservationV2,
  current: QuotaObservationV2,
  usageDropThreshold: number,
): QuotaResetEvidence | null {
  if (previous.windowId === current.windowId) return null;
  if (
    previous.providerWindowFingerprint !== null &&
    current.providerWindowFingerprint !== null &&
    previous.providerWindowFingerprint !== current.providerWindowFingerprint
  ) return 'window-id-change';
  if (
    previous.resetAt !== null &&
    current.resetAt !== null &&
    Math.abs(previous.resetAt - current.resetAt) > RESET_CLUSTER_MS
  ) return 'reset-at-change';
  if ((current.source === 'codex-official-api' && previous.usedFraction > current.usedFraction) ||
    previous.usedFraction - current.usedFraction >= usageDropThreshold) {
    return 'usage-drop';
  }
  return null;
}

/** Anonymous local reset epochs share only a local evidence channel. All
 * identified evidence compares within the same account, attribution and source. */
function boundarySeriesKey(item: QuotaObservationV2): string {
  const account = item.source === 'codex-local-structured-event' && item.accountAttribution === 'unattributed'
    ? 'anonymous-local-channel' : item.accountFingerprint;
  return [item.provider, item.periodType, item.source, item.accountAttribution, account].join('|');
}

function annotateBoundaries(
  observations: readonly QuotaObservationV2[],
  usageDropThreshold: number,
): QuotaObservationV2[] {
  const ordered = [...observations].sort((left, right) =>
    left.observedAt - right.observedAt ||
    left.provider.localeCompare(right.provider) ||
    left.periodType.localeCompare(right.periodType) ||
    left.windowId.localeCompare(right.windowId),
  );
  const previousBySeries = new Map<string, QuotaObservationV2>();
  const previousByChannel = new Map<string, QuotaObservationV2>();
  return ordered.map((item) => {
    const seriesKey = boundarySeriesKey(item);
    const previous = previousBySeries.get(seriesKey);
    const channelKey = [item.provider, item.periodType, item.source, item.accountAttribution].join('|');
    const previousInChannel = previousByChannel.get(channelKey);
    const inferred = previous
      ? persistedBoundaryEvidence(previous, item, usageDropThreshold)
      : null;
    const crossesAccountEpoch = Boolean(
      item.accountAttribution !== 'verified-local-signal' && previousInChannel &&
      previousInChannel.accountFingerprint !== item.accountFingerprint,
    );
    const normalized = {
      ...item,
      captureReason: inferred ?? item.captureReason,
      flags: orderedUniqueFlags([
        ...item.flags,
        ...(crossesAccountEpoch ? ['account-ambiguous' as const] : []),
      ]),
    };
    previousBySeries.set(seriesKey, normalized);
    previousByChannel.set(channelKey, normalized);
    return normalized;
  });
}

export function mergeQuotaCaptures(
  store: QuotaObservationStoreV2,
  captures: readonly QuotaCapture[],
  options: MergeQuotaCaptureOptions,
): QuotaObservationStoreV2 {
  const now = options.now ?? Date.now();
  const retentionDays = Math.max(
    1,
    Math.floor(options.retentionDays ?? QUOTA_OBSERVATION_RETENTION_DAYS),
  );
  const limitPerSeries = Math.max(
    1,
    Math.floor(options.limitPerSeries ?? QUOTA_OBSERVATION_LIMIT_PER_SERIES),
  );
  const usageDropThreshold = Math.max(
    0,
    Math.min(1, options.usageDropThreshold ?? USAGE_DROP_THRESHOLD),
  );
  const cutoff = now - retentionDays * DAY_MS;
  const observations = store.observations
    .filter((item) => item.observedAt >= cutoff && item.observedAt <= now + FUTURE_SKEW_MS)
    .map((item) => ({ ...item, flags: [...item.flags] }));
  const observationIds = new Set(observations.map(observationIdentity));
  const orderedCaptures = [...captures]
    .filter((item) => validCapture(item, now))
    .sort((left, right) =>
      left.observedAt - right.observedAt ||
      left.provider.localeCompare(right.provider) ||
      left.periodType.localeCompare(right.periodType),
    );
  for (const capture of orderedCaptures) {
    const stableFingerprint = capture.accountAttribution === 'unattributed'
      ? hmac(
          options.salt,
          `unattributed-account-epoch|${capture.provider}|${capture.unattributedEpochSignal}`,
          'anon',
        )
      : fingerprintForStableIdentity(
          options.salt,
          capture.provider,
          capture.stableIdentitySignal as string,
        );
    const previous = latestBefore(observations, capture, stableFingerprint);
    // Local Codex logs do not expose a safe stable account identity. Their reset windows
    // intentionally use separate unattributed epochs, but a resetAt/window
    // transition still remains useful low-confidence reset evidence. Consult
    // the preceding anonymous local-channel observation only for boundary detection;
    // never reuse its fingerprint or combine account-level estimates.
    const boundaryPrevious = previous ?? (
      capture.source === 'codex-local-structured-event' && capture.accountAttribution === 'unattributed'
        ? latestAnonymousChannelBefore(observations, capture)
        : undefined
    );
    const currentProviderWindowFingerprint = providerWindowFingerprint(
      options.salt,
      capture,
    );
    const boundary = boundaryEvidence(
      boundaryPrevious,
      capture,
      currentProviderWindowFingerprint,
      usageDropThreshold,
    );
    const captureWithBoundaryFlags = boundaryPrevious &&
      boundaryPrevious.accountFingerprint !== stableFingerprint
      ? {
          ...capture,
          flags: orderedUniqueFlags([
            ...(capture.flags ?? []),
            'account-ambiguous',
          ]),
        }
      : capture;
    const observation = normalizedObservation(
      captureWithBoundaryFlags,
      options.salt,
      previous,
      boundary,
      currentProviderWindowFingerprint,
    );
    const identity = observationIdentity(observation);
    if (!observationIds.has(identity)) {
      observations.push(observation);
      observationIds.add(identity);
    }
  }
  return {
    schemaVersion: QUOTA_OBSERVATION_SCHEMA_VERSION,
    fingerprintAlgorithm: 'hmac-sha256-v1',
    observations: compactBySeries(
      annotateBoundaries(observations, usageDropThreshold),
      limitPerSeries,
    ),
  };
}

/** Reset events are a deterministic runtime projection, not a second persisted
 * fact table. Boundary observations carry the evidence needed to reconstruct
 * consecutive and same-day resets without duplicating sensitive identifiers. */
export function deriveQuotaResetEvents(
  store: QuotaObservationStoreV2,
): QuotaResetEventV2[] {
  const events: QuotaResetEventV2[] = [];
  const ordered = [...store.observations].sort((left, right) =>
    left.observedAt - right.observedAt || left.windowId.localeCompare(right.windowId),
  );
  const previousBySeries = new Map<string, QuotaObservationV2>();
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const seriesKey = boundarySeriesKey(current);
    const previous = previousBySeries.get(seriesKey);
    previousBySeries.set(seriesKey, current);
    if (!previous || previous.windowId === current.windowId) continue;
    const inferred = persistedBoundaryEvidence(
      previous,
      current,
      USAGE_DROP_THRESHOLD,
    );
    const evidence = inferred ?? (
      RESET_EVIDENCE.has(current.captureReason as QuotaResetEvidence)
        ? current.captureReason as QuotaResetEvidence
        : null
    );
    if (!evidence) continue;
    const crossesAccountEpoch =
      previous.accountFingerprint !== current.accountFingerprint;
    events.push({
      schemaVersion: 2,
      provider: current.provider,
      periodType: current.periodType,
      detectedAt: current.observedAt,
      boundaryAt: evidence === 'usage-drop'
        ? current.observedAt
        : previous.resetAt ?? current.observedAt,
      previousAccountFingerprint: previous.accountFingerprint,
      nextAccountFingerprint: current.accountFingerprint,
      previousWindowId: previous.windowId,
      nextWindowId: current.windowId,
      evidence,
      confidence: crossesAccountEpoch
        ? 'low'
        : evidence === 'usage-drop'
          ? lowerConfidence(current.confidence, 'medium')
          : current.confidence,
      flags: orderedUniqueFlags([
        ...current.flags,
        ...(crossesAccountEpoch ? ['account-ambiguous' as const] : []),
      ]),
    });
  }
  return events;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^(?:acct|anon)_[a-f0-9]{32}$/.test(value);
}

function validWindowId(value: unknown): value is string {
  return typeof value === 'string' && /^win_[a-f0-9]{32}$/.test(value);
}

function parseFlags(value: unknown): QuotaObservationFlag[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && FLAGS.has(item as QuotaObservationFlag))) {
    return null;
  }
  return orderedUniqueFlags(value as QuotaObservationFlag[]);
}

function parseObservation(value: unknown, now: number): QuotaObservationV2 | null {
  const item = record(value);
  if (!item || !exactKeys(item, [
    'schemaVersion', 'provider', 'accountFingerprint', 'accountAttribution',
    'observedAt', 'periodType', 'usedFraction', 'remainingFraction', 'resetAt',
    'source', 'windowId', 'providerWindowFingerprint', 'confidence',
    'captureReason', 'flags',
  ])) return null;
  const flags = parseFlags(item.flags);
  if (
    item.schemaVersion !== 2 ||
    (item.provider !== 'claude' && item.provider !== 'codex') ||
    !validFingerprint(item.accountFingerprint) ||
    typeof item.accountAttribution !== 'string' ||
    !ATTRIBUTIONS.has(item.accountAttribution as QuotaAccountAttribution) ||
    !finitePositive(item.observedAt) ||
    item.observedAt > now + FUTURE_SKEW_MS ||
    typeof item.periodType !== 'string' ||
    !PERIOD_TYPES.has(item.periodType as QuotaPeriodType) ||
    !finiteFraction(item.usedFraction) ||
    !finiteFraction(item.remainingFraction) ||
    Math.abs(item.usedFraction + item.remainingFraction - 1) > 1e-9 ||
    !(item.resetAt === null || finitePositive(item.resetAt)) ||
    typeof item.source !== 'string' ||
    !SOURCES.has(item.source as QuotaObservationSource) ||
    !validWindowId(item.windowId) ||
    !(item.providerWindowFingerprint === null ||
      typeof item.providerWindowFingerprint === 'string' &&
      /^pwin_[a-f0-9]{32}$/.test(item.providerWindowFingerprint)) ||
    typeof item.confidence !== 'string' ||
    !CONFIDENCES.has(item.confidence as QuotaEvidenceConfidence) ||
    typeof item.captureReason !== 'string' ||
    !CAPTURE_REASONS.has(item.captureReason as QuotaCaptureReason) ||
    flags === null
  ) return null;
  return {
    schemaVersion: 2,
    provider: item.provider,
    accountFingerprint: item.accountFingerprint,
    accountAttribution: item.accountAttribution as QuotaAccountAttribution,
    observedAt: item.observedAt,
    periodType: item.periodType as QuotaPeriodType,
    usedFraction: item.usedFraction,
    remainingFraction: item.remainingFraction,
    resetAt: item.resetAt as number | null,
    source: item.source as QuotaObservationSource,
    windowId: item.windowId,
    providerWindowFingerprint: item.providerWindowFingerprint as string | null,
    confidence: item.confidence as QuotaEvidenceConfidence,
    captureReason: item.captureReason as QuotaCaptureReason,
    flags,
  };
}

function parseStore(value: unknown, now: number): QuotaObservationStoreV2 | null {
  const item = record(value);
  if (!item || !exactKeys(item, [
    'schemaVersion', 'fingerprintAlgorithm', 'observations',
  ])) return null;
  if (
    item.schemaVersion !== 2 ||
    item.fingerprintAlgorithm !== 'hmac-sha256-v1' ||
    !Array.isArray(item.observations)
  ) return null;
  const observations = item.observations.map((entry) => parseObservation(entry, now));
  if (observations.some((entry) => entry === null)) {
    return null;
  }
  const observationMap = new Map(
    (observations as QuotaObservationV2[]).map((entry) => [observationIdentity(entry), entry]),
  );
  return {
    schemaVersion: 2,
    fingerprintAlgorithm: 'hmac-sha256-v1',
    observations: [...observationMap.values()].sort((left, right) =>
      left.observedAt - right.observedAt || left.windowId.localeCompare(right.windowId),
    ),
  };
}

async function quarantine(filePath: string, now: number): Promise<string | undefined> {
  const quarantinePath = `${filePath}.quarantine-${Math.floor(now)}-${randomBytes(4).toString('hex')}`;
  try {
    await rename(filePath, quarantinePath);
    return quarantinePath;
  } catch {
    return undefined;
  }
}

export async function loadQuotaObservationStore(
  filePath: string,
  options: { now?: number } = {},
): Promise<QuotaObservationLoadResult> {
  const now = options.now ?? Date.now();
  let body: string;
  try {
    body = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { store: createEmptyQuotaObservationStore(), disposition: 'missing' };
    }
    return { store: createEmptyQuotaObservationStore(), disposition: 'quarantined' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    const quarantinePath = await quarantine(filePath, now);
    return {
      store: createEmptyQuotaObservationStore(),
      disposition: 'quarantined',
      ...(quarantinePath ? { quarantinePath } : {}),
    };
  }
  const store = parseStore(parsed, now);
  if (!store) {
    const quarantinePath = await quarantine(filePath, now);
    return {
      store: createEmptyQuotaObservationStore(),
      disposition: 'quarantined',
      ...(quarantinePath ? { quarantinePath } : {}),
    };
  }
  return { store, disposition: 'valid' };
}

export async function saveQuotaObservationStoreAtomic(
  filePath: string,
  store: QuotaObservationStoreV2,
): Promise<void> {
  const sanitized = parseStore(store, Date.now());
  if (!sanitized) {
    throw new Error('invalid quota observation store');
  }
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(sanitized), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
    try {
      const directoryHandle = await open(directory, 'r');
      await directoryHandle.sync();
      await directoryHandle.close();
    } catch {
      // Some VS Code hosts/filesystems do not permit directory fsync. The file
      // itself was still flushed and installed by same-directory rename.
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

function cloneStore(store: QuotaObservationStoreV2): QuotaObservationStoreV2 {
  return {
    schemaVersion: 2,
    fingerprintAlgorithm: 'hmac-sha256-v1',
    observations: store.observations.map((item) => ({
      ...item,
      flags: [...item.flags],
    })),
  };
}

async function quotaObservationAuxiliaryNames(filePath: string): Promise<string[]> {
  const directory = path.dirname(filePath);
  const canonical = path.basename(filePath);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const quarantinePattern = new RegExp(
    `^${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.quarantine-\\d+-[a-f0-9]{8}$`,
  );
  const temporaryPattern = new RegExp(
    `^\\.${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+\\.[a-f0-9]{12}\\.tmp$`,
  );
  return names.filter((name) => quarantinePattern.test(name) || temporaryPattern.test(name));
}

async function purgeQuotaObservationAuxiliaries(filePath: string): Promise<void> {
  const directory = path.dirname(filePath);
  for (const name of await quotaObservationAuxiliaryNames(filePath)) {
    await unlink(path.join(directory, name)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

export class QuotaObservationRepository {
  private state: QuotaObservationStoreV2 | undefined;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly salt: string,
    private readonly now: () => number = Date.now,
  ) {}

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  load(): Promise<QuotaObservationStoreV2> {
    return this.serialized(async () => {
      this.state = (await loadQuotaObservationStore(this.filePath, {
        now: this.now(),
      })).store;
      return cloneStore(this.state);
    });
  }

  append(captures: readonly QuotaCapture[]): Promise<QuotaObservationStoreV2> {
    return this.serialized(async () => {
      const lease = await acquireCodexIndexLease(this.filePath);
      try {
        // Always re-read under the process-shared lease. A second VS Code
        // Extension Host may have committed observations since our last call.
        const current = (await loadQuotaObservationStore(this.filePath, {
          now: this.now(),
        })).store;
        const next = mergeQuotaCaptures(current, captures, {
          salt: this.salt,
          now: this.now(),
        });
        if (JSON.stringify(next) !== JSON.stringify(current)) {
          await saveQuotaObservationStoreAtomic(this.filePath, next);
        }
        this.state = next;
        return cloneStore(next);
      } finally {
        await lease.release();
      }
    });
  }

  /**
   * Remove only observations selected by an exact provider/fingerprint scope.
   * The same process-shared lease and atomic writer as append() prevent a
   * clear from racing another Extension Host into resurrecting an older file.
   */
  clear(scope: QuotaObservationClearScope = {}): Promise<QuotaObservationStoreV2> {
    return this.serialized(async () => {
      const lease = await acquireCodexIndexLease(this.filePath);
      try {
        const loaded = await loadQuotaObservationStore(this.filePath, {
          now: this.now(),
        });
        const clearAll = scope.provider === undefined &&
          scope.accountFingerprint === undefined;
        const auxiliaries = await quotaObservationAuxiliaryNames(this.filePath);
        if (!clearAll && (loaded.disposition === 'quarantined' || auxiliaries.length > 0)) {
          throw new QuotaObservationScopedClearBlockedError();
        }
        const current = loaded.store;
        const observations = current.observations.filter((item) => {
          const providerMatches = scope.provider === undefined ||
            item.provider === scope.provider;
          const accountMatches = scope.accountFingerprint === undefined ||
            item.accountFingerprint === scope.accountFingerprint;
          return !(providerMatches && accountMatches);
        });
        const next: QuotaObservationStoreV2 = {
          schemaVersion: 2,
          fingerprintAlgorithm: 'hmac-sha256-v1',
          observations,
        };
        if (clearAll || observations.length !== current.observations.length) {
          await saveQuotaObservationStoreAtomic(this.filePath, next);
        }
        if (clearAll) {
          // Keep the canonical empty file. Another Extension Host that appends
          // after this lease is released must extend that empty store instead
          // of having its new write deleted by a second lease acquisition.
          await purgeQuotaObservationAuxiliaries(this.filePath);
        }
        this.state = next;
        return cloneStore(next);
      } finally {
        await lease.release();
      }
    });
  }
}

export function quotaStoreWeeklyObservations(
  store: QuotaObservationStoreV2,
  provider: UsageProvider,
  accountFingerprint?: string,
): WeeklyQuotaObservation[] {
  const selected = store.observations
    .filter((item) =>
      item.provider === provider &&
      item.periodType === 'seven-day' &&
      item.resetAt !== null &&
      (accountFingerprint === undefined || item.accountFingerprint === accountFingerprint),
    );
  const fingerprints = [...new Set(selected.map((item) => item.accountFingerprint))]
    .sort();
  const aliases = new Map(fingerprints.map((fingerprint, index) => [
    fingerprint,
    accountFingerprint === undefined
      ? `${provider}-epoch-${index + 1}`
      : `active-${provider}`,
  ]));
  const windows = [...new Set(selected.map((item) => item.windowId))].sort();
  const windowAliases = new Map(windows.map((windowId, index) => [
    windowId,
    `${provider}-window-${index + 1}`,
  ]));
  return selected.map((item) => ({
      provider: item.provider,
      seriesKey: aliases.get(item.accountFingerprint) as string,
      observedAt: item.observedAt,
      resetAt: item.resetAt as number,
      usedPercent: item.usedFraction * 100,
      accountAttribution: item.accountAttribution,
      windowId: windowAliases.get(item.windowId) as string,
      observationConfidence: item.confidence,
      flags: [...item.flags],
    }));
}

export function claudeQuotaCapturesFromUsage(
  usage: ClaudeApiUsageResponse | null,
  identitySignal: string,
  accountAttribution: Extract<
    QuotaAccountAttribution,
    'verified-local-signal' | 'profile-continuity'
  >,
  observedAt: number,
  captureReason: QuotaCaptureReason = 'refresh',
): QuotaCapture[] {
  return normalizeQuotaWindows(usage).map((window): QuotaCapture => {
    const resetAt = Date.parse(window.resetsAt);
    return {
      provider: 'claude',
      stableIdentitySignal: identitySignal,
      accountAttribution,
      observedAt,
      periodType: window.kind === 'session'
        ? 'five-hour'
        : window.kind === 'weekly_all'
          ? 'seven-day'
          : 'provider-scoped-seven-day',
      usedFraction: Math.max(0, Math.min(1, window.utilization / 100)),
      resetAt: Number.isFinite(resetAt) && resetAt > 0 ? resetAt : null,
      source: 'claude-official-api',
      // Scope labels never persist: this runtime string is HMACed into the
      // provider-window fingerprint by mergeQuotaCaptures.
      sourceWindowId: `${window.kind}|${window.scopeLabel ?? 'all'}`,
      confidence: Number.isFinite(resetAt) && resetAt > 0 ? 'high' : 'medium',
      captureReason,
      flags: Number.isFinite(resetAt) && resetAt > 0 ? [] : ['approximate-boundary'],
    };
  });
}

/** Copy only the daemon sample's numeric checkpoint and already-pseudonymous
 * account scope. This does not attribute local usage to the official account. */
export function codexQuotaCaptureFromOfficialSample(sample: {
  accountScopeKey: string;
  observedAt: number;
  resetAt: number;
  usedPercent: number;
}): QuotaCapture | null {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return null;
  try {
    const { accountScopeKey, observedAt, resetAt, usedPercent } = sample;
    if (
      typeof accountScopeKey !== 'string' || accountScopeKey.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(accountScopeKey) ||
      !Number.isSafeInteger(observedAt) || observedAt <= 0 ||
      !Number.isSafeInteger(resetAt) || resetAt <= observedAt ||
      observedAt < resetAt - 7 * DAY_MS ||
      !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100
    ) return null;
    return {
      provider: 'codex',
      stableIdentitySignal: 'official-account-scope-v1|' + accountScopeKey,
      accountAttribution: 'verified-local-signal',
      observedAt,
      periodType: 'seven-day',
      usedFraction: usedPercent / 100,
      resetAt,
      source: 'codex-official-api',
      sourceWindowId: 'codex|weekly',
      confidence: 'high',
      captureReason: 'refresh',
      flags: [],
    };
  } catch {
    return null;
  }
}

export function codexQuotaCapturesFromWeeklyObservations(
  observations: readonly WeeklyQuotaObservation[],
  captureReason: QuotaCaptureReason = 'refresh',
): QuotaCapture[] {
  return observations.map((item): QuotaCapture => {
    // A Codex file key identifies one local log, not an account. The reset
    // window is the narrowest safe epoch we can infer without inventing an
    // account split; attribution therefore remains explicitly unattributed.
    const sourceEpoch = `codex-window|${item.windowId ?? item.resetAt}`;
    return {
      provider: 'codex',
      unattributedEpochSignal: sourceEpoch,
      accountAttribution: 'unattributed',
      observedAt: item.observedAt,
      periodType: 'seven-day',
      usedFraction: Math.max(0, Math.min(1, item.usedPercent / 100)),
      resetAt: item.resetAt,
      source: 'codex-local-structured-event',
      confidence: item.observationConfidence ?? 'medium',
      captureReason,
      flags: orderedUniqueFlags(item.flags),
    };
  });
}
