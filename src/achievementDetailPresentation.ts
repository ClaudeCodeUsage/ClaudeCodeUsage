/** Share only an exact, nonblank condition present at every level. */
export function compactAchievementLevelNotes(
  notes: readonly (string | undefined)[],
): { shared?: string; perLevel: (string | undefined)[] } {
  const perLevel = [...notes];
  const first = perLevel[0];
  if (perLevel.length > 1 && typeof first === 'string' && first.trim().length > 0
    && perLevel.every(note => note === first)) {
    // Preserve the whole original text, including reference-price versions.
    return { shared: first, perLevel: perLevel.map(() => undefined) };
  }
  return { perLevel };
}

/**
 * Current measured progress, in its original integer unit (including microUSD).
 * The caller owns freshness via ready; targets and historical awards cannot
 * supply a missing value or cap a value that exceeds the highest level.
 */
export function achievementCurrentValue(
  result: { progress: number; target: number },
  ready: boolean,
): number | undefined {
  if (ready !== true) return undefined;
  const progress = result?.progress;
  return Number.isSafeInteger(progress) && progress >= 0 ? progress : undefined;
}
