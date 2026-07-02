// Usage Share Card (用量卡片) — pure, dependency-free logic for the V2.2 export
// feature. The DOM rendering + PNG export live in the webview; everything that
// must be *correct* and *private* lives here so it can be unit-tested.
//
// Privacy is enforced structurally: ShareCardData only ever carries aggregate,
// non-identifying fields. It never has room for prompt text, file paths, session
// ids, usernames, or absolute directories — so they cannot leak by accident.

import { UsageData } from './types';

export type ShareRange = 'today' | 'week' | 'month';

/** What the user can toggle in the preview. Defaults follow the V2.2 spec:
 * the privacy-safe metrics are on; project name / workflow share / peak context
 * / detailed composition are off. */
export interface ShareSections {
  totalTokens: boolean;
  estimatedCost: boolean;
  sessions: boolean;
  topModel: boolean;
  cacheEfficiency: boolean;
  rhythm: boolean;
  badge: boolean;
  watermark: boolean;
  // default OFF
  projectName: boolean;
  workflowShare: boolean;
  peakContext: boolean;
  tokenComposition: boolean;
}

export const DEFAULT_SECTIONS: ShareSections = {
  totalTokens: true,
  estimatedCost: true,
  sessions: true,
  topModel: true,
  cacheEfficiency: true,
  rhythm: true,
  badge: true,
  watermark: true,
  projectName: false,
  workflowShare: false,
  peakContext: false,
  tokenComposition: false,
};

/** Aggregate inputs for a range — all already computed by dataLoader (no raw
 * records, no identifying strings beyond an optional project NAME). */
export interface ShareInput {
  range: ShareRange;
  rangeData: UsageData;
  daily: number[]; // per-day token totals across the range (rhythm / heat strip)
  sessionCount: number;
  topModel?: string; // raw model id; reduced to a family before export
  workflowShare?: number; // 0..1
  peakContextTokens?: number;
  projectName?: string; // redacted unless sections.projectName
  now?: number; // for the date label / filename (defaults to Date.now())
}

/** Render-ready, already-redacted card data. Absent fields = hidden. */
export interface ShareCardData {
  range: ShareRange;
  totalTokens?: number;
  estimatedCost?: number;
  sessions?: number;
  topModelFamily?: string;
  topModelName?: string; // pretty full name, e.g. "Opus 4.8" (Carl: show the model, not just "Opus")
  cacheSharePct?: number;
  rhythm?: number[];
  // Token composition (the four billed token types) — off by default.
  composition?: { input: number; output: number; cacheCreate: number; cacheRead: number };
  badge?: { id: string; label: string };
  workflowSharePct?: number;
  peakContextTokens?: number;
  projectName?: string;
  watermark: boolean;
}

/** Total tokens across the four buckets. */
export function totalTokens(u: UsageData): number {
  return (
    u.totalInputTokens + u.totalOutputTokens + u.totalCacheCreationTokens + u.totalCacheReadTokens
  );
}

/** Cache read as a share of the input side (read / (input + write + read)), 0–100. */
export function cacheSharePct(u: UsageData): number {
  const inputSide = u.totalInputTokens + u.totalCacheCreationTokens + u.totalCacheReadTokens;
  return inputSide > 0 ? Math.round((u.totalCacheReadTokens / inputSide) * 100) : 0;
}

/** A pretty full model name from a raw id, e.g. "claude-opus-4-8" → "Opus 4.8",
 * "claude-fable-5" → "Fable 5". Third-party ids are kept verbatim. */
export function prettyModelName(model: string | undefined): string | undefined {
  if (!model) {
    return undefined;
  }
  const s = model.toLowerCase();
  const fam = (s.match(/opus|sonnet|haiku|fable|mythos/) || [])[0];
  if (!fam) {
    return model;
  }
  const pair = s.match(/(\d+)[-.](\d+)/);
  const single = s.match(/-(\d+)(?!\d)/);
  const ver = pair ? `${pair[1]}.${pair[2]}` : single ? single[1] : '';
  const Fam = fam[0].toUpperCase() + fam.slice(1);
  return ver ? `${Fam} ${ver}` : Fam;
}

