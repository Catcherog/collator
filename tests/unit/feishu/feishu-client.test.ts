import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeishuClient } from '../../../src/server/feishu/feishu-client.js';
import { FeishuApiError } from '../../../src/server/feishu/feishu-errors.js';

// Type for the injected fetch function
type FetchFn = typeof fetch;

// Helper: create a mock Response
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as Response;
}

// Helper: create a mock fetch that returns different responses based on URL
function createMockFetch(responses: Array<{ match: (url: string, init?: RequestInit) => boolean; response: Response }>): FetchFn & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    for (const r of responses) {
      if (r.match(url, init)) return r.response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as FetchFn & { calls: Array<{ url: string; init?: RequestInit }> };
  fn.calls = calls;
  return fn;
}

const APP_ID = 'cli_test_app_id';
const APP_SECRET = 'test_secret_do_not_log';
const BASE_TOKEN = 'basetoken_test_123';
const TABLE_ID = 'tblTest456';

const TENANT_TOKEN_RESP = {
  code: 0,
  msg: 'ok',
  tenant_access_token: 'tenant_token_abc',
  expire: 7200,
};

describe('FeishuClient', () => {
  let client: FeishuClient;

  beforeEach(() => {
    client = new FeishuClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      baseToken: BASE_TOKEN,
    });
  });

  describe('tenant access token', () => {
    it('acquires and caches tenant access token', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token/internal'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
      ]);
      client.setFetchFn(fetchFn);

      const token1 = await client.getTenantAccessToken();
      const token2 = await client.getTenantAccessToken();

      expect(token1).toBe('tenant_token_abc');
      expect(token2).toBe('tenant_token_abc');
      // Should only call token endpoint once (cached)
      const tokenCalls = fetchFn.calls.filter((c) => c.url.includes('/auth/v3/tenant_access_token'));
      expect(tokenCalls).toHaveLength(1);
    });

    it('refreshes token when expired', async () => {
      let callCount = 0;
      const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
        const url = input.toString();
        if (url.includes('/auth/v3/tenant_access_token')) {
          callCount++;
          return mockResponse(200, {
            code: 0,
            msg: 'ok',
            tenant_access_token: `token_${callCount}`,
            expire: 0, // immediately expired
          });
        }
        throw new Error(`Unexpected: ${url}`);
      });
      client.setFetchFn(fetchFn as FetchFn);

      const token1 = await client.getTenantAccessToken();
      const token2 = await client.getTenantAccessToken();

      expect(token1).toBe('token_1');
      expect(token2).toBe('token_2');
      expect(callCount).toBe(2);
    });

    it('throws FeishuApiError when token acquisition fails', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, { code: 99991663, msg: 'invalid app_id' }),
        },
      ]);
      client.setFetchFn(fetchFn);

      await expect(client.getTenantAccessToken()).rejects.toThrow(FeishuApiError);
      await expect(client.getTenantAccessToken()).rejects.toThrow(/tenant_access_token/);
    });

    it('does not include app_secret in error messages', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(500, { error: 'server error' }),
        },
      ]);
      client.setFetchFn(fetchFn);

      try {
        await client.getTenantAccessToken();
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(FeishuApiError);
        expect((e as Error).message).not.toContain(APP_SECRET);
      }
    });
  });

  describe('createRecord', () => {
    it('creates a record and returns the record_id', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) => url.includes(`/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records`) && init?.method === 'POST',
          response: mockResponse(200, {
            code: 0,
            msg: 'ok',
            data: { record: { record_id: 'rec123', fields: { name: 'test' } } },
          }),
        },
      ]);
      client.setFetchFn(fetchFn);

      const recordId = await client.createRecord(TABLE_ID, { name: 'test' });
      expect(recordId).toBe('rec123');
    });

    it('passes client_token as a query parameter for server-side idempotency', async () => {
      const clientToken = 'fe599b60-450f-46ff-b2ef-9f6675625b97';
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) =>
            url.includes(`/tables/${TABLE_ID}/records?client_token=${clientToken}`) &&
            init?.method === 'POST',
          response: mockResponse(200, {
            code: 0,
            msg: 'ok',
            data: { record: { record_id: 'rec_idempotent' } },
          }),
        },
      ]);
      client.setFetchFn(fetchFn);

      const recordId = await client.createRecord(
        TABLE_ID,
        { name: 'test' },
        clientToken
      );

      expect(recordId).toBe('rec_idempotent');
    });

    it('sends tenant_access_token in Authorization header', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) => url.includes('/records') && init?.method === 'POST',
          response: mockResponse(200, { code: 0, msg: 'ok', data: { record: { record_id: 'rec1' } } }),
        },
      ]);
      client.setFetchFn(fetchFn);

      await client.createRecord(TABLE_ID, { foo: 'bar' });

      const createCall = fetchFn.calls.find((c) => c.url.includes('/records') && c.init?.method === 'POST');
      expect(createCall).toBeDefined();
      const authHeader = (createCall!.init!.headers as Record<string, string>)?.['Authorization'];
      expect(authHeader).toBe('Bearer tenant_token_abc');
    });
  });

  describe('getRecord', () => {
    it('retrieves a record by id', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) => url.includes(`/tables/${TABLE_ID}/records/rec456`) && (!init?.method || init.method === 'GET'),
          response: mockResponse(200, {
            code: 0,
            msg: 'ok',
            data: { record: { record_id: 'rec456', fields: { status: 'received' } } },
          }),
        },
      ]);
      client.setFetchFn(fetchFn);

      const record = await client.getRecord(TABLE_ID, 'rec456');
      expect(record.record_id).toBe('rec456');
      expect(record.fields).toEqual({ status: 'received' });
    });
  });

  describe('updateRecord', () => {
    it('updates a record and returns success', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) => url.includes(`/tables/${TABLE_ID}/records/rec789`) && init?.method === 'PUT',
          response: mockResponse(200, {
            code: 0,
            msg: 'ok',
            data: { record: { record_id: 'rec789', fields: { status: 'completed' } } },
          }),
        },
      ]);
      client.setFetchFn(fetchFn);

      const result = await client.updateRecord(TABLE_ID, 'rec789', { status: 'completed' });
      expect(result.record_id).toBe('rec789');
    });
  });

  describe('deleteRecord', () => {
    it('deletes a record', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) => url.includes(`/tables/${TABLE_ID}/records/recDel`) && init?.method === 'DELETE',
          response: mockResponse(200, { code: 0, msg: 'ok' }),
        },
      ]);
      client.setFetchFn(fetchFn);

      await client.deleteRecord(TABLE_ID, 'recDel');
      // No throw = success
    });
  });

  describe('token refresh retry on 401', () => {
    it('retries once with refreshed token when first call returns 401', async () => {
      let tokenCallCount = 0;
      let recordCallCount = 0;
      const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = input.toString();
        if (url.includes('/auth/v3/tenant_access_token')) {
          tokenCallCount++;
          return mockResponse(200, {
            code: 0,
            msg: 'ok',
            tenant_access_token: `token_${tokenCallCount}`,
            expire: 7200,
          });
        }
        if (url.includes('/records') && init?.method === 'POST') {
          recordCallCount++;
          const authHeader = (init.headers as Record<string, string>)?.['Authorization'];
          if (authHeader === 'Bearer token_1') {
            // First attempt: token expired
            return mockResponse(401, { code: 99991663, msg: 'access token expired' });
          }
          // Retry with refreshed token
          return mockResponse(200, { code: 0, msg: 'ok', data: { record: { record_id: 'rec_retry' } } });
        }
        throw new Error(`Unexpected: ${url}`);
      });
      client.setFetchFn(fetchFn as FetchFn);

      const recordId = await client.createRecord(TABLE_ID, { foo: 'bar' });

      expect(recordId).toBe('rec_retry');
      expect(tokenCallCount).toBe(2); // initial + refresh
      expect(recordCallCount).toBe(2); // failed + retry
    });

    it('does not retry more than once', async () => {
      const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
        const url = input.toString();
        if (url.includes('/auth/v3/tenant_access_token')) {
          return mockResponse(200, TENANT_TOKEN_RESP);
        }
        if (url.includes('/records')) {
          // Always return 401
          return mockResponse(401, { code: 99991663, msg: 'access token expired' });
        }
        throw new Error(`Unexpected: ${url}`);
      });
      client.setFetchFn(fetchFn as FetchFn);

      await expect(client.createRecord(TABLE_ID, { foo: 'bar' })).rejects.toThrow(FeishuApiError);

      // Should have: 1 initial token + 1 refresh token + 2 record calls (initial + 1 retry)
      const tokenCalls = (fetchFn as any).mock.calls.filter((c: any[]) => c[0].toString().includes('/auth/v3/tenant_access_token'));
      const recordCalls = (fetchFn as any).mock.calls.filter((c: any[]) => c[0].toString().includes('/records'));
      expect(tokenCalls).toHaveLength(2);
      expect(recordCalls).toHaveLength(2);
    });
  });

  describe('token refresh retry on business code 99991663', () => {
    it('retries once when first call returns HTTP 200 with body code=99991663', async () => {
      let tokenCallCount = 0;
      let recordCallCount = 0;
      const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = input.toString();
        if (url.includes('/auth/v3/tenant_access_token')) {
          tokenCallCount++;
          return mockResponse(200, {
            code: 0,
            msg: 'ok',
            tenant_access_token: `token_${tokenCallCount}`,
            expire: 7200,
          });
        }
        if (url.includes('/records') && init?.method === 'POST') {
          recordCallCount++;
          const authHeader = (init.headers as Record<string, string>)?.['Authorization'];
          if (authHeader === 'Bearer token_1') {
            // First attempt: Feishu signals invalid token via body code on HTTP 200
            return mockResponse(200, { code: 99991663, msg: 'invalid access token' });
          }
          // Retry with refreshed token succeeds
          return mockResponse(200, { code: 0, msg: 'ok', data: { record: { record_id: 'rec_retry_business' } } });
        }
        throw new Error(`Unexpected: ${url}`);
      });
      client.setFetchFn(fetchFn as FetchFn);

      const recordId = await client.createRecord(TABLE_ID, { foo: 'bar' });

      expect(recordId).toBe('rec_retry_business');
      expect(tokenCallCount).toBe(2); // initial + refresh
      expect(recordCallCount).toBe(2); // failed + retry
    });

    it('does not retry more than once on repeated code=99991663', async () => {
      const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
        const url = input.toString();
        if (url.includes('/auth/v3/tenant_access_token')) {
          return mockResponse(200, TENANT_TOKEN_RESP);
        }
        if (url.includes('/records')) {
          // Always return HTTP 200 + code=99991663
          return mockResponse(200, { code: 99991663, msg: 'invalid access token' });
        }
        throw new Error(`Unexpected: ${url}`);
      });
      client.setFetchFn(fetchFn as FetchFn);

      await expect(client.createRecord(TABLE_ID, { foo: 'bar' })).rejects.toThrow(FeishuApiError);

      const calls = (fetchFn as any).mock.calls as Array<[string | URL | Request, RequestInit?]>;
      const tokenCalls = calls.filter((c) => c[0].toString().includes('/auth/v3/tenant_access_token'));
      const recordCalls = calls.filter((c) => c[0].toString().includes('/records'));
      // 1 initial token + 1 refresh token + 2 record calls (initial + 1 retry)
      expect(tokenCalls).toHaveLength(2);
      expect(recordCalls).toHaveLength(2);
    });

    it('does not refresh token on non-token business errors (e.g. 1254045)', async () => {
      let tokenCallCount = 0;
      const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
        const url = input.toString();
        if (url.includes('/auth/v3/tenant_access_token')) {
          tokenCallCount++;
          return mockResponse(200, TENANT_TOKEN_RESP);
        }
        if (url.includes('/records')) {
          // Non-token business error: must NOT trigger retry
          return mockResponse(200, { code: 1254045, msg: 'field name not exist' });
        }
        throw new Error(`Unexpected: ${url}`);
      });
      client.setFetchFn(fetchFn as FetchFn);

      await expect(client.createRecord(TABLE_ID, { bad_field: 'x' })).rejects.toThrow(FeishuApiError);

      // Token acquired exactly once (no refresh)
      expect(tokenCallCount).toBe(1);
      const calls = (fetchFn as any).mock.calls as Array<[string | URL | Request, RequestInit?]>;
      const recordCalls = calls.filter((c) => c[0].toString().includes('/records'));
      expect(recordCalls).toHaveLength(1);
    });
  });

  describe('searchRecords', () => {
    it('searches records with a filter condition', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) => url.includes('/records/search') && init?.method === 'POST',
          response: mockResponse(200, {
            code: 0,
            msg: 'ok',
            data: {
              items: [
                { record_id: 'recA', fields: { '摄入 ID': 'ing_001' } },
                { record_id: 'recB', fields: { '摄入 ID': 'ing_002' } },
              ],
              total: 2,
              has_more: false,
            },
          }),
        },
      ]);
      client.setFetchFn(fetchFn);

      const results = await client.searchRecords(TABLE_ID, {
        filter: { conjunction: 'and', conditions: [{ field_name: '摄入 ID', operator: 'is', value: ['ing_001'] }] },
      });

      expect(results).toHaveLength(2);
      expect(results[0].record_id).toBe('recA');
    });

    // TASK-003-GATE-D-TEXT-NORMALIZATION AC-06:
    // Explicitly request text fields as plain strings (text_field_as_array=false)
    // so Feishu does not return text fields as [{text: "..."}] arrays.
    it('sets text_field_as_array=false in the search request body', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) => url.includes('/records/search') && init?.method === 'POST',
          response: mockResponse(200, {
            code: 0,
            msg: 'ok',
            data: { items: [], total: 0, has_more: false },
          }),
        },
      ]);
      client.setFetchFn(fetchFn);

      await client.searchRecords(TABLE_ID, {
        filter: { conjunction: 'and', conditions: [{ field_name: '摄入 ID', operator: 'is', value: ['ing_001'] }] },
      });

      const searchCall = fetchFn.calls.find(
        (c) => c.url.includes('/records/search') && c.init?.method === 'POST'
      );
      expect(searchCall).toBeDefined();
      const body = JSON.parse(searchCall!.init!.body as string);
      expect(body.text_field_as_array).toBe(false);
    });
  });

  describe('getRecord text_field_as_array', () => {
    // TASK-003-GATE-D-TEXT-NORMALIZATION AC-06:
    // Explicitly request text fields as plain strings in getRecord too.
    it('appends text_field_as_array=false as a query parameter', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) =>
            url.includes(`/tables/${TABLE_ID}/records/recText`) &&
            (!init?.method || init.method === 'GET'),
          response: mockResponse(200, {
            code: 0,
            msg: 'ok',
            data: { record: { record_id: 'recText', fields: { name: 'test' } } },
          }),
        },
      ]);
      client.setFetchFn(fetchFn);

      await client.getRecord(TABLE_ID, 'recText');

      const getCall = fetchFn.calls.find(
        (c) => c.url.includes(`/tables/${TABLE_ID}/records/recText`) &&
          (!c.init?.method || c.init.method === 'GET')
      );
      expect(getCall).toBeDefined();
      expect(getCall!.url).toContain('text_field_as_array=false');
    });
  });

  describe('error handling', () => {
    it('throws FeishuApiError with code and message on API error', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) => url.includes('/records') && init?.method === 'POST',
          response: mockResponse(200, { code: 1254045, msg: 'field name not exist' }),
        },
      ]);
      client.setFetchFn(fetchFn);

      try {
        await client.createRecord(TABLE_ID, { bad_field: 'x' });
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(FeishuApiError);
        const err = e as FeishuApiError;
        expect(err.code).toBe(1254045);
        expect(err.message).toContain('field name not exist');
      }
    });

    it('redacts phone numbers in error messages', async () => {
      const fetchFn = createMockFetch([
        {
          match: (url) => url.includes('/auth/v3/tenant_access_token'),
          response: mockResponse(200, TENANT_TOKEN_RESP),
        },
        {
          match: (url, init) => url.includes('/records') && init?.method === 'POST',
          response: mockResponse(200, { code: 1254015, msg: 'value type mismatch for 13812345678' }),
        },
      ]);
      client.setFetchFn(fetchFn);

      try {
        await client.createRecord(TABLE_ID, { phone: '13812345678' });
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(FeishuApiError);
        expect((e as Error).message).not.toContain('13812345678');
        expect((e as Error).message).toContain('138****5678');
      }
    });
  });
});
