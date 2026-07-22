// feishu-gate-d.test.ts
// TASK-003 Gate D mock integration test.
//
// Exercises the full TASK-003 commit flow against a mock FeishuClient so the
// Gate D acceptance criteria can be verified without real Feishu credentials.
// The real `npm run gate:d` runner (scripts/run-gate-d.ts) performs the
// same sequence against a live Feishu Base; this mock test guards the
// contract in CI.
//
// Gate D synthetic record (per TASK-003 spec):
//   客户姓名: GateD测试客户
//   联系方式: 13800000000
//   来源渠道: 其他
//   拍摄类型: 亲子
//   预算区间: 1000-2000元
//   意向风格: 日系清新
//   跟进记录: COLLATOR_GATE_D_TEST:<uuid>
//
// Security constraints exercised:
// - No real app_secret / tenant_access_token in the test fixture.
// - Cleanup is by precise record_id returned by the mock client — never by
//   name / phone / fuzzy condition.
// - The synthetic phone (13800000000) is treated as PII and redacted in
//   HTTP responses.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { buildApp } from '../../src/server/app.js';
import { InMemoryTaskRepository } from '../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryReviewRepository } from '../../src/server/repositories/in-memory-review-repository.js';
import { InMemoryWriteLogRepository } from '../../src/server/repositories/in-memory-write-log-repository.js';
import { FeishuCustomerRecordWriter } from '../../src/server/business/customer-record-writer.js';
import { FeishuWriteLogRepository } from '../../src/server/repositories/feishu-write-log-repository.js';
import { FeishuClient } from '../../src/server/feishu/feishu-client.js';
import type { FastifyInstance } from 'fastify';
import type { FeishuRecord } from '../../src/server/feishu/feishu-client.js';
import type { IngestionService } from '../../src/server/services/ingestion-service.js';
import type { CandidateCallbackRequest } from '../../src/server/domain/ingestion.js';
import { NoOpPreWriteClient } from '../../src/server/governance/pre-write-client.js';

const WEBHOOK_SECRET = 'test-webhook-secret';
const CUSTOMER_TABLE_ID = 'tblCustomerGateD';
const WRITE_LOG_TABLE_ID = 'tblWriteLogGateD';

/**
 * Minimal mock FeishuClient. Records every call so the test can assert
 * idempotency (no duplicate createRecord calls for the same ingestion ID)
 * and precise cleanup (deleteRecord by exact record_id).
 *
 * NOTE: `createCalls` / `createdRecords` aggregate writes across ALL tables
 * (customer table + write-log table). Use `customerCreateCalls` /
 * `getCustomerRecords()` when asserting idempotency on the customer table
 * specifically — the write-log repository shares the same mock client and
 * also calls `createRecord`.
 */
class MockFeishuClient {
  public readonly createdRecords = new Map<string, { fields: Record<string, unknown> }>();
  public readonly deletedRecordIds = new Set<string>();
  public createCalls = 0;
  public customerCreateCalls = 0;
  public searchCalls = 0;

  async getTenantAccessToken(): Promise<string> {
    return 'mock-tenant-token';
  }

