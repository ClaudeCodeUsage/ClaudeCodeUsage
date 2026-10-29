import { execFileSync } from 'child_process';
import { createHmac } from 'node:crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { HttpResponse, requestViaCurl, requestViaFetch } from './httpClient';
import { ClaudeApiUsageResponse, ClaudeCredentials } from './types';

// Public native-client identifier, not a credential or client secret.
const CLAUDE_CODE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export interface ResolvedClaudeProfile {
  configDirectory: string;
  credentialsPath: string;
  source: 'explicit' | 'environment' | 'default';
  allowKeychainFallback: boolean;
}

export function claudeQuotaIdentitySignal(
  machineSalt: string,
  refreshToken: string,
): string {
  return createHmac('sha256', machineSalt)
    .update(`claude-quota-account-v1|${refreshToken}`)
    .digest('hex');
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve the Claude profile represented by this editor window. An explicit
 * dataDirectory wins even when its credentials file is currently absent: the
 * quota must become unavailable rather than silently switching accounts. */
export function resolveClaudeProfile(
  dataDirectory?: string | null,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = os.homedir(),
  directoryExists: (candidate: string) => boolean = isDirectory,
): ResolvedClaudeProfile {
  const defaultDirectory = path.resolve(homeDirectory, '.claude');
  const explicit = dataDirectory?.trim();
  let configDirectory: string;
  let source: ResolvedClaudeProfile['source'];

  if (explicit) {
    configDirectory = path.resolve(explicit);
    source = 'explicit';
  } else {
    const environmentDirectory = (env.CLAUDE_CONFIG_DIR ?? '')
      .split(',')
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate !== '')
      .map((candidate) => path.resolve(candidate))
      .find(directoryExists);
    configDirectory = environmentDirectory ?? defaultDirectory;
    source = environmentDirectory ? 'environment' : 'default';
  }

  return {
    configDirectory,
    credentialsPath: path.join(configDirectory, '.credentials.json'),
    source,
    // Claude Code exposes one global macOS Keychain item. It is safe only for
    // the default profile; using it for a custom profile can show and refresh
    // a different account's credentials (#89).
    allowKeychainFallback: configDirectory === defaultDirectory,
  };
}

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
  private readonly allowKeychainFallback: boolean;
  private credentials: ClaudeCredentials | null = null;
  private credentialsSource: 'file' | 'keychain' | null = null;
  private rateLimitedUntil: number = 0;
  private out: vscode.OutputChannel | null;
  // Once curl has succeeded after fetch failed, remember so we don't keep
  // paying the cost of a doomed fetch attempt on every refresh.
  private preferCurl: boolean = false;
  private lastQuotaIdentitySignal: string | null = null;

  constructor(
    out: vscode.OutputChannel | null = null,
    dataDirectory?: string | null,
    private readonly quotaIdentitySalt?: string,
  ) {
    const profile = resolveClaudeProfile(dataDirectory);
    this.credentialsPath = profile.credentialsPath;
    this.allowKeychainFallback = profile.allowKeychainFallback;
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
        return this.allowKeychainFallback
          ? this.loadCredentialsFromKeychain()
          : null;
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

  /** The getLastQuotaIdentitySignal() derivation for the credentials this
   * profile currently holds, so another window's verified observation can be
   * matched before this window has a successful request of its own. It uses
   * the same credential read as the request path and never refreshes a token
   * or sends a request. */
  async currentQuotaIdentitySignal(): Promise<string | null> {
    if (!this.quotaIdentitySalt) return null;
    const refreshToken = (await this.loadCredentials())?.claudeAiOauth?.refreshToken;
    return typeof refreshToken === 'string' && refreshToken.length > 0
      ? claudeQuotaIdentitySignal(this.quotaIdentitySalt, refreshToken)
      : null;
  }

  /** Machine-local one-way continuity signal for the exact credentials used
   * by the last successful quota request. No token or account identifier is
   * returned to the extension host. */
  getLastQuotaIdentitySignal(): string | null {
    return this.lastQuotaIdentitySignal;
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

  private async saveCredentials(
    credentials: ClaudeCredentials,
    source: 'file' | 'keychain' | null = this.credentialsSource,
  ): Promise<void> {
    if (source === 'keychain' && process.platform === 'darwin') {
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
        this.credentialsSource = 'keychain';
        this.log('credentials: refreshed in macOS Keychain');
        return;
      } catch {
        // exec errors can contain the command arguments, including credentials.
        // A failed Keychain write must not spill its payload into a profile file.
        throw new Error('Credential refresh could not be saved to macOS Keychain');
      }
    }
    await fs.promises.writeFile(this.credentialsPath, JSON.stringify(credentials), 'utf-8');
    this.credentials = credentials;
    this.credentialsSource = 'file';
  }

  private isTokenExpired(credentials: ClaudeCredentials): boolean {
    return Date.now() >= credentials.claudeAiOauth.expiresAt - 60 * 1000;
  }

  private async refreshAccessToken(
    credentials: ClaudeCredentials,
    signal?: AbortSignal,
  ): Promise<ClaudeCredentials> {
    if (signal?.aborted) throw new Error('Request cancelled');
    const source = this.credentialsSource;
    const r = await this.request('https://platform.claude.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: credentials.claudeAiOauth.refreshToken,
        grant_type: 'refresh_token',
        client_id: CLAUDE_CODE_OAUTH_CLIENT_ID,
      }),
      signal,
    });
    if (signal?.aborted) throw new Error('Request cancelled');
    if (r.status !== 200) {
      throw new Error(`Token refresh failed: ${r.status}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.body);
    } catch {
      // JSON parser messages may echo response text containing credentials.
      throw new Error('Invalid token refresh response');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid token refresh response');
    }
    const data = parsed as Record<string, unknown>;
    if (
      typeof data.access_token !== 'string' || !data.access_token.trim() ||
      typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token.trim())) ||
      (data.scope !== undefined && typeof data.scope !== 'string')
    ) {
      throw new Error('Invalid token refresh response');
    }
    const expiresAt = Date.now() + data.expires_in * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt > 8.64e15) {
      throw new Error('Invalid token refresh response');
    }
    const updated: ClaudeCredentials = {
      ...credentials,
      claudeAiOauth: {
        ...credentials.claudeAiOauth,
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string'
          ? data.refresh_token : credentials.claudeAiOauth.refreshToken,
        ...(typeof data.scope === 'string'
          ? { scopes: data.scope.trim().split(/\s+/).filter(Boolean) } : {}),
        expiresAt,
      }
    };
    if (signal?.aborted) throw new Error('Request cancelled');
    await this.saveCredentials(updated, source);
    return updated;
  }

  private async getValidCredentials(signal?: AbortSignal): Promise<ClaudeCredentials | null> {
    if (signal?.aborted) throw new Error('Request cancelled');
    // Re-read from disk/keychain on every call so switching Claude accounts is
    // honoured without a window reload. #45: a switched-in account has a *valid*
    // (non-expired) token, so the expiry-only re-read below never noticed it and
    // we kept serving the previous account's quota until the host restarted.
    // loadCredentials refreshes this.credentials; fall back to the cached copy
    // only if the fresh read transiently fails.
    let credentials = (await this.loadCredentials()) || this.credentials;
    if (signal?.aborted) throw new Error('Request cancelled');
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
        credentials = await this.refreshAccessToken(fresh || credentials, signal);
      } catch (e) {
        this.log(`token: refresh failed: ${(e as Error).message}`);
        return null;
      }
    }
    return credentials;
  }

  /**
   * A valid OAuth access token (refreshed if needed), or null when not signed
   * in. This credential is used for Claude Code account/quota APIs. It is not a
   * default AI-advice backend; the old keyless Messages prototype is dormant
   * after 403 responses and production advice remains user-configured BYOK.
   */
  async getAccessToken(): Promise<string | null> {
    const credentials = await this.getValidCredentials();
    return credentials?.claudeAiOauth?.accessToken ?? null;
  }

  /** Run an HTTP request via fetch, falling back to curl on TLS-fingerprint
   * rejection ("403 Request not allowed"). */
  private async request(
    url: string,
    opts: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    }
  ): Promise<HttpResponse> {
    if (opts.signal?.aborted) throw new Error('Request cancelled');
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
        if (opts.signal?.aborted) throw new Error('Request cancelled');
        this.log(`fetch: error ${(e as Error).message} → trying curl`);
      }
    }
    if (opts.signal?.aborted) throw new Error('Request cancelled');
    const r = await requestViaCurl(url, opts, (line) => this.log(line));
    this.log(`curl:  ${r.status} ${url}`);
    return r;
  }

  private callUsageApi(accessToken: string, signal?: AbortSignal): Promise<HttpResponse> {
    return this.request('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json'
      },
      signal,
    });
  }

  /**
   * Fetch current usage limits. Returns null (no error) when the user is not
   * signed in, when rate-limited, when neither fetch nor curl can complete,
   * or when anything else goes wrong. All decisions are logged to the
   * "Claude Code Usage" output channel for diagnosis.
   */
  async fetchUsageLimits(signal?: AbortSignal): Promise<ClaudeApiUsageResponse | null> {
    if (signal?.aborted) return null;
    if (Date.now() < this.rateLimitedUntil) {
      this.log(`skip: cooling down for ${Math.round((this.rateLimitedUntil - Date.now()) / 1000)}s after 429`);
      return null;
    }

    try {
      let credentials = await this.getValidCredentials(signal);
      if (!credentials) {
        return null;
      }

      if (signal?.aborted) return null;
      let response = await this.callUsageApi(
        credentials.claudeAiOauth.accessToken,
        signal,
      );

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
          const refreshed = await this.refreshAccessToken(credentials, signal);
          credentials = refreshed;
          response = await this.callUsageApi(
            refreshed.claudeAiOauth.accessToken,
            signal,
          );
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
      this.lastQuotaIdentitySignal = this.quotaIdentitySalt
        ? claudeQuotaIdentitySignal(
            this.quotaIdentitySalt,
            credentials.claudeAiOauth.refreshToken,
          )
        : null;
      this.log(`usage: ok — 5h=${data.five_hour?.utilization ?? 'n/a'}%, wk=${data.seven_day?.utilization ?? 'n/a'}%`);
      return data;
    } catch (e) {
      this.log(`usage: exception: ${(e as Error).message}`);
      return null;
    }
  }
}
