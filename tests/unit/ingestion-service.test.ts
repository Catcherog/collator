import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { IngestionService } from '../../src/server/services/ingestion-service.js';
import { InMemoryTaskRepository } from '../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryReviewRepository } from '../../src/server/repositories/in-memory-review-repository.js';
import type { CreateIngestionRequest } from '../../src/server/domain/ingestion.js';
import type { PipelineResult } from '../../src/server/cleaning/pipeline/cleaning-pipeline.js';

// Mock the pipeline so the validation_failed path can be exercised without
// depending on internal adapter throw behaviour. By default the mock
// delegates to the real implementation so the rest of the suite covers the
// true integration with the Phase 2C pipeline.
vi.mock('../../src/server/cleaning/pipeline/cleaning-pipeline.js', async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import('../../src/server/cleaning/pipeline/cleaning-pipeline.js');
  return {
    ...actual,
    runCleaningPipeline: vi.fn(actual.runCleaningPipeline) as Mock<
      (typeof actual.runCleaningPipeline)
    >,
  };
});

import { runCleaningPipeline } from '../../src/server/cleaning/pipeline/cleaning-pipeline.js';

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

function makeCandidateFields(overrides: Record<string, unknown> = {}) {
  return {
    customer_name: '张三',
    contact: '13800138000',
    source_channel: '小红书',
    consultation_time: '2026-07-15T10:00:00.000Z',
    shooting_type: '写真',
    budget: '3000-5000元',
    style_preferences: '小清新',
    follow_up_notes: '已加微信',
    review_record: '好评1',
    ...overrides,
  };
}

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    schema_name: 'customer',
    schema_version: '1.0.0',
    prompt_version: '1.0.0',
    fields: makeCandidateFields(overrides),
    field_confidence: {},
    evidence: {},
  };
}

