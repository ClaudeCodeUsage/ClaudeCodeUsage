import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, AchievementId, AchievementResult } from './achievements';
import { renderAchievementIcon } from './achievementIcons';
import type { AchievementCopy } from './i18n';
import { randomUUID } from 'node:crypto';
import {isAchievementMoneyId} from './achievementMoneyCatalog';
import {achievementConditionFor} from './achievementConditions';
import { achievementTitleWithoutRank } from './achievementTitles';

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
function wrapLabel(value: string, maxEm: number, maxLines: number): string[] {
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

/** Deterministic, self-contained SVG; carries titles only, never raw usage or identities. */
export function renderAchievementShareSvg(input: {
  selected: readonly AchievementId[];
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
  const height = Math.max(330, 190 + Math.ceil(rows.length / 3) * 140);
  const cells = rows.map((id, index) => {
    const x = 48 + (index % 3) * 304;
    const y = 155 + Math.floor(index / 3) * 140;
    const series = Object.values(ACHIEVEMENT_SERIES).find((ids) => ids.includes(id));
    const level = series?.indexOf(id);
    const title = achievementTitleWithoutRank(input.titles[id] || id,
      level === undefined ? undefined : input.levels[level]);
    const titleLines = wrapLabel(title, 11, 3).map((line, lineIndex) =>
      `<tspan x="${x + 86}" dy="${lineIndex === 0 ? 0 : 19}">${escapeXml(line)}</tspan>`).join('');
    const group = ACHIEVEMENT_DEFINITIONS.find((entry) => entry.id === id)?.group ?? 'combined';
    const accent = group === 'claude' ? '#db8b5b' : group === 'codex' ? '#82a9ed' : '#ad99e2';
    const color = level === undefined ? accent :
      ['#e7b899', '#d6dce5', '#efce76', '#8dcaf0', '#cfadff'][level];
    const levelLabel = level === undefined ? input.milestone : input.levels[level];
    const target=ACHIEVEMENT_DEFINITIONS.find(row=>row.id===id)!.target;
    const threshold=isAchievementMoneyId(id) ? '≥$'+new Intl.NumberFormat(input.locale ?? 'en').format(target/1_000_000)+' USD' : '';
    const condition=achievementConditionFor(input.locale ?? 'en',id);
    const publicTitle=[title,levelLabel,threshold,condition].filter(Boolean).join(' · ');
    return `<g data-achievement-share-badge="${id}"><title>${escapeXml(publicTitle)}</title>` +
      `<rect x="${x}" y="${y}" width="280" height="120" rx="14" fill="#202430" stroke="${color}" stroke-width="2"/>` +
      renderAchievementIcon(id, accent, { x: x + 11, y: y + 24, size: 64 }) +
      `<text x="${x + 86}" y="${y + 26}" font-size="16" font-weight="600" fill="${color}">${titleLines}</text>` +
      `<text x="${x + 86}" y="${y + 86}" font-size="12" fill="#b9bfcc">${escapeXml(input.groups[group])}</text>` +
      `<text x="${x + 86}" y="${y + 105}" font-size="12" fill="${color}">${escapeXml(levelLabel+(threshold ? ' · '+threshold : ''))}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" role="img" aria-label="${escapeXml(input.heading)}">` +
    `<rect width="1000" height="${height}" rx="24" fill="#151923"/>` +
    `<path d="M0 8h1000" stroke="#ad99e2" stroke-width="8"/>` +
    `<text x="48" y="66" font-family="system-ui,sans-serif" font-size="31" font-weight="700" fill="#f3f4f8">${escapeXml(input.heading)}</text>` +
    `<text x="48" y="101" font-family="system-ui,sans-serif" font-size="16" fill="#b9bfcc">` +
      wrapLabel(input.subtitle, 56, 2).map((line, index) =>
        `<tspan x="48" dy="${index === 0 ? 0 : 19}">${escapeXml(line)}</tspan>`).join('') + '</text>' +
    `<g font-family="system-ui,sans-serif">${cells}</g>` +
    `<text x="48" y="${height - 31}" font-family="system-ui,sans-serif" font-size="12" fill="#848c9d">Claude Code Usage · ${escapeXml(input.footer)}</text></svg>`;
}
