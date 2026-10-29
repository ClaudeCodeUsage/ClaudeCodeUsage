import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ACHIEVEMENT_SERIES, type AchievementId } from './achievements';
import { ACHIEVEMENT_EXPORT_RANK_COLORS, achievementIconLayout, renderAchievementAdornment, type AchievementEmblemState, type AchievementRank } from './achievementAdornment';
import { API_ACHIEVEMENT_DEFINITIONS, type AchievementMoneyId } from './achievementMoneyCatalog';
import { LONG_TERM_ACHIEVEMENT_DEFINITIONS, type LongTermAchievementId } from './achievementLongTerm';
const apiImageFiles = Object.fromEntries(API_ACHIEVEMENT_DEFINITIONS.map(row=>
  [row.id,row.id.replace(/-(bronze|silver|gold|platinum|legendary)$/,'-v242-v2.png')])) as Record<AchievementMoneyId,string>;

/** Only bundled artwork can appear in the gallery or exported SVG. */
const BASE_ACHIEVEMENT_IMAGE_FILES: Record<Exclude<AchievementId,LongTermAchievementId>, string> = {
  ...apiImageFiles,
  'codex-output-bronze': 'codex-output-v242.png',
  'codex-output-silver': 'codex-output-v242.png',
  'codex-output-gold': 'codex-output-v242.png',
  'codex-cache-read-bronze': 'codex-cache-read-v242.png',
  'codex-cache-read-silver': 'codex-cache-read-v242.png',
  'codex-cache-read-gold': 'codex-cache-read-v242.png',
  'astra-days-bronze': 'astra-days-v242.png',
  'astra-days-silver': 'astra-days-v242.png',
  'astra-days-gold': 'astra-days-v242.png',
  'sol-days-bronze': 'sol-days-v242.png',
  'sol-days-silver': 'sol-days-v242.png',
  'sol-days-gold': 'sol-days-v242.png',
  'luna-days-bronze': 'luna-days-v242.png',
  'luna-days-silver': 'luna-days-v242.png',
  'luna-days-gold': 'luna-days-v242.png',
  'sonnet-days-bronze': 'sonnet-days-v242.png',
  'sonnet-days-silver': 'sonnet-days-v242.png',
  'sonnet-days-gold': 'sonnet-days-v242.png',
  'opus-days-bronze': 'opus-days-v242.png',
  'opus-days-silver': 'opus-days-v242.png',
  'opus-days-gold': 'opus-days-v242.png',
  'haiku-days-bronze': 'haiku-days-v242.png',
  'haiku-days-silver': 'haiku-days-v242.png',
  'haiku-days-gold': 'haiku-days-v242.png',
  'dual-provider-days-bronze': 'dual-provider-days-v242.png',
  'dual-provider-days-silver': 'dual-provider-days-v242.png',
  'dual-provider-days-gold': 'dual-provider-days-v242.png',
  'active-weeks-bronze': 'active-weeks-v242.png',
  'active-weeks-silver': 'active-weeks-v242.png',
  'active-weeks-gold': 'active-weeks-v242.png',
  'weekly-average-bronze': 'weekly-average-v242.png',
  'weekly-average-silver': 'weekly-average-v242.png',
  'weekly-average-gold': 'weekly-average-v242.png',
  'three-family-day': 'three-family-day-v242.png',
  'dual-provider-day': 'dual-provider-day-v242.png',
  'sonnet-main': 'claude-sonnet-main.png',
  'sonnet-main-silver': 'claude-sonnet-main.png',
  'sonnet-main-gold': 'claude-sonnet-main.png',
  'opus-cannon': 'claude-opus-cannon.png',
  'opus-cannon-silver': 'claude-opus-cannon.png',
  'opus-cannon-gold': 'claude-opus-cannon.png',
  'haiku-worker': 'claude-haiku-worker.png',
  'haiku-worker-silver': 'claude-haiku-worker.png',
  'haiku-worker-gold': 'claude-haiku-worker.png',
  'cache-wizard': 'claude-cache-wizard.png',
  'cache-wizard-silver': 'claude-cache-wizard.png',
  'cache-wizard-gold': 'claude-cache-wizard.png',
  'claude-output-bronze': 'claude-context-marathon.png',
  'claude-output-silver': 'claude-context-marathon.png',
  'claude-output-gold': 'claude-context-marathon.png',
  'claude-output-sessions-bronze': 'claude-output-sessions-v242.png',
  'claude-output-sessions-silver': 'claude-output-sessions-v242.png',
  'claude-output-sessions-gold': 'claude-output-sessions-v242.png',
  'claude-cache-creation-bronze': 'claude-cache-creation-v242.png',
  'claude-cache-creation-silver': 'claude-cache-creation-v242.png',
  'claude-cache-creation-gold': 'claude-cache-creation-v242.png',
  'fable-volume-bronze': 'claude-fable-day-pass.png',
  'fable-volume-silver': 'claude-fable-day-pass.png',
  'fable-volume-gold': 'claude-fable-day-pass.png',
  'fable-days-bronze': 'fable-days-v242.png',
  'fable-days-silver': 'fable-days-v242.png',
  'fable-days-gold': 'fable-days-v242.png',
  'fable-relay': 'fable-relay-v242.png',
  'fable-sessions-bronze': 'fable-sessions-v242.png',
  'fable-sessions-silver': 'fable-sessions-v242.png',
  'fable-sessions-gold': 'fable-sessions-v242.png',
  'weekly-volume-bronze': 'weekly-volume-v242.png',
  'weekly-volume-silver': 'weekly-volume-v242.png',
  'weekly-volume-gold': 'weekly-volume-v242.png',
  'output-hours-bronze': 'output-hours-v242.png',
  'output-hours-silver': 'output-hours-v242.png',
  'output-hours-gold': 'output-hours-v242.png',
  'night-output-peak': 'combined-three-am-partner.png',
  'settings-explorer-bronze': 'combined-settings-tourist.png',
  'settings-explorer-silver': 'combined-settings-tourist.png',
  'settings-explorer-gold': 'combined-settings-tourist.png',
  'safe-feature-explorer': 'safe-feature-journey-v242.png',
  'local-share-export': 'combined-share-it.png',
  'local-advice-feedback': 'local-advice-feedback-v242.png',
  'astra-regular': 'codex-astra-regular.png',
  'astra-regular-silver': 'codex-astra-regular.png',
  'astra-regular-gold': 'codex-astra-regular.png',
  'sol-regular': 'codex-sol-regular.png',
  'sol-regular-silver': 'codex-sol-regular.png',
  'sol-regular-gold': 'codex-sol-regular.png',
  'luna-regular': 'codex-luna-regular.png',
  'luna-regular-silver': 'codex-luna-regular.png',
  'luna-regular-gold': 'codex-luna-regular.png',
  'agent-standup': 'codex-agent-standup.png',
  'tiny-ai-company': 'codex-agent-standup.png',
  'agent-team-gold': 'codex-agent-standup.png',
  'agent-conductor': 'codex-cyber-foreman.png',
  'agent-conductor-silver': 'codex-cyber-foreman.png',
  'agent-conductor-gold': 'codex-cyber-foreman.png',
  'root-portfolio-bronze': 'root-portfolio-v242.png',
  'root-portfolio-silver': 'root-portfolio-v242.png',
  'root-portfolio-gold': 'root-portfolio-v242.png',
  'agent-participation-bronze': 'codex-tiny-ai-company.png',
  'agent-participation-silver': 'codex-tiny-ai-company.png',
  'agent-participation-gold': 'codex-tiny-ai-company.png',
  'model-relay-roots-bronze': 'model-relay-roots-v242.png',
  'model-relay-roots-silver': 'model-relay-roots-v242.png',
  'model-relay-roots-gold': 'model-relay-roots-v242.png',
  'multi-core-human': 'codex-multi-core-human.png',
  'same-root-models-silver': 'codex-multi-core-human.png',
  'same-root-models-gold': 'codex-multi-core-human.png',
  'effort-explorer': 'codex-effort-explorer.png',
  'effort-breadth-silver': 'codex-effort-explorer.png',
  'effort-spectrum': 'codex-effort-explorer.png',
  'active-day-streak': 'combined-active-day-streak.png',
  'active-day-streak-silver': 'combined-active-day-streak.png',
  'active-day-streak-gold': 'combined-active-day-streak.png',
  'active-days-bronze': 'active-days-v242.png',
  'active-days-silver': 'active-days-v242.png',
  'active-days-gold': 'active-days-v242.png',
  'streak-machine': 'combined-fourteen-day-streak.png',
  'model-rainbow': 'combined-model-rainbow.png',
  'model-rainbow-bronze': 'combined-model-rainbow.png',
  'model-rainbow-gold': 'combined-model-rainbow.png',
  'hundred-million-club': 'combined-hundred-million-club.png',
  'billion-token-club': 'combined-hundred-million-club.png',
  'ten-billion-token-club': 'combined-hundred-million-club.png',
  'hundred-billion-token-club': 'combined-hundred-million-club.png',
  'trillion-token-club': 'combined-hundred-million-club.png',
};

