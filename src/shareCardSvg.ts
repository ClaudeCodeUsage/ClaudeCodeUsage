// Usage Share Card renderer — turns the redacted ShareCardData into a
// self-contained SVG (no DOM, no html-to-image dependency, no CSP concerns).
// Pure and unit-testable. Privacy is already enforced by ShareCardData's shape
// (see shareCard.ts); this only draws what's present.

import { ShareCardData, ShareRange } from './shareCard';

const RANGE_LABEL: Record<ShareRange, string> = {
  today: 'today',
  week: 'this week',
  month: 'this month',
};

const esc = (s: string): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function compact(n: number): string {
  const a = Math.abs(n);
  const t = (x: number): string => x.toFixed(1).replace(/\.0$/, '');
  if (a >= 1e9) return t(n / 1e9) + 'B';
  if (a >= 1e6) return t(n / 1e6) + 'M';
  if (a >= 1e3) return t(n / 1e3) + 'K';
  return String(Math.round(n));
}

function money(n: number): string {
  return n >= 100 ? '$' + Math.round(n).toLocaleString('en-US') : '$' + n.toFixed(2);
}

export interface ShareCardSvgOptions {
  width?: number; // default 1200 (landscape)
  height?: number; // default 630
}

/** Render the share card as an SVG string. Landscape social-card proportions. */
export function renderShareCardSvg(data: ShareCardData, opts: ShareCardSvgOptions = {}): string {
  const W = opts.width ?? 1200;
  const H = opts.height ?? 630;
  const orange = '#c85a2b';
  const orangeSoft = '#e07d4f';
  const ink = '#2b2b2b';
  const muted = '#6b6b6b';
  const p: string[] = [];

  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">`
  );
  // Soft background + a subtle top accent bar.
  p.push('<defs>');
  p.push(`<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7f2"/><stop offset="1" stop-color="#fdeee6"/></linearGradient>`);
  p.push(`<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${orange}"/><stop offset="1" stop-color="${orangeSoft}"/></linearGradient>`);
  p.push('</defs>');
  p.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  p.push(`<rect width="${W}" height="10" fill="url(#accent)"/>`);

  const M = 64; // margin
  // Header.
  p.push(`<text x="${M}" y="92" font-size="30" font-weight="700" fill="${ink}">My Claude Code usage</text>`);
  p.push(`<text x="${M}" y="126" font-size="20" fill="${muted}">${esc(RANGE_LABEL[data.range])}${data.projectName ? ' · ' + esc(data.projectName) : ''}</text>`);

  // Hero metric: total tokens (or fall back to cost / sessions if tokens off).
  let heroValue = '';
  let heroUnit = '';
  if (data.totalTokens != null) {
    heroValue = compact(data.totalTokens);
    heroUnit = 'tokens';
  } else if (data.estimatedCost != null) {
    heroValue = money(data.estimatedCost);
    heroUnit = 'spent';
  } else if (data.sessions != null) {
    heroValue = String(data.sessions);
    heroUnit = 'sessions';
  }
  if (heroValue) {
    p.push(`<text x="${M}" y="248" font-size="112" font-weight="800" fill="${orange}">${esc(heroValue)}</text>`);
    p.push(`<text x="${M}" y="292" font-size="24" fill="${muted}">${esc(heroUnit)}</text>`);
  }

  // Supporting stat tiles.
  const tiles: { label: string; value: string }[] = [];
  if (data.totalTokens != null && data.estimatedCost != null) {
    tiles.push({ label: 'est. cost', value: money(data.estimatedCost) });
  }
  if (data.sessions != null) {
    tiles.push({ label: 'sessions', value: String(data.sessions) });
  }
  if (data.cacheSharePct != null) {
    tiles.push({ label: 'from cache', value: data.cacheSharePct + '%' });
  }
  if (data.topModelFamily) {
    tiles.push({ label: 'top model', value: data.topModelFamily });
  }
  if (data.workflowSharePct != null) {
    tiles.push({ label: 'workflows', value: data.workflowSharePct + '%' });
  }
  if (data.peakContextTokens != null) {
    tiles.push({ label: 'peak context', value: compact(data.peakContextTokens) });
  }
  const tileY = 348;
  const tileW = 224;
  tiles.slice(0, 4).forEach((t, i) => {
    const x = M + i * (tileW + 16);
    p.push(`<rect x="${x}" y="${tileY}" width="${tileW}" height="92" rx="14" fill="#ffffff" fill-opacity="0.72" stroke="#f0d8c9"/>`);
    p.push(`<text x="${x + 18}" y="${tileY + 38}" font-size="30" font-weight="700" fill="${ink}">${esc(t.value)}</text>`);
    p.push(`<text x="${x + 18}" y="${tileY + 68}" font-size="17" fill="${muted}">${esc(t.label)}</text>`);
  });

  // Rhythm strip (per-day tokens across the range).
  if (data.rhythm && data.rhythm.length > 0) {
    const rx = M;
    const ry = 486;
    const rw = W - 2 * M;
    const rh = 60;
    const max = Math.max(...data.rhythm, 1);
    const n = data.rhythm.length;
    const bw = Math.max(3, Math.min(18, (rw / n) - 3));
    const step = rw / n;
    data.rhythm.forEach((v, i) => {
      const bh = Math.max(2, (v / max) * rh);
      p.push(`<rect x="${(rx + i * step).toFixed(1)}" y="${(ry + rh - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${orangeSoft}"/>`);
    });
  }

  // Badge pill (bottom-left) + watermark (bottom-right).
  if (data.badge) {
    const bw = 40 + data.badge.label.length * 11;
    p.push(`<rect x="${M}" y="${H - 66}" width="${bw}" height="40" rx="20" fill="url(#accent)"/>`);
    p.push(`<text x="${M + bw / 2}" y="${H - 40}" font-size="18" font-weight="600" fill="#ffffff" text-anchor="middle">${esc(data.badge.label)}</text>`);
  }
  if (data.watermark) {
    p.push(`<text x="${W - M}" y="${H - 40}" font-size="17" fill="${muted}" text-anchor="end">Made with Claude Code Usage</text>`);
  }

  p.push('</svg>');
  return p.join('\n');
}
