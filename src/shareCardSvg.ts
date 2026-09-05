// Usage Share Card renderer — turns the redacted ShareCardData into a
// self-contained SVG (no DOM, no html-to-image, no network, no web fonts).
// Pure & deterministic: same data + options ⇒ same SVG. Privacy is enforced by
// ShareCardData's shape; this only draws what's present.
//
// Visual direction: "Code Pulse · Aurora Console" (GPT design, docs/
// V2.2-ShareCard-GPT-design.md). Two themes share ONE renderer via a token set:
//   • claudeCream (default) — warm, editorial, Claude-like.
//   • auroraDark — technical, high-contrast, social-share ready.
// Landscape 1200×680 only for now (square/portrait/story = a later patch).

import { ShareCardData, rangeLabel } from './shareCard';

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI","Inter","Microsoft YaHei","PingFang SC",sans-serif';

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Compact token count. Chinese cards use 万 / 亿 (万 / 億 for Traditional) to fit
// the language; others use K / M / B. `keepDecimal` forces one decimal (the hero
// keeps it even for round values, e.g. "5.0亿").
function compact(n: number, lang: 'en' | 'zh-CN' | 'zh-TW' = 'en', keepDecimal = false): string {
  const a = Math.abs(n);
  const t = (x: number): string => (keepDecimal ? x.toFixed(1) : x.toFixed(1).replace(/\.0$/, ''));
  if (lang === 'zh-CN' || lang === 'zh-TW') {
    const yi = lang === 'zh-TW' ? '億' : '亿';
    const wan = lang === 'zh-TW' ? '萬' : '万';
    if (a >= 1e8) return t(n / 1e8) + yi;
    if (a >= 1e4) return t(n / 1e4) + wan;
    return String(Math.round(n));
  }
  if (a >= 1e9) return t(n / 1e9) + 'B';
  if (a >= 1e6) return t(n / 1e6) + 'M';
  if (a >= 1e3) return t(n / 1e3) + 'K';
  return String(Math.round(n));
}

