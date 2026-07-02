// Usage Share Card renderer — turns the redacted ShareCardData into a
// self-contained SVG (no DOM, no html-to-image dependency, no CSP concerns).
// Pure and unit-testable. Privacy is already enforced by ShareCardData's shape
// (see shareCard.ts); this only draws what's present.
//
// Layout flows vertically and distributes spare height as even gaps, so the
// same content reads well in landscape, square, portrait and story sizes.

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
/** 'YYYY-MM-DD' → 'Jun 3'; 'HH:00' passthrough; else the raw string. */
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

/** Named size presets (Carl: portrait for phones + multiple sizes). */
export type ShareCardSize = 'landscape' | 'square' | 'portrait' | 'story';
export const SHARE_CARD_SIZES: Record<ShareCardSize, { width: number; height: number }> = {
  landscape: { width: 1200, height: 680 }, // 16:9-ish, X / blog
  square: { width: 1080, height: 1080 }, // Instagram feed
  portrait: { width: 1080, height: 1350 }, // Instagram portrait
  story: { width: 1080, height: 1920 }, // stories / phone full-screen
};

export interface ShareCardSvgOptions {
  width?: number;
  height?: number;
  size?: ShareCardSize; // takes precedence over width/height
  avatarDataUri?: string; // optional embedded avatar (data: URI), top-right
}