// Tiers share an emblem: retain one byte string per file, not per award ID.
export const ACHIEVEMENT_IMAGE_FILES: Record<AchievementId,string> = {
  ...BASE_ACHIEVEMENT_IMAGE_FILES,
  ...Object.fromEntries(LONG_TERM_ACHIEVEMENT_DEFINITIONS.map(rule=>[rule.id,BASE_ACHIEVEMENT_IMAGE_FILES[rule.baseId]])),
} as Record<AchievementId,string>;
const encoded = new Map<string, string>();

export function achievementImagePath(id: AchievementId): string {
  return path.join(__dirname, '..', 'assets', 'achievements', ACHIEVEMENT_IMAGE_FILES[id]);
}

export function achievementImageDataUrl(id: AchievementId): string {
  const filename = ACHIEVEMENT_IMAGE_FILES[id];
  let url = encoded.get(filename);
  if (!url) {
    url = 'data:image/png;base64,' + readFileSync(achievementImagePath(id)).toString('base64');
    encoded.set(filename, url);
  }
  return url;
}

const ranks: readonly AchievementRank[] = ['bronze', 'silver', 'gold', 'platinum', 'legendary'];
const rankById = new Map<AchievementId, AchievementRank>(Object.values(ACHIEVEMENT_SERIES)
  .flatMap(ids => ids.map((id, index) => [id, ranks[index]] as const)));