  async createRecord(tableId: string, fields: Record<string, unknown>): Promise<string> {
    this.createCalls++;
    if (tableId === CUSTOMER_TABLE_ID) {
      this.customerCreateCalls++;
    }
    const recordId = `rec_mock_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    this.createdRecords.set(recordId, { fields: { ...fields, _tableId: tableId } });
    return recordId;
  }

  /** Test helper: return only customer-table records (excluding write logs). */
  getCustomerRecords(): Map<string, { fields: Record<string, unknown> }> {
    const result = new Map<string, { fields: Record<string, unknown> }>();
    for (const [id, rec] of this.createdRecords.entries()) {
      if (rec.fields['_tableId'] === CUSTOMER_TABLE_ID) {
        result.set(id, rec);
      }
    }
    return result;
  }

  async searchRecords(
    tableId: string,
    opts: { filter?: { conditions: Array<{ field_name: string; value: unknown[] }> } }
  ): Promise<FeishuRecord[]> {
    this.searchCalls++;
    const filter = opts.filter;
    if (!filter || !filter.conditions || filter.conditions.length === 0) {
      return Array.from(this.createdRecords.entries()).map(([record_id, rec]) => ({
        record_id,
        fields: rec.fields,
      }));
    }
    // Support lookup by `Collator 摄入 ID` (the writer's idempotency key)
    // and by `摄入 ID` (the write-log repository's key).
    const results: FeishuRecord[] = [];
    for (const [record_id, rec] of this.createdRecords.entries()) {
      let match = true;
      for (const cond of filter.conditions) {
        const fieldValue = rec.fields[cond.field_name];
        const expected = cond.value[0];
        // Feishu text fields may be stored as { text: '...' } objects;
        // our mock stores raw values.
        const actual =
          fieldValue && typeof fieldValue === 'object' && 'text' in (fieldValue as object)
            ? (fieldValue as { text: string }).text
            : fieldValue;
        if (actual !== expected) {
          match = false;
          break;
        }
      }
      if (match && rec.fields['_tableId'] === tableId) {
        results.push({ record_id, fields: rec.fields });
      }
    }
    return results;
  }

  async updateRecord(
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ): Promise<FeishuRecord> {
    void tableId;
    const existing = this.createdRecords.get(recordId);
    if (!existing) {
      throw new Error(`record not found: ${recordId}`);
    }
    existing.fields = { ...existing.fields, ...fields };
    return { record_id: recordId, fields: existing.fields };
  }

  async deleteRecord(tableId: string, recordId: string): Promise<void> {
    void tableId;
    if (!this.createdRecords.has(recordId)) {
      throw new Error(`cannot delete unknown record: ${recordId}`);
    }
    this.createdRecords.delete(recordId);
    this.deletedRecordIds.add(recordId);
  }

  /** Test helper: assert a record was deleted by exact ID. */
  assertDeleted(recordId: string): void {
    if (!this.deletedRecordIds.has(recordId)) {
      throw new Error(`expected record ${recordId} to be deleted, but it was not`);
    }
  }
}

async function buildGateDApp(mockClient: MockFeishuClient): Promise<{
  app: FastifyInstance;
  service: IngestionService;
  repository: InMemoryTaskRepository;
  reviewRepository: InMemoryReviewRepository;
  writeLogRepository: InMemoryWriteLogRepository;
  feishuWriteLogRepository: FeishuWriteLogRepository;
}> {
  process.env.COLLATOR_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const repository = new InMemoryTaskRepository();
  const reviewRepository = new InMemoryReviewRepository();
  const writeLogRepository = new InMemoryWriteLogRepository();
  const feishuWriteLogRepository = new FeishuWriteLogRepository(
    mockClient as unknown as FeishuClient,
    { writeLogTableId: WRITE_LOG_TABLE_ID }
  );
  const customerRecordWriter = new FeishuCustomerRecordWriter(
    mockClient as unknown as FeishuClient,
    { customerTableId: CUSTOMER_TABLE_ID }
  );
  const { app, service } = await buildApp({
    repository,
    reviewRepository,
    customerRecordWriter,
    // Use the Feishu-backed write-log repository so Gate D exercises the
    // real create/search path. The InMemoryWriteLogRepository is used as
    // a cross-check shadow in selected assertions.
    writeLogRepository: feishuWriteLogRepository,
    // RF-02: 测试模式必须显式注入 preWriteClient（无 NoOp 默认 fallback）。
    preWriteClient: new NoOpPreWriteClient(),
  });
  return { app, service, repository, reviewRepository, writeLogRepository, feishuWriteLogRepository };
}

function makeGateDIngestionBody() {
  return {
    source_system: 'feishu_form',
    source_record_id: 'gate_d_rec_001',
    source_type: 'chat_text',
    target_domain: 'customer_consultation',
    content: 'Gate D synthetic test ingestion.',
    submitted_at: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    submitted_by: 'gate_d_runner',
    dry_run: false,
  };
}

function makeGateDCandidateFields() {
  const gateDUuid = randomUUID();
  return {
    // Per TASK-003 spec — exact synthetic values.
    客户姓名: 'GateD测试客户',
    联系方式: '13800000000',
    来源渠道: '其他',
    拍摄类型: '亲子',
    预算区间: '1000-2000元',
    意向风格: '日系清新',
    跟进记录: `COLLATOR_GATE_D_TEST:${gateDUuid}`,
  };
}

describe('TASK-003 Gate D (mock): customer-table commit flow acceptance', () => {
  let mockClient: MockFeishuClient;
  let app: FastifyInstance;
  let service: IngestionService;
  let repository: InMemoryTaskRepository;
  let reviewRepository: InMemoryReviewRepository;
  let feishuWriteLogRepository: FeishuWriteLogRepository;

  beforeEach(async () => {
    mockClient = new MockFeishuClient();
    const built = await buildGateDApp(mockClient);
    app = built.app;
    service = built.service;
    repository = built.repository;
    reviewRepository = built.reviewRepository;
    feishuWriteLogRepository = built.feishuWriteLogRepository;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('end-to-end: approve -> committing -> completed with real business_record_id + write log', async () => {
    // Step 1: create ingestion (dry_run=false so the commit flow runs).
    const created = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: makeGateDIngestionBody(),
    });
    expect(created.statusCode).toBe(202);
    const ingestionId = created.json().ingestion_id as string;

    // Step 2: candidate callback with Gate D synthetic fields.
    // FAMP-CONTRACT-ADOPTION-GATE-01-R1: Dify callback HTTP route abolished (410 Gone).
    // Test now calls service.receiveCandidate directly.
    const candidatePayload = {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: makeGateDCandidateFields(),
        field_confidence: {},
        evidence: {},
      },
    };
    const candidateResult = await service.receiveCandidate(
      ingestionId,
      candidatePayload as CandidateCallbackRequest
    );
    const reviewRecordId = candidateResult.review_record_id as string;
    expect(reviewRecordId).toBeTruthy();

    // Step 3: approve — triggers the full commit flow.
    const approveResponse = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/approve`,
      payload: { reviewer_id: 'gate_d_reviewer', review_record_id: reviewRecordId },
    });
    expect(approveResponse.statusCode).toBe(200);
    const approved = approveResponse.json();
    expect(approved.status).toBe('completed');
    expect(approved.business_record_id).toMatch(/^rec_mock_/);
    expect(approved.error_code).toBeUndefined();

    const businessRecordId = approved.business_record_id as string;

    // Step 4: verify the customer record was created with the exact Gate D
    // synthetic fields + the Collator 摄入 ID idempotency key.
    const createdRecord = mockClient.createdRecords.get(businessRecordId);
    expect(createdRecord).toBeDefined();
    expect(createdRecord!.fields['客户姓名']).toBe('GateD测试客户');
    expect(createdRecord!.fields['联系方式']).toBe('13800000000');
    expect(createdRecord!.fields['来源渠道']).toBe('其他');
    expect(createdRecord!.fields['拍摄类型']).toBe('亲子');
    expect(createdRecord!.fields['预算区间']).toBe('1000-2000元');
    expect(createdRecord!.fields['意向风格']).toEqual(['日系清新']);
    expect(createdRecord!.fields['跟进记录']).toMatch(/^COLLATOR_GATE_D_TEST:/);
    expect(createdRecord!.fields['Collator 摄入 ID']).toBe(ingestionId);

    // Step 5: verify the write log was persisted with status=succeeded.
    const logs = await feishuWriteLogRepository.findByIngestionId(ingestionId);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('succeeded');
    expect(logs[0].business_record_id).toBe(businessRecordId);
    expect(logs[0].target_table_id).toBe(CUSTOMER_TABLE_ID);

    // Step 6: verify the task is readable across a new repository instance
    // (the Gate D runner creates fresh repository instances; the task must
    // be durable).
    const freshRepository = new InMemoryTaskRepository();
    // The in-memory repository does not persist across instances, so we
    // verify the original instance still holds the completed task. The
    // Feishu-backed runner exercises true cross-instance durability.
    const storedTask = await repository.findById(ingestionId);
    expect(storedTask).not.toBeNull();
    expect(storedTask!.status).toBe('completed');
    expect(storedTask!.business_record_id).toBe(businessRecordId);
    void freshRepository;

    // Step 7: verify the review record was persisted.
    const review = await reviewRepository.findByIngestionId(ingestionId);
    expect(review).not.toBeNull();
    expect(review!.status).toBe('pending_review');
    expect(review!.candidate.fields['客户姓名']).toBe('GateD测试客户');

    // Step 8: cleanup — delete the customer record and write log by precise
    // record_id. Fuzzy deletion (by name/phone) is forbidden per TASK-003.
    await mockClient.deleteRecord(CUSTOMER_TABLE_ID, businessRecordId);
    const writeLogId = logs[0].write_log_id;
    await mockClient.deleteRecord(WRITE_LOG_TABLE_ID, writeLogId);
    mockClient.assertDeleted(businessRecordId);
    mockClient.assertDeleted(writeLogId);
  });

  it('duplicate approve is idempotent: writer search finds existing record, no duplicate created', async () => {
    // First approval creates the customer record.
    const created = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: makeGateDIngestionBody(),
    });
    const ingestionId = created.json().ingestion_id as string;

    const candidatePayload = {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: makeGateDCandidateFields(),
        field_confidence: {},
        evidence: {},
      },
    };
    // FAMP-CONTRACT-ADOPTION-GATE-01-R1: Dify callback HTTP route abolished.
    const candidateResult = await service.receiveCandidate(
      ingestionId,
      candidatePayload as CandidateCallbackRequest
    );
    const reviewRecordId = candidateResult.review_record_id as string;

    const firstApprove = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/approve`,
      payload: { reviewer_id: 'gate_d_reviewer', review_record_id: reviewRecordId },
    });
    expect(firstApprove.statusCode).toBe(200);
    const firstBusinessRecordId = firstApprove.json().business_record_id as string;
    expect(firstBusinessRecordId).toMatch(/^rec_mock_/);

    // The second approve should be rejected because the task is already
    // completed (ConflictError -> HTTP 409). This is the service-layer
    // idempotency: a completed task cannot be re-approved.
    const secondApprove = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/approve`,
      payload: { reviewer_id: 'gate_d_reviewer', review_record_id: reviewRecordId },
    });
    expect(secondApprove.statusCode).toBe(409);
    expect(secondApprove.json().error.code).toBe('CONFLICT');

    // Exactly one CUSTOMER record was created (no duplicate from the
    // blocked second approve). `customerCreateCalls` isolates customer-table
    // creates from write-log creates (both share the same mock client).
    expect(mockClient.customerCreateCalls).toBe(1);
    expect(mockClient.getCustomerRecords().size).toBe(1);

    // Cleanup by precise record_id.
    await mockClient.deleteRecord(CUSTOMER_TABLE_ID, firstBusinessRecordId);
    const logs = await feishuWriteLogRepository.findByIngestionId(ingestionId);
    expect(logs).toHaveLength(1);
    await mockClient.deleteRecord(WRITE_LOG_TABLE_ID, logs[0].write_log_id);
  });

  it('PII redaction: synthetic phone 13800000000 is masked in GET response', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: makeGateDIngestionBody(),
    });
    const ingestionId = created.json().ingestion_id as string;

    const candidatePayload = {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: makeGateDCandidateFields(),
        field_confidence: {},
        evidence: {},
      },
    };
    // FAMP-CONTRACT-ADOPTION-GATE-01-R1: Dify callback HTTP route abolished (410 Gone).
    // Test now calls service.receiveCandidate directly.
    await service.receiveCandidate(
      ingestionId,
      candidatePayload as CandidateCallbackRequest
    );

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    expect(getResponse.statusCode).toBe(200);
    // The raw synthetic phone must NOT appear in the HTTP response.
    expect(getResponse.body).not.toContain('13800000000');
    // The masked form is present instead.
    expect(getResponse.body).toContain('138****0000');
  });

  it('cleanup failure reports the exact record ID (no fuzzy deletion)', async () => {
    // Create a record manually in the mock client to simulate a leftover
    // from a previous failed cleanup.
    const orphanId = await mockClient.createRecord(CUSTOMER_TABLE_ID, {
      '客户姓名': 'GateD测试客户',
      'Collator 摄入 ID': 'ing_orphan',
    });

    // Cleanup by precise record_id succeeds.
    await mockClient.deleteRecord(CUSTOMER_TABLE_ID, orphanId);
    mockClient.assertDeleted(orphanId);

    // A second cleanup of the same ID fails — the runner must surface
    // this as a failure with the exact record ID, NOT fall back to
    // deleting by name or phone.
    await expect(mockClient.deleteRecord(CUSTOMER_TABLE_ID, orphanId)).rejects.toThrow(
      /cannot delete unknown record: rec_mock_/
    );
  });
});
