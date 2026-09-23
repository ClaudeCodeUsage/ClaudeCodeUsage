export function escapeSvgText(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeSvgAttribute(value: unknown): string {
  return escapeSvgText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function approximateGlyphWidthEm(character: string): number {
  if (/\s/u.test(character)) return 0.35;
  const codePoint = character.codePointAt(0) ?? 0;
  if (
    codePoint >= 0x1100 &&
    (codePoint <= 0x11ff ||
      (codePoint >= 0x2e80 && codePoint <= 0x9fff) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      codePoint >= 0x1f000)
  ) {
    return 1;
  }
  if (/[WM@#%&]/u.test(character)) return 0.98;
  if (/[A-Z]/u.test(character)) return 0.74;
  if (/[a-z0-9]/u.test(character)) return 0.62;
  return 0.5;
}

export function fitSvgText(
  value: string,
  maxWidthPx: number,
  fontSizePx: number,
): string {
  const characters = Array.from(value);
  if (approximateSvgTextWidth(value, fontSizePx) <= maxWidthPx) return value;

  const available = Math.max(0, maxWidthPx - fontSizePx);
  const kept: string[] = [];
  let used = 0;
  for (const character of characters) {
    const advance = approximateGlyphWidthEm(character) * fontSizePx;
    if (used + advance > available) break;
    kept.push(character);
    used += advance;
  }
  return `${kept.join('').trimEnd()}…`;
}

export function approximateSvgTextWidth(value: string, fontSizePx: number): number {
  return Array.from(value).reduce(
    (total, character) => total + approximateGlyphWidthEm(character) * fontSizePx,
    0,
  );
}