function money(n: number): string {
  return n >= 100 ? '$' + Math.round(n).toLocaleString('en-US') : '$' + n.toFixed(2);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDay(iso: string | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1] || m[2]} ${Number(m[3])}` : iso;
}

// ---- Theme tokens -----------------------------------------------------------

export type ShareCardTheme = 'auto' | 'claudeCream' | 'claudeClassic' | 'auroraDark';
type ConcreteTheme = 'claudeCream' | 'claudeClassic' | 'auroraDark';

interface ThemeTokens {
  bgTop: string;
  bgBottom: string;
  blobWarm: string;
  blobCool: string;
  primaryAccent: string;
  primaryAccentBright: string;
  secondaryAccent: string;
  cacheAccent: string;
  modelAccent: string;
  panelFill: string;
  panelBorder: string;
  primaryText: string;
  secondaryText: string;
  mutedText: string;
  softLine: string;
  watermark: string;
  badgeFill: string;
  badgeBorder: string;
}

export const SHARE_CARD_THEMES: Record<ConcreteTheme, ThemeTokens> = {
  // Classic: the pre-redesign single-hue orange — fewer colours, more refined.
  // A monochrome orange ramp for the token mix (no violet/mint), on the cream
  // background, so it keeps the older "high-end" restraint.
  claudeClassic: {
    bgTop: '#FFF7F2',
    bgBottom: '#FDEEE6',
    blobWarm: '#FFE6D8',
    blobCool: '#FAD9C6',
    primaryAccent: '#C85A2B',
    primaryAccentBright: '#E07D4F',
    secondaryAccent: '#F0AA82',
    cacheAccent: '#F7CBB0',
    modelAccent: '#E07D4F',
    panelFill: 'rgba(255,255,255,0.74)',
    panelBorder: '#F0D8C9',
    primaryText: '#2B2B2B',
    secondaryText: '#6B6B6B',
    mutedText: '#9A8478',
    softLine: '#F0D8C9',
    watermark: 'rgba(43,43,43,0.50)',
    badgeFill: 'rgba(255,255,255,0.86)',
    badgeBorder: 'rgba(200,90,43,0.16)',
  },
  claudeCream: {
    bgTop: '#FFF8F3',
    bgBottom: '#FDEEE6',
    blobWarm: '#FFE1D2',
    blobCool: '#F6C177',
    primaryAccent: '#C85A2B',
    primaryAccentBright: '#E07D4F',
    secondaryAccent: '#F6C177',
    cacheAccent: '#5FAE8F',
    modelAccent: '#8B7CF6',
    panelFill: 'rgba(255,255,255,0.82)',
    panelBorder: 'rgba(200,90,43,0.14)',
    primaryText: '#6B341F',
    secondaryText: '#9A6A55',
    mutedText: '#B9907E',
    softLine: '#EFD8CB',
    watermark: 'rgba(107,52,31,0.58)',
    badgeFill: 'rgba(255,255,255,0.86)',
    badgeBorder: 'rgba(200,90,43,0.20)',
  },
  auroraDark: {
    bgTop: '#111827',
    bgBottom: '#1E1B4B',
    blobWarm: '#C85A2B',
    blobCool: '#312E81',
    primaryAccent: '#E07D4F',
    primaryAccentBright: '#F6A06F',
    secondaryAccent: '#F6C177',
    cacheAccent: '#5CC8A7',
    modelAccent: '#8B7CF6',
    panelFill: 'rgba(255,255,255,0.10)',
    panelBorder: 'rgba(255,255,255,0.20)',
    primaryText: '#FFF7F2',
    secondaryText: '#C9D1D9',
    mutedText: '#9CA3AF',
    softLine: 'rgba(255,255,255,0.18)',
    watermark: 'rgba(255,247,242,0.62)',
    badgeFill: 'rgba(255,255,255,0.12)',
    badgeBorder: 'rgba(255,255,255,0.24)',
  },
};

/** Resolve the theme. Explicit themes pass through; 'auto'/undefined follow VS
 * Code (dark → auroraDark) and otherwise use the default, Claude Classic. */
export function resolveShareCardTheme(theme: ShareCardTheme | undefined, isDark?: boolean): ConcreteTheme {
  if (theme === 'auroraDark' || theme === 'claudeCream' || theme === 'claudeClassic') {
    return theme;
  }
  return isDark ? 'auroraDark' : 'claudeClassic'; // 'auto' / undefined
}

// The card renders in the UI language (Carl: no en/zh mixing). Fully localized
// for en / zh-CN / zh-TW (the maintainer's languages); other UI languages fall
// back to en so a card never mixes languages. Card-specific strings live here
// (self-contained + testable) rather than bloating the shared i18n table.
export type CardLang = 'en' | 'zh-CN' | 'zh-TW';
export function cardLang(lang?: string): CardLang {
  return lang === 'zh-CN' || lang === 'zh-TW' ? lang : 'en';
}

interface CardStrings {
  subtitle: string;
  totalTokens: string;
  spent: string;
  sessionsUnit: string;
  estCost: string;
  cacheHit: string;
  topModel: string;
  sessions: string;
  messages: string;
  workflows: string;
  peakCtx: string;
  tokenMix: string;
  input: string;
  output: string;
  cacheWrite: string;
  cacheRead: string;
  daily: string;
  hourly: string;
  peak: string;
  madeWith: string;
}

const CARD_STRINGS: Record<CardLang, CardStrings> = {
  en: {
    subtitle: 'AI coding usage snapshot', totalTokens: 'total tokens', spent: 'estimated spend', sessionsUnit: 'sessions',
    estCost: 'est. cost', cacheHit: 'cache hit', topModel: 'top model', sessions: 'sessions', messages: 'messages',
    workflows: 'workflows', peakCtx: 'peak ctx', tokenMix: 'Token mix', input: 'Input', output: 'Output',
    cacheWrite: 'Cache write', cacheRead: 'Cache read', daily: 'Daily pulse', hourly: 'Hourly pulse', peak: 'peak',
    madeWith: 'Made with Claude Code Usage',
  },
  'zh-CN': {
    subtitle: 'AI 编程用量快照', totalTokens: '总 token', spent: '预计花费', sessionsUnit: '会话',
    estCost: '预计成本', cacheHit: '缓存命中', topModel: '主力模型', sessions: '会话数', messages: '消息数',
    workflows: '工作流', peakCtx: '峰值上下文', tokenMix: 'Token 组成', input: '输入', output: '输出',
    cacheWrite: '缓存写入', cacheRead: '缓存读取', daily: '每日节奏', hourly: '每小时节奏', peak: '峰值',
    madeWith: '由 Claude Code Usage 制作',
  },
  'zh-TW': {
    subtitle: 'AI 程式設計用量快照', totalTokens: '總 token', spent: '預計花費', sessionsUnit: '會話',
    estCost: '預計成本', cacheHit: '快取命中', topModel: '主力模型', sessions: '會話數', messages: '訊息數',
    workflows: '工作流', peakCtx: '峰值上下文', tokenMix: 'Token 組成', input: '輸入', output: '輸出',
    cacheWrite: '快取寫入', cacheRead: '快取讀取', daily: '每日節奏', hourly: '每小時節奏', peak: '峰值',
    madeWith: '由 Claude Code Usage 製作',
  },
};

// On-brand badge copy per language (title + one-line personality), keyed by
// selectShareBadge ids. Title AND line use the same language — no mixing.
export const BADGE_COPY: Record<string, Record<CardLang, { title: string; line: string }>> = {
  'context-marathoner': {
    en: { title: 'Context Marathon', line: "Half-marathon of context — the model's still catching its breath." },
    'zh-CN': { title: 'Context 马拉松', line: '上下文跑了个半马，模型还在喘。' },
    'zh-TW': { title: 'Context 馬拉松', line: '上下文跑了個半馬，模型還在喘。' },
  },
  'cache-saver': {
    en: { title: 'Cache Alchemist', line: 'High cache hits — barely a token wasted.' },
    'zh-CN': { title: '缓存日子人', line: '缓存命中高，token 没白烧。' },
    'zh-TW': { title: '快取日子人', line: '快取命中高，token 沒白燒。' },
  },
  'token-sprinter': {
    en: { title: 'Token Sprinter', line: 'Full throttle. 🔥' },
    'zh-CN': { title: '无限火力', line: '开炮！！！' },
    'zh-TW': { title: '無限火力', line: '開炮！！！' },
  },
  'workflow-pilot': {
    en: { title: 'Workflow Pilot', line: "You're not coding — you're running a crew." },
    'zh-CN': { title: 'Agent 包工头', line: '你不是在写代码，你是在使唤一支小队。' },
    'zh-TW': { title: 'Agent 包工頭', line: '你不是在寫程式，你是在使喚一支小隊。' },
  },
  'steady-builder': {
    en: { title: 'Steady Builder', line: 'No rush, no burnout — steady progress.' },
    'zh-CN': { title: '节奏大师', line: '不卷不燥，代码稳步推进。' },
    'zh-TW': { title: '節奏大師', line: '不捲不燥，程式碼穩步推進。' },
  },
};

const REPO = 'github.com/ClaudeCodeUsage';

// ---- Renderer ---------------------------------------------------------------

export interface ShareCardSvgOptions {
  width?: number;
  height?: number;
  theme?: ShareCardTheme; // default claudeCream
  isDark?: boolean; // used only when theme === 'auto'
  avatarDataUri?: string;
  username?: string;
  fullNumbers?: boolean;
  lang?: string; // UI language; the card renders in it (en fallback)
}

export function renderShareCardSvg(data: ShareCardData, opts: ShareCardSvgOptions = {}): string {
  const W = opts.width ?? 1200;
  const H = opts.height ?? 680;
  const M = 60;
  const T = SHARE_CARD_THEMES[resolveShareCardTheme(opts.theme, opts.isDark)];
  const L = cardLang(opts.lang);
  const S = CARD_STRINGS[L];
  const p: string[] = [];

  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${FONT}'>`
  );

  // Aurora background: vertical gradient + two soft radial blobs (deterministic).
  p.push('<defs>');
  p.push(`<linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${T.bgTop}"/><stop offset="1" stop-color="${T.bgBottom}"/></linearGradient>`);
  p.push(`<radialGradient id="blobA" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${T.blobWarm}" stop-opacity="0.55"/><stop offset="1" stop-color="${T.blobWarm}" stop-opacity="0"/></radialGradient>`);
  p.push(`<radialGradient id="blobB" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${T.blobCool}" stop-opacity="0.5"/><stop offset="1" stop-color="${T.blobCool}" stop-opacity="0"/></radialGradient>`);
  p.push(`<linearGradient id="hero" x1="0" y1="0" x2="1" y2="0.6"><stop offset="0" stop-color="${T.primaryAccent}"/><stop offset="1" stop-color="${T.primaryAccentBright}"/></linearGradient>`);
  p.push('</defs>');
  p.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  p.push(`<circle cx="${W - 120}" cy="90" r="360" fill="url(#blobA)"/>`);
  p.push(`<circle cx="140" cy="${H - 40}" r="340" fill="url(#blobB)"/>`);

  // --- Brand block (top-left) ---
  p.push(`<text x="${M}" y="74" font-size="22" font-weight="700" fill="${T.primaryText}">Claude Code Usage</text>`);
  p.push(`<text x="${M}" y="100" font-size="16" font-weight="500" fill="${T.secondaryText}">${esc(S.subtitle)}</text>`);
  const range = (data.rangeLabel || rangeLabel(data.range)) + (data.projectName ? ' · ' + truncate(data.projectName, 28) : '');
  p.push(`<text x="${M}" y="124" font-size="15" font-weight="500" fill="${T.mutedText}">${esc(range)}</text>`);

  // --- Corner (top-right): avatar + badge card + optional name ---
  let cornerBottom = 130;
  let avatarBottom = 0;
  if (opts.avatarDataUri) {
    const s = 60;
    const ax = W - M - s;
    const ay = 46;
    p.push(`<clipPath id="av"><circle cx="${ax + s / 2}" cy="${ay + s / 2}" r="${s / 2}"/></clipPath>`);
    p.push(`<image x="${ax}" y="${ay}" width="${s}" height="${s}" href="${esc(opts.avatarDataUri)}" xlink:href="${esc(opts.avatarDataUri)}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`);
    p.push(`<circle cx="${ax + s / 2}" cy="${ay + s / 2}" r="${s / 2}" fill="none" stroke="${T.badgeBorder}" stroke-width="2"/>`);
    avatarBottom = ay + s;
  }
  if (data.badge) {
    const copy = BADGE_COPY[data.badge.id]?.[L] || { title: data.badge.label, line: '' };
    const hasName = !!(opts.username && opts.username.trim());
    const titleW = 16 + copy.title.length * 11;
    const lineW = copy.line ? 24 + copy.line.length * 15 : 0;
    const nameW = hasName ? 24 + truncate(opts.username!.trim(), 22).length * 10 : 0;
    const cardW = Math.min(380, Math.max(160, titleW, lineW, nameW) + 28);
    const cardX = W - M - cardW;
    const cardY = avatarBottom ? avatarBottom + 12 : 52;
    const cardH = (hasName ? 26 : 0) + (copy.line ? 62 : 42);
    p.push(`<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="16" fill="${T.badgeFill}" stroke="${T.badgeBorder}"/>`);
    // Accent dot + title.
    let ty = cardY + (hasName ? 24 : 20);
    if (hasName) {
      p.push(`<text x="${cardX + cardW - 16}" y="${ty}" font-size="13" font-weight="600" fill="${T.mutedText}" text-anchor="end">${esc(truncate(opts.username!.trim(), 24))}</text>`);
      ty += 28;
    } else {
      ty += 8;
    }
    p.push(`<circle cx="${cardX + 20}" cy="${ty - 6}" r="6" fill="url(#hero)"/>`);
    p.push(`<text x="${cardX + 34}" y="${ty}" font-size="18" font-weight="700" fill="${T.primaryText}">${esc(truncate(copy.title, 22))}</text>`);
    if (copy.line) {
      p.push(`<text x="${cardX + 16}" y="${ty + 26}" font-size="13" font-weight="500" fill="${T.secondaryText}">${esc(truncate(copy.line, 44))}</text>`);
    }
    cornerBottom = Math.max(cornerBottom, cardY + cardH);
  } else {
    cornerBottom = Math.max(cornerBottom, avatarBottom);
  }

  // --- Middle sections ---
  // The hero sits top-left and the corner block sits top-right, so they can
  // overlap VERTICALLY without colliding. The remaining (full-width) sections
  // flow below whichever reaches lower — so turning on the avatar only nudges
  // the tiles down a little instead of pushing the whole card off the canvas.
  const contentTop = 134;
  const footerTop = H - 56;
  type Section = { h: number; draw: (y: number) => void };
  const sections: Section[] = []; // tiles / composition / pulse (flowed)

  // Hero (drawn at a fixed top position).
  let heroValue = '';
  let heroUnit = '';
  if (data.totalTokens != null) {
    heroValue = opts.fullNumbers ? data.totalTokens.toLocaleString('en-US') : compact(data.totalTokens, L, true);
    heroUnit = S.totalTokens;
  } else if (data.estimatedCost != null) {
    heroValue = money(data.estimatedCost);
    heroUnit = S.spent;
  } else if (data.sessions != null) {
    heroValue = String(data.sessions);
    heroUnit = S.sessionsUnit;
  }
  let heroBottom = contentTop;
  if (heroValue) {
    const heroFont = heroValue.length > 11 ? 60 : heroValue.length > 8 ? 82 : 104;
    p.push(`<text x="${M}" y="${contentTop + heroFont}" font-size="${heroFont}" font-weight="800" fill="url(#hero)">${esc(heroValue)}</text>`);
    p.push(`<text x="${M}" y="${contentTop + heroFont + 34}" font-size="22" font-weight="600" fill="${T.secondaryText}">${esc(heroUnit)}</text>`);
    heroBottom = contentTop + heroFont + 48;
  }

  // Stat tiles — 4 by default (cost / cache / model / sessions), glass panels.
  const tiles: { label: string; value: string; accent?: string }[] = [];
  if (data.totalTokens != null && data.estimatedCost != null) tiles.push({ label: S.estCost, value: money(data.estimatedCost) });
  if (data.cacheSharePct != null) tiles.push({ label: S.cacheHit, value: data.cacheSharePct + '%', accent: T.cacheAccent });
  const modelLabel = data.topModelName || data.topModelFamily;
  if (modelLabel) tiles.push({ label: S.topModel, value: truncate(modelLabel, 12), accent: T.modelAccent });
  if (data.sessions != null) tiles.push({ label: S.sessions, value: String(data.sessions) });
  if (data.messages != null) tiles.push({ label: S.messages, value: String(data.messages) });
  if (data.workflowSharePct != null) tiles.push({ label: S.workflows, value: data.workflowSharePct + '%' });
  if (data.peakContextTokens != null) tiles.push({ label: S.peakCtx, value: compact(data.peakContextTokens, L) });
  const shownTiles = tiles.slice(0, 4);
  if (shownTiles.length > 0) {
    const gap = 18;
    const n = shownTiles.length;
    const tileW = (W - 2 * M - (n - 1) * gap) / n;
    const rowH = 96;
    sections.push({
      h: rowH,
      draw: (y) => {
        shownTiles.forEach((t, i) => {
          const x = M + i * (tileW + gap);
          p.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${tileW.toFixed(1)}" height="${rowH}" rx="16" fill="${T.panelFill}" stroke="${T.panelBorder}"/>`);
          p.push(`<rect x="${x.toFixed(1)}" y="${y + 16}" width="4" height="${rowH - 32}" rx="2" fill="${t.accent || T.primaryAccent}"/>`);
          p.push(`<text x="${(x + 22).toFixed(1)}" y="${y + 46}" font-size="30" font-weight="750" fill="${T.primaryText}">${esc(t.value)}</text>`);
          p.push(`<text x="${(x + 22).toFixed(1)}" y="${y + 74}" font-size="14" font-weight="500" fill="${T.mutedText}">${esc(t.label)}</text>`);
        });
      },
    });
  }

  // Token composition — stacked bar (theme-aware segment colors) + legend.
  if (data.composition) {
    const c = data.composition;
    const segs = [
      { v: c.input, label: S.input, color: T.primaryAccent },
      { v: c.output, label: S.output, color: T.modelAccent },
      { v: c.cacheCreate, label: S.cacheWrite, color: T.secondaryAccent },
      { v: c.cacheRead, label: S.cacheRead, color: T.cacheAccent },
    ];
    const total = segs.reduce((a, b) => a + b.v, 0);
    if (total > 0) {
      // A touch of internal padding (label at y+10, legend at y+74) so the block
      // doesn't crowd the tiles above / pulse below.
      sections.push({
        h: 84,
        draw: (y) => {
          const barY = y + 30;
          const barW = W - 2 * M;
          const barH = 22;
          p.push(`<text x="${M}" y="${y + 12}" font-size="15" font-weight="700" fill="${T.secondaryText}">${esc(S.tokenMix)}</text>`);
          let x = M;
          segs.forEach((s) => {
            const w = (s.v / total) * barW;
            if (w > 0) {
              p.push(`<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" fill="${s.color}"/>`);
              x += w;
            }
          });
          p.push(`<rect x="${M}" y="${barY}" width="${barW}" height="${barH}" rx="6" fill="none" stroke="${T.softLine}"/>`);
          let lx = M;
          const ly = barY + barH + 22;
          segs.forEach((s) => {
            const pct = Math.round((s.v / total) * 100);
            const label = `${s.label} ${pct}% · ${compact(s.v, L)}`;
            p.push(`<rect x="${lx}" y="${ly - 11}" width="12" height="12" rx="3" fill="${s.color}"/>`);
            p.push(`<text x="${lx + 18}" y="${ly}" font-size="14" font-weight="500" fill="${T.mutedText}">${esc(label)}</text>`);
            lx += 38 + label.length * 7.6;
          });
        },
      });
    }
  }

  // Daily pulse strip — centred + width-capped bars, peak + first/last labels.
  if (data.rhythm && data.rhythm.length > 0) {
    sections.push({
      h: 110,
      draw: (y) => {
        const capW = W - 2 * M;
        const rh = 70;
        const barsTop = y + 14;
        const max = Math.max(...data.rhythm!, 1);
        const nn = data.rhythm!.length;
        const slot = Math.min(capW / nn, 46);
        const usedW = slot * nn;
        const startX = M + (capW - usedW) / 2;
        const bw = Math.max(3, Math.min(slot - 6, 28));
        p.push(`<text x="${M}" y="${y}" font-size="15" font-weight="700" fill="${T.secondaryText}">${esc(nn <= 24 && data.range === 'today' ? S.hourly : S.daily)}</text>`);
        p.push(`<text x="${M + capW}" y="${y}" font-size="14" font-weight="500" fill="${T.mutedText}" text-anchor="end">${esc(S.peak)} ${esc(compact(max, L))}</text>`);
        p.push(`<line x1="${M}" y1="${barsTop + rh}" x2="${M + capW}" y2="${barsTop + rh}" stroke="${T.softLine}"/>`);
        let firstCx = startX;
        let lastCx = startX;
        data.rhythm!.forEach((v, i) => {
          const bh = Math.max(2, (v / max) * rh);
          const bx = startX + i * slot + (slot - bw) / 2;
          if (i === 0) firstCx = bx + bw / 2;
          if (i === nn - 1) lastCx = bx + bw / 2;
          const col = i === data.rhythm!.indexOf(max) ? T.primaryAccentBright : T.primaryAccent;
          p.push(`<rect x="${bx.toFixed(1)}" y="${(barsTop + rh - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${col}"/>`);
        });
        if (data.rhythmStart) {
          p.push(`<text x="${firstCx.toFixed(1)}" y="${barsTop + rh + 22}" font-size="13" font-weight="500" fill="${T.mutedText}" text-anchor="middle">${esc(shortDay(data.rhythmStart))}</text>`);
        }
        if (data.rhythmEnd && nn > 1) {
          p.push(`<text x="${lastCx.toFixed(1)}" y="${barsTop + rh + 22}" font-size="13" font-weight="500" fill="${T.mutedText}" text-anchor="middle">${esc(shortDay(data.rhythmEnd))}</text>`);
        }
      },
    });
  }

  // Flow the full-width sections below whichever of the hero / corner reaches
  // lower, distributing the spare height as even gaps clamped to a sane band
  // (so a card with few sections isn't hollow and a full one isn't cramped).
  const restTop = Math.max(heroBottom, cornerBottom + 12);
  const sumH = sections.reduce((a, s) => a + s.h, 0);
  const n = sections.length;
  let gap = n > 0 ? (footerTop - restTop - sumH) / (n + 1) : 0;
  gap = Math.max(14, Math.min(38, gap));
  let cursor = restTop + gap;
  for (const s of sections) {
    s.draw(cursor);
    cursor += s.h + gap;
  }

  // --- Footer (brand signature) ---
  if (data.watermark) {
    p.push(`<text x="${M}" y="${H - 28}" font-size="13" font-weight="500" fill="${T.watermark}">${esc(S.madeWith)} · ${esc(REPO)}</text>`);
  }

  p.push('</svg>');
  return p.join('\n');
}
