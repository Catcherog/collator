import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { IngestionService } from '../../src/server/services/ingestion-service.js';
import { InMemoryTaskRepository } from '../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryReviewRepository } from '../../src/server/repositories/in-memory-review-repository.js';
import { InMemoryWriteLogRepository } from '../../src/server/repositories/in-memory-write-log-repository.js';
import type { WriteLogRepository } from '../../src/server/repositories/write-log-repository.js';
import { FeishuCommitFailedError } from '../../src/server/domain/errors.js';
import { FeishuApiError } from '../../src/server/feishu/feishu-errors.js';
import type { CustomerRecordWriter, CustomerRecordWriterInput, CustomerRecordWriterResult } from '../../src/server/business/customer-record-writer.js';
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
      // 预算区间 is a real customer-schema enum field; '5000元以上' is in
      // the enum (candidate had '3000-5000元'). English `budget` key is also
      // supported by TASK-002 mapper and is exercised in the TASK-003
      // corrections test below.
      corrections: { 预算区间: '5000元以上' },
    });

    expect(approved.status).toBe('completed');
    expect(approved.review_decision).toBe('modified');
    expect(approved.normalized_fields).toMatchObject({
      预算区间: '5000元以上',
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

  // ---------------------------------------------------------------------
  // TASK-002 P0 regression tests
  // ---------------------------------------------------------------------

  describe('P0-02: original Candidate evidence retained as raw_candidate', () => {
    it('persists an untouched deep copy of the original Candidate on the task', async () => {
      const created = await service.createIngestion(makeRequest());
      const originalCandidate = makeCandidate({ unknown_field: 'should be retained verbatim' });
      const req = { candidate: originalCandidate };

      await service.receiveCandidate(created.ingestion_id, req);

      const task = await service.getIngestion(created.ingestion_id);
      expect(task.raw_candidate).toBeDefined();
      // Byte-for-byte / deep-equal preservation of the original Candidate.
      expect(task.raw_candidate).toEqual(originalCandidate);
      // The canonical candidate has mapped fields only.
      expect(task.candidate?.fields['客户姓名']).toBe('张三');
      expect(task.candidate?.fields['unknown_field']).toBeUndefined();
      // Raw candidate keeps the original English + unknown keys.
      expect(task.raw_candidate?.fields['customer_name']).toBe('张三');
      expect(task.raw_candidate?.fields['unknown_field']).toBe('should be retained verbatim');
    });

    it('keeps unknown fields out of canonical Pipeline input and normalized_fields', async () => {
      const created = await service.createIngestion(makeRequest());
      await service.receiveCandidate(created.ingestion_id, {
        candidate: makeCandidate({ unknown_field: 'dropped', another_unknown: 42 }),
      });

      const task = await service.getIngestion(created.ingestion_id);
      expect(task.normalized_fields).toBeDefined();
      expect(task.normalized_fields!['unknown_field']).toBeUndefined();
      expect(task.normalized_fields!['another_unknown']).toBeUndefined();
      expect(task.normalized_fields!['客户姓名']).toBe('张三');
    });

    it('retains raw evidence on the review record and survives replay across a new service instance', async () => {
      const created = await service.createIngestion(makeRequest());
      const originalCandidate = makeCandidate({ secret_field: 'secret_value' });
      const req = { candidate: originalCandidate };

      const first = await service.receiveCandidate(created.ingestion_id, req);

      const review = await reviewRepository.findByIngestionId(created.ingestion_id);
      expect(review).not.toBeNull();
      const validation = review!.validation as Record<string, unknown>;
      const rawCandidate = validation['rawCandidate'] as {
        fields: Record<string, unknown>;
      };
      expect(rawCandidate).toBeDefined();
      expect(rawCandidate.fields['secret_field']).toBe('secret_value');
      expect(rawCandidate.fields['customer_name']).toBe('张三');

      // New service instance simulates process restart.
      const newService = new IngestionService(repository, reviewRepository);
      const replay = await newService.receiveCandidate(created.ingestion_id, req);
      expect(replay.review_record_id).toBe(first.review_record_id);

      // Raw evidence still intact after replay.
      const reviewAfterReplay = await reviewRepository.findByIngestionId(created.ingestion_id);
      const validationAfter = reviewAfterReplay!.validation as Record<string, unknown>;
      const rawAfter = validationAfter['rawCandidate'] as { fields: Record<string, unknown> };
      expect(rawAfter.fields['secret_field']).toBe('secret_value');
    });

    it('sanitizes PII/path leakage in mapper warning field and message before persistence', async () => {
      const created = await service.createIngestion(makeRequest());
      // Two attacker-controlled unknown keys: one smuggles a phone number,
      // the other smuggles an absolute filesystem path.
      await service.receiveCandidate(created.ingestion_id, {
        candidate: makeCandidate({
          'phone_13800138000_field': 'dropped',
          '/etc/passwd': 'also_dropped',
        }),
      });

      const task = await service.getIngestion(created.ingestion_id);
      // Phone-bearing key → warning.field and warning.message have the
      // phone number redacted.
      const phoneWarning = task.warnings.find((w) => w.field.includes('phone_'));
      expect(phoneWarning).toBeDefined();
      expect(phoneWarning!.field).not.toContain('13800138000');
      expect(phoneWarning!.field).toContain('138****8000');
      expect(phoneWarning!.message).not.toContain('13800138000');
      expect(phoneWarning!.message).toContain('138****8000');
      // Path-bearing key → warning.field and warning.message have the
      // absolute path replaced with <PATH>.
      const pathWarning = task.warnings.find((w) => w.field.includes('PATH') || w.field === '<PATH>');
      expect(pathWarning).toBeDefined();
      expect(pathWarning!.field).not.toContain('/etc/passwd');
      expect(pathWarning!.message).not.toContain('/etc/passwd');
      expect(pathWarning!.message).toContain('<PATH>');
    });
  });

  describe('P0-03: full Pipeline evidence persisted on the task', () => {
    it('persists pipelineVersion/stages/validation/corrections/warnings/errors/qualityReport on success', async () => {
      const created = await service.createIngestion(makeRequest());
      await service.receiveCandidate(created.ingestion_id, { candidate: makeCandidate() });

      const task = await service.getIngestion(created.ingestion_id);
      expect(task.pipeline_evidence).toBeDefined();
      const evidence = task.pipeline_evidence as Record<string, unknown>;
      expect(evidence['pipelineVersion']).toBeDefined();
      expect(evidence['stages']).toBeDefined();
      expect(evidence['validation']).toBeDefined();
      expect(evidence['corrections']).toBeDefined();
      expect(evidence['warnings']).toBeDefined();
      expect(evidence['errors']).toBeDefined();
      expect(evidence['qualityReport']).toBeDefined();
      expect(evidence['success']).toBe(true);
    });

    it('persists full Pipeline evidence on the validation_failed path', async () => {
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
        warnings: ['a pipeline warning'],
        corrections: [{ field: 'foo', original: 'a', corrected: 'b', reason: 'test' }],
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
      await service.receiveCandidate(created.ingestion_id, { candidate: makeCandidate() });

      const task = await service.getIngestion(created.ingestion_id);
      expect(task.status).toBe('validation_failed');
      expect(task.pipeline_evidence).toBeDefined();
      const evidence = task.pipeline_evidence as Record<string, unknown>;
      expect(evidence['pipelineVersion']).toBe('2c.1.0');
      expect(evidence['success']).toBe(false);
      expect(evidence['errors']).toEqual(failureResult.errors);
      expect(evidence['warnings']).toEqual(['a pipeline warning']);
      expect(evidence['corrections']).toEqual(failureResult.corrections);
      expect(evidence['stages']).toEqual(failureResult.stages);
      expect(evidence['qualityReport']).toBeNull();
    });

    it('keeps mapper warnings distinguishable from Pipeline warnings on the task', async () => {
      const created = await service.createIngestion(makeRequest());
      await service.receiveCandidate(created.ingestion_id, {
        candidate: makeCandidate({ unknown_field: 'dropped' }),
      });

      const task = await service.getIngestion(created.ingestion_id);
      // Mapper warning lives on task.warnings.
      const mapperWarning = task.warnings.find(
        (w) => w.code === 'UNMAPPED_CANDIDATE_FIELD'
      );
      expect(mapperWarning).toBeDefined();
      // Pipeline warnings live inside pipeline_evidence.warnings (string array).
      const evidence = task.pipeline_evidence as Record<string, unknown>;
      const pipelineWarnings = evidence['warnings'] as unknown[];
      expect(Array.isArray(pipelineWarnings)).toBe(true);
      // Pipeline warnings are strings; mapper warnings are {field, code, message}.
      for (const w of pipelineWarnings) {
        expect(typeof w).toBe('string');
      }
    });

    it('task Pipeline evidence is durable across a new service instance', async () => {
    const created = await service.createIngestion(makeRequest());
    await service.receiveCandidate(created.ingestion_id, { candidate: makeCandidate() });

    const newService = new IngestionService(repository, reviewRepository);
    const task = await newService.getIngestion(created.ingestion_id);
    expect(task.pipeline_evidence).toBeDefined();
    const evidence = task.pipeline_evidence as Record<string, unknown>;
    expect(evidence['pipelineVersion']).toBeDefined();
    expect(evidence['stages']).toBeDefined();
    expect(evidence['success']).toBe(true);
  });
  });

  // ---------------------------------------------------------------------
  // TASK-003: customer commit flow (committing / completed / commit_failed,
  // dry_run / reject, idempotent retry, per-ingestion serialization)
  // ---------------------------------------------------------------------

  describe('TASK-003: commit flow', () => {
    let writeLogRepository: InMemoryWriteLogRepository;
    let writer: CustomerRecordWriter;
    let write: Mock<(input: CustomerRecordWriterInput) => Promise<CustomerRecordWriterResult>>;
    let commitService: IngestionService;

    beforeEach(() => {
      writeLogRepository = new InMemoryWriteLogRepository();
      write = vi.fn(async (input: CustomerRecordWriterInput): Promise<CustomerRecordWriterResult> => ({
        business_record_id: `rec_customer_${input.ingestionId.slice(-6)}`,
        created: true,
      }));
      writer = { write };
      commitService = new IngestionService(
        repository,
        reviewRepository,
        writer,
        writeLogRepository
      );
    });

    async function prepareApprovedTask(dryRun: boolean = false) {
      const created = await commitService.createIngestion(makeRequest({ dry_run: dryRun }));
      const candidate = await commitService.receiveCandidate(created.ingestion_id, {
        candidate: makeCandidate(),
      });
      return { ingestionId: created.ingestion_id, reviewRecordId: candidate.review_record_id };
    }

    it('runs the full commit flow: pending_review -> approved -> committing -> completed', async () => {
      const { ingestionId, reviewRecordId } = await prepareApprovedTask(false);

      const approved = await commitService.approve(ingestionId, {
        reviewer_id: 'reviewer_1',
        review_record_id: reviewRecordId,
      });

      expect(approved.status).toBe('completed');
      expect(approved.business_record_id).toMatch(/^rec_customer_/);
      expect(approved.error_code).toBeUndefined();
      expect(approved.error_message).toBeUndefined();
      expect(write).toHaveBeenCalledTimes(1);

      // Write log persisted with status=succeeded.
      const logs = await writeLogRepository.findByIngestionId(ingestionId);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('succeeded');
      expect(logs[0].business_record_id).toBe(approved.business_record_id);
    });

    it('dry_run=true: writes skipped_dry_run log, no customer write, status=completed', async () => {
      const { ingestionId, reviewRecordId } = await prepareApprovedTask(true);

      const result = await commitService.approve(ingestionId, {
        reviewer_id: 'reviewer_1',
        review_record_id: reviewRecordId,
      });

      expect(result.status).toBe('completed');
      expect(result.business_record_id).toBeUndefined();
      expect(write).not.toHaveBeenCalled();

      const logs = await writeLogRepository.findByIngestionId(ingestionId);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('skipped_dry_run');
      expect(logs[0].target_table_id).toBe('dry_run');
      expect(logs[0].business_record_id).toBeUndefined();
    });

    it('commit_failed: customer write raises FeishuApiError -> task status=commit_failed + sanitised write log + FeishuCommitFailedError re-thrown', async () => {
      const { ingestionId, reviewRecordId } = await prepareApprovedTask(false);
      // FeishuApiError already redacts phones; message carries the masked form.
      const feishuError = new FeishuApiError(1254045, 'permission denied phone 13800138000');
      write.mockRejectedValueOnce(feishuError);

      await expect(
        commitService.approve(ingestionId, {
          reviewer_id: 'reviewer_1',
          review_record_id: reviewRecordId,
        })
      ).rejects.toBeInstanceOf(FeishuCommitFailedError);

      const task = await commitService.getIngestion(ingestionId);
      expect(task.status).toBe('commit_failed');
      expect(task.error_code).toBe('FEISHU_COMMIT_FAILED');
      // Sanitised message persisted (phone already masked by FeishuApiError).
      expect(task.error_message).toContain('138****8000');
      expect(task.error_message).not.toContain('13800138000');

      const logs = await writeLogRepository.findByIngestionId(ingestionId);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('failed');
      expect(logs[0].error_code).toBe('FEISHU_COMMIT_FAILED');
      expect(logs[0].redacted_error_message).toContain('138****8000');
      expect(logs[0].redacted_error_message).not.toContain('13800138000');
    });

    it('commit_failed: unknown error is wrapped as FeishuCommitFailedError with sanitised name-only message', async () => {
      const { ingestionId, reviewRecordId } = await prepareApprovedTask(false);
      const internalError = new Error('Internal path /usr/local/secret with phone 13900139000');
      write.mockRejectedValueOnce(internalError);

      try {
        await commitService.approve(ingestionId, {
          reviewer_id: 'reviewer_1',
          review_record_id: reviewRecordId,
        });
        throw new Error('expected rejection');
      } catch (e) {
        expect(e).toBeInstanceOf(FeishuCommitFailedError);
        // Unknown errors are reduced to name only — no path, no PII.
        expect((e as Error).message).not.toContain('/usr/local/secret');
        expect((e as Error).message).not.toContain('13900139000');
      }

      const task = await commitService.getIngestion(ingestionId);
      expect(task.status).toBe('commit_failed');
      expect(task.error_message).not.toContain('/usr/local/secret');
      expect(task.error_message).not.toContain('13900139000');
    });

    it('retry after commit_failed: writer finds existing record by ingestion ID and returns completed', async () => {
      const { ingestionId, reviewRecordId } = await prepareApprovedTask(false);
      // First attempt fails.
      write.mockRejectedValueOnce(new FeishuApiError(1254045, 'transient'));
      await expect(
        commitService.approve(ingestionId, {
          reviewer_id: 'reviewer_1',
          review_record_id: reviewRecordId,
        })
      ).rejects.toBeInstanceOf(FeishuCommitFailedError);

      // Second attempt: writer reports the customer record now exists
      // (idempotent search-by-Collator 摄入 ID finds it on the Feishu side).
      write.mockResolvedValueOnce({
        business_record_id: 'rec_existing_001',
        created: false,
      });
      const retried = await commitService.approve(ingestionId, {
        reviewer_id: 'reviewer_1',
        review_record_id: reviewRecordId,
      });

      expect(retried.status).toBe('completed');
      expect(retried.business_record_id).toBe('rec_existing_001');
      // Prior commit_failed error fields cleared on successful retry.
      expect(retried.error_code).toBeUndefined();
      expect(retried.error_message).toBeUndefined();
      // Two write logs: one failed (first attempt), one succeeded (retry).
      const logs = await writeLogRepository.findByIngestionId(ingestionId);
      const statuses = logs.map((l) => l.status).sort();
      expect(statuses).toEqual(['failed', 'succeeded']);
    });

    it('cannot approve a completed ingestion', async () => {
      const { ingestionId, reviewRecordId } = await prepareApprovedTask(false);
      await commitService.approve(ingestionId, {
        reviewer_id: 'reviewer_1',
        review_record_id: reviewRecordId,
      });
      await expect(
        commitService.approve(ingestionId, {
          reviewer_id: 'reviewer_1',
          review_record_id: reviewRecordId,
        })
      ).rejects.toThrow('Ingestion already completed');
    });

    it('cannot approve a rejected ingestion', async () => {
      const { ingestionId, reviewRecordId } = await prepareApprovedTask(false);
      await commitService.reject(ingestionId, {
        reviewer_id: 'reviewer_1',
        reason_code: 'INSUFFICIENT_INFO',
        reason: '缺少联系方式。',
      });
      await expect(
        commitService.approve(ingestionId, {
          reviewer_id: 'reviewer_1',
          review_record_id: reviewRecordId,
        })
      ).rejects.toThrow('Rejected ingestion cannot be approved');
    });

    it('reject does NOT call the customer writer and does NOT create a write log', async () => {
      const { ingestionId } = await prepareApprovedTask(false);
      const rejected = await commitService.reject(ingestionId, {
        reviewer_id: 'reviewer_1',
        reason_code: 'INSUFFICIENT_INFO',
        reason: '缺少联系方式。',
      });

      expect(rejected.status).toBe('review_rejected');
      expect(rejected.review_decision).toBe('rejected');
      expect(write).not.toHaveBeenCalled();
      const logs = await writeLogRepository.findByIngestionId(ingestionId);
      expect(logs).toHaveLength(0);
    });

    it('does not allow an ingestion without a review record to reach the customer writer', async () => {
      const created = await commitService.createIngestion(
        makeRequest({ dry_run: false })
      );

      await expect(
        commitService.approve(created.ingestion_id, {
          reviewer_id: 'reviewer_1',
          review_record_id: 'forged_review_id',
        })
      ).rejects.toThrow('Ingestion is not awaiting approval');

      expect(write).not.toHaveBeenCalled();
      const persisted = await commitService.getIngestion(created.ingestion_id);
      expect(persisted.status).toBe('received');
    });

    it('per-ingestion serialization: 20 concurrent approve calls share a single in-flight commit', async () => {
      const { ingestionId, reviewRecordId } = await prepareApprovedTask(false);

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          commitService.approve(ingestionId, {
            reviewer_id: 'reviewer_1',
            review_record_id: reviewRecordId,
          })
        )
      );

      // All 20 calls resolve to the same completed task.
      const ids = new Set(results.map((r) => r.ingestion_id));
      expect(ids.size).toBe(1);
      expect(results[0].status).toBe('completed');
      // The writer was invoked exactly once — no duplicate customer records.
      expect(write).toHaveBeenCalledTimes(1);
      // Exactly one succeeded write log.
      const logs = await writeLogRepository.findByIngestionId(ingestionId);
      const succeeded = logs.filter((l) => l.status === 'succeeded');
      expect(succeeded).toHaveLength(1);
    });

    it('legacy fallback: when writer/repo absent, approve goes straight to completed (Phase 3B path)', async () => {
      // service (without writer/writeLogRepository) was constructed in beforeEach.
      const created = await service.createIngestion(makeRequest());
      const candidate = await service.receiveCandidate(created.ingestion_id, {
        candidate: makeCandidate(),
      });

      const approved = await service.approve(created.ingestion_id, {
        reviewer_id: 'reviewer_1',
        review_record_id: candidate.review_record_id,
      });

      expect(approved.status).toBe('completed');
      expect(approved.business_record_id).toBeUndefined();
    });

    it('fails closed for a non-dry-run approval when writer and write-log repository are absent', async () => {
      const created = await service.createIngestion(makeRequest({ dry_run: false }));
      const candidate = await service.receiveCandidate(created.ingestion_id, {
        candidate: makeCandidate(),
      });

      await expect(
        service.approve(created.ingestion_id, {
          reviewer_id: 'reviewer_1',
          review_record_id: candidate.review_record_id,
        })
      ).rejects.toThrow('Customer commit flow is not configured');

      const persisted = await service.getIngestion(created.ingestion_id);
      expect(persisted.status).toBe('pending_review');
    });

    it('rejects partial commit-flow dependency injection', () => {
      expect(
        () => new IngestionService(repository, reviewRepository, writer)
      ).toThrow('Customer record writer and write-log repository must be configured together');
      expect(
        () => new IngestionService(repository, reviewRepository, undefined, writeLogRepository)
      ).toThrow('Customer record writer and write-log repository must be configured together');
    });

    it('does not report completed when the succeeded write log cannot be persisted', async () => {
      const failingWriteLogRepository: WriteLogRepository = {
        create: vi.fn(async () => {
          throw new Error('write log unavailable');
        }),
        findByIngestionId: vi.fn(async () => []),
        save: vi.fn(async () => undefined),
      };
      const serviceWithFailingLog = new IngestionService(
        repository,
        reviewRepository,
        writer,
        failingWriteLogRepository
      );
      const created = await serviceWithFailingLog.createIngestion(
        makeRequest({ dry_run: false })
      );
      const candidate = await serviceWithFailingLog.receiveCandidate(
        created.ingestion_id,
        { candidate: makeCandidate() }
      );

      await expect(
        serviceWithFailingLog.approve(created.ingestion_id, {
          reviewer_id: 'reviewer_1',
          review_record_id: candidate.review_record_id,
        })
      ).rejects.toBeInstanceOf(FeishuCommitFailedError);

      const persisted = await serviceWithFailingLog.getIngestion(created.ingestion_id);
      expect(persisted.status).toBe('commit_failed');
      expect(persisted.business_record_id).toBeUndefined();
    });

    it('does not report a dry run completed when its audit log cannot be persisted', async () => {
      const failingWriteLogRepository: WriteLogRepository = {
        create: vi.fn(async () => {
          throw new Error('write log unavailable');
        }),
        findByIngestionId: vi.fn(async () => []),
        save: vi.fn(async () => undefined),
      };
      const serviceWithFailingLog = new IngestionService(
        repository,
        reviewRepository,
        writer,
        failingWriteLogRepository
      );
      const created = await serviceWithFailingLog.createIngestion(
        makeRequest({ dry_run: true })
      );
      const candidate = await serviceWithFailingLog.receiveCandidate(
        created.ingestion_id,
        { candidate: makeCandidate() }
      );

      await expect(
        serviceWithFailingLog.approve(created.ingestion_id, {
          reviewer_id: 'reviewer_1',
          review_record_id: candidate.review_record_id,
        })
      ).rejects.toBeInstanceOf(FeishuCommitFailedError);

      const persisted = await serviceWithFailingLog.getIngestion(created.ingestion_id);
      expect(persisted.status).toBe('approved');
      expect(write).not.toHaveBeenCalled();
    });

    it('review_record_id mismatch is rejected with BAD_REQUEST', async () => {
      const { ingestionId } = await prepareApprovedTask(false);
      await expect(
        commitService.approve(ingestionId, {
          reviewer_id: 'reviewer_1',
          review_record_id: 'wrong_record_id',
        })
      ).rejects.toThrow('Review record ID mismatch');
    });

    it('corrections are re-mapped and re-pipelined before the customer write', async () => {
      const { ingestionId, reviewRecordId } = await prepareApprovedTask(false);

      // Use the English key `budget` to verify TASK-002 mapper is applied
      // to corrections. '5000元以上' is a canonical enum value (candidate
      // had '3000-5000元' via the `budget` key), so format_clean passes it
      // through unchanged — proving the corrected value survives the
      // re-pipeline run and reaches the writer.
      const approved = await commitService.approve(ingestionId, {
        reviewer_id: 'reviewer_1',
        review_record_id: reviewRecordId,
        corrections: { budget: '5000元以上' },
      });

      expect(approved.status).toBe('completed');
      expect(approved.review_decision).toBe('modified');
      expect(approved.normalized_fields).toMatchObject({
        预算区间: '5000元以上',
      });
      // Writer received the corrected, re-pipelined normalized_fields.
      const writerInput = write.mock.calls[0][0];
      expect(writerInput.normalizedFields['预算区间']).toBe('5000元以上');
    });
  });
});
