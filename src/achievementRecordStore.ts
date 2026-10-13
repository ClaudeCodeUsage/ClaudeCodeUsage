import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, AchievementId, newlyUnlockedPluginAchievements, notifiableAchievementIds } from './achievements';
import { AchievementActivity, emptyAchievementActivity, parseAchievementActivity } from './achievementActivity';
import { CalendarPeakEvidence, parseCalendarPeakEvidence, updateCalendarPeakEvidence } from './achievementCalendar';
import { HourEvidence, parseHourEvidence } from './achievementHours';
import { acquireCodexIndexLease } from './providers/codex/codexIndexLease';
import { achievementRuleVersion, isLegacyAchievementId } from './achievementRuleVersions';
import { isAchievementMoneyId, type AchievementMoneyId } from './achievementMoneyCatalog';
import { getAchievementMoneyPricebook } from './achievementMoney';
import {isPublishedAchievementReferencePricebook} from './achievementReferenceBooks';

// The joint-rule evaluator and canonical migration switch together.
export const ACHIEVEMENT_RECORD_FILE = 'achievements-v2.json';
export const ACHIEVEMENT_V2_RECORD_FILE = 'achievements-v2.json';
export const ACHIEVEMENT_LEGACY_RECORD_FILE = 'achievements-v1.json';
export const ACHIEVEMENT_RECORD_BYTE_LIMIT = 65_536;
export function achievementRecordAuxiliaryName(name: string): boolean {
  return /^\.achievements-v[12]\.json\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/.test(name);
}
export type AchievementRecordOrigin = 'existing' | 'history' | 'usage' | 'activity';
export interface AchievementRecordDraft {
  id: AchievementId;
  origin: AchievementRecordOrigin;
  /** First recording day, never inferred as the original achievement date. */
  recordedDay: string | null;
  timeZone: string | null;
  /** Public frozen reference identity only; no personal amount or config. */
  referencePricebook?: string;
}
export interface AchievementUsageRecording {
  recordedDay: string;
  timeZone: string;
  /** Required exactly for selected money IDs; public frozen versions only. */
  referencePricebooks?: Partial<Record<AchievementMoneyId, string>>;
}
export interface AchievementRecord extends AchievementRecordDraft {
  ruleVersion: 1 | 2;
  seq: number;
  unread: boolean;
}
export interface AchievementRecordStore {
  schemaVersion: 1 | 2;
  generation: number;
  sequence: number;
  lastNoticeAt: number;
  pins: string[];
  records: AchievementRecord[];
  auxiliary: AchievementAuxiliaryProof;
  /** Present only in v2. Old qualifications do not confer current grant rights. */
  catalogVersion?: 2;
  legacyRecords?: AchievementRecord[];
  showcaseMode?: 'automatic' | 'manual';
  pinRevision?: number;
  /** Bounded derived-store revision, not an account or usage-source identity. */
  legacyBoundary?: { generation: number; sequence: number; signature: string } | null;
}
/** Existing bounded proof only; no per-action history or setting values. */
export interface AchievementAuxiliaryProof {
  activity: AchievementActivity;
  hours: HourEvidence;
  calendarPeak: CalendarPeakEvidence | null;
}
function emptyAuxiliary(): AchievementAuxiliaryProof {
  return { activity: emptyAchievementActivity(), hours: { schemaVersion: 3, maxStreak: 0 }, calendarPeak: null };
}
const ids = new Set<string>(ACHIEVEMENT_DEFINITIONS.map(row => row.id));
const seriesIds = new Set(Object.values(ACHIEVEMENT_SERIES).flat());
const keys = new Set([...Object.keys(ACHIEVEMENT_SERIES), ...ACHIEVEMENT_DEFINITIONS.filter(row => !seriesIds.has(row.id)).map(row => row.id)]);
// Frozen v1 pin vocabulary: adding tiers must neither invalidate old series pins
// nor let a newly invented series key enter a downgrade-readable file.
const legacySeriesKeys = new Set<string>([
  'cumulative-volume', 'sonnet-main', 'opus-cannon', 'haiku-worker', 'cache-wizard',
  'claude-output', 'claude-output-sessions', 'claude-cache-creation', 'fable-volume',
  'fable-days', 'fable-sessions', 'weekly-volume', 'output-hours', 'settings-explorer',
  'astra-regular', 'sol-regular', 'luna-regular', 'agent-team', 'same-root-models',
  'effort-breadth', 'agent-conductor', 'root-portfolio', 'agent-participation',
  'model-relay-roots', 'active-day-streak', 'active-days', 'model-rainbow',
  'codex-output', 'codex-cache-read', 'astra-days', 'sol-days', 'luna-days',
  'sonnet-days', 'opus-days', 'haiku-days', 'dual-provider-days', 'active-weeks', 'weekly-average',
]);
const origins = new Set(['existing', 'history', 'usage', 'activity']);
type WriteGuard = () => boolean;
const invalid = (): never => { throw new Error('achievement-record:invalid'); };
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const actual = Object.keys(value);
  if (actual.length !== fields.length || actual.some(key => !fields.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function validDay(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function validZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z0-9_+./-]+$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}
function draft(value: unknown, bookPolicy: 'current' | 'history' = 'current'): AchievementRecordDraft {
  const monetary = !!value && typeof value === 'object' && typeof (value as {id?:unknown}).id === 'string' &&
    isAchievementMoneyId((value as {id:string}).id);
  const row = object(value, ['id', 'origin', 'recordedDay', 'timeZone', ...(monetary ? ['referencePricebook'] : [])]);
  if (monetary) {
    const provider=String(row.id).startsWith('codex-') ? 'codex' : 'claude';
    const current=provider==='codex' ? [getAchievementMoneyPricebook('openai').version] :
      [getAchievementMoneyPricebook('anthropic').version,getAchievementMoneyPricebook('aws-bedrock-in-region').version];
    if (!current.includes(row.referencePricebook as string) &&
      !(bookPolicy==='history' && isPublishedAchievementReferencePricebook(provider,row.referencePricebook))) return invalid();
  }
  if (typeof row.id !== 'string' || !ids.has(row.id) || typeof row.origin !== 'string' || !origins.has(row.origin)) return invalid();
  const historical = row.origin === 'history' || row.origin === 'existing';
  if (historical ? row.recordedDay !== null || row.timeZone !== null
    : !validDay(row.recordedDay) || !validZone(row.timeZone)) return invalid();
  return row as unknown as AchievementRecordDraft;
}
function legacyPinKey(key:string):boolean {
  return isLegacyAchievementId(key) || legacySeriesKeys.has(key);
}
function pins(value: unknown, limit = 3, legacy = false): string[] {
  if (!Array.isArray(value) || value.length > limit || new Set(value).size !== value.length ||
      value.some(key => !keys.has(key) || legacy && !legacyPinKey(key))) return invalid();
  return value.slice();
}
function recordIds(value: unknown): AchievementId[] {
  if (!Array.isArray(value) || value.length > ids.size || new Set(value).size !== value.length ||
      value.some(id => typeof id !== 'string' || !ids.has(id))) return invalid();
  return value.slice();
}
function activity(value: unknown): AchievementActivity {
  const parsed = parseAchievementActivity(value);
  if (!isDeepStrictEqual(value, parsed)) return invalid();
  return parsed;
}
function hours(value: unknown): HourEvidence {
  const parsed = parseHourEvidence(value);
  if (!isDeepStrictEqual(value, parsed)) return invalid();
  return parsed;
}
function calendarPeak(value: unknown): CalendarPeakEvidence | null {
  if (value === null) return null;
  const parsed = parseCalendarPeakEvidence(value);
  if (!parsed || !validZone(parsed.timeZone) || !isDeepStrictEqual(value, parsed)) return invalid();
  return parsed;
}
function auxiliary(value: unknown): AchievementAuxiliaryProof {
  const row = object(value, ['activity', 'hours', 'calendarPeak']);
  return { activity: activity(row.activity), hours: hours(row.hours), calendarPeak: calendarPeak(row.calendarPeak) };
}
function mergeActivity(current: AchievementActivity, next: AchievementActivity): AchievementActivity {
  return { schemaVersion: 2,
    settingKeys: [...new Set([...current.settingKeys, ...next.settingKeys])].sort(),
    features: [...new Set([...current.features, ...next.features])].sort() };
}
function appendRecords(store: AchievementRecordStore, drafts: readonly AchievementRecordDraft[]): AchievementRecord[] {
  const added: AchievementRecord[] = [];
  const existing = new Set(store.records.map(row => row.id));
  for (const row of drafts) {
    if (store.schemaVersion === 1 && !isLegacyAchievementId(row.id)) return invalid();
    if (existing.has(row.id)) continue;
    if (store.sequence === Number.MAX_SAFE_INTEGER) return invalid();
    const record: AchievementRecord = { ...row, ruleVersion: store.schemaVersion === 2 ? achievementRuleVersion(row.id) : 1, seq: ++store.sequence,
      unread: row.origin === 'usage' || row.origin === 'activity' };
    existing.add(row.id); store.records.push(record); added.push(record);
  }
  return added;
}
export function parseAchievementRecordStore(value: unknown): AchievementRecordStore {
  if (!value || typeof value !== 'object') return invalid();
  const version = (value as {schemaVersion?: unknown}).schemaVersion;
  if (version !== 1 && version !== 2) return invalid();
  const store = object(value, ['schemaVersion', 'generation', 'sequence', 'lastNoticeAt', 'pins', 'records', 'auxiliary',
    ...(version === 2 ? ['catalogVersion', 'legacyRecords', 'showcaseMode', 'pinRevision', 'legacyBoundary'] : [])]);
  if (!integer(store.generation) || store.generation < 1 ||
      !integer(store.sequence) || !integer(store.lastNoticeAt) || !Array.isArray(store.records) || store.records.length > ids.size) return invalid();
  function rows(values: unknown, archived = false): AchievementRecord[] {
    if (!Array.isArray(values) || values.length > (archived ? 48 : version === 1 ? 124 : ids.size)) return invalid();
    const seen = new Set<string>();
    let previous = 0;
    return values.map(value => {
    const monetary = version === 2 && !archived && !!value && typeof value === 'object' &&
      isAchievementMoneyId((value as {id:string}).id);
    const row = object(value, ['id', 'origin', 'recordedDay', 'timeZone', 'ruleVersion', 'seq', 'unread',
      ...(monetary ? ['referencePricebook'] : [])]);
    const base = draft({ id: row.id, origin: row.origin, recordedDay: row.recordedDay, timeZone: row.timeZone,
      ...(monetary ? {referencePricebook:row.referencePricebook} : {}) },'history');
    const expectedVersion = archived || version === 1 ? 1 : achievementRuleVersion(base.id);
    if ((version === 1 || archived) && !isLegacyAchievementId(base.id)) return invalid();
    if (archived && (achievementRuleVersion(base.id) !== 2 || row.unread !== false)) return invalid();
    if (row.ruleVersion !== expectedVersion || !integer(row.seq) || row.seq <= previous || row.seq > (store.sequence as number) ||
        seen.has(base.id) || typeof row.unread !== 'boolean' ||
        ((base.origin === 'history' || base.origin === 'existing') && row.unread)) return invalid();
    seen.add(base.id); previous = row.seq;
    return { ...base, ruleVersion: expectedVersion, seq: row.seq, unread: row.unread };
    });
  }
  const result: AchievementRecordStore = { schemaVersion: version, generation: store.generation, sequence: store.sequence,
    lastNoticeAt: store.lastNoticeAt, pins: pins(store.pins, version === 2 ? 6 : 3, version===1), records: rows(store.records), auxiliary: auxiliary(store.auxiliary) };
  if (version === 2) {
    if (store.catalogVersion !== 2 || !['automatic','manual'].includes(store.showcaseMode as string) || !integer(store.pinRevision)) return invalid();
    let boundary: AchievementRecordStore['legacyBoundary'] = null;
    if (store.legacyBoundary !== null) {
      const parsed = object(store.legacyBoundary, ['generation','sequence','signature']);
      if (!integer(parsed.generation) || parsed.generation < 1 || !integer(parsed.sequence) ||
          typeof parsed.signature !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.signature)) return invalid();
      boundary = {generation:parsed.generation,sequence:parsed.sequence,signature:parsed.signature};
    }
    Object.assign(result, {catalogVersion:2, legacyRecords:rows(store.legacyRecords,true),
      showcaseMode:store.showcaseMode,pinRevision:store.pinRevision,legacyBoundary:boundary});
    const receipts = new Set(result.records.map(row => row.seq));
    const currentById = new Map(result.records.map(row => [row.id,row]));
    for (const row of result.legacyRecords!) {
      if (receipts.has(row.seq) || (currentById.get(row.id)?.seq ?? Infinity) <= row.seq) return invalid();
      receipts.add(row.seq);
    }
  }
  if (Buffer.byteLength(JSON.stringify(result)) > ACHIEVEMENT_RECORD_BYTE_LIMIT) return invalid();
  return result;
}
export function recentAchievementRecords(store: AchievementRecordStore): AchievementRecord[] {
  return store.records.slice(-30).reverse();
}
function empty(generation = 1, sequence = 0): AchievementRecordStore {
  return { schemaVersion: 1, generation, sequence, lastNoticeAt: 0, pins: [], records: [], auxiliary: emptyAuxiliary() };
}
function v2Empty(generation = 1, sequence = 0, legacyBoundary: AchievementRecordStore['legacyBoundary'] = null): AchievementRecordStore {
  return {...empty(generation,sequence),schemaVersion:2,catalogVersion:2,legacyRecords:[],
    showcaseMode:'automatic',pinRevision:0,legacyBoundary};
}
function boundaryFor(store: AchievementRecordStore): NonNullable<AchievementRecordStore['legacyBoundary']> {
  return {generation:store.generation,sequence:store.sequence,
    signature:createHash('sha256').update(JSON.stringify(store)).digest('hex')};
}
function migrateV1(store: AchievementRecordStore): AchievementRecordStore {
  if (store.schemaVersion !== 1 || store.generation === Number.MAX_SAFE_INTEGER) return invalid();
  const result = v2Empty(store.generation + 1,store.sequence,boundaryFor(store));
  result.lastNoticeAt = store.lastNoticeAt;
  result.auxiliary = auxiliary(store.auxiliary);
  result.records = store.records.filter(row => achievementRuleVersion(row.id) === 1).map(row => ({...row}));
  result.legacyRecords = store.records.filter(row => achievementRuleVersion(row.id) === 2).map(row => ({...row,unread:false}));
  result.pins = store.pins.slice();
  result.showcaseMode = result.pins.length ? 'manual' : 'automatic';
  return result;
}
function errno(error: unknown, code: string): boolean { return (error as NodeJS.ErrnoException)?.code === code; }
/** Pin an open regular file and read at most 64 KiB + one overflow byte. */
export async function loadAchievementRecords(file: string): Promise<AchievementRecordStore | undefined> {
  let before;
  try { before = await lstat(file); } catch (error) { if (errno(error, 'ENOENT')) return undefined; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || before.size > ACHIEVEMENT_RECORD_BYTE_LIMIT) return invalid();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev || info.size > ACHIEVEMENT_RECORD_BYTE_LIMIT) return invalid();
    const buffer = Buffer.alloc(ACHIEVEMENT_RECORD_BYTE_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > ACHIEVEMENT_RECORD_BYTE_LIMIT) return invalid();
    let value;
    try { value = JSON.parse(buffer.toString('utf8', 0, length)); } catch { return invalid(); }
    return parseAchievementRecordStore(value);
  } finally { await handle.close(); }
}
function check(guard: WriteGuard): void { if (!guard()) throw new Error('achievement-record:cancelled'); }
async function save(file: string, store: AchievementRecordStore, guard: WriteGuard): Promise<void> {
  const bytes = JSON.stringify(parseAchievementRecordStore(store));
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let handle;
  try {
    check(guard);
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes, 'utf8');
    await handle.sync(); await handle.close(); handle = undefined;
    check(guard);
    await rename(temporary, file);
    // Directory fsync is unsupported on some platforms; the file was flushed.
    const directory = await open(path.dirname(file), 'r').catch(() => undefined);
    if (directory) { try { await directory.sync().catch(() => undefined); } finally { await directory.close(); } }
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(error => { if (!errno(error, 'ENOENT')) throw error; });
  }
}
/** Per-operation filesystem lease, not an in-memory queue: hosts merge the latest bytes. */
export class AchievementRecordRepository {
  private readonly v2: boolean;
  private readonly legacyFile: string;
  private adopted = false;
  constructor(readonly file: string) {
    this.v2 = path.basename(file) === ACHIEVEMENT_V2_RECORD_FILE;
    this.legacyFile = path.join(path.dirname(file), ACHIEVEMENT_LEGACY_RECORD_FILE);
  }
  private async transaction<T>(guard: WriteGuard, run: () => Promise<T>): Promise<T> {
    check(guard);
    // v1 writers already use this anchor. One shared lease avoids cross-version
    // races without ever copying v2 fields into a v1-readable file.
    const lease = await acquireCodexIndexLease(this.v2 ? this.legacyFile : this.file, { timeoutMs: 5_000, shouldCancel: () => !guard() });
    try { check(guard); return await run(); } finally { await lease.release(); }
  }
  private async owned(): Promise<AchievementRecordStore | undefined> {
    const saved = await loadAchievementRecords(this.file);
    if (saved && saved.schemaVersion !== (this.v2 ? 2 : 1)) return invalid();
    return saved;
  }
  private async legacy(): Promise<AchievementRecordStore | undefined> {
    const saved = await loadAchievementRecords(this.legacyFile);
    if (saved && saved.schemaVersion !== 1) return invalid();
    return saved;
  }
  private async synchronizeLegacy(store: AchievementRecordStore, guard: WriteGuard, adopt: boolean): Promise<AchievementRecordStore> {
    if (!this.v2) return store;
    let legacy = await this.legacy();
    const previous = store.legacyBoundary;
    // Resume an explicit clear after the v2 tombstone committed but flushing
    // the old-version fence failed. Never re-import pre-clear qualification.
    if (previous && (!legacy || legacy.generation < previous.generation) &&
        boundaryFor(empty(previous.generation,previous.sequence)).signature === previous.signature) {
      legacy = empty(previous.generation,previous.sequence);
      await save(this.legacyFile,legacy,guard);
    }
    if (legacy && legacy.generation > (previous?.generation ?? 1)) {
      if (store.generation === Number.MAX_SAFE_INTEGER) return invalid();
      const cleared = v2Empty(store.generation + 1,store.sequence,boundaryFor(legacy));
      await save(this.file,cleared,guard);
      return cleared;
    }
    const next = legacy ? boundaryFor(legacy) : null;
    if (!isDeepStrictEqual(previous,next)) {
      if (!adopt) throw new Error('achievement-record:old-writer');
      // A freshly reloaded host may adopt the revision, not its grants/proof.
      // Existing v2 stays authoritative even after a downgrade has written v1.
      store.legacyBoundary = next;
      await save(this.file,store,guard);
    }
    return store;
  }
  async initialize(legacy: readonly AchievementId[], guard: WriteGuard = () => true,
    legacyAuxiliary: AchievementAuxiliaryProof = emptyAuxiliary()): Promise<AchievementRecordStore> {
    return this.transaction(guard, async () => {
      const saved = await this.owned();
      if (saved) {
        const synchronized = await this.synchronizeLegacy(saved,guard,!this.adopted);
        this.adopted = true;
        return synchronized;
      }
      const prior = this.v2 ? await this.legacy() : undefined;
      if (prior) {
        const migrated = migrateV1(prior);
        await save(this.file,migrated,guard);
        this.adopted = true;
        return migrated;
      }
      const store = this.v2 ? v2Empty() : empty();
      store.auxiliary = auxiliary(legacyAuxiliary);
      for (const id of [...new Set(legacy)].sort()) {
        if (!ids.has(id)) return invalid();
        if (!isLegacyAchievementId(id)) {
          if (this.v2 && isAchievementMoneyId(id)) continue;
          return invalid();
        }
        const row: AchievementRecord = { id, origin: 'existing', recordedDay: null, timeZone: null, ruleVersion: 1, seq: ++store.sequence, unread: false };
        if (this.v2 && achievementRuleVersion(id) === 2) store.legacyRecords!.push(row);
        else store.records.push(row);
      }
      await save(this.file, store, guard); this.adopted = true; return store;
    });
  }
  private async mutate<T>(generation: number, guard: WriteGuard, run: (store: AchievementRecordStore) => T): Promise<{ store: AchievementRecordStore; value: T }> {
    return this.transaction(guard, async () => {
      const loaded = await this.owned();
      const store = loaded ? await this.synchronizeLegacy(loaded,guard,false) : undefined;
      if (!store || store.generation !== generation) throw new Error('achievement-record:generation');
      const before = JSON.stringify(store);
      const pinBefore = JSON.stringify([store.pins,store.showcaseMode]);
      const value = run(store);
      if (this.v2 && pinBefore !== JSON.stringify([store.pins,store.showcaseMode])) {
        if (store.pinRevision === Number.MAX_SAFE_INTEGER) return invalid();
        store.pinRevision! += 1;
      }
      if (JSON.stringify(store) !== before) await save(this.file, store, guard);
      return { store, value };
    });
  }
  /** Merge the latest proof under the same lease, never a cached Memento object. */
  async updateAuxiliary<K extends keyof AchievementAuxiliaryProof>(generation: number, key: K,
    value: AchievementAuxiliaryProof[K], guard: WriteGuard = () => true): Promise<{
      store: AchievementRecordStore; previous: AchievementAuxiliaryProof; added: AchievementRecord[];
    }> {
    // Runtime callers/messages must not supply arbitrary keys or nested fields.
    if (!['activity', 'hours', 'calendarPeak'].includes(key)) return invalid();
    const incoming = key === 'activity' ? activity(value) : key === 'hours' ? hours(value) : calendarPeak(value);
    const result = await this.mutate(generation, guard, store => {
      const previous = auxiliary(store.auxiliary);
      if (key === 'activity') {
        const current = store.auxiliary.activity;
        const next = incoming as AchievementActivity;
        store.auxiliary.activity = mergeActivity(current, next);
      } else if (key === 'hours') {
        store.auxiliary.hours = { schemaVersion: 3,
          maxStreak: Math.max(store.auxiliary.hours.maxStreak, (incoming as HourEvidence).maxStreak) };
      } else if (incoming) {
        const next = incoming as CalendarPeakEvidence;
        store.auxiliary.calendarPeak = updateCalendarPeakEvidence(store.auxiliary.calendarPeak ?? undefined,
          next, next.peakFourWeekAverage, true) ?? null;
      }
      return previous;
    });
    return { store: result.store, previous: result.value, added: [] };
  }
  /** Successful deliberate action and newly crossed catalog targets are one transaction. */
  async recordActivity(generation: number, value: AchievementActivity,
    recording: { recordedDay: string; timeZone: string }, guard: WriteGuard = () => true): Promise<{
      store: AchievementRecordStore; previous: AchievementAuxiliaryProof; added: AchievementRecord[];
    }> {
    const incoming = activity(value);
    const stamp = object(recording, ['recordedDay', 'timeZone']);
    if (!validDay(stamp.recordedDay) || !validZone(stamp.timeZone)) return invalid();
    const result = await this.mutate(generation, guard, store => {
      const previous = auxiliary(store.auxiliary);
      store.auxiliary.activity = mergeActivity(previous.activity, incoming);
      const drafts = newlyUnlockedPluginAchievements(previous.activity, store.auxiliary.activity).map(id =>
        draft({ id, origin: 'activity', recordedDay: stamp.recordedDay, timeZone: stamp.timeZone }));
      return { previous, added: appendRecords(store, drafts) };
    });
    return { store: result.store, ...result.value };
  }
  /** An old activity migration must not recreate evidence after any clear. */
  async migrateLegacyActivity(run: () => Promise<void>): Promise<void> {
    await this.transaction(() => true, async () => {
      const store = await loadAchievementRecords(this.file);
      if (store) return;
      await run();
    });
  }
  async append(generation: number, values: readonly AchievementRecordDraft[], guard: WriteGuard = () => true): Promise<{ store: AchievementRecordStore; added: AchievementRecord[] }> {
    if (!Array.isArray(values) || values.length > ids.size) return invalid();
    const drafts = values.map(value=>draft(value));
    const result = await this.mutate(generation, guard, store => appendRecords(store, drafts));
    return { store: result.store, added: result.value };
  }
  /** The host supplies exact producer-proven crossings and the canonical sequence
   * accepted BEFORE observing that growth. Only later peer history can be repaired;
   * established history/existing/activity/usage records are never redated. */
  async recordUsage(generation: number, baselineSequence: number, values: readonly AchievementId[],
    recording: AchievementUsageRecording, guard: WriteGuard = () => true): Promise<{
      store: AchievementRecordStore; added: AchievementRecord[];
    }> {
    if (!integer(baselineSequence)) return invalid();
    const selection = recordIds(values);
    if (selection.some(id => ACHIEVEMENT_DEFINITIONS.find(row => row.id === id)?.group === 'plugin')) return invalid();
    const monetaryIds = selection.filter(isAchievementMoneyId);
    const stamp = object(recording, ['recordedDay', 'timeZone', ...(monetaryIds.length ? ['referencePricebooks'] : [])]);
    if (!validDay(stamp.recordedDay) || !validZone(stamp.timeZone)) return invalid();
    const books = monetaryIds.length ? object(stamp.referencePricebooks, monetaryIds) : undefined;
    if (books && Reflect.ownKeys(books).length !== monetaryIds.length) return invalid();
    const drafts = selection.map(id => draft({ id, origin: 'usage',
      recordedDay: stamp.recordedDay, timeZone: stamp.timeZone,
      ...(isAchievementMoneyId(id) ? { referencePricebook: books![id] } : {}) }));
    const result = await this.mutate(generation, guard, store => {
      if (baselineSequence > store.sequence) return invalid();
      // Drafts snapshot the validated books before waiting on the shared lease.
      const repair = new Map(drafts.map(row => [row.id, row]));
      store.records = store.records.filter(row => !(repair.has(row.id) &&
        row.origin === 'history' && row.seq > baselineSequence &&
        (!isAchievementMoneyId(row.id) || row.referencePricebook === repair.get(row.id)!.referencePricebook)));
      // Reissued sequence also fences ACKs issued for the preempting history.
      return appendRecords(store, drafts);
    });
    return { store: result.store, added: result.value };
  }
  async acknowledge(generation: number, sequence: number, guard: WriteGuard = () => true): Promise<AchievementRecordStore> {
    return (await this.mutate(generation, guard, store => {
      if (!integer(sequence) || sequence > store.sequence) return invalid();
      for (const record of store.records) if (record.seq <= sequence) record.unread = false;
    })).store;
  }
  /** Reserve the shared disturbance budget, not read status. No replay queue. */
  async reserveNotice(generation: number, values: readonly AchievementId[], now: number,
    guard: WriteGuard = () => true): Promise<{ store: AchievementRecordStore; records: AchievementRecord[] }> {
    const selection = new Set(notifiableAchievementIds(recordIds(values)));
    if (!integer(now) || now === 0) return invalid();
    const result = await this.mutate(generation, guard, store => {
      if (store.lastNoticeAt !== 0 && now - store.lastNoticeAt <= 300_000) return [];
      const records = store.records.filter(row => row.unread && selection.has(row.id));
      if (records.length > 0) store.lastNoticeAt = now;
      return records;
    });
    return { store: result.store, records: result.value };
  }
  /** A live notice confirms only the IDs actually represented by its batch. */
  async acknowledgeRecords(generation: number, sequence: number, values: readonly AchievementId[],
    guard: WriteGuard = () => true): Promise<AchievementRecordStore> {
    const selection = new Set(recordIds(values));
    return (await this.mutate(generation, guard, store => {
      if (!integer(sequence) || sequence > store.sequence) return invalid();
      for (const record of store.records) if (record.seq <= sequence && selection.has(record.id)) record.unread = false;
    })).store;
  }
  async pin(generation: number, values: readonly string[], guard: WriteGuard = () => true,
    expectedRevision?: number): Promise<AchievementRecordStore> {
    if (this.v2 && !integer(expectedRevision)) return invalid();
    const selection = pins(values,this.v2 ? 6 : 3,!this.v2);
    return (await this.mutate(generation, guard, store => {
      if (this.v2 && expectedRevision !== store.pinRevision) throw new Error('achievement-record:pin-stale');
      if (this.v2 && selection.some(key => !store.pins.includes(key) &&
          !store.records.some(row => row.id === key || ACHIEVEMENT_SERIES[key]?.includes(row.id)))) return invalid();
      store.pins = selection;
      if (this.v2) store.showcaseMode = 'manual';
    })).store;
  }
  /** Apply one deliberate pin intent against fresh peer state, not a stale whole list. */
  async setPinned(generation: number, key: string, selected: boolean,
    guard: WriteGuard = () => true): Promise<AchievementRecordStore> {
    if (typeof key !== 'string' || !keys.has(key) || !this.v2 && !legacyPinKey(key) || typeof selected !== 'boolean') return invalid();
    return (await this.mutate(generation, guard, store => {
      if (!selected) { store.pins = store.pins.filter(value => value !== key); return; }
      if (!store.records.some(row => row.id === key || ACHIEVEMENT_SERIES[key]?.includes(row.id))) return invalid();
      if (store.pins.includes(key)) {
        if (this.v2) store.showcaseMode = 'manual';
        return;
      }
      if (store.pins.length === (this.v2 ? 6 : 3)) throw new Error('achievement-record:pin-limit');
      store.pins.push(key);
      if (this.v2) store.showcaseMode = 'manual';
    })).store;
  }
  async reorderPinned(generation: number, values: readonly string[], revision: number,
    guard: WriteGuard = () => true): Promise<AchievementRecordStore> {
    if (!this.v2 || !integer(revision)) return invalid();
    const selection = pins(values,6);
    return (await this.mutate(generation,guard,store => {
      if (revision !== store.pinRevision) throw new Error('achievement-record:pin-stale');
      if (selection.length !== store.pins.length || selection.some(key => !store.pins.includes(key))) return invalid();
      store.pins = selection;
    })).store;
  }
  async setShowcaseMode(generation: number, mode: 'automatic' | 'manual', revision: number,
    guard: WriteGuard = () => true): Promise<AchievementRecordStore> {
    if (!this.v2 || !['automatic','manual'].includes(mode) || !integer(revision)) return invalid();
    return (await this.mutate(generation,guard,store => {
      if (revision !== store.pinRevision) throw new Error('achievement-record:pin-stale');
      store.showcaseMode = mode;
    })).store;
  }
  async clear(resetRelatedState?: () => Promise<void>): Promise<AchievementRecordStore> {
    return this.transaction(() => true, async () => {
      const current = await this.owned();
      if (current?.generation === Number.MAX_SAFE_INTEGER) return invalid();
      const legacy = this.v2 ? await this.legacy() : undefined;
      const legacyGeneration = Math.max(legacy?.generation ?? 1,current?.legacyBoundary?.generation ?? 1);
      if (this.v2 && legacyGeneration === Number.MAX_SAFE_INTEGER) return invalid();
      await resetRelatedState?.();
      const oldFence = this.v2 ? empty(legacyGeneration + 1,legacy?.sequence ?? current?.legacyBoundary?.sequence ?? 0) : undefined;
      const store = this.v2 ? v2Empty((current?.generation ?? 1) + 1,current?.sequence ?? 0,boundaryFor(oldFence!))
        : empty((current?.generation ?? 1) + 1, current?.sequence ?? 0);
      await save(this.file, store, () => true);
      if (oldFence) await save(this.legacyFile,oldFence,() => true);
      // Only this exact writer's interrupted-file names. Never follow links,
      // remove leases, quarantine unknown files or traverse source directories.
      for (const name of await readdir(path.dirname(this.file))) {
        if (!achievementRecordAuxiliaryName(name) || (!this.v2 && !name.startsWith('.achievements-v1.json.'))) continue;
        const auxiliary = path.join(path.dirname(this.file), name);
        const info = await lstat(auxiliary);
        if (info.isFile() && !info.isSymbolicLink()) await unlink(auxiliary);
      }
      return store;
    });
  }
}
