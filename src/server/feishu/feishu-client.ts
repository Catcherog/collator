import { createHash } from 'crypto';
import { FeishuApiError } from './feishu-errors.js';

/**
 * OpenAPI base URL. Overridable in constructor for testing.
 */
const DEFAULT_API_BASE = 'https://open.feishu.cn';

/**
 * Feishu OpenAPI business error code that signals an invalid or expired
 * tenant_access_token. The API typically returns this in the response body
 * (HTTP 200) instead of an HTTP 401, so we must inspect the parsed envelope.
 *
 * Official signal: code=99991663 ("invalid access token" / "token expired").
 */
const TOKEN_INVALID_CODE = 99991663;

/**
 * Produce a stable UUIDv4-shaped operation token from a logical operation
 * key. Feishu validates the UUID version/variant bits and uses the token to
 * make record creation idempotent. The token contains no source data.
 */
export function createStableClientToken(operationKey: string): string {
  const bytes = Buffer.from(createHash('sha256').update(operationKey).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface FeishuClientOptions {
  appId: string;
  appSecret: string;
  baseToken: string;
  /**
   * Optional injected fetch implementation. Defaults to the global `fetch`
   * (Node.js 20+). Unit tests pass a mock here to avoid real network access.
   */
  fetchFn?: typeof fetch;
  /**
   * Optional API base URL override (for tests).
   */
  apiBase?: string;
}

export interface FeishuRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

export interface SearchFilter {
  conjunction: 'and' | 'or';
  conditions: Array<{
    field_name: string;
    operator: string;
    value: unknown[];
  }>;
}

export interface SearchOptions {
  filter?: SearchFilter;
  page_size?: number;
  page_token?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

/**
 * Minimal Feishu OpenAPI client built on Node.js 20 native `fetch`.
 *
 * - tenant_access_token is acquired lazily and cached until shortly before
 *   `expire` elapses.
 * - On HTTP 401 from a Base record call the token is refreshed exactly once
 *   and the request is retried. Further failures surface as FeishuApiError.
 * - All errors are wrapped in FeishuApiError with phone-number redaction and
 *   no app_secret leakage.
 */
export class FeishuClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseToken: string;
  private readonly apiBase: string;
  private fetchFn: typeof fetch;
  private tokenCache: TokenCache | null = null;

  constructor(opts: FeishuClientOptions) {
    this.appId = opts.appId;
    this.appSecret = opts.appSecret;
    this.baseToken = opts.baseToken;
    this.apiBase = opts.apiBase ?? DEFAULT_API_BASE;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  /**
   * Injectable fetch setter, primarily for unit tests.
   */
  setFetchFn(fetchFn: typeof fetch): void {
    this.fetchFn = fetchFn;
    this.tokenCache = null;
  }

  /**
   * Acquire (and cache) a tenant_access_token. Refreshes when the cached
   * token is past or near its expiry.
   */
  async getTenantAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }
    const url = `${this.apiBase}/open-apis/auth/v3/tenant_access_token/internal`;
    const body = JSON.stringify({ app_id: this.appId, app_secret: this.appSecret });
    const resp = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
    });
    const json = (await resp.json()) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };
    if (typeof json.code !== 'number' || json.code !== 0 || !json.tenant_access_token) {
      throw new FeishuApiError(
        typeof json.code === 'number' ? json.code : -1,
        `Failed to acquire tenant_access_token: ${json.msg ?? 'unknown error'}`
      );
    }
    // Treat expire (seconds) conservatively: refresh 60s before actual expiry.
    const expireSec = typeof json.expire === 'number' ? json.expire : 7200;
    const expiresAt = Date.now() + Math.max(0, expireSec - 60) * 1000;
    this.tokenCache = { token: json.tenant_access_token, expiresAt };
    return this.tokenCache.token;
  }

  /**
   * Force-refresh the cached token. Used on 401.
   */
  private async refreshToken(): Promise<string> {
    this.tokenCache = null;
    return this.getTenantAccessToken();
  }

  async createRecord(
    tableId: string,
    fields: Record<string, unknown>,
    clientToken?: string
  ): Promise<string> {
    const query = clientToken
      ? `?client_token=${encodeURIComponent(clientToken)}`
      : '';
    const data = await this.callWithRetry<{ record: { record_id: string } }>(
      'POST',
      `/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records${query}`,
      { fields }
    );
    return data.record.record_id;
  }

  async getRecord(tableId: string, recordId: string): Promise<FeishuRecord> {
    // Explicitly request text fields as plain strings rather than
    // `[{ text: "..." }]` arrays. The Repository adapters still defend
    // against both shapes, but setting this flag reduces response-size
    // variance and makes the default behaviour deterministic.
    // See TASK-003-GATE-D-TEXT-NORMALIZATION AC-06.
    const data = await this.callWithRetry<{ record: FeishuRecord }>(
      'GET',
      `/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records/${recordId}?text_field_as_array=false`
    );
    return data.record;
  }

  async updateRecord(
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ): Promise<FeishuRecord> {
    const data = await this.callWithRetry<{ record: FeishuRecord }>(
      'PUT',
      `/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records/${recordId}`,
      { fields }
    );
    return data.record;
  }

  async deleteRecord(tableId: string, recordId: string): Promise<void> {
    await this.callWithRetry<unknown>(
      'DELETE',
      `/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records/${recordId}`
    );
  }

  async searchRecords(tableId: string, opts: SearchOptions = {}): Promise<FeishuRecord[]> {
    const payload: Record<string, unknown> = {};
    if (opts.filter) payload.filter = opts.filter;
    if (typeof opts.page_size === 'number') payload.page_size = opts.page_size;
    if (typeof opts.page_token === 'string') payload.page_token = opts.page_token;
    // Explicitly request text fields as plain strings rather than
    // `[{ text: "..." }]` arrays. The Repository adapters still defend
    // against both shapes, but setting this flag reduces response-size
    // variance and makes the default behaviour deterministic.
    // See TASK-003-GATE-D-TEXT-NORMALIZATION AC-06.
    payload.text_field_as_array = false;
    const data = await this.callWithRetry<{
      items?: FeishuRecord[];
      has_more?: boolean;
      page_token?: string;
      total?: number;
    }>(
      'POST',
      `/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records/search`,
      payload
    );
    return data.items ?? [];
  }

  /**
   * Core HTTP call wrapper with single-retry-on-token-invalid.
   *
   * Triggers a single token refresh + retry in two cases:
   *   1. HTTP 401 (rare for Feishu, but handled defensively).
   *   2. HTTP 2xx with body code=99991663 (Feishu's official signal for an
   *      invalid/expired tenant_access_token; returned even on HTTP 200).
   *
   * Only one retry is attempted per call. If the retry still fails with the
   * same code, the error surfaces to the caller.
   *
   * NOTE: the tenant_access_token endpoint itself is NOT retried here (it has
   * no Authorization header and is fetched via getTenantAccessToken()).
   */
  private async callWithRetry<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const token = await this.getTenantAccessToken();
    let resp: Response;
    try {
      resp = await this.doRequest(method, path, token, body);
    } catch (e) {
      // Network-level error: redact message and wrap.
      throw new FeishuApiError(-2, (e as Error).message ?? 'network error');
    }
    if (resp.status === 401) {
      // HTTP-level 401: refresh token once and retry exactly once.
      const refreshed = await this.refreshToken();
      resp = await this.doRequest(method, path, refreshed, body);
      return this.parseResponse<T>(resp);
    }
    // HTTP was not 401. Feishu may still signal an invalid token via the
    // body's `code` field (e.g. 99991663) even on HTTP 200 — parse the
    // envelope and retry once if so.
    try {
      return await this.parseResponse<T>(resp);
    } catch (e) {
      if (e instanceof FeishuApiError && e.code === TOKEN_INVALID_CODE) {
        const refreshed = await this.refreshToken();
        const retryResp = await this.doRequest(method, path, refreshed, body);
        return this.parseResponse<T>(retryResp);
      }
      throw e;
    }
  }

  private async doRequest(
    method: string,
    path: string,
    token: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };
    const init: RequestInit = {
      method,
      headers,
    };
    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      init.body = JSON.stringify(body);
    }
    return this.fetchFn(url, init);
  }

  private async parseResponse<T>(resp: Response): Promise<T> {
    let json: unknown;
    try {
      json = await resp.json();
    } catch (e) {
      throw new FeishuApiError(
        -3,
        `Non-JSON response (status=${resp.status}): ${(e as Error).message}`
      );
    }
    const envelope = json as { code?: number; msg?: string; data?: T };
    if (typeof envelope.code !== 'number' || envelope.code !== 0) {
      const code = typeof envelope.code === 'number' ? envelope.code : -4;
      const msg = envelope.msg ?? `HTTP ${resp.status}`;
      throw new FeishuApiError(code, msg);
    }
    return envelope.data as T;
  }
}
