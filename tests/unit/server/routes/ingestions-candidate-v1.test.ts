// Task 3 Adoption Gate — collator 持续摄入入口级测试
//
// 验证 AC-10 Adoption Gate 的 collator 侧采用点：
//   1. 合法 Candidate V1 → 200 + service.adoptCandidateV1 被调用
//   2. 非法 schema_version (v99) → 400 UNKNOWN_SCHEMA_VERSION + service 未被调用
//   3. 缺失必填子字段 (processing.ocr_version) → 400 MISSING_REQUIRED_FIELD + service 未被调用
//   4. 无副作用：校验失败时 task 仓库未被修改、review 仓库为空
//
// FAMP-CONTRACT-ADOPTION-GATE-01-R1 新增：
//   5. PRE_WRITE BLOCKED → 200 + status=candidate_blocked + task 未持久化候选（AC-R1-02 / AC-R1-05）
//   6. PRE_WRITE PASS → 200 + status=candidate_received + task 持久化候选
//   7. PRE_WRITE NEEDS_REVIEW → 200 + status=candidate_received + task 持久化候选（NEEDS_REVIEW 不阻断持久化）
//   8. Dify callback 废止路由返回 410 Gone（AC-R1-01）
//
// 运行：vitest run tests/unit/server/routes/ingestions-candidate-v1.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../../../src/server/app.js';
import { InMemoryTaskRepository } from '../../../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryReviewRepository } from '../../../../src/server/repositories/in-memory-review-repository.js';
import type { PreWriteClient, PreWriteGovernanceResult } from '../../../../src/server/governance/pre-write-client.js';
import type { CandidateV1 } from '../../../../src/contracts/candidate-v1.js';
import type { FastifyInstance } from 'fastify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIXTURES_PATH = path.join(
  REPO_ROOT,
  'src',
  'contracts',
  'fixtures',
  'project-candidates.json',
);
const projectCandidates = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf-8')) as Array<Record<string, unknown>>;

const WEBHOOK_SECRET = 'test-webhook-secret-candidate-v1';

function makeIngestionBody() {
  return {
    source_system: 'feishu_form',
    source_record_id: 'rec_001',
    source_type: 'chat_text',
    target_domain: 'customer_consultation',
    content: '你好，我想拍一套写真，预算3000元左右。',
    submitted_at: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    submitted_by: 'operator_1',
    dry_run: true,
  };
}

/**
 * 构造一个可编程的 PreWriteClient，用于测试 PRE_WRITE 治理的不同决策路径。
 * R1 / AC-R1-02: 验证 adoptCandidateV1 在不同 PRE_WRITE 决策下的 fail-closed 行为。
 */
class FakePreWriteClient implements PreWriteClient {
  constructor(
    private readonly decision: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED',
    public readonly callCount: { value: number } = { value: 0 },
  ) {}

  async callPreWrite(candidate: CandidateV1): Promise<PreWriteGovernanceResult> {
    this.callCount.value += 1;
    return {
      candidate_id: candidate.candidate_id,
      decision: this.decision,
      write_status: this.decision === 'BLOCKED' ? 'NOT_ATTEMPTED' : 'NOT_ATTEMPTED',
      violations_count: this.decision === 'BLOCKED' ? 1 : 0,
    };
  }
}

async function setup(): Promise<{
  app: FastifyInstance;
  repository: InMemoryTaskRepository;
  reviewRepository: InMemoryReviewRepository;
}>;
async function setup(options: {
  preWriteClient?: PreWriteClient;
}): Promise<{
  app: FastifyInstance;
  repository: InMemoryTaskRepository;
  reviewRepository: InMemoryReviewRepository;
  preWriteClient?: PreWriteClient;
}>;
async function setup(options?: {
  preWriteClient?: PreWriteClient;
}): Promise<{
  app: FastifyInstance;
  repository: InMemoryTaskRepository;
  reviewRepository: InMemoryReviewRepository;
  preWriteClient?: PreWriteClient;
}> {
  process.env.COLLATOR_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const repository = new InMemoryTaskRepository();
  const reviewRepository = new InMemoryReviewRepository();
  const { app } = await buildApp({
    repository,
    reviewRepository,
    preWriteClient: options?.preWriteClient,
  });
  return { app, repository, reviewRepository, preWriteClient: options?.preWriteClient };
}

async function createTask(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/ingestions',
    payload: makeIngestionBody(),
  });
  return response.json().ingestion_id as string;
}

// 合法 V1 候选（来自 fixtures：合法客片）
const validCandidateV1 = projectCandidates[0] as Record<string, unknown>;