/** Catalog order is authoritative; suffixes cannot identify legacy IDs or milestones. */
export function achievementIconRank(id: AchievementId): AchievementRank {
  return rankById.get(id) ?? 'milestone';
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

export type AchievementIconContext = 'gallery' | 'overview' | 'record' | 'detail' | 'selection';
const WEBVIEW_ICON_SIZES: Readonly<Record<AchievementIconContext, readonly number[]>> = {
  gallery: [56, 80, 112], overview: [56, 72, 96], record: [40, 56], detail: [40], selection: [48],
};

/** One resource image and one SVG. CSS selects a bounded pixel-sized group for
 * the existing size control; SVG user units stay CSS pixels, never scale away
 * the fixed eight-pixel ornament allowance. */
export function renderAchievementWebviewIcon(id: AchievementId, imageSrc: string,
  state: AchievementEmblemState = 'earned', imageClass?: 'achievement-share-choice-icon',
  context: AchievementIconContext = 'gallery'): string {
  const rank = achievementIconRank(id), frame = state === 'locked' ? 'locked' : rank;
  return '<span class="achievement-framed-icon" data-achievement-frame="' + frame + '" data-emblem-state="' + state +
    '" data-icon-context="' + context + '" aria-hidden="true">' +
    '<img' + (imageClass ? ' class="' + imageClass + '"' : '') + ' data-achievement-icon="' + id +
    '" data-achievement-artwork="' + ACHIEVEMENT_IMAGE_FILES[id] + '" src="' + escapeAttribute(imageSrc) + '" alt="" loading="lazy">' +
    '<svg class="achievement-adornment" aria-hidden="true" focusable="false">' +
    WEBVIEW_ICON_SIZES[context].map(size => '<g data-art-size="' + size + '">' + renderAchievementAdornment(rank, state, size) + '</g>').join('') +
    '</svg></span>';
}

/** Self-contained exported SVG uses only local, allowlisted PNG bytes. The
 * requested size describes the artwork; coordinates locate its decorated box. */
export function renderAchievementIcon(
  id: AchievementId,
  _color: 'currentColor' | '#db8b5b' | '#82a9ed' | '#ad99e2',
  position?: { x: number; y: number; size?: number },
): string {
  const coordinates = position ? ` x="${position.x}" y="${position.y}"` : '';
  const { artSize, edge, totalSize } = achievementIconLayout(position?.size ?? 48);
  const rank = achievementIconRank(id);
  return `<svg data-achievement-icon="${id}" data-achievement-frame="${rank}" data-emblem-state="earned"${coordinates} width="${totalSize}" height="${totalSize}" viewBox="0 0 ${totalSize} ${totalSize}" color="${ACHIEVEMENT_EXPORT_RANK_COLORS[rank]}" aria-hidden="true"><image href="${achievementImageDataUrl(id)}" x="${edge}" y="${edge}" width="${artSize}" height="${artSize}" />${renderAchievementAdornment(rank, 'earned', artSize)}</svg>`;
}