/** Reduce a model id to a family name (no version exposed); third-party kept. */
export function modelFamily(model: string | undefined): string | undefined {
  if (!model) {
    return undefined;
  }
  const s = model.toLowerCase();
  if (/fable|mythos/.test(s)) {
    return 'Fable';
  }
  if (/opus/.test(s)) {
    return 'Opus';
  }
  if (/sonnet/.test(s)) {
    return 'Sonnet';
  }
  if (/haiku/.test(s)) {
    return 'Haiku';
  }
  return model;
}

/** Deterministic, local, rule-based badge. First match wins, most distinctive
 * first; Steady Builder is the always-valid fallback. */
export function selectShareBadge(input: ShareInput): { id: string; label: string } {
  const tokens = totalTokens(input.rangeData);
  const cache = cacheSharePct(input.rangeData);
  const peak = input.peakContextTokens ?? 0;
  const maxDay = input.daily.length ? Math.max(...input.daily) : 0;
  const activeDays = input.daily.filter((d) => d > 0).length;

  if (peak >= 500_000) {
    return { id: 'context-marathoner', label: 'Context Marathoner' };
  }
  if (cache >= 60) {
    return { id: 'cache-saver', label: 'Cache Saver' };
  }
  if (maxDay >= 5_000_000) {
    return { id: 'token-sprinter', label: 'Token Sprinter' };
  }
  if (input.sessionCount >= 30) {
    return { id: 'workflow-pilot', label: 'Workflow Pilot' };
  }
  // Balanced across several active days (no single day dominates) → steady.
  if (activeDays >= 4 && maxDay > 0 && maxDay <= tokens * 0.5) {
    return { id: 'steady-builder', label: 'Steady Builder' };
  }
  return { id: 'steady-builder', label: 'Steady Builder' };
}

/** Build the redacted, render-ready card data from aggregate inputs + the chosen
 * sections. Anything off (or privacy-gated) is simply omitted. */
export function buildShareCardData(input: ShareInput, sections: ShareSections): ShareCardData {
  const u = input.rangeData;
  const out: ShareCardData = { range: input.range, watermark: sections.watermark };
  if (sections.totalTokens) {
    out.totalTokens = totalTokens(u);
  }
  if (sections.estimatedCost) {
    out.estimatedCost = u.totalCost;
  }
  if (sections.sessions) {
    out.sessions = input.sessionCount;
  }
  if (sections.topModel) {
    out.topModelFamily = modelFamily(input.topModel);
    out.topModelName = prettyModelName(input.topModel);
  }
  if (sections.cacheEfficiency) {
    out.cacheSharePct = cacheSharePct(u);
  }
  if (sections.rhythm) {
    out.rhythm = input.daily.slice();
  }
  if (sections.tokenComposition) {
    out.composition = {
      input: u.totalInputTokens,
      output: u.totalOutputTokens,
      cacheCreate: u.totalCacheCreationTokens,
      cacheRead: u.totalCacheReadTokens,
    };
  }
  if (sections.badge) {
    out.badge = selectShareBadge(input);
  }
  // Default-off / privacy-gated fields.
  if (sections.workflowShare && typeof input.workflowShare === 'number') {
    out.workflowSharePct = Math.round(input.workflowShare * 100);
  }
  if (sections.peakContext && typeof input.peakContextTokens === 'number') {
    out.peakContextTokens = input.peakContextTokens;
  }
  if (sections.projectName && input.projectName) {
    out.projectName = input.projectName;
  }
  return out;
}

/** Default export file name, e.g. "claude-code-usage-2026-06-week.png". */
export function shareCardFilename(range: ShareRange, date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const stamp = range === 'today' ? `${y}-${m}-${d}-day` : `${y}-${m}-${range}`;
  return `claude-code-usage-${stamp}.png`;
}
