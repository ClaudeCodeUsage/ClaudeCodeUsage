/** Keep the localized name intact when its exact rank is shown separately.
 * Only catalog middle-dot separators qualify; words containing a rank do not.
 * Pass undefined for an unranked milestone. No rule/ID or copy lookup occurs here.
 */
export function achievementTitleWithoutRank(title: string, rankLabel: string | undefined): string {
  if (!rankLabel || !title.endsWith(rankLabel)) return title;
  const prefix = title.slice(0, -rankLabel.length);
  const separator = /\s*[·・]\s*$/u.exec(prefix);
  return separator && separator.index > 0 ? prefix.slice(0, separator.index) : title;
}
