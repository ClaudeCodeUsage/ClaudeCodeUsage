import {achievementRollingCopyFor} from './achievementRollingCopy';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, AchievementId, AchievementResult } from './achievements';
import { renderAchievementIcon } from './achievementIcons';
import { achievementIconLayout, ACHIEVEMENT_EXPORT_RANK_COLORS } from './achievementAdornment';
import {achievementCopyFor, type AchievementCopy} from './i18n';
import { randomUUID } from 'node:crypto';
import {isAchievementMoneyId} from './achievementMoneyCatalog';
import {achievementConditionFor} from './achievementConditions';
import { achievementTitleWithoutRank } from './achievementTitles';
import {achievementUnitFor} from './achievementUnit';
import {formatAchievementInteger} from './achievementFormat';
import {achievementMoneyCopyFor} from './achievementMoneyCopy';

/** One accepted local artifact, not an export history. Capture before any save dialog. */
export class AchievementSharePreview {
  private current?: { previewId: string; ids: string; svg: string; locale: string };

  accept(ids: readonly AchievementId[], svg: string, locale = ''): { previewId?: string; svg: string } {
    this.clear();
    if (!ids.length || !svg) return { svg: '' };
    this.current = { previewId: randomUUID(), ids: JSON.stringify(ids), svg, locale };
    return { previewId: this.current.previewId, svg };
  }

  capture(previewId: unknown, ids: readonly string[], locale = ''): string | undefined {
    return typeof previewId === 'string' && this.current?.previewId === previewId &&
      this.current.ids === JSON.stringify(ids) && this.current.locale === locale ? this.current.svg : undefined;
  }

  read(ids: readonly string[], locale = ''): { previewId: string; svg: string } | undefined {
    return this.current?.ids === JSON.stringify(ids) && this.current.locale === locale
      ? { previewId: this.current.previewId, svg: this.current.svg } : undefined;
  }

  clear(): void { this.current = undefined; }
}

/** One earned representative per series, in canonical rule order. */
export function highestEarnedAchievements(results: readonly AchievementResult[]): AchievementResult[] {
  const earned = new Set(results.filter((result) => result.unlocked).map((result) => result.id));
  for (const ids of Object.values(ACHIEVEMENT_SERIES)) {
    const highest = [...ids].reverse().find((id) => earned.has(id));
    for (const id of ids) if (id !== highest) earned.delete(id);
  }
  return results.filter((result) => earned.has(result.id));
}

/** Export is an explicit subset of earned badges; client-provided IDs are never trusted. */
export function selectShareAchievements(
  results: readonly AchievementResult[],
  requested: readonly string[] | undefined,
): AchievementId[] {
  // Privacy by default: entering the studio never preselects personal patterns.
  const chosen = new Set(requested ?? []);
  const unlocked = new Set(highestEarnedAchievements(results.filter((result) => chosen.has(result.id)))
    .map((result) => result.id));
  return ACHIEVEMENT_DEFINITIONS.map((entry) => entry.id)
    .filter((id) => unlocked.has(id) && chosen.has(id))
    .slice(0, 9);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]!);
}

/** Conservative em widths keep export deterministic without browser/font I/O. */
function wrapLabel(value: string, maxEm: number, maxLines = Infinity): string[] {
  const width = (text: string): number => Array.from(text).reduce((sum, char) => sum +
    (/\s/.test(char) ? 0.35 : /[ilI1.,:;!'|]/.test(char) ? 0.35 :
      /[MWmw@%]/.test(char) ? 1 : /[\u2e80-\uffef]/.test(char) ? 1.1 : 0.7), 0);
  const lines: string[] = [];
  let current = '';
  for (const char of Array.from(value)) {
    if (current && width(current + char) > maxEm) {
      const space = current.lastIndexOf(' ');
      lines.push(space > 0 ? current.slice(0, space) : current);
      current = space > 0 ? current.slice(space + 1) : '';
    }
    current += char;
  }
  if (current) lines.push(current.trim());
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && width(last + '…') > maxEm) last = Array.from(last).slice(0, -1).join('');
    lines[maxLines - 1] = last.trimEnd() + '…';
  }
  return lines;
}

