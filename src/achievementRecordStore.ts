import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, AchievementId, newlyUnlockedPluginAchievements, notifiableAchievementIds } from './achievements';
import { AchievementActivity, emptyAchievementActivity, parseAchievementActivity } from './achievementActivity';
import { CalendarPeakEvidence, parseCalendarPeakEvidence, updateCalendarPeakEvidence } from './achievementCalendar';
import { HourEvidence, parseHourEvidence } from './achievementHours';
import { acquireCodexIndexLease } from './providers/codex/codexIndexLease';

export const ACHIEVEMENT_RECORD_FILE = 'achievements-v1.json';
export const ACHIEVEMENT_RECORD_BYTE_LIMIT = 65_536;
export function achievementRecordAuxiliaryName(name: string): boolean {
  return /^\.achievements-v1\.json\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/.test(name);
}
export type AchievementRecordOrigin = 'existing' | 'history' | 'usage' | 'activity';
export interface AchievementRecordDraft {
  id: AchievementId;
  origin: AchievementRecordOrigin;
  /** First recording day, never inferred as the original achievement date. */
  recordedDay: string | null;
  timeZone: string | null;
}
export interface AchievementRecord extends AchievementRecordDraft {
  ruleVersion: 1;
  seq: number;
  unread: boolean;
}
export interface AchievementRecordStore {
  schemaVersion: 1;
  generation: number;
  sequence: number;
  lastNoticeAt: number;
  pins: string[];
  records: AchievementRecord[];
  auxiliary: AchievementAuxiliaryProof;
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
function draft(value: unknown): AchievementRecordDraft {
  const row = object(value, ['id', 'origin', 'recordedDay', 'timeZone']);
  if (typeof row.id !== 'string' || !ids.has(row.id) || typeof row.origin !== 'string' || !origins.has(row.origin)) return invalid();
  const historical = row.origin === 'history' || row.origin === 'existing';
  if (historical ? row.recordedDay !== null || row.timeZone !== null
    : !validDay(row.recordedDay) || !validZone(row.timeZone)) return invalid();
  return row as unknown as AchievementRecordDraft;
}
function pins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 3 || new Set(value).size !== value.length || value.some(key => !keys.has(key))) return invalid();
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
    if (existing.has(row.id)) continue;
    if (store.sequence === Number.MAX_SAFE_INTEGER) return invalid();
    const record: AchievementRecord = { ...row, ruleVersion: 1, seq: ++store.sequence,
      unread: row.origin === 'usage' || row.origin === 'activity' };
    existing.add(row.id); store.records.push(record); added.push(record);
  }
  return added;
}
export function parseAchievementRecordStore(value: unknown): AchievementRecordStore {
  const store = object(value, ['schemaVersion', 'generation', 'sequence', 'lastNoticeAt', 'pins', 'records', 'auxiliary']);
  if (store.schemaVersion !== 1 || !integer(store.generation) || store.generation < 1 ||
      !integer(store.sequence) || !integer(store.lastNoticeAt) || !Array.isArray(store.records) || store.records.length > ids.size) return invalid();
  const seen = new Set<string>();
  let previous = 0;
  const records = store.records.map(value => {
    const row = object(value, ['id', 'origin', 'recordedDay', 'timeZone', 'ruleVersion', 'seq', 'unread']);
    const base = draft({ id: row.id, origin: row.origin, recordedDay: row.recordedDay, timeZone: row.timeZone });
    if (row.ruleVersion !== 1 || !integer(row.seq) || row.seq <= previous || row.seq > (store.sequence as number) ||
        seen.has(base.id) || typeof row.unread !== 'boolean' ||
        ((base.origin === 'history' || base.origin === 'existing') && row.unread)) return invalid();
    seen.add(base.id); previous = row.seq;
    return { ...base, ruleVersion: 1 as const, seq: row.seq, unread: row.unread };
  });
  const result: AchievementRecordStore = { schemaVersion: 1, generation: store.generation, sequence: store.sequence,
    lastNoticeAt: store.lastNoticeAt, pins: pins(store.pins), records, auxiliary: auxiliary(store.auxiliary) };
  if (Buffer.byteLength(JSON.stringify(result)) > ACHIEVEMENT_RECORD_BYTE_LIMIT) return invalid();
  return result;
}
export function recentAchievementRecords(store: AchievementRecordStore): AchievementRecord[] {
  return store.records.slice(-30).reverse();
}
function empty(generation = 1, sequence = 0): AchievementRecordStore {
  return { schemaVersion: 1, generation, sequence, lastNoticeAt: 0, pins: [], records: [], auxiliary: emptyAuxiliary() };
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
  constructor(readonly file: string) {}
  private async transaction<T>(guard: WriteGuard, run: () => Promise<T>): Promise<T> {
    check(guard);
    const lease = await acquireCodexIndexLease(this.file, { timeoutMs: 5_000, shouldCancel: () => !guard() });
    try { check(guard); return await run(); } finally { await lease.release(); }
  }
  async initialize(legacy: readonly AchievementId[], guard: WriteGuard = () => true,
    legacyAuxiliary: AchievementAuxiliaryProof = emptyAuxiliary()): Promise<AchievementRecordStore> {
    return this.transaction(guard, async () => {
      const saved = await loadAchievementRecords(this.file);
      if (saved) return saved;
      const store = empty();
      store.auxiliary = auxiliary(legacyAuxiliary);
      for (const id of [...new Set(legacy)].sort()) {
        if (!ids.has(id)) return invalid();
        store.records.push({ id, origin: 'existing', recordedDay: null, timeZone: null, ruleVersion: 1, seq: ++store.sequence, unread: false });
      }
      await save(this.file, store, guard); return store;
    });
  }
  private async mutate<T>(generation: number, guard: WriteGuard, run: (store: AchievementRecordStore) => T): Promise<{ store: AchievementRecordStore; value: T }> {
    return this.transaction(guard, async () => {
      const store = await loadAchievementRecords(this.file);
      if (!store || store.generation !== generation) throw new Error('achievement-record:generation');
      const before = JSON.stringify(store);
      const value = run(store);
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
    const drafts = values.map(draft);
    const result = await this.mutate(generation, guard, store => appendRecords(store, drafts));
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
  async pin(generation: number, values: readonly string[], guard: WriteGuard = () => true): Promise<AchievementRecordStore> {
    const selection = pins(values);
    return (await this.mutate(generation, guard, store => { store.pins = selection; })).store;
  }
  /** Apply one deliberate pin intent against fresh peer state, not a stale whole list. */
  async setPinned(generation: number, key: string, selected: boolean,
    guard: WriteGuard = () => true): Promise<AchievementRecordStore> {
    if (typeof key !== 'string' || !keys.has(key) || typeof selected !== 'boolean') return invalid();
    return (await this.mutate(generation, guard, store => {
      if (!selected) { store.pins = store.pins.filter(value => value !== key); return; }
      if (!store.records.some(row => row.id === key || ACHIEVEMENT_SERIES[key]?.includes(row.id))) return invalid();
      if (store.pins.includes(key)) return;
      if (store.pins.length === 3) throw new Error('achievement-record:pin-limit');
      store.pins.push(key);
    })).store;
  }
  async clear(resetRelatedState?: () => Promise<void>): Promise<AchievementRecordStore> {
    return this.transaction(() => true, async () => {
      const current = await loadAchievementRecords(this.file);
      if (current?.generation === Number.MAX_SAFE_INTEGER) return invalid();
      await resetRelatedState?.();
      const store = empty((current?.generation ?? 1) + 1, current?.sequence ?? 0);
      await save(this.file, store, () => true);
      // Only this exact writer's interrupted-file names. Never follow links,
      // remove leases, quarantine unknown files or traverse source directories.
      for (const name of await readdir(path.dirname(this.file))) {
        if (!achievementRecordAuxiliaryName(name)) continue;
        const auxiliary = path.join(path.dirname(this.file), name);
        const info = await lstat(auxiliary);
        if (info.isFile() && !info.isSymbolicLink()) await unlink(auxiliary);
      }
      return store;
    });
  }
}
