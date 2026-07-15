import { describe, it, expect, beforeEach } from 'vitest';
import { IngestionService } from '../../src/server/services/ingestion-service.js';
import { InMemoryTaskRepository } from '../../src/server/repositories/in-memory-task-repository.js';
import type { CreateIngestionRequest } from '../../src/server/domain/ingestion.js';

function makeRequest(overrides: Partial<CreateIngestionRequest> = {}): CreateIngestionRequest {
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
    ...overrides,
  };
}

describe('IngestionService', () => {
  let repository: InMemoryTaskRepository;
  let service: IngestionService;

  beforeEach(() => {
    repository = new InMemoryTaskRepository();
    service = new IngestionService(repository);
  });

  it('creates a new ingestion task', async () => {
    const result = await service.createIngestion(makeRequest());
    expect(result.status).toBe('received');
    expect(result.idempotent_replay).toBe(false);
    expect(result.ingestion_id).toMatch(/^ing_[a-f0-9]{32}$/);
    expect(repository.size()).toBe(1);
  });

  it('returns idempotent replay for duplicate requests', async () => {
    const req = makeRequest();
    const first = await service.createIngestion(req);
    const second = await service.createIngestion(req);

    expect(second.ingestion_id).toBe(first.ingestion_id);
    expect(second.idempotent_replay).toBe(true);
    expect(repository.size()).toBe(1);
  });

  it('rejects unsupported target_domain', async () => {
    await expect(
      service.createIngestion(makeRequest({ target_domain: 'order_creation' }))
    ).rejects.toThrow('V1 only supports target_domain=customer_consultation');
  });

  it('rejects empty content', async () => {
    await expect(service.createIngestion(makeRequest({ content: '   ' }))).rejects.toThrow(
      'content is required'
    );
  });

  it('20 duplicate requests create exactly one task', async () => {
    const req = makeRequest();
    const results = await Promise.all(Array.from({ length: 20 }, () => service.createIngestion(req)));

    const ids = new Set(results.map((r) => r.ingestion_id));
    expect(ids.size).toBe(1);
    expect(repository.size()).toBe(1);
  });

  it('receives candidate and creates review record', async () => {
    const created = await service.createIngestion(makeRequest());
    const result = await service.receiveCandidate(created.ingestion_id, {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: { budget: '3000-5000元' },
        field_confidence: { budget: 0.95 },
        evidence: { budget: '预算3000元左右' },
      },
    });

    expect(result.status).toBe('pending_review');
    expect(result.review_record_id).toMatch(/^rec_review_[a-f0-9]{32}$/);

    const task = await service.getIngestion(created.ingestion_id);
    expect(task.status).toBe('pending_review');
    expect(task.candidate?.fields.budget).toBe('3000-5000元');
  });

  it('candidate callback is idempotent', async () => {
    const created = await service.createIngestion(makeRequest());
    const req = {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: { budget: '3000-5000元' },
        field_confidence: {},
        evidence: {},
      },
    };

    const first = await service.receiveCandidate(created.ingestion_id, req);
    const replays = await Promise.all(
      Array.from({ length: 20 }, () => service.receiveCandidate(created.ingestion_id, req))
    );

    for (const replay of replays) {
      expect(replay.review_record_id).toBe(first.review_record_id);
    }
  });

  it('approves an ingestion with corrections', async () => {
    const created = await service.createIngestion(makeRequest());
    const candidate = await service.receiveCandidate(created.ingestion_id, {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: { budget: '3000-5000元' },
        field_confidence: {},
        evidence: {},
      },
    });

    const approved = await service.approve(created.ingestion_id, {
      reviewer_id: 'reviewer_1',
      review_record_id: candidate.review_record_id,
      corrections: { budget: '3000-5000元', shooting_date: '2026-08-01' },
    });

    expect(approved.status).toBe('completed');
    expect(approved.review_decision).toBe('modified');
    expect(approved.normalized_fields).toEqual({
      budget: '3000-5000元',
      shooting_date: '2026-08-01',
    });
  });

  it('rejects an ingestion', async () => {
    const created = await service.createIngestion(makeRequest());
    await service.receiveCandidate(created.ingestion_id, {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: {},
        field_confidence: {},
        evidence: {},
      },
    });

    const rejected = await service.reject(created.ingestion_id, {
      reviewer_id: 'reviewer_1',
      reason_code: 'INSUFFICIENT_INFO',
      reason: '缺少联系方式，无法跟进。',
    });

    expect(rejected.status).toBe('review_rejected');
    expect(rejected.review_decision).toBe('rejected');
    expect(rejected.error_code).toBe('INSUFFICIENT_INFO');
  });

  it('cannot approve a rejected ingestion', async () => {
    const created = await service.createIngestion(makeRequest());
    await service.receiveCandidate(created.ingestion_id, {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: {},
        field_confidence: {},
        evidence: {},
      },
    });

    const candidate = await service.receiveCandidate(created.ingestion_id, {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: {},
        field_confidence: {},
        evidence: {},
      },
    });

    await service.reject(created.ingestion_id, {
      reviewer_id: 'reviewer_1',
      reason_code: 'INSUFFICIENT_INFO',
      reason: '缺少联系方式。',
    });

    await expect(
      service.approve(created.ingestion_id, {
        reviewer_id: 'reviewer_1',
        review_record_id: candidate.review_record_id,
      })
    ).rejects.toThrow('Rejected ingestion cannot be approved');
  });
});
