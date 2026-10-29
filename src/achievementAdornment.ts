/** Shared, bounded SVG geometry only. No award evaluation, resources or I/O. */
export type AchievementRank = 'bronze' | 'silver' | 'gold' | 'platinum' | 'legendary' | 'milestone';
export type AchievementEmblemState = 'earned' | 'target' | 'locked';

export const ACHIEVEMENT_EXPORT_RANK_COLORS: Readonly<Record<AchievementRank | 'locked', string>> = {
  bronze: '#e7b899', silver: '#e1e7ef', gold: '#efce76', platinum: '#8dcaf0',
  legendary: '#cfadff', milestone: '#d6dce5', locked: '#929ba8',
};

/** `artSize` is the actual PNG size, never the enclosing decorated square. */
export function achievementIconLayout(artSize: number): { artSize: number; edge: number; totalSize: number } {
  if (!Number.isFinite(artSize) || artSize <= 0) throw new RangeError('Invalid achievement artwork size');
  const edge = artSize > 56 ? 8 : 0;
  return { artSize, edge, totalSize: artSize + edge * 2 };
}

/** Marks use CSS/SVG pixel coordinates, with a separate eight-pixel ornament
 * margin on full-size artwork. Compact thumbnails keep only identifying marks.
 * The same fragment is used over resource PNGs and inside standalone exports. */
export function renderAchievementAdornment(rank: AchievementRank, state: AchievementEmblemState = 'earned', artSize = 80): string {
  const { edge, totalSize: total } = achievementIconLayout(artSize);
  const frame = state === 'locked' ? 'locked' : rank;
  const full = edge > 0;
  const low = full ? edge - .8 : 1.5;
  const span = full ? artSize + 1.6 : artSize - 3;
  let marks = '<rect data-frame-part="square" x="' + low + '" y="' + low + '" width="' + span +
    '" height="' + span + '" rx="4" fill="none" stroke="currentColor" stroke-width="' +
    (frame === 'bronze' || frame === 'locked' ? '1.5' : '2') + '"' + (state === 'target' ? ' stroke-dasharray="4 3"' : '') + '/>';
  if (frame === 'silver') marks += '<rect data-frame-part="inner-square" x="' + (low + 2.5) +
    '" y="' + (low + 2.5) + '" width="' + (span - 5) + '" height="' + (span - 5) +
    '" rx="3" fill="none" stroke="currentColor" stroke-width=".7"/>';
  if (full && ['gold', 'platinum', 'legendary'].includes(frame)) {
    // Leaves sit in the added edge allowance, preserving the complete PNG.
    const count = frame === 'gold' ? 3 : frame === 'platinum' ? 4 : 5;
    for (const side of [-1, 1]) for (let i = 0; i < count; i++) {
      const x = side < 0 ? edge - 2 : total - edge + 2;
      const y = total - edge - 4 - i * 8;
      marks += '<path data-frame-part="laurel" d="M' + x + ' ' + y + 'q' + side * 7 + ' -3 ' +
        side * 3 + ' -10q' + -side * 5 + ' 3 ' + -side * 3 + ' 10Z" fill="currentColor"/>';
    }
    marks += '<path data-frame-part="stem" d="M' + (edge - 2) + ' ' + (total - edge - 5) + 'Q' +
      total / 2 + ' ' + (total + 3) + ' ' + (total - edge + 2) + ' ' + (total - edge - 5) +
      '" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  }
  if (full && (frame === 'platinum' || frame === 'legendary')) marks += '<path data-frame-part="corners" d="M' +
    low + ' ' + (low + 10) + 'l10-10M' + (total - low - 10) + ' ' + low +
    'l10 10" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  if (frame === 'legendary') marks += '<path data-frame-part="apex" d="m' + total / 2 + ' ' +
    (full ? 1 : 0) + ' 5 5-5 5-5-5Z" fill="currentColor"/>';
  if (frame === 'milestone' && state === 'earned') marks += '<path data-frame-part="complete" d="m' +
    (total - 17) + ' ' + (total - 7) + ' 4 4 10-12" fill="none" stroke="currentColor" stroke-width="2.5"/>';
  if (frame === 'locked') marks += '<path data-frame-part="lock" d="M' + (total - 11) + ' ' +
    (total - 10) + 'v-3a3 3 0 0 1 6 0v3m-7 0h8v8h-8Z" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  return marks;
}
