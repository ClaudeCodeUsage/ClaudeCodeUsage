import { ACHIEVEMENT_DEFINITIONS, AchievementGroup } from './achievements';
import { ACHIEVEMENT_GALLERY, achievementGalleryKey } from './achievementGallery';
import type { AchievementEvidenceState } from './achievementEvidence';
import { nextAchievementStage } from './achievementStages';
import type { AchievementId } from './achievements';
import type { AchievementRecord } from './achievementRecordStore';

export interface AchievementOverviewCandidate {
  key: string;
  group: AchievementGroup;
  earnedLevel: number;
  earned: boolean;
  next: boolean;
  progress: number;
  target: number;
  proof: AchievementEvidenceState;
  /** Explicit structural eligibility for NEXT only; absent means unknown. */
  nextEligible?: boolean;
}
export interface AchievementOverviewSelection { badges: string[]; next: string[] }
const order = ACHIEVEMENT_GALLERY.map(entry => entry.key);
const known = new Set(order);
const knownAwardIds = new Set<string>(ACHIEVEMENT_DEFINITIONS.map(rule => rule.id));

/** Current recognized family capacity, not usage proof or selected-tab preference. */
export function modelRainbowNextEligibility(
  target: number, providers: { claude?: boolean; codex?: boolean },
): boolean | undefined {
  const formal = ACHIEVEMENT_DEFINITIONS.some(rule =>
    (rule.id === 'model-rainbow' || rule.id.startsWith('model-rainbow-')) && rule.target === target);
  if (!formal || typeof providers.claude !== 'boolean' || typeof providers.codex !== 'boolean') return;
  const capacity = (providers.claude ? 4 : 0) + (providers.codex ? 3 : 0);
  return target <= capacity;
}

export interface AchievementUnreadBatch {
  total: number;
  sequence: number;
  records: AchievementRecord[];
}

/** Bounded display projection, not a read receipt. Exact levels must not collapse into series. */
export function selectUnreadAchievementBatch(
  records: readonly AchievementRecord[], visibleIds: readonly string[], previous?: AchievementUnreadBatch,
): AchievementUnreadBatch {
  const visible = new Set(visibleIds.filter(id => knownAwardIds.has(id)));
  const rows = records.filter(row => visible.has(row.id) && row.unread &&
    (row.origin === 'usage' || row.origin === 'activity')).sort((a, b) => b.seq - a.seq);
  // Never widen an issued group when a different window appends a later award.
  // A removed/read/hidden/replaced member invalidates the complete old group.
  const retained = previous && previous.records.length > 0 && previous.records.length <= 6 &&
    previous.records.every(old => rows.some(row => row.id === old.id && row.seq === old.seq));
  const selected = retained ? previous.records.map(old => rows.find(row => row.id === old.id && row.seq === old.seq)!)
    : rows.slice(0, 6);
  return { total: rows.length, sequence: retained ? previous.sequence : Math.max(0, ...selected.map(row => row.seq)),
    records: selected.map(row => ({ ...row })) };
}

/** Read-only views of validated local records; chronology is recording order, not inferred attainment time. */
export function projectAchievementRecords(records: readonly AchievementRecord[], visibleIds: readonly string[]): {
  recent: AchievementRecord[]; history: AchievementRecord[]; unreadIds: AchievementId[];
} {
  const visible = new Set(visibleIds.filter(id => knownAwardIds.has(id)));
  const rows = records.filter(row => visible.has(row.id));
  const recent: AchievementRecord[] = [], seen = new Set<string>();
  const latest = rows.slice().sort((a, b) => b.seq - a.seq);
  for (const row of latest) {
    if (row.origin !== 'usage' && row.origin !== 'activity') continue;
    const key = achievementGalleryKey(row.id)!;
    if (seen.has(key)) continue;
    seen.add(key); recent.push({ ...row });
    if (recent.length === 3) break;
  }
  return { recent, history: latest.slice(0, 30).map(row => ({ ...row })),
    unreadIds: rows.filter(row => row.unread).map(row => row.id) };
}