describe('POST /v1/ingestions/:id/candidate-v1 — Task 3 Adoption Gate', () => {
  beforeEach(() => {
    delete process.env.COLLATOR_WEBHOOK_SECRET;
  });

  it('1. accepts a legal Candidate V1 and persists as adoption evidence', async () => {
    const { app, repository } = await setup();
    const ingestionId = await createTask(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: validCandidateV1,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ingestion_id).toBe(ingestionId);
    expect(body.candidate_id).toBe(validCandidateV1.candidate_id);
    expect(body.status).toBe('candidate_received');

    // Task persisted with V1 candidate as adoption evidence.
    const task = await repository.findById(ingestionId);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('candidate_received');
    expect(task!.raw_candidate).toBeDefined();
    expect(task!.raw_candidate!.schema_name).toBe('project_candidate_v1');
    expect(task!.raw_candidate!.schema_version).toBe('v1');
    // V1 candidate_id preserved in adapted fields
    expect((task!.raw_candidate!.fields as { candidate_id: string }).candidate_id).toBe(
      validCandidateV1.candidate_id
    );
  });

  it('2. rejects non-v1 schema_version with 400 UNKNOWN_SCHEMA_VERSION', async () => {
    const { app, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);

    const invalidPayload = {
      ...validCandidateV1,
      schema_version: 'v99', // 显式非 v1
    };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: invalidPayload,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('UNKNOWN_SCHEMA_VERSION');
    expect(body.error.field).toBe('schema_version');

    // 无副作用：task 仓库未被修改（status 仍为 received，无 raw_candidate）
    const task = await repository.findById(ingestionId);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('received');
    expect(task!.raw_candidate).toBeUndefined();
    expect(task!.candidate).toBeUndefined();

    // 无副作用：review 仓库为空
    expect(reviewRepository.size()).toBe(0);
  });

  it('3. rejects missing required subfield (processing.ocr_version) with 400 MISSING_REQUIRED_FIELD', async () => {
    const { app, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);

    // 删除 processing.ocr_version 子字段
    const invalidPayload = JSON.parse(JSON.stringify(validCandidateV1)) as {
      processing: { ocr_version?: string; asr_version: string; processed_at: string; agent_version: string };
    };
    delete invalidPayload.processing.ocr_version;

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: invalidPayload,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('MISSING_REQUIRED_FIELD');
    expect(body.error.field).toContain('processing');

    // 无副作用：task 仓库未被修改
    const task = await repository.findById(ingestionId);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('received');
    expect(task!.raw_candidate).toBeUndefined();
    expect(task!.candidate).toBeUndefined();

    // 无副作用：review 仓库为空
    expect(reviewRepository.size()).toBe(0);
  });

  it('4. no side effects on validation failure: task unchanged, no review created, no Feishu write', async () => {
    const { app, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);

    // 缺失 raw_evidence.redacted（必填子字段）
    const invalidPayload = JSON.parse(JSON.stringify(validCandidateV1)) as {
      raw_evidence: { redacted?: boolean };
    };
    delete invalidPayload.raw_evidence.redacted;

    const taskBefore = await repository.findById(ingestionId);
    expect(taskBefore).not.toBeNull();
    const taskBeforeSnapshot = JSON.parse(JSON.stringify(taskBefore));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: invalidPayload,
    });

    expect(response.statusCode).toBe(400);

    // 无副作用：task 与调用前完全一致（深比较）
    const taskAfter = await repository.findById(ingestionId);
    expect(taskAfter).not.toBeNull();
    expect(JSON.parse(JSON.stringify(taskAfter))).toEqual(taskBeforeSnapshot);

    // 无副作用：review 仓库为空（无复核记录创建）
    expect(reviewRepository.size()).toBe(0);

    // 无副作用：task 未进入 candidate_received 状态
    expect(taskAfter!.status).toBe('received');
    expect(taskAfter!.raw_candidate).toBeUndefined();
    expect(taskAfter!.candidate).toBeUndefined();
    expect(taskAfter!.review_record_id).toBeUndefined();
  });

  // FAMP-CONTRACT-ADOPTION-GATE-01-R1: redacted=false 必须 fail closed
  // AC-A07：v99、缺必填字段、redacted=false 均 fail closed
  // 验证 raw_evidence.redacted=false（强制脱敏失败）时返回 400（zod 归类为 INVALID_FIELD_TYPE，
  // 因为 z.literal(true) 不匹配 false），且不产生任何副作用。
  it('5. rejects raw_evidence.redacted=false with 400 (fail closed, no side effects)', async () => {
    const { app, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);

    // redacted=false：违反强制脱敏标记，必须 fail closed
    const invalidPayload = JSON.parse(JSON.stringify(validCandidateV1)) as {
      raw_evidence: { redacted: boolean };
    };
    invalidPayload.raw_evidence.redacted = false;

    const taskBefore = await repository.findById(ingestionId);
    expect(taskBefore).not.toBeNull();
    const taskBeforeSnapshot = JSON.parse(JSON.stringify(taskBefore));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: invalidPayload,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    // collator 用 zod 校验，redacted=false 命中 z.literal(true) 的 invalid_literal，
    // 但 fieldPath 不是 schema_version，所以归类为 INVALID_FIELD_TYPE
    expect(body.error.code).toBe('INVALID_FIELD_TYPE');
    expect(body.error.field).toContain('redacted');

    // 无副作用：task 与调用前完全一致
    const taskAfter = await repository.findById(ingestionId);
    expect(taskAfter).not.toBeNull();
    expect(JSON.parse(JSON.stringify(taskAfter))).toEqual(taskBeforeSnapshot);

    // 无副作用：review 仓库为空
    expect(reviewRepository.size()).toBe(0);

    // 无副作用：task 未进入 candidate_received 状态
    expect(taskAfter!.status).toBe('received');
    expect(taskAfter!.raw_candidate).toBeUndefined();
    expect(taskAfter!.candidate).toBeUndefined();
  });
});