describe('IngestionService', () => {
  let repository: InMemoryTaskRepository;
  let reviewRepository: InMemoryReviewRepository;
  let service: IngestionService;

  beforeEach(() => {
    repository = new InMemoryTaskRepository();
    reviewRepository = new InMemoryReviewRepository();
    service = new IngestionService(repository, reviewRepository);
    // Reset the pipeline mock between tests so each starts with the real
    // implementation. Tests that need to override use mockImplementationOnce.
    vi.mocked(runCleaningPipeline).mockImplementation(
      // Re-fetch the original implementation by clearing the mock.
      vi.mocked(runCleaningPipeline).getMockImplementation() ??
        (() => {
          throw new Error('pipeline mock not initialised');
        })
    );
    // Safer: clear mock and let vi fall back to the wrapped real fn.
    vi.mocked(runCleaningPipeline).mockClear();
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
    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.createIngestion(req))
    );

    const ids = new Set(results.map((r) => r.ingestion_id));
    expect(ids.size).toBe(1);
    expect(repository.size()).toBe(1);
  });

  it('receives candidate and creates review record', async () => {
    const created = await service.createIngestion(makeRequest());
    const result = await service.receiveCandidate(created.ingestion_id, {
      candidate: makeCandidate(),
    });

    expect(result.status).toBe('pending_review');
    // review_record_id is now opaque — only assert non-empty string and
    // no longer matches the legacy rec_review_ prefix.
    expect(typeof result.review_record_id).toBe('string');
    expect(result.review_record_id.length).toBeGreaterThan(0);
    expect(result.review_record_id.startsWith('rec_review_')).toBe(false);

    const task = await service.getIngestion(created.ingestion_id);
    expect(task.status).toBe('pending_review');
    expect(task.candidate?.fields['客户姓名']).toBe('张三');
    expect(task.normalized_fields).toBeDefined();
    expect(reviewRepository.size()).toBe(1);
  });

  it('candidate callback is idempotent', async () => {
    const created = await service.createIngestion(makeRequest());
    const req = { candidate: makeCandidate() };

    const first = await service.receiveCandidate(created.ingestion_id, req);
    const replays = await Promise.all(
      Array.from({ length: 20 }, () => service.receiveCandidate(created.ingestion_id, req))
    );

    for (const replay of replays) {
      expect(replay.review_record_id).toBe(first.review_record_id);
    }
    expect(reviewRepository.size()).toBe(1);
  });

  it('approves an ingestion with corrections', async () => {
    const created = await service.createIngestion(makeRequest());
    const candidate = await service.receiveCandidate(created.ingestion_id, {
      candidate: makeCandidate(),
    });

    const approved = await service.approve(created.ingestion_id, {
      reviewer_id: 'reviewer_1',
      review_record_id: candidate.review_record_id,
      corrections: { 预算区间: '5000-8000元', shooting_date: '2026-08-01' },
    });

    expect(approved.status).toBe('completed');
    expect(approved.review_decision).toBe('modified');
    expect(approved.normalized_fields).toMatchObject({
      预算区间: '5000-8000元',
      shooting_date: '2026-08-01',
    });
  });

  it('rejects an ingestion', async () => {
    const created = await service.createIngestion(makeRequest());
    await service.receiveCandidate(created.ingestion_id, { candidate: makeCandidate() });

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
    const candidate = await service.receiveCandidate(created.ingestion_id, {
      candidate: makeCandidate(),
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

  // ---------------------------------------------------------------------
  // TASK-002 new behaviour: mapping, pipeline integration, review workflow
  // ---------------------------------------------------------------------

  it('produces identical normalized_fields for equivalent English and Chinese candidates', async () => {
    const englishIngestion = await service.createIngestion(makeRequest({ source_record_id: 'rec_en' }));
    await service.receiveCandidate(englishIngestion.ingestion_id, {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: {
          customer_name: '张三',
          contact: '13800138000',
          budget: '3000-5000元',
        },
        field_confidence: {},
        evidence: {},
      },
    });

    const chineseIngestion = await service.createIngestion(
      makeRequest({ source_record_id: 'rec_cn' })
    );
    await service.receiveCandidate(chineseIngestion.ingestion_id, {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: {
          客户姓名: '张三',
          联系方式: '13800138000',
          预算区间: '3000-5000元',
        },
        field_confidence: {},
        evidence: {},
      },
    });

    const enTask = await service.getIngestion(englishIngestion.ingestion_id);
    const cnTask = await service.getIngestion(chineseIngestion.ingestion_id);

    expect(enTask.normalized_fields).toEqual(cnTask.normalized_fields);
  });

  it('persists mapping and pipeline warnings on the task', async () => {
    const created = await service.createIngestion(makeRequest());
    await service.receiveCandidate(created.ingestion_id, {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: {
          customer_name: '张三',
          unknown_field: 'should be dropped',
        },
        field_confidence: {},
        evidence: {},
      },
    });

    const task = await service.getIngestion(created.ingestion_id);
    const unmapped = task.warnings.find((w) => w.code === 'UNMAPPED_CANDIDATE_FIELD');
    expect(unmapped).toBeDefined();
    expect(unmapped?.field).toBe('unknown_field');
  });

  it('keeps unknown fields out of normalized_fields', async () => {
    const created = await service.createIngestion(makeRequest());
    await service.receiveCandidate(created.ingestion_id, {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: {
          customer_name: '张三',
          unknown_field: 'should be dropped',
          another_unknown: 42,
        },
        field_confidence: {},
        evidence: {},
      },
    });

    const task = await service.getIngestion(created.ingestion_id);
    expect(task.normalized_fields).toBeDefined();
    expect(task.normalized_fields!['unknown_field']).toBeUndefined();
    expect(task.normalized_fields!['another_unknown']).toBeUndefined();
    expect(task.normalized_fields!['客户姓名']).toBe('张三');
  });

  it('stores pipeline validation and corrections in the review record', async () => {
    const created = await service.createIngestion(makeRequest());
    await service.receiveCandidate(created.ingestion_id, {
      candidate: makeCandidate(),
    });

    const review = await reviewRepository.findByIngestionId(created.ingestion_id);
    expect(review).not.toBeNull();
    expect(review?.status).toBe('pending_review');
    expect(review?.normalized_fields).toBeDefined();
    expect(review?.validation).toBeDefined();
    // Pipeline evidence is persisted inside validation.
    const validation = review!.validation as Record<string, unknown>;
    expect(validation['pipelineVersion']).toBeDefined();
    expect(validation['stages']).toBeDefined();
    expect(validation['validation']).toBeDefined();
    expect(validation['corrections']).toBeDefined();
    expect(validation['warnings']).toBeDefined();
    expect(validation['errors']).toBeDefined();
    expect(validation['qualityReport']).toBeDefined();
  });

  it('sets validation_failed and creates no review when pipeline returns success=false', async () => {
    const failureResult: PipelineResult = {
      standardizedRecord: {},
      validation: null,
      errors: [
        {
          stage: 'format_clean',
          module: 'cleaner-adapter',
          code: 'PIPELINE_STAGE_FAILED',
          message: 'simulated failure',
        },
      ],
      warnings: [],
      corrections: [],
      qualityReport: null,
      stages: [
        { name: 'format_clean', status: 'failed', module: 'cleaner-adapter' },
        { name: 'enum_map_clean', status: 'skipped' },
        { name: 'validate', status: 'skipped' },
        { name: 'quality_assessment', status: 'skipped' },
      ],
      pipelineVersion: '2c.1.0',
      success: false,
    };
    vi.mocked(runCleaningPipeline).mockImplementationOnce(() => failureResult);

    const created = await service.createIngestion(makeRequest());
    const result = await service.receiveCandidate(created.ingestion_id, {
      candidate: makeCandidate(),
    });

    expect(result.status).toBe('validation_failed');
    expect(result.review_record_id).toBe('');

    const task = await service.getIngestion(created.ingestion_id);
    expect(task.status).toBe('validation_failed');

    const review = await reviewRepository.findByIngestionId(created.ingestion_id);
    expect(review).toBeNull();
    expect(reviewRepository.size()).toBe(0);
  });

  it('returns one opaque review_record_id for 20 concurrent identical callbacks', async () => {
    const created = await service.createIngestion(makeRequest());
    const req = { candidate: makeCandidate() };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.receiveCandidate(created.ingestion_id, req))
    );

    const ids = new Set(results.map((r) => r.review_record_id));
    expect(ids.size).toBe(1);
    const id = results[0].review_record_id;
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(id.startsWith('rec_review_')).toBe(false);
    expect(reviewRepository.size()).toBe(1);
  });

  it('returns the existing review for a replay after a new service instance is created', async () => {
    const created = await service.createIngestion(makeRequest());
    const req = { candidate: makeCandidate() };
    const first = await service.receiveCandidate(created.ingestion_id, req);

    // Build a brand-new service instance backed by the SAME repositories so
    // the in-memory state carries over. This simulates a process restart.
    const newService = new IngestionService(repository, reviewRepository);
    const replay = await newService.receiveCandidate(created.ingestion_id, req);

    expect(replay.review_record_id).toBe(first.review_record_id);
    expect(replay.status).toBe('pending_review');
    expect(reviewRepository.size()).toBe(1);
  });
});