/** Similar counters share one showcase slot, not one award identity. */
export function achievementOverviewTopic(key: string): string {
  if (key==='cumulative-volume' || /^(claude|codex)-api-total$/.test(key)) return 'resource-volume';
  if (/^(claude|codex)-api-week$/.test(key)) return 'weeks';
  if (/^(claude|codex)-api-(session|task)$/.test(key)) return 'resource-volume';
  if (/^(astra|sol|luna|sonnet|opus|haiku|fable)-days$/.test(key)) return 'activity';
  if (/^(astra|sol|luna|sonnet|opus|haiku|fable)-(regular|main|cannon|worker|volume|sessions)$/.test(key) || key === 'fable-relay') return 'models';
  if (key.startsWith('weekly-')) return 'weeks';
  if (/^(active-|streak-machine|dual-provider-)/.test(key)) return 'activity';
  if (/^(settings-|safe-feature-|local-)/.test(key)) return 'plugin';
  if (/^(agent-|root-portfolio)/.test(key)) return 'agents';
  if (/^(same-root-|model-relay-|model-rainbow|three-family-)/.test(key)) return 'model-breadth';
  if (/^(claude-output|codex-output|codex-cache|claude-cache|cache-wizard)/.test(key)) return 'token-shape';
  return key;
}

function valid(row: AchievementOverviewCandidate): boolean {
  return known.has(row.key) && Number.isSafeInteger(row.earnedLevel) && row.earnedLevel >= 0 && row.earnedLevel <= 5 &&
    Number.isSafeInteger(row.progress) && row.progress >= 0 && Number.isSafeInteger(row.target) && row.target > 0;
}
function reachable(row: AchievementOverviewCandidate): boolean {
  return valid(row) && row.next && row.nextEligible !== false && row.proof === 'ready' && row.progress > 0 && row.progress < row.target &&
    row.key !== 'output-hours' && row.key !== 'night-output-peak';
}
function diversify(rows: AchievementOverviewCandidate[], pinned: string[] = []): string[] {
  const topics = new Set(pinned.map(achievementOverviewTopic));
  const selected: string[] = pinned.slice();
  for (const row of rows) {
    if (selected.length === 3) break;
    const topic = achievementOverviewTopic(row.key);
    if (topics.has(topic)) continue;
    topics.add(topic); selected.push(row.key);
    if (selected.length === 3) break;
  }
  return selected;
}

/** Only already-collapsed, enabled-provider rows enter this display-only selector. */
export function selectAchievementOverview(
  rows: readonly AchievementOverviewCandidate[], preferred: 'claude' | 'codex' | 'compare',
  pins: readonly string[] = [], mode?: 'automatic' | 'manual',
): AchievementOverviewSelection {
  const earned = new Set(rows.filter(row => valid(row) && row.earned).map(row => row.key));
  const pinned = [...new Set(pins.map(achievementGalleryKey)
    .filter((key): key is string => key !== undefined && earned.has(key)))].slice(0, mode === 'manual' ? 6 : 3);
  const tie = (a: AchievementOverviewCandidate, b: AchievementOverviewCandidate): number =>
    Number(b.group === preferred) - Number(a.group === preferred) || order.indexOf(a.key) - order.indexOf(b.key);
  const fraction = (row: AchievementOverviewCandidate): number => row.progress /
    (nextAchievementStage(row.key, row.progress, row.target, true) ?? row.target);
  return {
    badges: mode === 'manual' ? pinned : diversify(rows.filter(row => valid(row) && row.earned)
      .sort((a, b) => b.earnedLevel - a.earnedLevel || tie(a, b)), mode === 'automatic' ? [] : pinned),
    next: diversify(rows.filter(reachable).sort((a, b) => fraction(b) - fraction(a) || tie(a, b))),
  };
}

/** During a visit, invalid goals disappear but never invite a reshuffle. */
export function retainAchievementOverview(
  selection: AchievementOverviewSelection, rows: readonly AchievementOverviewCandidate[],
): AchievementOverviewSelection {
  const byKey = new Map(rows.filter(valid).map(row => [row.key, row]));
  return {
    badges: selection.badges.filter(key => byKey.get(key)?.earned).slice(0, 6),
    next: selection.next.filter(key => { const row = byKey.get(key); return !!row && reachable(row); }).slice(0, 3),
  };
}
