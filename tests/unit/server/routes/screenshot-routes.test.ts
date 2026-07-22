// 主线 A1: 截图纵向闭环 — 7 个 API 路由测试
//
// 验证 FAMP-CHAT-SCREENSHOT-VERTICAL-SLICE-01 的 7 个 API：
//   1. POST   /v1/screenshots                      — 创建截图提交
//   2. GET    /v1/screenshots/:id                  — 查询处理状态
//   3. GET    /v1/screenshots/:id/evidence          — 获取 OCR 证据和 Candidate
//   4. POST   /v1/screenshots/:id/corrections       — 提交人工修正
//   5. POST   /v1/screenshots/:id/confirm            — 确认写入
//   6. POST   /v1/screenshots/:id/escalate-review    — 转人工复核
//   7. GET    /v1/screenshots/:id/final-result       — 获取最终治理和写入结果
//
// 验收标准：
//   AC-A03: 人工修正标记为 CONFIRMED
//   AC-A08: 重复上传幂等
//   AC-A09: 重复确认幂等
//   AC-A10: 写入失败不报告 SUCCEEDED
//   AC-A11: 未知 schema version fail closed
//
// 运行：vitest run tests/unit/server/routes/screenshot-routes.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../src/server/app.js';
import { InMemoryTaskRepository } from '../../../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryReviewRepository } from '../../../../src/server/repositories/in-memory-review-repository.js';
import { NoOpPreWriteClient } from '../../../fixtures/noop-pre-write-client.js';
import { MockOcrEngine } from '../../../../src/server/services/screenshot-ocr-adapter.js';
import type { ScreenshotGovernanceClient, FullGovernanceResult } from '../../../../src/server/governance/screenshot-governance-client.js';
import type { CandidateV1 } from '../../../../src/contracts/candidate-v1.js';
import type { BatchWriterPort, TransactionalBatchWriterInput, TransactionalBatchWriterResult } from '../../../../src/server/business/transactional-batch-writer.js';
import type { WriteResult } from '../../../../src/contracts/screenshot-api-v1.js';

const WEBHOOK_SECRET = 'test-webhook-secret-screenshot';

// ============================================================================
// Test Fixtures
// ============================================================================

/** 可编程的截图治理客户端 — 返回指定决策的 Governance Result */
class FakeScreenshotGovernanceClient implements ScreenshotGovernanceClient {
  constructor(
    private readonly decision: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED',
    public callCount = 0,
  ) {}

  async callPreWriteFull(candidate: CandidateV1): Promise<FullGovernanceResult> {
    this.callCount++;
    const now = new Date().toISOString();
    return {
      schema_version: 'v1',
      candidate_id: candidate.candidate_id,
      decision: this.decision,
      classification: {
        entity_type: 'project',
        project_type: candidate.normalized_fields.project_type as string,
        confidence: candidate.quality.score ?? 0.9,
      },
      rule_version: 'project-rules-1.1',
      violations: this.decision === 'PASS' ? [] : [{
        code: 'CUSTOMER_REQUIRED',
        message: 'BR-01: customer_ref missing',
        severity: 'warning',
      }],
      write: {
        status: 'NOT_ATTEMPTED',
        target_table: 'projects_demo',
        target_record_id: null,
        attempted_at: now,
      },
      review: {
        status: this.decision === 'NEEDS_REVIEW' ? 'CREATED' : 'NOT_REQUIRED',
        review_task_id: null,
        ai_explanation: {
          available: this.decision !== 'PASS',
          reason: this.decision === 'PASS' ? 'All rules passed' : 'Review required',
        },
      },
      audit: {
        audit_id: `audit_test_${Date.now()}`,
        timestamp: now,
        source_record_id: candidate.source.record_id,
        idempotency_key: candidate.idempotency_key,
        rule_version: 'project-rules-1.1',
      },
    };
  }
}

/** 可编程的批量写入器 — 返回指定结果 */
class FakeBatchWriter implements BatchWriterPort {
  constructor(
    private readonly mode: 'success' | 'failure',
    public callCount = 0,
  ) {}

  async writeBatch(input: TransactionalBatchWriterInput): Promise<TransactionalBatchWriterResult> {
    this.callCount++;
    const tables = input.targetTables ?? ['customer', 'project', 'model'];
    const writeResults: WriteResult[] = tables.map((table) => ({
      entity_type: table,
      target_table_id: table,
      business_record_id: this.mode === 'success' ? `rec_${table}_${Date.now()}` : null,
      created: this.mode === 'success',
      status: this.mode === 'success' ? 'succeeded' : 'failed',
      ...(this.mode === 'failure' ? { error_code: 'COMMIT_FAILED' } : {}),
    }));

    return {
      write_results: writeResults,
      transaction_snapshot_id: `txn_${input.ingestionId}_${Date.now()}`,
      status: this.mode === 'success' ? 'committed' : 'rolled_back',
      records_created: this.mode === 'success' ? tables.length : 0,
      records_rolled_back: this.mode === 'failure' ? 0 : 0,
      ...(this.mode === 'failure' ? { error_code: 'COMMIT_FAILED' } : {}),
    };
  }
}

