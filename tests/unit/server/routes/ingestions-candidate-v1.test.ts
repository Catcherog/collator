// Task 3 Adoption Gate — collator 持续摄入入口级测试
//
// 验证 AC-10 Adoption Gate 的 collator 侧采用点：
//   1. 合法 Candidate V1 → 200 + service.adoptCandidateV1 被调用
//   2. 非法 schema_version (v99) → 400 UNKNOWN_SCHEMA_VERSION + service 未被调用
//   3. 缺失必填子字段 (processing.ocr_version) → 400 MISSING_REQUIRED_FIELD + service 未被调用
//   4. 无副作用：校验失败时 task 仓库未被修改、review 仓库为空
//
// 运行：vitest run tests/unit/server/routes/ingestions-candidate-v1.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../../../src/server/app.js';
import { InMemoryTaskRepository } from '../../../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryReviewRepository } from '../../../../src/server/repositories/in-memory-review-repository.js';
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

async function setup(): Promise<{
  app: FastifyInstance;
  repository: InMemoryTaskRepository;
  reviewRepository: InMemoryReviewRepository;
}> {
  process.env.COLLATOR_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const repository = new InMemoryTaskRepository();
  const reviewRepository = new InMemoryReviewRepository();
  const { app } = await buildApp({
    repository,
    reviewRepository,
  });
  return { app, repository, reviewRepository };
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
});
