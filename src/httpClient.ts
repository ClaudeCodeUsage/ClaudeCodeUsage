import { spawn } from 'child_process';
import * as os from 'os';

// Shared HTTP transport helpers. Node's fetch is the default path; curl is
// the fallback for two failure classes seen in the wild:
//  - Anthropic's edge rejects Node's TLS ClientHello fingerprint (quota API);
//  - flaky networks where Node fetch dies with "terminated" while curl,
//    with its own retry/timeout semantics, completes (advice API).
// curl.exe ships with Windows 10+ and is universally available on
// macOS / Linux.

export interface HttpResponse {
  status: number;
  body: string;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Run an HTTP request via Node fetch. Optional timeoutMs aborts the request
 * and surfaces a clear "timed out" error instead of hanging forever. */
export async function requestViaFetch(
  url: string,
  opts: HttpRequestOptions & { timeoutMs?: number }
): Promise<HttpResponse> {
  if (typeof fetch === 'undefined') {
    throw new Error('fetch unavailable in this VS Code version');
  }
  let signal: AbortSignal | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    signal = controller.signal;
  }
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.headers,
      body: opts.body,
      signal
    });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round((opts.timeoutMs || 0) / 1000)}s`);
    }
    throw e;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** Run an HTTP request via the system curl binary. */
export function requestViaCurl(
  url: string,
  opts: HttpRequestOptions & { timeoutSec?: number },
  log?: (line: string) => void
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const args: string[] = ['-sS', '-w', '\n__CCU_STATUS__%{http_code}', '--max-time', String(opts.timeoutSec ?? 15)];
    if (opts.method && opts.method !== 'GET') {
      args.push('-X', opts.method);
    }
    for (const [k, v] of Object.entries(opts.headers || {})) {
      args.push('-H', `${k}: ${v}`);
    }
    if (opts.body !== undefined) {
      args.push('--data-binary', '@-');
    }
    args.push(url);

    // On Windows be explicit about the .exe extension so spawn doesn't
    // depend on PATHEXT resolution; on POSIX 'curl' is correct.
    const cmd = process.platform === 'win32' ? 'curl.exe' : 'curl';
    // Pin cwd to the home dir. The extension host inherits its cwd from VS Code,
    // and after switching folders in the SAME window that inherited cwd can point
    // at a directory that no longer exists — spawn then fails with ENOENT and the
    // quota silently stops loading (while a fresh window, with a valid cwd, works
    // fine). curl needs no particular cwd, so anchor it somewhere always valid.
    const child = spawn(cmd, args, { shell: false, windowsHide: true, cwd: os.homedir() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf-8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf-8')));
    child.on('error', (e) => {
      if (log) {
        log(`curl: spawn error ${(e as Error).message} (is curl on PATH?)`);
      }
      reject(e);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`curl exit ${code}: ${stderr.trim().slice(0, 200)}`));
      }
      const m = stdout.match(/^([\s\S]*)\n__CCU_STATUS__(\d{3})$/);
      if (!m) {
        return reject(new Error(`Could not parse curl output: ${stdout.slice(0, 200)}`));
      }
      resolve({ status: parseInt(m[2], 10), body: m[1] });
    });
    if (opts.body !== undefined) {
      child.stdin.end(opts.body);
    } else {
      child.stdin.end();
    }
  });
}