function textLines(lines: readonly string[], x: number, spacing: number): string {
  return lines.map((line, index) =>
    `<tspan x="${x}" dy="${index === 0 ? 0 : spacing}">${escapeXml(line)}</tspan>`).join('');
}

// Navigation only: never used as an image/resource URL or derived from input.
const REPOSITORY_URL = 'https://github.com/ClaudeCodeUsage/ClaudeCodeUsage';

/** Deterministic SVG of public rule thresholds; never raw usage or identities. */
export function renderAchievementShareSvg(input: {
  selected: readonly AchievementId[];
  /** Existing calendar-week receipts stay shareable without claiming rolling proof. */
  retainedCalendarIds?:readonly AchievementId[];
  titles: Partial<Record<AchievementId, string>>;
  heading: string;
  subtitle: string;
  groups: AchievementCopy['groups'];
  levels: AchievementCopy['levels'];
  milestone: string;
  footer: string;
  locale?: string;
}): string {
  const rows = input.selected.slice(0, 9);
  const locale=input.locale ?? 'en',units=achievementCopyFor(locale).units;
  const artSize = rows.length === 1 ? 112 : rows.length <= 3 ? 96 : 80;
  const iconSize = achievementIconLayout(artSize).totalSize;
  const cellWidth = 280, cellGap = 24;
  const headingLines = wrapLabel(input.heading, 28);
  const subtitleLines = wrapLabel(input.subtitle, 56, 2);
  const subtitleY = 66 + Math.max(0, headingLines.length - 1) * 38 + 35;
  const gridY = subtitleY + Math.max(0, subtitleLines.length - 1) * 19 + 35;
  const badges = rows.map((id) => {
    const series = Object.values(ACHIEVEMENT_SERIES).find((ids) => ids.includes(id));
    const level = series?.indexOf(id);
    const title = achievementTitleWithoutRank(input.titles[id] || id,
      level === undefined ? undefined : input.levels[level]);
    const titleLines = wrapLabel(title, 14);
    const group = ACHIEVEMENT_DEFINITIONS.find((entry) => entry.id === id)?.group ?? 'combined';
    const accent: Parameters<typeof renderAchievementIcon>[1] =
      group === 'claude' ? '#db8b5b' : group === 'codex' ? '#82a9ed' : '#ad99e2';
    const color = level === undefined ? ACHIEVEMENT_EXPORT_RANK_COLORS.milestone :
      ['#e7b899', '#d6dce5', '#efce76', '#8dcaf0', '#cfadff'][level];
    const levelLabel = level === undefined ? input.milestone : input.levels[level];
    const target=ACHIEVEMENT_DEFINITIONS.find(row=>row.id===id)!.target;
    const threshold=isAchievementMoneyId(id) ? '≥$'+new Intl.NumberFormat(input.locale ?? 'en').format(target/1_000_000)+' USD' : '';
    const targetLabel=isAchievementMoneyId(id) ? '' : '≥'+formatAchievementInteger(target,locale)+' '+achievementUnitFor(id,units,'USD');
    const thresholdLines=targetLabel ? wrapLabel(targetLabel,20) : [];
    const retained=input.retainedCalendarIds?.includes(id)===true;
    const condition=retained?achievementRollingCopyFor(input.locale??'en').legacy:achievementConditionFor(input.locale ?? 'en',id);
    const publicTitle=[title,levelLabel,threshold||targetLabel,condition].filter(Boolean).join(' · ');
    const groupLines = wrapLabel(input.groups[group], 20);
    const rankLines = wrapLabel(levelLabel + (threshold ? ' · ' + threshold : '')+
      (retained?' · '+achievementRollingCopyFor(input.locale??'en').legacyShort:''), 20);
    return { id, titleLines, groupLines, rankLines, thresholdLines, publicTitle, accent, color };
  });
  // Keep typography aligned across the complete artifact. Actual localized
  // names and rank/threshold labels grow the card instead of eliding evidence.
  const titleY = 24 + iconSize + 24;
  const rankY = titleY + Math.max(0, ...badges.map(badge => badge.titleLines.length - 1)) * 19 + 24;
  const thresholdY = rankY + Math.max(0, ...badges.map(badge => badge.rankLines.length - 1)) * 16 + 24;
  const thresholdLineCount=Math.max(0,...badges.map(badge=>badge.thresholdLines.length));
  const groupY = thresholdY + (thresholdLineCount ? (thresholdLineCount-1)*16+24 : 0);
  const cellHeight = groupY + Math.max(0, ...badges.map(badge => badge.groupLines.length - 1)) * 16 + 24;
  const cells = badges.map((badge, index) => {
    const { id, titleLines, groupLines, rankLines, thresholdLines, publicTitle, accent, color } = badge;
    const rowStart = Math.floor(index / 3) * 3;
    const inRow = Math.min(3, badges.length - rowStart);
    const rowWidth = inRow * cellWidth + (inRow - 1) * cellGap;
    const x = (1000 - rowWidth) / 2 + (index % 3) * (cellWidth + cellGap);
    const y = gridY + Math.floor(index / 3) * (cellHeight + 20);
    const center = x + cellWidth / 2;
    return `<g data-achievement-share-badge="${id}"><title>${escapeXml(publicTitle)}</title>` +
      `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" rx="6" fill="#202430" stroke="#48505f" stroke-width="1" data-share-card-frame="neutral"/>` +
      renderAchievementIcon(id, accent, { x: center - iconSize / 2, y: y + 24, size: artSize }) +
      `<text data-share-field="name" x="${center}" y="${y + titleY}" text-anchor="middle" font-size="16" font-weight="600" fill="#f3f4f8">${textLines(titleLines, center, 19)}</text>` +
      `<text data-share-field="rank" x="${center}" y="${y + rankY}" text-anchor="middle" font-size="13" font-weight="600" fill="${color}">${textLines(rankLines, center, 16)}</text>` +
      (thresholdLines.length ? `<text data-share-field="threshold" x="${center}" y="${y + thresholdY}" text-anchor="middle" font-size="12" fill="#b9bfcc">${textLines(thresholdLines, center, 16)}</text>` : '') +
      `<text data-share-field="group" x="${center}" y="${y + groupY}" text-anchor="middle" font-size="12" fill="#b9bfcc">${textLines(groupLines, center, 16)}</text></g>`;
  }).join('');
  const rowCount = Math.ceil(badges.length / 3);
  const gridBottom = gridY + rowCount * (cellHeight + 20) - (rowCount ? 20 : 0);
  const footerLines = wrapLabel(`Claude Code Usage · ${input.footer}`, 74);
  const footerY = gridBottom + 44;
  const moneyNoteLines=rows.some(isAchievementMoneyId) ? wrapLabel(achievementMoneyCopyFor(locale).note,74) : [];
  const moneyNoteY=footerY + Math.max(0,footerLines.length-1)*16+24;
  const linkY = moneyNoteLines.length ? moneyNoteY+(moneyNoteLines.length-1)*16+40 : footerY + Math.max(0, footerLines.length - 1) * 16 + 40;
  const height = Math.max(330, linkY + 32);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" role="img" aria-label="${escapeXml(input.heading)}">` +
    `<rect width="1000" height="${height}" rx="24" fill="#151923"/>` +
    `<path d="M0 8h1000" stroke="#ad99e2" stroke-width="8"/>` +
    `<text x="48" y="66" font-family="system-ui,sans-serif" font-size="31" font-weight="700" fill="#f3f4f8">${textLines(headingLines, 48, 38)}</text>` +
    `<text x="48" y="${subtitleY}" font-family="system-ui,sans-serif" font-size="16" fill="#b9bfcc">${textLines(subtitleLines, 48, 19)}</text>` +
    `<g font-family="system-ui,sans-serif">${cells}</g>` +
    `<text data-share-field="footer" x="48" y="${footerY}" font-family="system-ui,sans-serif" font-size="12" fill="#848c9d">${textLines(footerLines, 48, 16)}</text>` +
    (moneyNoteLines.length ? `<text data-share-field="money-note" x="48" y="${moneyNoteY}" font-family="system-ui,sans-serif" font-size="12" fill="#b9bfcc">${textLines(moneyNoteLines,48,16)}</text>` : '') +
    `<a href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">` +
      `<text x="48" y="${linkY}" font-family="system-ui,sans-serif" font-size="14" fill="#8dcaf0" text-decoration="underline">${REPOSITORY_URL}</text></a></svg>`;
}
