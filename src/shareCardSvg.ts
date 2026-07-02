// Usage Share Card renderer — turns the redacted ShareCardData into a
// self-contained SVG (no DOM, no html-to-image dependency, no CSP concerns).
// Pure and unit-testable. Privacy is already enforced by ShareCardData's shape
// (see shareCard.ts); this only draws what's present.

import { ShareCardData, rangeLabel } from './shareCard';

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' → 'Jun 3' (falls back to the raw string). */
function shortDay(iso: string | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] || m[2]} ${Number(m[3])}`;
}

// Palette (Claude orange family + heatmap tones for composition segments).
const ORANGE = '#c85a2b';
const ORANGE_SOFT = '#e07d4f';
const INK = '#2b2b2b';
const MUTED = '#6b6b6b';
const COMPOSITION = [
  { key: 'input', label: 'Input', color: '#e07d4f' },
  { key: 'output', label: 'Output', color: '#c85a2b' },
  { key: 'cacheCreate', label: 'Cache write', color: '#f0aa82' },
  { key: 'cacheRead', label: 'Cache read', color: '#f7cbb0' },
] as const;

const REPO = 'github.com/ClaudeCodeUsage/ClaudeCodeUsage';

export interface ShareCardSvgOptions {
  width?: number; // default 1200
  height?: number; // default 680
}

/** Render the share card as an SVG string. */
export function renderShareCardSvg(data: ShareCardData, opts: ShareCardSvgOptions = {}): string {
  const W = opts.width ?? 1200;
  const H = opts.height ?? 680;
  const M = 64;
  const p: string[] = [];

  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">`
  );
  p.push('<defs>');
  p.push(`<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7f2"/><stop offset="1" stop-color="#fdeee6"/></linearGradient>`);
  p.push(`<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ORANGE}"/><stop offset="1" stop-color="${ORANGE_SOFT}"/></linearGradient>`);
  p.push('</defs>');
  p.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  p.push(`<rect width="${W}" height="10" fill="url(#accent)"/>`);

  // Header.
  const sub = (data.rangeLabel || rangeLabel(data.range)) + (data.projectName ? ' · ' + data.projectName : '');
  p.push(`<text x="${M}" y="92" font-size="30" font-weight="700" fill="${INK}">My Claude Code usage</text>`);
  p.push(`<text x="${M}" y="126" font-size="20" fill="${MUTED}">${esc(sub)}</text>`);

  // Badge pill (top-right).
  if (data.badge) {
    const bw = 40 + data.badge.label.length * 11;
    const bx = W - M - bw;
    p.push(`<rect x="${bx}" y="74" width="${bw}" height="40" rx="20" fill="url(#accent)"/>`);
    p.push(`<text x="${bx + bw / 2}" y="100" font-size="18" font-weight="600" fill="#ffffff" text-anchor="middle">${esc(data.badge.label)}</text>`);
  }

  // Hero metric.
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
    p.push(`<text x="${M}" y="258" font-size="108" font-weight="800" fill="${ORANGE}">${esc(heroValue)}</text>`);
    p.push(`<text x="${M}" y="302" font-size="24" fill="${MUTED}">${esc(heroUnit)}</text>`);
  }

  // Supporting stat tiles (priority order; capped at 4).
  const tiles: { label: string; value: string }[] = [];
  if (data.totalTokens != null && data.estimatedCost != null) {
    tiles.push({ label: 'est. cost', value: money(data.estimatedCost) });
  }
  if (data.cacheSharePct != null) {
    tiles.push({ label: 'from cache', value: data.cacheSharePct + '%' });
  }
  const modelLabel = data.topModelName || data.topModelFamily;
  if (modelLabel) {
    tiles.push({ label: 'top model', value: modelLabel });
  }
  if (data.sessions != null) {
    tiles.push({ label: 'sessions', value: String(data.sessions) });
  }
  if (data.messages != null) {
    tiles.push({ label: 'messages', value: String(data.messages) });
  }
  if (data.workflowSharePct != null) {
    tiles.push({ label: 'workflows', value: data.workflowSharePct + '%' });
  }
  if (data.peakContextTokens != null) {
    tiles.push({ label: 'peak context', value: compact(data.peakContextTokens) });
  }
  const tileY = 340;
  const tileW = 224;
  tiles.slice(0, 4).forEach((t, i) => {
    const x = M + i * (tileW + 16);
    p.push(`<rect x="${x}" y="${tileY}" width="${tileW}" height="92" rx="14" fill="#ffffff" fill-opacity="0.72" stroke="#f0d8c9"/>`);
    p.push(`<text x="${x + 18}" y="${tileY + 40}" font-size="28" font-weight="700" fill="${INK}">${esc(t.value)}</text>`);
    p.push(`<text x="${x + 18}" y="${tileY + 68}" font-size="17" fill="${MUTED}">${esc(t.label)}</text>`);
  });

  // Token composition — stacked bar of the four billed token types + legend
  // showing both the percentage and the absolute token amount.
  if (data.composition) {
    const c = data.composition;
    const segs = [c.input, c.output, c.cacheCreate, c.cacheRead];
    const total = segs.reduce((a, b) => a + b, 0);
    const barX = M;
    const barY = 466;
    const barW = W - 2 * M;
    const barH = 26;
    p.push(`<text x="${barX}" y="452" font-size="17" fill="${MUTED}">Token composition</text>`);
    if (total > 0) {
      let x = barX;
      segs.forEach((v, i) => {
        const w = (v / total) * barW;
        if (w > 0) {
          p.push(`<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" fill="${COMPOSITION[i].color}"/>`);
          x += w;
        }
      });
      p.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="6" fill="none" stroke="#f0d8c9"/>`);
      let lx = barX;
      const ly = 512;
      segs.forEach((v, i) => {
        const pct = Math.round((v / total) * 100);
        p.push(`<rect x="${lx}" y="${ly - 11}" width="13" height="13" rx="3" fill="${COMPOSITION[i].color}"/>`);
        const label = `${COMPOSITION[i].label} ${pct}% · ${compact(v)}`;
        p.push(`<text x="${lx + 19}" y="${ly}" font-size="15" fill="${MUTED}">${esc(label)}</text>`);
        lx += 40 + label.length * 8;
      });
    }
  }

  // Rhythm strip (per-day tokens), with peak scale + first/last date labels.
  if (data.rhythm && data.rhythm.length > 0) {
    const rx = M;
    const ry = 552;
    const rw = W - 2 * M;
    const rh = 68;
    const max = Math.max(...data.rhythm, 1);
    const n = data.rhythm.length;
    const bw = Math.max(3, Math.min(18, rw / n - 3));
    const step = rw / n;
    p.push(`<text x="${rx}" y="540" font-size="15" fill="${MUTED}">Daily tokens</text>`);
    p.push(`<text x="${rx + rw}" y="540" font-size="15" fill="${MUTED}" text-anchor="end">peak ${esc(compact(max))}</text>`);
    p.push(`<line x1="${rx}" y1="${ry}" x2="${rx + rw}" y2="${ry}" stroke="#f0d8c9"/>`);
    p.push(`<line x1="${rx}" y1="${ry + rh}" x2="${rx + rw}" y2="${ry + rh}" stroke="#eccbb9"/>`);
    data.rhythm.forEach((v, i) => {
      const bh = Math.max(2, (v / max) * rh);
      p.push(`<rect x="${(rx + i * step).toFixed(1)}" y="${(ry + rh - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${ORANGE_SOFT}"/>`);
    });
    // First / last date under the axis so the x-axis is meaningful.
    if (data.rhythmStart || data.rhythmEnd) {
      p.push(`<text x="${rx}" y="${ry + rh + 22}" font-size="14" fill="${MUTED}">${esc(shortDay(data.rhythmStart))}</text>`);
      p.push(`<text x="${rx + rw}" y="${ry + rh + 22}" font-size="14" fill="${MUTED}" text-anchor="end">${esc(shortDay(data.rhythmEnd))}</text>`);
    }
  }

  // Watermark + repo (bottom).
  if (data.watermark) {
    p.push(`<text x="${M}" y="${H - 28}" font-size="16" fill="${MUTED}">Made with Claude Code Usage · ${esc(REPO)}</text>`);
  }

  p.push('</svg>');
  return p.join('\n');
}
