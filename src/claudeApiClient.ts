import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { HttpResponse, requestViaCurl, requestViaFetch } from './httpClient';
import { ClaudeApiUsageResponse, ClaudeCredentials } from './types';

// Fetches real 5-hour / weekly limit utilisation from Anthropic's OAuth usage
// endpoint, reusing the credentials Claude Code already stores. This mirrors
// what the `/usage` command shows. Approach adapted from upstream PR #9
// (jack21/ClaudeCodeUsage).
//
// HTTP strategy (added in 2.0): try Node's built-in `fetch` first — it's the
// simplest path and works wherever Anthropic accepts it. If `fetch` comes
// back with `403 "Request not allowed"`, fall back to the system `curl`
// binary, because Anthropic's edge fingerprints the TLS ClientHello
// (JA3/JA4) and currently rejects Node's openssl handshake while accepting
// curl's. `curl.exe` ships with Windows 10+ (2018) and is universally
// available on macOS / Linux. Every step is logged to the
// "Claude Code Usage" output channel for diagnosis. The transports
// themselves live in httpClient.ts (shared with the advice feature).

export class ClaudeApiClient {
  private readonly credentialsPath: string;
  private credentials: ClaudeCredentials | null = null;
  private credentialsSource: 'file' | 'keychain' | null = null;
  private rateLimitedUntil: number = 0;
  private out: vscode.OutputChannel | null;
  // Once curl has succeeded after fetch failed, remember so we don't keep
  // paying the cost of a doomed fetch attempt on every refresh.
  private preferCurl: boolean = false;

  constructor(out: vscode.OutputChannel | null = null) {
    this.credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    this.out = out;
  }

  private log(line: string): void {
    if (this.out) {
      const ts = new Date().toLocaleTimeString(undefined, { hour12: false });
      this.out.appendLine(`[${ts}] ${line}`);
    }
  }

