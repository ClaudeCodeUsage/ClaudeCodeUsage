/** Keep the localized name intact when its rank is shown separately.
 * Only catalog middle-dot separators qualify; words containing a rank do not.
 * Pass undefined for an unranked milestone. No rule/ID or copy lookup occurs here.
 */
export function achievementTitleWithoutRank(title: string, rankLabel: string | undefined): string {
  if (!rankLabel) return title;
  // Display-only compatibility for titles supplied with the former rank names.
  // Match only aliases of the requested rank; IDs and saved pins stay untouched.
  const aliases: Record<string, readonly string[]> = {
    '铜': ['普通'], '銅': ['一般', '普通'], '银': ['银色'], '銀': ['銀色'], '金': ['金色'],
    Bronze: ['Ordinary', 'Basis', 'Básico'], 'ブロンズ': ['通常'], '브론즈': ['일반'], Perunggu: ['Dasar'],
  };
  const oldLabels = Object.prototype.hasOwnProperty.call(aliases, rankLabel) ? aliases[rankLabel] : [];
  for (const label of [rankLabel, ...oldLabels]) {
    if (!title.endsWith(label)) continue;
    const prefix = title.slice(0, -label.length);
    const separator = /\s*[·・]\s*$/u.exec(prefix);
    if (separator && separator.index > 0) return prefix.slice(0, separator.index);
  }
  return title;
}