// =============================================================================
// FAMP-CONTRACT-ADOPTION-GATE-01-R1 新增测试
// AC-R1-01: Dify callback 废止（410 Gone）
// AC-R1-02 + AC-R1-05: PRE_WRITE BLOCKED fail-closed + 无副作用
// AC-R1-06: 不存在仍可用的无门禁 fallback（Dify callback 废止后无其他入口）
// =============================================================================

describe('POST /v1/internal/ingestions/:id/candidate — AC-R1-01 Dify callback abolished', () => {
  beforeEach(() => {
    delete process.env.COLLATOR_WEBHOOK_SECRET;
  });

  it('6. AC-R1-01: abolished Dify callback route returns 410 Gone with CONTRACT_ADOPTION_GATE_ABOLISHED', async () => {
    const { app, repository } = await setup();
    const ingestionId = await createTask(app);

    const taskBefore = await repository.findById(ingestionId);
    expect(taskBefore).not.toBeNull();
    const taskBeforeSnapshot = JSON.parse(JSON.stringify(taskBefore));

    // 即使带签名也返回 410（废止路由不校验签名、不解析 body）
    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/ingestions/${ingestionId}/candidate`,
      payload: { candidate: { schema_name: 'customer', schema_version: '1.0.0' } },
    });

    expect(response.statusCode).toBe(410);
    const body = response.json();
    expect(body.error.code).toBe('CONTRACT_ADOPTION_GATE_ABOLISHED');
    expect(body.error.message).toContain('abolished');

    // 无副作用：task 未被修改
    const taskAfter = await repository.findById(ingestionId);
    expect(taskAfter).not.toBeNull();
    expect(JSON.parse(JSON.stringify(taskAfter))).toEqual(taskBeforeSnapshot);
  });

  it('7. AC-R1-01: abolished route returns 410 even without signature (no auth check, no body parsing)', async () => {
    const { app } = await setup();
    const ingestionId = await createTask(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/ingestions/${ingestionId}/candidate`,
      // 不带签名头，也不带 body — 废止路由不应触发任何处理
    });

    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe('CONTRACT_ADOPTION_GATE_ABOLISHED');
  });
});