/** 创建一个 base64 编码的模拟图片 */
function makeBase64Image(content: string = 'fake-screenshot-content'): string {
  return Buffer.from(content, 'utf8').toString('base64');
}

// ============================================================================
// Setup
// ============================================================================

async function setup(options?: {
  governanceDecision?: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
  batchWriterMode?: 'success' | 'failure';
}): Promise<{
  app: FastifyInstance;
  repository: InMemoryTaskRepository;
  governanceClient: FakeScreenshotGovernanceClient;
  batchWriter: FakeBatchWriter;
}> {
  process.env.COLLATOR_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const repository = new InMemoryTaskRepository();
  const reviewRepository = new InMemoryReviewRepository();
  const governanceClient = new FakeScreenshotGovernanceClient(options?.governanceDecision ?? 'PASS');
  const batchWriter = new FakeBatchWriter(options?.batchWriterMode ?? 'success');

  const { app } = await buildApp({
    repository,
    reviewRepository,
    preWriteClient: new NoOpPreWriteClient(),
    screenshotServiceOptions: {
      ocrEngine: new MockOcrEngine(),
      governanceClient,
      batchWriter,
      writeLogRepository: undefined,
    },
  });

  return { app, repository, governanceClient, batchWriter };
}

/** 创建截图提交的辅助函数 */
async function createScreenshot(app: FastifyInstance, overrides?: Record<string, unknown>): Promise<{
  screenshot_id: string;
  ingestion_id: string;
  status: string;
  idempotent_replay: boolean;
}> {
  const body = {
    source_system: 'feishu_form',
    source_record_id: 'rec_screenshot_001',
    submitted_at: new Date().toISOString(),
    image_base64: makeBase64Image(),
    image_filename: 'chat-screenshot.png',
    ...overrides,
  };
  const response = await app.inject({
    method: 'POST',
    url: '/v1/screenshots',
    payload: body,
  });
  expect(response.statusCode).toBe(202);
  return response.json();
}

// ============================================================================
// Tests
// ============================================================================