/** Render the share card as an SVG string. */
export function renderShareCardSvg(data: ShareCardData, opts: ShareCardSvgOptions = {}): string {
  const preset = opts.size ? SHARE_CARD_SIZES[opts.size] : undefined;
  const W = preset?.width ?? opts.width ?? 1200;
  const H = preset?.height ?? opts.height ?? 680;
  const M = Math.round(W * 0.055); // margin scales with width
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

  // --- Header (pinned top) ---
  const sub = (data.rangeLabel || rangeLabel(data.range)) + (data.projectName ? ' · ' + data.projectName : '');
  p.push(`<text x="${M}" y="86" font-size="30" font-weight="700" fill="${INK}">My Claude Code usage</text>`);
  p.push(`<text x="${M}" y="120" font-size="20" fill="${MUTED}">${esc(sub)}</text>`);

  // Avatar (optional, top-right) or badge — avatar wins the corner if present.
  if (opts.avatarDataUri) {
    const s = 76;
    const ax = W - M - s;
    p.push(`<clipPath id="av"><circle cx="${ax + s / 2}" cy="${58 + s / 2}" r="${s / 2}"/></clipPath>`);
    p.push(`<image x="${ax}" y="58" width="${s}" height="${s}" href="${esc(opts.avatarDataUri)}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`);
    p.push(`<circle cx="${ax + s / 2}" cy="${58 + s / 2}" r="${s / 2}" fill="none" stroke="#f0d8c9" stroke-width="2"/>`);
  } else if (data.badge) {
    const bw = 40 + data.badge.label.length * 11;
    const bx = W - M - bw;
    p.push(`<rect x="${bx}" y="68" width="${bw}" height="40" rx="20" fill="url(#accent)"/>`);
    p.push(`<text x="${bx + bw / 2}" y="94" font-size="18" font-weight="600" fill="#ffffff" text-anchor="middle">${esc(data.badge.label)}</text>`);
  }

  // --- Middle sections, distributed between the header and the footer ---
  const headerBottom = 150;
  const footerTop = H - 64; // watermark zone
  type Section = { h: number; draw: (y: number) => void };
  const sections: Section[] = [];

  // Hero.
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
    sections.push({
      h: 150,
      draw: (y) => {
        p.push(`<text x="${M}" y="${y + 108}" font-size="108" font-weight="800" fill="${ORANGE}">${esc(heroValue)}</text>`);
        p.push(`<text x="${M}" y="${y + 148}" font-size="24" fill="${MUTED}">${esc(heroUnit)}</text>`);
      },
    });
  }

  // Stat tiles (priority order, capped at 4).
  const tiles: { label: string; value: string }[] = [];
  if (data.totalTokens != null && data.estimatedCost != null) tiles.push({ label: 'est. cost', value: money(data.estimatedCost) });
  if (data.cacheSharePct != null) tiles.push({ label: 'from cache', value: data.cacheSharePct + '%' });
  const modelLabel = data.topModelName || data.topModelFamily;
  if (modelLabel) tiles.push({ label: 'top model', value: modelLabel });
  if (data.sessions != null) tiles.push({ label: 'sessions', value: String(data.sessions) });
  if (data.messages != null) tiles.push({ label: 'messages', value: String(data.messages) });
  if (data.workflowSharePct != null) tiles.push({ label: 'workflows', value: data.workflowSharePct + '%' });
  if (data.peakContextTokens != null) tiles.push({ label: 'peak context', value: compact(data.peakContextTokens) });
  const shownTiles = tiles.slice(0, 4);
  if (shownTiles.length > 0) {
    const gap = 16;
    const perRow = Math.max(1, Math.min(shownTiles.length, Math.floor((W - 2 * M + gap) / (200 + gap))));
    const rows = Math.ceil(shownTiles.length / perRow);
    const tileW = (W - 2 * M - (perRow - 1) * gap) / perRow;
    const rowH = 92;
    sections.push({
      h: rows * rowH + (rows - 1) * 12,
      draw: (y) => {
        shownTiles.forEach((t, i) => {
          const r = Math.floor(i / perRow);
          const c = i % perRow;
          const x = M + c * (tileW + gap);
          const ty = y + r * (rowH + 12);
          p.push(`<rect x="${x.toFixed(1)}" y="${ty}" width="${tileW.toFixed(1)}" height="${rowH}" rx="14" fill="#ffffff" fill-opacity="0.72" stroke="#f0d8c9"/>`);
          p.push(`<text x="${(x + 18).toFixed(1)}" y="${ty + 40}" font-size="28" font-weight="700" fill="${INK}">${esc(t.value)}</text>`);
          p.push(`<text x="${(x + 18).toFixed(1)}" y="${ty + 68}" font-size="17" fill="${MUTED}">${esc(t.label)}</text>`);
        });
      },
    });
  }

  // Token composition (stacked bar + legend with % and amount).
  if (data.composition) {
    const c = data.composition;
    const segs = [c.input, c.output, c.cacheCreate, c.cacheRead];
    const total = segs.reduce((a, b) => a + b, 0);
    if (total > 0) {
      sections.push({
        h: 66,
        draw: (y) => {
          const barX = M;
          const barY = y + 20;
          const barW = W - 2 * M;
          const barH = 26;
          p.push(`<text x="${barX}" y="${y + 6}" font-size="17" fill="${MUTED}">Token composition</text>`);
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
          const ly = barY + barH + 20;
          segs.forEach((v, i) => {
            const pct = Math.round((v / total) * 100);
            const label = `${COMPOSITION[i].label} ${pct}% · ${compact(v)}`;
            p.push(`<rect x="${lx}" y="${ly - 11}" width="13" height="13" rx="3" fill="${COMPOSITION[i].color}"/>`);
            p.push(`<text x="${lx + 19}" y="${ly}" font-size="15" fill="${MUTED}">${esc(label)}</text>`);
            lx += 40 + label.length * 8;
          });
        },
      });
    }
  }

  // Rhythm strip (per-day/-hour tokens), centred + capped bars, with a scale
  // and first/last labels so short ranges don't look sparse.
  if (data.rhythm && data.rhythm.length > 0) {
    sections.push({
      h: 118,
      draw: (y) => {
        const rx = M;
        const capW = W - 2 * M;
        const rh = 76;
        const barsTop = y + 12;
        const max = Math.max(...data.rhythm!, 1);
        const n = data.rhythm!.length;
        const slot = Math.min(capW / n, 46);
        const usedW = slot * n;
        const startX = rx + (capW - usedW) / 2; // centre when few bars
        const bw = Math.max(3, Math.min(slot - 6, 30));
        p.push(`<text x="${rx}" y="${y}" font-size="15" fill="${MUTED}">${n > 26 ? 'Daily' : n <= 24 && data.range === 'today' ? 'Hourly' : 'Daily'} tokens</text>`);
        p.push(`<text x="${rx + capW}" y="${y}" font-size="15" fill="${MUTED}" text-anchor="end">peak ${esc(compact(max))}</text>`);
        p.push(`<line x1="${rx}" y1="${barsTop}" x2="${rx + capW}" y2="${barsTop}" stroke="#f0d8c9"/>`);
        p.push(`<line x1="${rx}" y1="${barsTop + rh}" x2="${rx + capW}" y2="${barsTop + rh}" stroke="#eccbb9"/>`);
        data.rhythm!.forEach((v, i) => {
          const bh = Math.max(2, (v / max) * rh);
          const bx = startX + i * slot + (slot - bw) / 2;
          p.push(`<rect x="${bx.toFixed(1)}" y="${(barsTop + rh - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${ORANGE_SOFT}"/>`);
        });
        if (data.rhythmStart || data.rhythmEnd) {
          p.push(`<text x="${rx}" y="${barsTop + rh + 24}" font-size="14" fill="${MUTED}">${esc(shortDay(data.rhythmStart))}</text>`);
          p.push(`<text x="${rx + capW}" y="${barsTop + rh + 24}" font-size="14" fill="${MUTED}" text-anchor="end">${esc(shortDay(data.rhythmEnd))}</text>`);
        }
      },
    });
  }

  // Distribute the spare vertical space as even gaps.
  const sumH = sections.reduce((a, s) => a + s.h, 0);
  const avail = footerTop - headerBottom;
  const gap = Math.max(16, (avail - sumH) / (sections.length + 1));
  let cursor = headerBottom + gap;
  for (const s of sections) {
    s.draw(cursor);
    cursor += s.h + gap;
  }

  // --- Footer (pinned bottom, clear of the rhythm dates) ---
  if (data.watermark) {
    p.push(`<text x="${M}" y="${H - 30}" font-size="16" fill="${MUTED}">Made with Claude Code Usage · ${esc(REPO)}</text>`);
  }

  p.push('</svg>');
  return p.join('\n');
}