  private async loadCredentials(): Promise<ClaudeCredentials | null> {
    try {
      if (!fs.existsSync(this.credentialsPath)) {
        this.log(`credentials: missing at ${this.credentialsPath}`);
        return this.loadCredentialsFromKeychain();
      }
      const content = await fs.promises.readFile(this.credentialsPath, 'utf-8');
      const parsed = JSON.parse(content) as ClaudeCredentials;
      if (!parsed || !parsed.claudeAiOauth || !parsed.claudeAiOauth.accessToken) {
        this.log('credentials: file present but no claudeAiOauth.accessToken');
        return null;
      }
      this.credentials = parsed;
      this.credentialsSource = 'file';
      return parsed;
    } catch (e) {
      this.log(`credentials: read failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Absolute path to the OAuth credentials file the client reads. Lets the
   * extension watch it and refetch quota immediately on an account switch (#45).
   * On macOS the credentials may instead live in the Keychain (no file to
   * watch); that case still updates on the next quota refresh tick. */
  getCredentialsPath(): string {
    return this.credentialsPath;
  }

  private loadCredentialsFromKeychain(): ClaudeCredentials | null {
    if (process.platform !== 'darwin') {
      return null;
    }
    try {
      const content = execFileSync('/usr/bin/security', [
        'find-generic-password',
        '-s',
        'Claude Code-credentials',
        '-w'
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const parsed = JSON.parse(content) as ClaudeCredentials;
      if (!parsed || !parsed.claudeAiOauth || !parsed.claudeAiOauth.accessToken) {
        this.log('credentials: keychain item present but no claudeAiOauth.accessToken');
        return null;
      }
      this.log('credentials: loaded from macOS Keychain');
      this.credentials = parsed;
      this.credentialsSource = 'keychain';
      return parsed;
    } catch (e) {
      this.log(`credentials: keychain read failed: ${(e as Error).message}`);
      return null;
    }
  }

  private async saveCredentials(credentials: ClaudeCredentials): Promise<void> {
    if (this.credentialsSource === 'keychain' && process.platform === 'darwin') {
      try {
        execFileSync('/usr/bin/security', [
          'add-generic-password',
          '-a',
          os.userInfo().username,
          '-s',
          'Claude Code-credentials',
          '-w',
          JSON.stringify(credentials),
          '-U'
        ], { stdio: ['ignore', 'ignore', 'pipe'] });
        this.credentials = credentials;
        this.log('credentials: refreshed in macOS Keychain');
        return;
      } catch (e) {
        this.log(`credentials: keychain write failed: ${(e as Error).message}`);
      }
    }
    await fs.promises.writeFile(this.credentialsPath, JSON.stringify(credentials), 'utf-8');
    this.credentials = credentials;
    this.credentialsSource = 'file';
  }

  private isTokenExpired(credentials: ClaudeCredentials): boolean {
    return Date.now() >= credentials.claudeAiOauth.expiresAt - 60 * 1000;
  }

  private async refreshAccessToken(credentials: ClaudeCredentials): Promise<ClaudeCredentials> {
    const r = await this.request('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: credentials.claudeAiOauth.refreshToken,
        grant_type: 'refresh_token'
      })
    });
    if (r.status !== 200) {
      throw new Error(`Token refresh failed: ${r.status}`);
    }
    const data = JSON.parse(r.body) as { access_token: string; expires_in: number };
    const updated: ClaudeCredentials = {
      ...credentials,
      claudeAiOauth: {
        ...credentials.claudeAiOauth,
        accessToken: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000
      }
    };
    await this.saveCredentials(updated);
    return updated;
  }

  private async getValidCredentials(): Promise<ClaudeCredentials | null> {
    // Re-read from disk/keychain on every call so switching Claude accounts is
    // honoured without a window reload. #45: a switched-in account has a *valid*
    // (non-expired) token, so the expiry-only re-read below never noticed it and
    // we kept serving the previous account's quota until the host restarted.
    // loadCredentials refreshes this.credentials; fall back to the cached copy
    // only if the fresh read transiently fails.
    let credentials = (await this.loadCredentials()) || this.credentials;
    if (!credentials) {
      return null;
    }
    if (this.isTokenExpired(credentials)) {
      // Claude Code refreshes ~/.claude/.credentials.json itself. Re-read from
      // disk FIRST — it has very likely already rotated the token — before
      // attempting our own refresh. Without this, a cached-in-memory expired
      // token would stick until the extension host restarts, which is exactly
      // why "quota only comes back after I restart VS Code" was happening.
      const fresh = await this.loadCredentials();
      if (fresh && !this.isTokenExpired(fresh)) {
        this.log('token: expired in memory, re-read a fresh one from disk');
        return fresh;
      }
      this.log('token: expired, refreshing');
      try {
        credentials = await this.refreshAccessToken(fresh || credentials);
      } catch (e) {
        this.log(`token: refresh failed: ${(e as Error).message}`);
        return null;
      }
    }
    return credentials;
  }

  /**
   * A valid OAuth access token (refreshed if needed), or null when not signed
   * in. Lets the advice/optimizer features reuse the user's Claude subscription
   * — `Authorization: Bearer <token>` + `anthropic-beta: oauth-2025-04-20` —
   * to call the Messages API with no separate API key (verified 2026-06-13).
   */
  async getAccessToken(): Promise<string | null> {
    const credentials = await this.getValidCredentials();
    return credentials?.claudeAiOauth?.accessToken ?? null;
  }

  /** Run an HTTP request via fetch, falling back to curl on TLS-fingerprint
   * rejection ("403 Request not allowed"). */
  private async request(
    url: string,
    opts: { method?: string; headers?: Record<string, string>; body?: string }
  ): Promise<HttpResponse> {
    if (!this.preferCurl) {
      try {
        const r = await requestViaFetch(url, opts);
        if (r.status === 403 && r.body.includes('Request not allowed')) {
          this.log(`fetch: 403 "Request not allowed" → falling back to curl (Anthropic TLS-fingerprint gate)`);
          this.preferCurl = true;
        } else {
          this.log(`fetch: ${r.status} ${url}`);
          return r;
        }
      } catch (e) {
        this.log(`fetch: error ${(e as Error).message} → trying curl`);
      }
    }
    const r = await requestViaCurl(url, opts, (line) => this.log(line));
    this.log(`curl:  ${r.status} ${url}`);
    return r;
  }

  private callUsageApi(accessToken: string): Promise<HttpResponse> {
    return this.request('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Fetch current usage limits. Returns null (no error) when the user is not
   * signed in, when rate-limited, when neither fetch nor curl can complete,
   * or when anything else goes wrong. All decisions are logged to the
   * "Claude Code Usage" output channel for diagnosis.
   */
  async fetchUsageLimits(): Promise<ClaudeApiUsageResponse | null> {
    if (Date.now() < this.rateLimitedUntil) {
      this.log(`skip: cooling down for ${Math.round((this.rateLimitedUntil - Date.now()) / 1000)}s after 429`);
      return null;
    }

    try {
      const credentials = await this.getValidCredentials();
      if (!credentials) {
        return null;
      }

      let response = await this.callUsageApi(credentials.claudeAiOauth.accessToken);

      if (response.status === 429) {
        // 60 s cool-down. The old flat 5-minute cool-down made a single 429
        // look like the indicator had broken (only a restart appeared to fix
        // it). Paired with the gentler fetch cadence below, 429s should be
        // rare and short-lived.
        this.rateLimitedUntil = Date.now() + 60 * 1000;
        this.log('429: rate-limited, cooling down 60s');
        return null;
      }

      // One retry after a forced token refresh on 401.
      if (response.status === 401) {
        this.log('401: forcing token refresh and retrying once');
        try {
          const refreshed = await this.refreshAccessToken(credentials);
          response = await this.callUsageApi(refreshed.claudeAiOauth.accessToken);
        } catch (e) {
          this.log(`401 retry: refresh failed: ${(e as Error).message}`);
          return null;
        }
      }

      if (response.status !== 200) {
        this.log(`usage: non-200 (${response.status}); body head: ${response.body.slice(0, 200)}`);
        return null;
      }
      const data = JSON.parse(response.body) as ClaudeApiUsageResponse;
      this.log(`usage: ok — 5h=${data.five_hour?.utilization ?? 'n/a'}%, wk=${data.seven_day?.utilization ?? 'n/a'}%`);
      return data;
    } catch (e) {
      this.log(`usage: exception: ${(e as Error).message}`);
      return null;
    }
  }
}
