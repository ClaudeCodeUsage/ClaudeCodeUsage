import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

export interface CodexVolumeIdentity {
  readonly dev: number;
  readonly key: string;
}

export type CodexVolumeIdentityResolver = (
  allowedRoot: string,
  machineSalt: string,
) => Promise<CodexVolumeIdentity | undefined>;

interface RootStat {
  dev: number;
  ino: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

interface InspectionOptions {
  encoding: 'utf8';
  timeout: number;
  maxBuffer: number;
  killSignal: 'SIGKILL';
}

/** Injection is for synthetic tests; the production adapter never invokes a shell. */
export interface CodexVolumeIdentityDependencies {
  platform: NodeJS.Platform;
  now(): number;
  lstat(root: string): Promise<RootStat>;
  execFile(file: string, args: readonly string[], options: InspectionOptions): Promise<string>;
}

export const CODEX_VOLUME_IDENTITY_LIMITS = Object.freeze({
  timeoutMs: 3_000,
  maxXmlBytes: 64 * 1024,
  maxCommandBytes: 64 * 1024,
  maxCacheEntries: 64,
  cacheTtlMs: 60_000,
  failureTtlMs: 10_000,
});

export function isCodexVolumeKey(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
}

function validRoot(stat: RootStat): boolean {
  return !stat.isSymbolicLink() && stat.isDirectory() &&
    Number.isSafeInteger(stat.dev) && stat.dev > 0 &&
    Number.isSafeInteger(stat.ino) && stat.ino > 0;
}

/** POSIX df has one header and one data line for exactly one inspected path.
 * Admit only the first data token, never the mount name or an arbitrary path. */
function volumeDevice(output: string): string | undefined {
  if (Buffer.byteLength(output, 'utf8') > CODEX_VOLUME_IDENTITY_LIMITS.maxCommandBytes) return undefined;
  const lines = output.trimEnd().split(/\r?\n/);
  if (lines.length !== 2 || !/^Filesystem[ \t]/.test(lines[0])) return undefined;
  const device = /^[ \t]*([^ \t\r\n]+)[ \t]+/.exec(lines[1])?.[1];
  return device && device.length <= 256 && /^\/dev\/disk[0-9]+(?:s[0-9]+)*$/.test(device)
    ? device : undefined;
}

/** Read a plist structurally without building an object of private disk fields.
 * Only one top-level VolumeUUID string is admitted. No entity expansion, CDATA,
 * custom DTD, nested identity, or malformed/duplicate dictionary identity works. */
function volumeUuid(xml: string): string | undefined {
  if (Buffer.byteLength(xml, 'utf8') > CODEX_VOLUME_IDENTITY_LIMITS.maxXmlBytes) return undefined;
  let source = xml.trim();
  source = source.replace(/^<\?xml version="1\.0"(?: encoding="UTF-8")?\?>\s*/, '');
  source = source.replace(/^<!DOCTYPE plist PUBLIC "-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN" "http:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd">\s*/, '');
  const stack: Array<{ tag: string; expectsKey: boolean; uuidValue: boolean; children: number }> = [];
  let position = 0;
  let complete = false;
  let uuid: string | undefined;
  let uuidKeys = 0;
  while (position < source.length) {
    if (source.startsWith('<!--', position)) {
      const end = source.indexOf('-->', position + 4);
      if (end < 0 || source.slice(position + 4, end).includes('--')) return undefined;
      position = end + 3;
      continue;
    }
    if (source[position] !== '<') {
      const end = source.indexOf('<', position);
      const text = source.slice(position, end < 0 ? source.length : end);
      // Scalar contents are consumed atomically below. Everything else is whitespace.
      if (text.trim()) return undefined;
      position = end < 0 ? source.length : end;
      continue;
    }
    const end = source.indexOf('>', position);
    if (end < 0) return undefined;
    const token = source.slice(position, end + 1);
    position = end + 1;
    const close = /^<\/(plist|dict|array)>$/.exec(token);
    if (close) {
      const frame = stack.pop();
      if (!frame || frame.tag !== close[1] ||
          (frame.tag === 'dict' && !frame.expectsKey) ||
          (frame.tag === 'plist' && frame.children !== 1)) return undefined;
      if (!stack.length) complete = true;
      continue;
    }
    if (complete) return undefined;
    if (!stack.length) {
      if (token !== '<plist version="1.0">') return undefined;
      stack.push({ tag: 'plist', expectsKey: false, uuidValue: false, children: 0 });
      continue;
    }
    const parent = stack[stack.length - 1];
    const open = /^<(dict|array|key|string|integer|real|date|data|true|false)(\s*\/?)>$/.exec(token);
    if (!open) return undefined;
    const tag = open[1];
    const empty = open[2].includes('/');
    if (parent.tag === 'plist' && (tag !== 'dict' || parent.children !== 0)) return undefined;
    if (parent.tag === 'dict' && (parent.expectsKey !== (tag === 'key'))) return undefined;
    if (parent.tag === 'array' && tag === 'key') return undefined;
    const isUuidValue = parent.uuidValue;
    if (tag !== 'key') {
      parent.children++;
      if (parent.tag === 'dict') parent.expectsKey = true;
      parent.uuidValue = false;
    }
    if (tag === 'dict' || tag === 'array') {
      if (isUuidValue) return undefined;
      if (!empty) stack.push({ tag, expectsKey: tag === 'dict', uuidValue: false, children: 0 });
      continue;
    }
    let text = '';
    if (!empty) {
      const scalarEnd = source.indexOf(`</${tag}>`, position);
      if (scalarEnd < 0) return undefined;
      text = source.slice(position, scalarEnd);
      if (text.includes('<')) return undefined;
      position = scalarEnd + tag.length + 3;
    }
    if (tag === 'key') {
      parent.expectsKey = false;
      parent.uuidValue = text === 'VolumeUUID';
      if (parent.uuidValue && (++uuidKeys !== 1 || stack.length !== 2)) return undefined;
    } else if (isUuidValue) {
      if (tag !== 'string' || text.length !== 36 ||
          !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(text)) return undefined;
      uuid = text.toLowerCase();
    }
  }
  return complete && stack.length === 0 && uuidKeys === 1 ? uuid : undefined;
}

const defaultDependencies: CodexVolumeIdentityDependencies = {
  platform: process.platform,
  now: () => performance.now(),
  lstat,
  execFile: (file, args, options) => new Promise((resolve, reject) => {
    execFile(file, [...args], options, (error, stdout) => error ? reject(error) : resolve(stdout));
  }),
};

/** Runtime-only bounded cache. Failures never escape with process output or paths.
 * Each lookup lstats the exact allowlisted root, including on cache hits. */
export function createCodexVolumeIdentityResolver(
  dependencies: Partial<CodexVolumeIdentityDependencies> = {},
): CodexVolumeIdentityResolver {
  const io = { ...defaultDependencies, ...dependencies };
  const cache = new Map<string, {
    pending: boolean;
    expiresAt: number;
    result: Promise<CodexVolumeIdentity | undefined>;
  }>();
  return async (allowedRoot, machineSalt) => {
    try {
      if (io.platform !== 'darwin' || !machineSalt || !path.isAbsolute(allowedRoot) ||
          path.resolve(allowedRoot) !== allowedRoot ||
          !['sessions', 'archived_sessions'].includes(path.basename(allowedRoot))) return undefined;
      const before = await io.lstat(allowedRoot);
      if (!validRoot(before)) return undefined;
      const saltKey = createHmac('sha256', machineSalt).update('volume-cache-v1').digest('hex');
      const cacheKey = JSON.stringify([allowedRoot, before.dev, before.ino, saltKey]);
      const now = io.now();
      const cached = cache.get(cacheKey);
      if (cached && (cached.pending || cached.expiresAt > now)) return await cached.result;
      cache.delete(cacheKey);
      if (cache.size >= CODEX_VOLUME_IDENTITY_LIMITS.maxCacheEntries) {
        const evict = [...cache].find(([, entry]) => !entry.pending);
        // Do not evict pending inspections and admit unbounded subprocess work.
        if (!evict) return undefined;
        cache.delete(evict[0]);
      }
      const entry = { pending: true, expiresAt: 0, result: Promise.resolve<CodexVolumeIdentity | undefined>(undefined) };
      entry.result = (async () => {
        try {
          // Both child processes share one monotonic deadline, including parsing
          // and scheduling between them. Diskutil does not accept descendant paths.
          const started = io.now();
          const remaining = () => Math.floor(CODEX_VOLUME_IDENTITY_LIMITS.timeoutMs -
            Math.max(0, io.now() - started));
          const run = async (file: string, args: readonly string[]): Promise<string> => {
            const timeout = remaining();
            if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('inspection-timeout');
            const output = await io.execFile(file, args, {
              encoding: 'utf8', timeout, maxBuffer: CODEX_VOLUME_IDENTITY_LIMITS.maxCommandBytes,
              killSignal: 'SIGKILL',
            });
            if (remaining() <= 0 ||
                Buffer.byteLength(output, 'utf8') > CODEX_VOLUME_IDENTITY_LIMITS.maxCommandBytes) {
              throw new Error('inspection-limit');
            }
            return output;
          };
          const device = volumeDevice(await run('/bin/df', ['-P', allowedRoot]));
          if (!device) return undefined;
          const xml = await run('/usr/sbin/diskutil', ['info', '-plist', device]);
          const uuid = volumeUuid(xml);
          if (!uuid) return undefined;
          const after = await io.lstat(allowedRoot);
          if (remaining() <= 0 || !validRoot(after) || before.dev !== after.dev || before.ino !== after.ino) return undefined;
          return Object.freeze({
            dev: before.dev,
            key: createHmac('sha256', machineSalt).update('volume-v1\0').update(uuid).digest('hex'),
          });
        } catch {
          return undefined;
        }
      })().then(result => {
        entry.pending = false;
        entry.expiresAt = io.now() + (result ? CODEX_VOLUME_IDENTITY_LIMITS.cacheTtlMs : CODEX_VOLUME_IDENTITY_LIMITS.failureTtlMs);
        return result;
      });
      cache.set(cacheKey, entry);
      return await entry.result;
    } catch {
      return undefined;
    }
  };
}

export const resolveCodexVolumeIdentity: CodexVolumeIdentityResolver = createCodexVolumeIdentityResolver();
