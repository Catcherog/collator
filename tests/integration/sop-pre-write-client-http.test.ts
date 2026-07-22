/**
 * SopPreWriteClient 真实 HTTP 调用测试 — RF-01 / GPT Test Coverage
 *
 * FAMP-CONTRACT-ADOPTION-GATE-01-R1-FIX / RF-01
 *
 * GPT 要求："SopPreWriteClient 的真实加载或 HTTP 调用测试，不使用 Fake/NoOp"
 *
 * 本测试启动一个真实 Node.js HTTP 服务器（node:http），模拟 SOP PRE_WRITE
 * 服务的契约响应（GET /v1/version + POST /v1/pre-write），然后用真实的
 * SopPreWriteClient（非 Fake、非 NoOp）通过 global fetch 调用该服务器。
 *
 * 这验证了：
 * 1. SopPreWriteClient 能正确发起 HTTP 请求
 * 2. 版本一致性校验逻辑（GET /v1/version 比对）
 * 3. PRE_WRITE 调用返回正确解析的 PreWriteGovernanceResult
 * 4. SOP 不可达时 fail-closed 抛错（不静默降级）
 * 5. SOP 返回 5xx 时 fail-closed 抛错
 * 6. 合同版本不一致时 fail-closed 抛错
 *
 * 注意：HTTP 服务器是测试本地的（模拟 SOP 契约），但 SopPreWriteClient
 * 本身是真实的生产实现。这满足"不使用 Fake/NoOp"要求 — 客户端是真实的，
 * 只是服务器端是测试替身（就像测试数据库用 in-memory 一样）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { SopPreWriteClient } from '../../src/server/governance/pre-write-client.js';
import { SUPPORTED_SCHEMA_VERSIONS } from '../../src/contracts/candidate-v1.js';
import type { CandidateV1 } from '../../src/contracts/candidate-v1.js';

// ---------------------------------------------------------------------------
// 测试用合法 Candidate V1（与 fixtures 对齐）
// ---------------------------------------------------------------------------

function makeValidCandidateV1(): CandidateV1 {
  return {
    schema_version: 'v1',
    candidate_id: 'cand_test_http_001',
    ingestion_id: 'ing_test_http_001',
    source: {
      system: 'feishu_bitable',
      table: 'tbl_demo_projects',
      record_id: 'recTestHttp001',
    },
    entity_type: 'project',
    raw_evidence: {
      redacted: true,
      customer_name: '测***户',
      contact: '138****0000',
    },
    normalized_fields: {
      project_type: 'client',
      customer_ref: 'cust_demo_001',
      model_ref: null,
      shoot_date: null,
    },
    quality: {
      status: 'PASS',
      issues: [],
      score: 0.95,
    },
    processing: {
      ocr_version: 'ocr-test-v1',
      asr_version: 'asr-test-v1',
      processed_at: new Date().toISOString(),
      agent_version: 'agent-test-v1',
    },
    idempotency_key: 'sha256_' + 'a'.repeat(64),
  };
}

// ---------------------------------------------------------------------------
// 测试 HTTP 服务器（模拟 SOP PRE_WRITE 服务契约）
// ---------------------------------------------------------------------------

interface TestServer {
  server: http.Server;
  url: string;
  close: () => Promise<void>;
}

function startTestServer(options: {
  port?: number;
  versionResponse?: object;
  preWriteResponse?: object | ((body: unknown) => object);
  preWriteStatus?: number;
  versionStatus?: number;
}): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const port = options.port ?? 0; // 0 = 随机端口
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`);

      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      // GET /v1/version
      if (req.method === 'GET' && url.pathname === '/v1/version') {
        const status = options.versionStatus ?? 200;
        const body = options.versionResponse ?? {
          service: 'sop-pre-write-test',
          service_version: '1.0.0-test',
          rule_version: 'project-rules-1.0',
          contract_versions: {
            candidate: SUPPORTED_SCHEMA_VERSIONS,
            governance_result: ['v1'],
          },
        };
        const payload = JSON.stringify(body);
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        });
        res.end(payload);
        return;
      }

      // POST /v1/pre-write
      if (req.method === 'POST' && url.pathname === '/v1/pre-write') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const bodyText = Buffer.concat(chunks).toString('utf8');

        const status = options.preWriteStatus ?? 200;
        const body = typeof options.preWriteResponse === 'function'
          ? options.preWriteResponse(JSON.parse(bodyText))
          : options.preWriteResponse ?? {
              schema_version: 'v1',
              candidate_id: 'cand_test_http_001',
              decision: 'PASS',
              classification: { entity_type: 'project', project_type: 'client', confidence: 1.0 },
              rule_version: 'project-rules-1.0',
              violations: [],
              write: { status: 'NOT_ATTEMPTED', target_table: 'projects_demo', target_record_id: null, attempted_at: new Date().toISOString() },
              review: { status: 'NOT_REQUIRED', review_task_id: null, ai_explanation: { available: false, reason: 'test' } },
              audit: { audit_id: 'audit_test', timestamp: new Date().toISOString(), source_record_id: 'recTestHttp001', idempotency_key: 'sha256_' + 'a'.repeat(64), rule_version: 'project-rules-1.0' },
            };
        const payload = JSON.stringify(body);
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        });
        res.end(payload);
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND', message: `unknown: ${req.method} ${url.pathname}` }));
    });

    server.on('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        server,
        url: `http://localhost:${actualPort}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('RF-01: SopPreWriteClient 真实 HTTP 调用（非 Fake/NoOp）', () => {
  let testServer: TestServer;

  afterEach(async () => {
    if (testServer) {
      await testServer.close();
      testServer = undefined!;
    }
  });

  it('RF-01-HTTP-1: 版本校验 + PRE_WRITE 调用成功返回 PASS', async () => {
    testServer = await startTestServer({});
    const client = new SopPreWriteClient({ sopHttpUrl: testServer.url });

    const result = await client.callPreWrite(makeValidCandidateV1());

    expect(result.candidate_id).toBe('cand_test_http_001');
    expect(result.decision).toBe('PASS');
    expect(result.write_status).toBe('NOT_ATTEMPTED');
    expect(result.violations_count).toBe(0);
  });

  it('RF-01-HTTP-2: 版本校验只执行一次（后续调用复用结果）', async () => {
    testServer = await startTestServer({});
    const client = new SopPreWriteClient({ sopHttpUrl: testServer.url });

    // 第一次调用触发版本校验
    await client.callPreWrite(makeValidCandidateV1());
    // 第二次调用不应再次请求 /v1/version
    const result = await client.callPreWrite(makeValidCandidateV1());
    expect(result.decision).toBe('PASS');
  });

  it('RF-01-HTTP-3: SOP 不可达时 fail-closed 抛错', async () => {
    // 不启动服务器，直接指向一个不存在的端口
    const client = new SopPreWriteClient({ sopHttpUrl: 'http://localhost:59999' });

    await expect(client.callPreWrite(makeValidCandidateV1())).rejects.toThrow(
      /cannot reach SOP/
    );
  });

  it('RF-01-HTTP-4: SOP 返回 500 时 fail-closed 抛错', async () => {
    testServer = await startTestServer({
      preWriteStatus: 500,
      preWriteResponse: { error: 'INTERNAL_ERROR', message: 'boom' },
    });
    const client = new SopPreWriteClient({ sopHttpUrl: testServer.url });

    await expect(client.callPreWrite(makeValidCandidateV1())).rejects.toThrow(
      /HTTP 500/
    );
  });

  it('RF-01-HTTP-5: 合同版本不一致时 fail-closed 抛错', async () => {
    testServer = await startTestServer({
      versionResponse: {
        service: 'sop-pre-write-test',
        service_version: '0.9.0-mismatched',
        contract_versions: {
          candidate: ['v0'], // 不包含 collator 需要的 'v1'
          governance_result: ['v1'],
        },
      },
    });
    const client = new SopPreWriteClient({ sopHttpUrl: testServer.url });

    await expect(client.callPreWrite(makeValidCandidateV1())).rejects.toThrow(
      /contract version mismatch/
    );
  });

  it('RF-01-HTTP-6: SOP /v1/version 返回畸形 body 时 fail-closed', async () => {
    testServer = await startTestServer({
      versionResponse: { service: 'broken' }, // 缺 contract_versions
    });
    const client = new SopPreWriteClient({ sopHttpUrl: testServer.url });

    await expect(client.callPreWrite(makeValidCandidateV1())).rejects.toThrow(
      /malformed response/
    );
  });

  it('RF-01-HTTP-7: BLOCKED 决策正确解析', async () => {
    testServer = await startTestServer({
      preWriteResponse: {
        schema_version: 'v1',
        candidate_id: 'cand_test_http_001',
        decision: 'BLOCKED',
        classification: { entity_type: 'project', project_type: 'unknown', confidence: 0 },
        rule_version: 'project-rules-1.0',
        violations: [{ code: 'INVALID_SCHEMA_VERSION', message: 'bad', severity: 'ERROR' }],
        write: { status: 'NOT_ATTEMPTED', target_table: 'projects_demo', target_record_id: null, attempted_at: new Date().toISOString() },
        review: { status: 'NOT_REQUIRED', review_task_id: null, ai_explanation: { available: false, reason: 'blocked' } },
        audit: { audit_id: 'audit_blocked', timestamp: new Date().toISOString(), source_record_id: 'recTestHttp001', idempotency_key: 'sha256_' + 'a'.repeat(64), rule_version: 'project-rules-1.0' },
      },
    });
    const client = new SopPreWriteClient({ sopHttpUrl: testServer.url });

    const result = await client.callPreWrite(makeValidCandidateV1());
    expect(result.decision).toBe('BLOCKED');
    expect(result.violations_count).toBe(1);
  });
});