describe('POST /v1/ingestions/:id/candidate-v1 — AC-R1-02 / AC-R1-05 PRE_WRITE BLOCKED fail-closed', () => {
  beforeEach(() => {
    delete process.env.COLLATOR_WEBHOOK_SECRET;
  });

  it('8. AC-R1-02: PRE_WRITE BLOCKED → 200 + status=candidate_blocked + task 未持久化候选', async () => {
    const callCount = { value: 0 };
    const blockedClient = new FakePreWriteClient('BLOCKED', callCount);
    const { app, repository, reviewRepository } = await setup({ preWriteClient: blockedClient });
    const ingestionId = await createTask(app);

    const taskBefore = await repository.findById(ingestionId);
    expect(taskBefore).not.toBeNull();
    const taskBeforeSnapshot = JSON.parse(JSON.stringify(taskBefore));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: validCandidateV1,
    });

    // 200 + status=candidate_blocked（治理决策，非合同错误）
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ingestion_id).toBe(ingestionId);
    expect(body.candidate_id).toBe(validCandidateV1.candidate_id);
    expect(body.status).toBe('candidate_blocked');

    // AC-R1-05 无副作用：PreWriteClient 被调用 1 次
    expect(callCount.value).toBe(1);

    // AC-R1-05 无副作用：task 与调用前完全一致（深比较）
    const taskAfter = await repository.findById(ingestionId);
    expect(taskAfter).not.toBeNull();
    expect(JSON.parse(JSON.stringify(taskAfter))).toEqual(taskBeforeSnapshot);

    // AC-R1-05 无副作用：task 未进入 candidate_received 状态
    expect(taskAfter!.status).toBe('received');
    expect(taskAfter!.raw_candidate).toBeUndefined();
    expect(taskAfter!.candidate).toBeUndefined();
    expect(taskAfter!.review_record_id).toBeUndefined();

    // AC-R1-05 无副作用：review 仓库为空
    expect(reviewRepository.size()).toBe(0);
  });

  it('9. AC-R1-02: PRE_WRITE PASS → 200 + status=candidate_received + task 持久化候选', async () => {
    const callCount = { value: 0 };
    const passClient = new FakePreWriteClient('PASS', callCount);
    const { app, repository } = await setup({ preWriteClient: passClient });
    const ingestionId = await createTask(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: validCandidateV1,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('candidate_received');
    expect(body.candidate_id).toBe(validCandidateV1.candidate_id);

    // PreWriteClient 被调用 1 次
    expect(callCount.value).toBe(1);

    // task 持久化候选
    const task = await repository.findById(ingestionId);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('candidate_received');
    expect(task!.raw_candidate).toBeDefined();
    expect(task!.raw_candidate!.schema_name).toBe('project_candidate_v1');
  });

  it('10. AC-R1-02: PRE_WRITE NEEDS_REVIEW → 200 + status=candidate_received + task 持久化候选（NEEDS_REVIEW 不阻断持久化）', async () => {
    const callCount = { value: 0 };
    const needsReviewClient = new FakePreWriteClient('NEEDS_REVIEW', callCount);
    const { app, repository } = await setup({ preWriteClient: needsReviewClient });
    const ingestionId = await createTask(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: validCandidateV1,
    });

    // NEEDS_REVIEW 不阻断持久化（候选仍需持久化以便人工复核）
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('candidate_received');

    // PreWriteClient 被调用 1 次
    expect(callCount.value).toBe(1);

    // task 持久化候选
    const task = await repository.findById(ingestionId);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('candidate_received');
    expect(task!.raw_candidate).toBeDefined();
  });

  it('11. AC-R1-05: PRE_WRITE BLOCKED idempotent replay — second call returns candidate_blocked without re-calling PreWriteClient', async () => {
    const callCount = { value: 0 };
    const blockedClient = new FakePreWriteClient('BLOCKED', callCount);
    const { app, repository } = await setup({ preWriteClient: blockedClient });
    const ingestionId = await createTask(app);

    // 第一次调用：BLOCKED，不持久化候选
    const first = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: validCandidateV1,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('candidate_blocked');
    expect(callCount.value).toBe(1);

    // 第二次调用：task 仍无 raw_candidate，所以不是幂等 replay，会再次调用 PreWriteClient
    //（幂等 replay 基于 task.raw_candidate 存在性；BLOCKED 时未持久化 raw_candidate）
    const second = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: validCandidateV1,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('candidate_blocked');
    expect(callCount.value).toBe(2);

    // 两次调用后 task 仍未持久化候选
    const task = await repository.findById(ingestionId);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('received');
    expect(task!.raw_candidate).toBeUndefined();
  });

  it('12. AC-R1-06: contract validation failure does NOT invoke PreWriteClient (route-level gate before service)', async () => {
    const callCount = { value: 0 };
    const blockedClient = new FakePreWriteClient('BLOCKED', callCount);
    const { app, repository, reviewRepository } = await setup({ preWriteClient: blockedClient });
    const ingestionId = await createTask(app);

    // v99 在路由层 validateCandidateV1 就被拒绝，不应到达 service.adoptCandidateV1
    const invalidPayload = { ...validCandidateV1, schema_version: 'v99' };
    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/candidate-v1`,
      payload: invalidPayload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('UNKNOWN_SCHEMA_VERSION');

    // PreWriteClient 不应被调用（合同校验在路由层就拒绝了）
    expect(callCount.value).toBe(0);

    // task 未被修改
    const task = await repository.findById(ingestionId);
    expect(task!.status).toBe('received');
    expect(task!.raw_candidate).toBeUndefined();

    // review 仓库为空
    expect(reviewRepository.size()).toBe(0);
  });
});