describe('Screenshot Routes — 主线 A1 截图纵向闭环', () => {
  beforeEach(() => {
    delete process.env.COLLATOR_WEBHOOK_SECRET;
  });

  // ============================================================
  // 1. POST /v1/screenshots — 创建截图提交
  // ============================================================
  describe('POST /v1/screenshots', () => {
    it('应成功创建截图提交并返回 202', async () => {
      const { app } = await setup();
      const result = await createScreenshot(app);

      expect(result.screenshot_id).toBeDefined();
      expect(result.ingestion_id).toBe(result.screenshot_id);
      expect(result.idempotent_replay).toBe(false);
      expect(result.status).toBe('candidate_drafted'); // mock OCR 同步完成
    });

    it('AC-A08: 重复上传相同图片应返回幂等重放（idempotent_replay=true, 200）', async () => {
      const { app } = await setup();
      const imageContent = makeBase64Image('same-content');

      // 第一次上传
      const r1 = await app.inject({
        method: 'POST',
        url: '/v1/screenshots',
        payload: {
          source_system: 'feishu_form',
          source_record_id: 'rec_001',
          submitted_at: new Date().toISOString(),
          image_base64: imageContent,
        },
      });
      expect(r1.statusCode).toBe(202);
      const first = r1.json();

      // 第二次上传相同图片
      const r2 = await app.inject({
        method: 'POST',
        url: '/v1/screenshots',
        payload: {
          source_system: 'feishu_form',
          source_record_id: 'rec_002',
          submitted_at: new Date().toISOString(),
          image_base64: imageContent,
        },
      });
      expect(r2.statusCode).toBe(200); // 幂等重放返回 200
      const second = r2.json();

      expect(second.screenshot_id).toBe(first.screenshot_id);
      expect(second.idempotent_replay).toBe(true);
    });

    it('缺少 image_base64 和 image_url 应返回 400', async () => {
      const { app } = await setup();
      const response = await app.inject({
        method: 'POST',
        url: '/v1/screenshots',
        payload: {
          source_system: 'feishu_form',
          source_record_id: 'rec_001',
          submitted_at: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ============================================================
  // 2. GET /v1/screenshots/:id — 查询处理状态
  // ============================================================
  describe('GET /v1/screenshots/:id', () => {
    it('应返回截图处理状态', async () => {
      const { app } = await setup();
      const created = await createScreenshot(app);

      const response = await app.inject({
        method: 'GET',
        url: `/v1/screenshots/${created.screenshot_id}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.screenshot_id).toBe(created.screenshot_id);
      expect(body.status).toBe('candidate_drafted');
      expect(body.ocr).toBeDefined();
      expect(body.ocr.engine).toBe('mock');
      expect(body.candidate).toBeDefined();
    });

    it('不存在的截图 ID 应返回 404', async () => {
      const { app } = await setup();
      const response = await app.inject({
        method: 'GET',
        url: '/v1/screenshots/nonexistent',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ============================================================
  // 3. GET /v1/screenshots/:id/evidence — 获取 OCR 证据和 Candidate
  // ============================================================
  describe('GET /v1/screenshots/:id/evidence', () => {
    it('应返回 OCR 证据和 Candidate V1', async () => {
      const { app } = await setup();
      const created = await createScreenshot(app);

      const response = await app.inject({
        method: 'GET',
        url: `/v1/screenshots/${created.screenshot_id}/evidence`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ocr_evidence).toBeDefined();
      expect(body.ocr_evidence.engine).toBe('mock');
      expect(body.ocr_evidence.text_blocks).toBeDefined();
      expect(body.ocr_evidence.text_blocks.length).toBeGreaterThan(0);
      expect(body.candidate_v1).toBeDefined();
      expect(body.candidate_v1.schema_version).toBe('v1');
      expect(body.candidate_v1.entity_type).toBe('project');
    });
  });

  // ============================================================
  // 4. POST /v1/screenshots/:id/corrections — 提交人工修正
  // ============================================================
  describe('POST /v1/screenshots/:id/corrections', () => {
    it('AC-A03: 人工修正应标记 field_authority=CONFIRMED', async () => {
      const { app } = await setup();
      const created = await createScreenshot(app);

      const response = await app.inject({
        method: 'POST',
        url: `/v1/screenshots/${created.screenshot_id}/corrections`,
        payload: {
          reviewer_id: 'reviewer_001',
          corrections: {
            project_type: 'client',
            customer_ref: 'cust_manual_001',
          },
          correction_reason: '人工确认项目类型和客户',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.field_authority).toBe('CONFIRMED');
      expect(body.candidate_v1.normalized_fields.project_type).toBe('client');
      expect(body.candidate_v1.normalized_fields.customer_ref).toBe('cust_manual_001');
      expect(body.reviewer_id).toBe('reviewer_001');
    });
  });

  // ============================================================
  // 5. POST /v1/screenshots/:id/confirm — 确认写入
  // ============================================================
  describe('POST /v1/screenshots/:id/confirm', () => {
    it('治理 PASS 时应成功写入飞书（write_succeeded）', async () => {
      const { app, governanceClient, batchWriter } = await setup({ governanceDecision: 'PASS' });
      const created = await createScreenshot(app);

      // 先获取 candidate_id
      const evidenceResp = await app.inject({
        method: 'GET',
        url: `/v1/screenshots/${created.screenshot_id}/evidence`,
      });
      const candidateId = evidenceResp.json().candidate_v1.candidate_id;

      const response = await app.inject({
        method: 'POST',
        url: `/v1/screenshots/${created.screenshot_id}/confirm`,
        payload: {
          reviewer_id: 'reviewer_001',
          candidate_v1_id: candidateId,
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('write_succeeded');
      expect(body.write_results).toBeDefined();
      expect(body.write_results.length).toBeGreaterThan(0);
      expect(governanceClient.callCount).toBe(1);
      expect(batchWriter.callCount).toBe(1);
    });

    it('AC-A09: 重复确认应返回幂等结果（已有 write_succeeded）', async () => {
      const { app } = await setup({ governanceDecision: 'PASS' });
      const created = await createScreenshot(app);

      const evidenceResp = await app.inject({
        method: 'GET',
        url: `/v1/screenshots/${created.screenshot_id}/evidence`,
      });
      const candidateId = evidenceResp.json().candidate_v1.candidate_id;

      // 第一次确认
      const r1 = await app.inject({
        method: 'POST',
        url: `/v1/screenshots/${created.screenshot_id}/confirm`,
        payload: { reviewer_id: 'reviewer_001', candidate_v1_id: candidateId },
      });
      expect(r1.statusCode).toBe(200);
      expect(r1.json().status).toBe('write_succeeded');

      // 第二次确认（幂等）
      const r2 = await app.inject({
        method: 'POST',
        url: `/v1/screenshots/${created.screenshot_id}/confirm`,
        payload: { reviewer_id: 'reviewer_001', candidate_v1_id: candidateId },
      });
      expect(r2.statusCode).toBe(200);
      expect(r2.json().status).toBe('write_succeeded');
    });

    it('治理 BLOCKED 时应 fail-closed 不写入', async () => {
      const { app, batchWriter } = await setup({ governanceDecision: 'BLOCKED' });
      const created = await createScreenshot(app);

      const evidenceResp = await app.inject({
        method: 'GET',
        url: `/v1/screenshots/${created.screenshot_id}/evidence`,
      });
      const candidateId = evidenceResp.json().candidate_v1.candidate_id;

      const response = await app.inject({
        method: 'POST',
        url: `/v1/screenshots/${created.screenshot_id}/confirm`,
        payload: { reviewer_id: 'reviewer_001', candidate_v1_id: candidateId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('governance_blocked');
      expect(body.error_code).toBe('GOVERNANCE_BLOCKED');
      expect(batchWriter.callCount).toBe(0); // 未调用写入器
    });

    it('AC-A10: 写入失败时应返回 write_failed 而非 SUCCEEDED', async () => {
      const { app, batchWriter } = await setup({
        governanceDecision: 'PASS',
        batchWriterMode: 'failure',
      });
      const created = await createScreenshot(app);

      const evidenceResp = await app.inject({
        method: 'GET',
        url: `/v1/screenshots/${created.screenshot_id}/evidence`,
      });
      const candidateId = evidenceResp.json().candidate_v1.candidate_id;

      const response = await app.inject({
        method: 'POST',
        url: `/v1/screenshots/${created.screenshot_id}/confirm`,
        payload: { reviewer_id: 'reviewer_001', candidate_v1_id: candidateId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('write_failed');
      expect(body.error_code).toBeDefined();
      expect(batchWriter.callCount).toBe(1);
    });
  });

  // ============================================================
  // 6. POST /v1/screenshots/:id/escalate-review — 转人工复核
  // ============================================================
  describe('POST /v1/screenshots/:id/escalate-review', () => {
    it('应创建复核任务并返回 NEEDS_REVIEW 治理结果', async () => {
      const { app } = await setup();
      const created = await createScreenshot(app);

      const response = await app.inject({
        method: 'POST',
        url: `/v1/screenshots/${created.screenshot_id}/escalate-review`,
        payload: {
          reviewer_id: 'reviewer_001',
          reason_code: 'PROJECT_TYPE_REQUIRED',
          reason: '无法确定项目类型，需人工确认',
          suggested_fields: { project_type: 'client' },
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.governance_result_v1.decision).toBe('NEEDS_REVIEW');
      expect(body.review_task).toBeDefined();
      expect(body.review_task.review_task_id).toBeDefined();
      expect(body.review_task.status).toBe('pending_review');
    });

    it('AC-A09: 重复转复核应返回已有复核任务', async () => {
      const { app } = await setup();
      const created = await createScreenshot(app);

      const body = {
        reviewer_id: 'reviewer_001',
        reason_code: 'PROJECT_TYPE_REQUIRED',
        reason: '无法确定项目类型',
      };

      const r1 = await app.inject({
        method: 'POST',
        url: `/v1/screenshots/${created.screenshot_id}/escalate-review`,
        payload: body,
      });
      expect(r1.statusCode).toBe(200);
      const first = r1.json();

      const r2 = await app.inject({
        method: 'POST',
        url: `/v1/screenshots/${created.screenshot_id}/escalate-review`,
        payload: body,
      });
      expect(r2.statusCode).toBe(200);
      const second = r2.json();

      expect(second.review_task.review_task_id).toBe(first.review_task.review_task_id);
    });
  });

  // ============================================================
  // 7. GET /v1/screenshots/:id/final-result — 获取最终治理和写入结果
  // ============================================================
  describe('GET /v1/screenshots/:id/final-result', () => {
    it('应返回最终治理和写入结果', async () => {
      const { app } = await setup({ governanceDecision: 'PASS' });
      const created = await createScreenshot(app);

      const evidenceResp = await app.inject({
        method: 'GET',
        url: `/v1/screenshots/${created.screenshot_id}/evidence`,
      });
      const candidateId = evidenceResp.json().candidate_v1.candidate_id;

      // 先确认写入
      await app.inject({
        method: 'POST',
        url: `/v1/screenshots/${created.screenshot_id}/confirm`,
        payload: { reviewer_id: 'reviewer_001', candidate_v1_id: candidateId },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/screenshots/${created.screenshot_id}/final-result`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.screenshot_id).toBe(created.screenshot_id);
      expect(body.final_status).toBe('write_succeeded');
      expect(body.governance_result_v1).toBeDefined();
      expect(body.write_logs).toBeDefined();
    });
  });
});
