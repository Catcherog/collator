import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { InMemoryTaskRepository } from '../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryReviewRepository } from '../../src/server/repositories/in-memory-review-repository.js';
import { InMemoryWriteLogRepository } from '../../src/server/repositories/in-memory-write-log-repository.js';
import { generateSignatureHeaders } from '../../src/server/security/signature.js';
import type { FastifyInstance } from 'fastify';
import type { IngestionTask, CandidateCallbackRequest } from '../../src/server/domain/ingestion.js';
import type {
  CustomerRecordWriter,
  CustomerRecordWriterInput,
  CustomerRecordWriterResult,
} from '../../src/server/business/customer-record-writer.js';
import { FeishuApiError } from '../../src/server/feishu/feishu-errors.js';
import type { IngestionService } from '../../src/server/services/ingestion-service.js';
import { NoOpPreWriteClient } from '../fixtures/noop-pre-write-client.js';

const WEBHOOK_SECRET = 'test-webhook-secret';

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
  service: IngestionService;
  repository: InMemoryTaskRepository;
  reviewRepository: InMemoryReviewRepository;
}>;
async function setup(options: {
  writer?: CustomerRecordWriter;
  writeLogRepository?: InMemoryWriteLogRepository;
}): Promise<{
  app: FastifyInstance;
  service: IngestionService;
  repository: InMemoryTaskRepository;
  reviewRepository: InMemoryReviewRepository;
  writeLogRepository: InMemoryWriteLogRepository;
  writer: CustomerRecordWriter;
}>;
async function setup(options?: {
  writer?: CustomerRecordWriter;
  writeLogRepository?: InMemoryWriteLogRepository;
}): Promise<{
  app: FastifyInstance;
  service: IngestionService;
  repository: InMemoryTaskRepository;
  reviewRepository: InMemoryReviewRepository;
  writeLogRepository?: InMemoryWriteLogRepository;
  writer?: CustomerRecordWriter;
}> {
  process.env.COLLATOR_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const repository = new InMemoryTaskRepository();
  const reviewRepository = new InMemoryReviewRepository();
  // Only pass writer/writeLogRepository through to buildApp when a writer
  // is provided. When writer is absent, IngestionService falls back to the
  // legacy Phase 3B path (approve -> completed directly), which is the
  // behaviour existing tests rely on.
  const writer = options?.writer;
  const writeLogRepository = writer
    ? (options?.writeLogRepository ?? new InMemoryWriteLogRepository())
    : undefined;
  const { app, service } = await buildApp({
    repository,
    reviewRepository,
    customerRecordWriter: writer,
    writeLogRepository,
    // RF-02: 测试模式必须显式注入 preWriteClient（无 NoOp 默认 fallback）。
    preWriteClient: new NoOpPreWriteClient(),
  });
  return { app, service, repository, reviewRepository, writeLogRepository, writer };
}

describe('POST /v1/ingestions', () => {
  beforeEach(() => {
    delete process.env.COLLATOR_WEBHOOK_SECRET;
  });

  it('creates a new ingestion task', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: makeIngestionBody(),
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.status).toBe('received');
    expect(body.idempotent_replay).toBe(false);
    expect(body.ingestion_id).toMatch(/^ing_[a-f0-9]{32}$/);
  });

  it('returns 400 for unsupported target_domain', async () => {
    const { app } = await setup();
    const payload = makeIngestionBody() as Record<string, unknown>;
    payload.target_domain = 'order_creation';

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for invalid body', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: { source_system: 'x' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /v1/ingestions/:id', () => {
  beforeEach(() => {
    delete process.env.COLLATOR_WEBHOOK_SECRET;
  });

  it('returns the task', async () => {
    const { app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: makeIngestionBody(),
    });
    const { ingestion_id } = created.json();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestion_id}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ingestion_id).toBe(ingestion_id);
    expect(body.status).toBe('received');
  });

  it('returns 404 for unknown task', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/ingestions/ing_unknown',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});

describe('POST /v1/internal/ingestions/:id/candidate — AC-R1-01 Dify callback abolished', () => {
  beforeEach(() => {
    delete process.env.COLLATOR_WEBHOOK_SECRET;
  });

  // FAMP-CONTRACT-ADOPTION-GATE-01-R1:
  // Dify callback route abolished (410 Gone) to eliminate contract bypass path.
  // Replacement entry: POST /v1/ingestions/:id/candidate-v1 (Candidate V1 contract).
  // Customer consultation flow still tested via service.receiveCandidate in
  // P0 redaction tests and approve/reject flow tests below.

  async function createTask(app: FastifyInstance) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: makeIngestionBody(),
    });
    return response.json().ingestion_id as string;
  }

  it('returns 410 Gone with CONTRACT_ADOPTION_GATE_ABOLISHED', async () => {
    const { app, repository } = await setup();
    const ingestionId = await createTask(app);

    const taskBefore = await repository.findById(ingestionId);
    const taskBeforeSnapshot = JSON.parse(JSON.stringify(taskBefore));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/ingestions/${ingestionId}/candidate`,
      payload: { candidate: { schema_name: 'customer', schema_version: '1.0.0' } },
    });

    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe('CONTRACT_ADOPTION_GATE_ABOLISHED');

    // No side effects: task unchanged
    const taskAfter = await repository.findById(ingestionId);
    expect(JSON.parse(JSON.stringify(taskAfter))).toEqual(taskBeforeSnapshot);
  });

  it('returns 410 even with valid signature (abolished route ignores auth)', async () => {
    const { app } = await setup();
    const ingestionId = await createTask(app);

    const payload = { candidate: { schema_name: 'customer', schema_version: '1.0.0' } };
    const rawBody = JSON.stringify(payload);
    const { timestamp, signature } = generateSignatureHeaders(rawBody, WEBHOOK_SECRET);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/ingestions/${ingestionId}/candidate`,
      headers: {
        'x-collator-timestamp': timestamp,
        'x-collator-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe('CONTRACT_ADOPTION_GATE_ABOLISHED');
  });
});

// ---------------------------------------------------------------------------
// P0: GET response PII redaction tests.
// FAMP-CONTRACT-ADOPTION-GATE-01-R1: migrated from abolished Dify callback HTTP
// route to direct service.receiveCandidate calls. Tests verify PII redaction
// in GET responses, not contract validation (which is covered in
// tests/unit/server/routes/ingestions-candidate-v1.test.ts).
// ---------------------------------------------------------------------------

describe('P0: GET response PII redaction (via service.receiveCandidate)', () => {
  beforeEach(() => {
    delete process.env.COLLATOR_WEBHOOK_SECRET;
  });

  async function createTask(app: FastifyInstance) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: makeIngestionBody(),
    });
    return response.json().ingestion_id as string;
  }

  function makeCandidatePayload(overrides: Record<string, unknown> = {}) {
    return {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: {
          customer_name: '张三',
          contact: '13800138000',
          budget: '3000-5000元',
          ...overrides,
        },
        field_confidence: { budget: 0.95 },
        evidence: { budget: '预算3000元左右' },
      },
    };
  }

  // FAMP-CONTRACT-ADOPTION-GATE-01-R1: Dify callback HTTP route abolished.
  // P0 tests now call service.receiveCandidate directly to set up state.
  async function postCandidate(
    service: IngestionService,
    ingestionId: string,
    payload: unknown
  ) {
    await service.receiveCandidate(ingestionId, payload as CandidateCallbackRequest);
    return { statusCode: 200 };
  }

  it('P0-01: GET response redacts nested Candidate PII (phone in fields and evidence) without mutating stored task', async () => {
    const { app, service, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // Candidate carries a phone number in fields and evidence. The unknown
    // field key is intentionally benign so the response-wide "no original
    // phone number" assertion is meaningful (PII lives in values, not keys).
    const payload = makeCandidatePayload({
      unknown_field: '13800138000',
    });
    (payload.candidate as { evidence: Record<string, string> }).evidence = {
      contact: '电话13800138000',
      budget: '预算3000元左右',
    };

    const callbackResponse = await postCandidate(service, ingestionId, payload);
    expect(callbackResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    expect(getResponse.statusCode).toBe(200);

    const serialized = getResponse.body;
    // The original phone number must not appear anywhere in the response.
    expect(serialized).not.toContain('13800138000');
    // Sanitized forms are present instead.
    expect(serialized).toContain('138****8000');

    // Repository storage still retains the original evidence (P0-02 + P0-01
    // "Do not remove raw evidence from repository storage").
    const storedTask = await repository.findById(ingestionId);
    expect(storedTask).not.toBeNull();
    expect(storedTask!.raw_candidate).toBeDefined();
    expect(storedTask!.raw_candidate!.fields['unknown_field']).toBe('13800138000');
    expect(storedTask!.raw_candidate!.evidence['contact']).toBe('电话13800138000');

    // Review record retains raw Candidate under validation.rawCandidate.
    const review = await reviewRepository.findByIngestionId(ingestionId);
    expect(review).not.toBeNull();
    const validation = review!.validation as Record<string, unknown>;
    const rawCandidate = validation['rawCandidate'] as { fields: Record<string, unknown>; evidence: Record<string, string> };
    expect(rawCandidate.fields['unknown_field']).toBe('13800138000');
    expect(rawCandidate.evidence['contact']).toBe('电话13800138000');

    // The sanitized GET response did not mutate the stored task.
    const storedTaskAgain = await repository.findById(ingestionId);
    expect(storedTaskAgain!.raw_candidate!.fields['unknown_field']).toBe('13800138000');
  });

  it('P0-01 (residual): GET response redacts non-phone WeChat IDs under contact / 联系方式 without mutating stored evidence', async () => {
    const { app, service, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // Candidate carries a non-phone WeChat ID in `contact`. The mapper
    // canonicalizes `contact` to `联系方式` for `candidate.fields`, but
    // `raw_candidate.fields.contact` retains the original English key. Both
    // must be masked in the GET response.
    const payload = makeCandidatePayload({
      contact: 'wechat_secret_01',
    });

    const callbackResponse = await postCandidate(service, ingestionId, payload);
    expect(callbackResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    expect(getResponse.statusCode).toBe(200);

    const serialized = getResponse.body;
    // The original WeChat ID must not appear anywhere in the response.
    expect(serialized).not.toContain('wechat_secret_01');
    // The masked form (first/last 2 chars, middle replaced with *) is present.
    expect(serialized).toContain('we************01');

    // Repository storage still retains the original evidence under both
    // the canonical Chinese key and the raw English key.
    const storedTask = await repository.findById(ingestionId);
    expect(storedTask).not.toBeNull();
    expect(storedTask!.raw_candidate).toBeDefined();
    expect(storedTask!.raw_candidate!.fields['contact']).toBe('wechat_secret_01');
    expect(storedTask!.candidate!.fields['联系方式']).toBe('wechat_secret_01');

    // Review record retains raw Candidate under validation.rawCandidate.
    const review = await reviewRepository.findByIngestionId(ingestionId);
    expect(review).not.toBeNull();
    const validation = review!.validation as Record<string, unknown>;
    const rawCandidate = validation['rawCandidate'] as { fields: Record<string, unknown> };
    expect(rawCandidate.fields['contact']).toBe('wechat_secret_01');

    // The sanitized GET response did not mutate the stored task.
    const storedTaskAgain = await repository.findById(ingestionId);
    expect(storedTaskAgain!.raw_candidate!.fields['contact']).toBe('wechat_secret_01');
  });

  it('P0-01A: GET response redacts mixed phone+wechat contact string (fail closed) without mutating stored evidence', async () => {
    const { app, service, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // Mixed phone + WeChat ID in a single contact string. redactContactValue
    // must fail closed: no residual `wechat_secret_01` may cross the GET
    // response boundary, and the pure-phone mask format does not apply.
    const mixedContact = '电话13800138000 微信wechat_secret_01';
    const payload = makeCandidatePayload({
      contact: mixedContact,
    });

    const callbackResponse = await postCandidate(service, ingestionId, payload);
    expect(callbackResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    expect(getResponse.statusCode).toBe(200);

    const serialized = getResponse.body;
    // Neither the WeChat ID nor the raw phone may leak through the response.
    expect(serialized).not.toContain('wechat_secret_01');
    expect(serialized).not.toContain('13800138000');

    // Repository storage retains the original mixed contact string under
    // both the raw English key and the canonical Chinese key.
    const storedTask = await repository.findById(ingestionId);
    expect(storedTask).not.toBeNull();
    expect(storedTask!.raw_candidate!.fields['contact']).toBe(mixedContact);
    expect(storedTask!.candidate!.fields['联系方式']).toBe(mixedContact);

    // Review record retains raw Candidate under validation.rawCandidate.
    const review = await reviewRepository.findByIngestionId(ingestionId);
    expect(review).not.toBeNull();
    const validation = review!.validation as Record<string, unknown>;
    const rawCandidate = validation['rawCandidate'] as { fields: Record<string, unknown> };
    expect(rawCandidate.fields['contact']).toBe(mixedContact);

    // The sanitized GET response did not mutate the stored task.
    const storedTaskAgain = await repository.findById(ingestionId);
    expect(storedTaskAgain!.raw_candidate!.fields['contact']).toBe(mixedContact);
  });

  it('P0-01B: GET response redacts contact array elements without mutating stored evidence', async () => {
    const { app, service, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // `fields.contact` as an array of strings. Recursion must propagate
    // contact context to each element so non-phone WeChat IDs are masked
    // instead of falling back to redactPhone (which would leave them intact).
    const contactArray = ['wechat_secret_01'];
    const payload = makeCandidatePayload({
      contact: contactArray,
    });

    const callbackResponse = await postCandidate(service, ingestionId, payload);
    expect(callbackResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    expect(getResponse.statusCode).toBe(200);

    const serialized = getResponse.body;
    expect(serialized).not.toContain('wechat_secret_01');
    // The masked form (first/last 2 chars, middle replaced with *) is present.
    expect(serialized).toContain('we************01');

    // Repository storage retains the original array under the raw English key.
    const storedTask = await repository.findById(ingestionId);
    expect(storedTask).not.toBeNull();
    expect(storedTask!.raw_candidate!.fields['contact']).toEqual(contactArray);

    // Review record retains raw Candidate under validation.rawCandidate.
    const review = await reviewRepository.findByIngestionId(ingestionId);
    expect(review).not.toBeNull();
    const validation = review!.validation as Record<string, unknown>;
    const rawCandidate = validation['rawCandidate'] as { fields: Record<string, unknown> };
    expect(rawCandidate.fields['contact']).toEqual(contactArray);

    // The sanitized GET response did not mutate the stored task.
    const storedTaskAgain = await repository.findById(ingestionId);
    expect(storedTaskAgain!.raw_candidate!.fields['contact']).toEqual(contactArray);
  });

  it('P0-01C: GET response redacts nested sensitive child key under contact parent (parent mode wins) without mutating stored evidence', async () => {
    const { app, service, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // Candidate carries a nested object under the `wechat` contact key
    // whose child key (`content`) would normally select content redaction
    // (phone-only). Parent contact mode must be authoritative so the
    // non-phone WeChat ID is masked via redactContactValue instead of
    // leaking through redactContent. `contact` stays a valid phone so the
    // Pipeline succeeds and a review record is created.
    const nestedWechat = { content: 'wechat_secret_01' };
    const payload = makeCandidatePayload({
      wechat: nestedWechat,
    });

    const callbackResponse = await postCandidate(service, ingestionId, payload);
    expect(callbackResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    expect(getResponse.statusCode).toBe(200);

    const serialized = getResponse.body;
    // The original WeChat ID must not appear anywhere in the response.
    expect(serialized).not.toContain('wechat_secret_01');
    // The masked form (first/last 2 chars, middle replaced with *) is present.
    expect(serialized).toContain('we************01');

    // Repository storage retains the original nested object under the raw
    // English key (`wechat` is an unknown Candidate field, so it is kept
    // verbatim in raw_candidate and dropped from canonical mappedFields).
    const storedTask = await repository.findById(ingestionId);
    expect(storedTask).not.toBeNull();
    expect(storedTask!.raw_candidate!.fields['wechat']).toEqual(nestedWechat);

    // Review record retains raw Candidate under validation.rawCandidate.
    const review = await reviewRepository.findByIngestionId(ingestionId);
    expect(review).not.toBeNull();
    const validation = review!.validation as Record<string, unknown>;
    const rawCandidate = validation['rawCandidate'] as { fields: Record<string, unknown> };
    expect(rawCandidate.fields['wechat']).toEqual(nestedWechat);

    // The sanitized GET response did not mutate the stored task.
    const storedTaskAgain = await repository.findById(ingestionId);
    expect(storedTaskAgain!.raw_candidate!.fields['wechat']).toEqual(nestedWechat);
  });

  it('P0-04: GET response preserves structural ingestion_id byte-for-byte while retaining PII redaction', async () => {
    const { app, repository } = await setup();
    // Deterministic ID that previously failed: it contains an 11-digit
    // substring `19181507170` matching `1[3-9]\d{9}`, so the default
    // redactPhone() branch mutated it to `ing_2e0428903925****7170127599`.
    // isStructuralId() now preserves it byte-for-byte (TASK-002 P0-04).
    const deterministicId = 'ing_2e042890392546c19181507170127599';
    const phoneInContent = '你好我的手机是13800138000';
    const now = new Date().toISOString();
    const task: IngestionTask = {
      ingestion_id: deterministicId,
      idempotency_key: 'idem_p0_04',
      status: 'received',
      source_system: 'feishu_form',
      source_record_id: 'rec_001',
      source_type: 'chat_text',
      target_domain: 'customer_consultation',
      content: phoneInContent,
      submitted_at: now,
      timezone: 'Asia/Shanghai',
      submitted_by: 'operator_1',
      dry_run: true,
      attempt_count: 0,
      warnings: [],
      errors: [],
      duplicate_candidates: [],
      created_at: now,
      updated_at: now,
    };
    await repository.save(task);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${deterministicId}`,
    });
    expect(getResponse.statusCode).toBe(200);

    const serialized = getResponse.body;
    // The structural ingestion_id must be present byte-for-byte.
    expect(serialized).toContain(`"ingestion_id":"${deterministicId}"`);
    // The mutated form observed in the GPT re-review must NOT appear.
    expect(serialized).not.toContain('ing_2e0428903925****7170127599');
    // PII redaction is retained: the phone number in `content` is masked.
    expect(serialized).not.toContain('13800138000');
    expect(serialized).toContain('138****8000');

    // Repository storage retains the original ID and content unchanged.
    const storedTask = await repository.findById(deterministicId);
    expect(storedTask).not.toBeNull();
    expect(storedTask!.ingestion_id).toBe(deterministicId);
    expect(storedTask!.content).toBe(phoneInContent);
  });

  it('P0-01D: GET upgrades nested contact semantics beneath content without mutating evidence', async () => {
    const { app, service, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // `fields.content` is an unknown Candidate field (kept verbatim in
    // raw_candidate, dropped from canonical normalized_fields). The
    // nested `contact` key beneath a content parent must upgrade to
    // contact redaction so the non-phone WeChat ID is masked instead of
    // leaking through redactContent (phone-only). `contact: '13800138000'`
    // stays a valid phone so the Pipeline succeeds and a review record
    // is created.
    const nested = { contact: 'wechat_secret_01' };
    const payload = makeCandidatePayload({ content: nested });

    const callback = await postCandidate(service, ingestionId, payload);
    expect(callback.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('wechat_secret_01');
    expect(response.body).toContain('we************01');

    const stored = await repository.findById(ingestionId);
    expect(stored!.raw_candidate!.fields['content']).toEqual(nested);

    const review = await reviewRepository.findByIngestionId(ingestionId);
    const validation = review!.validation as Record<string, unknown>;
    const rawCandidate = validation['rawCandidate'] as {
      fields: Record<string, unknown>;
    };
    expect(rawCandidate.fields['content']).toEqual(nested);

    const storedAgain = await repository.findById(ingestionId);
    expect(storedAgain!.raw_candidate!.fields['content']).toEqual(nested);
  });

  it('P0-04B: GET redacts wrapped phones in unknown fields and evidence without mutating evidence', async () => {
    const { app, service, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // Attacker-controlled unknown Candidate/evidence strings that match
    // `<alpha>_<alphanumeric>` must NOT be treated as trusted structural
    // IDs. The wrapped phone numbers must continue through redactPhone.
    const wrappedField = 'note_13900139000';
    const wrappedEvidence = 'proof_13700137000';
    const payload = makeCandidatePayload({
      unknown_field: wrappedField,
    });
    (payload.candidate as {
      evidence: Record<string, string>;
    }).evidence = {
      unknown_field: wrappedEvidence,
    };

    const callback = await postCandidate(service, ingestionId, payload);
    expect(callback.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('13900139000');
    expect(response.body).not.toContain('13700137000');
    expect(response.body).toContain('note_139****9000');
    expect(response.body).toContain('proof_137****7000');

    const stored = await repository.findById(ingestionId);
    expect(stored!.raw_candidate!.fields['unknown_field']).toBe(wrappedField);
    expect(stored!.raw_candidate!.evidence['unknown_field']).toBe(
      wrappedEvidence
    );

    const review = await reviewRepository.findByIngestionId(ingestionId);
    const validation = review!.validation as Record<string, unknown>;
    const rawCandidate = validation['rawCandidate'] as {
      fields: Record<string, unknown>;
      evidence: Record<string, string>;
    };
    expect(rawCandidate.fields['unknown_field']).toBe(wrappedField);
    expect(rawCandidate.evidence['unknown_field']).toBe(wrappedEvidence);

    const storedAgain = await repository.findById(ingestionId);
    expect(storedAgain!.raw_candidate).toEqual(stored!.raw_candidate);
  });
});

describe('POST /v1/ingestions/:id/approve and /reject', () => {
  beforeEach(() => {
    delete process.env.COLLATOR_WEBHOOK_SECRET;
  });

  async function createTaskWithCandidate(
    app: FastifyInstance,
    service: IngestionService
  ) {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: makeIngestionBody(),
    });
    const ingestionId = created.json().ingestion_id as string;

    // FAMP-CONTRACT-ADOPTION-GATE-01-R1: Dify callback HTTP route abolished (410 Gone).
    // Test helper now calls service.receiveCandidate directly.
    const payload = {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: { 客户姓名: '张三', 预算区间: '3000-5000元' },
        field_confidence: {},
        evidence: {},
      },
    };

    const result = await service.receiveCandidate(ingestionId, payload);

    return {
      ingestionId,
      reviewRecordId: result.review_record_id as string,
    };
  }

  it('approves an ingestion', async () => {
    const { app, service } = await setup();
    const { ingestionId, reviewRecordId } = await createTaskWithCandidate(app, service);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/approve`,
      payload: {
        reviewer_id: 'reviewer_1',
        review_record_id: reviewRecordId,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('completed');
    expect(body.review_decision).toBe('approved');
  });

  it('rejects an ingestion', async () => {
    const { app, service } = await setup();
    const { ingestionId } = await createTaskWithCandidate(app, service);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/reject`,
      payload: {
        reviewer_id: 'reviewer_1',
        reason_code: 'INSUFFICIENT_INFO',
        reason: '缺少联系方式。',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('review_rejected');
    expect(body.review_decision).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// TASK-003: HTTP-level integration for the customer-record commit flow.
// Exercises the full pipeline: approve -> committing -> completed/commit_failed
// through Fastify's HTTP layer, verifying status codes, response shapes, and
// that PII never leaks in HTTP responses.
// ---------------------------------------------------------------------------

describe('TASK-003: POST /v1/ingestions/:id/approve commit flow', () => {
  beforeEach(() => {
    delete process.env.COLLATOR_WEBHOOK_SECRET;
  });

  function makeWriter(
    impl: (input: CustomerRecordWriterInput) => Promise<CustomerRecordWriterResult>
  ): { writer: CustomerRecordWriter; write: Mock<typeof impl> } {
    const write = vi.fn(impl);
    return { writer: { write }, write };
  }

  async function createPendingReviewTask(
    app: FastifyInstance,
    service: IngestionService,
    options: { dryRun?: boolean } = {}
  ): Promise<{ ingestionId: string; reviewRecordId: string }> {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: { ...makeIngestionBody(), dry_run: options.dryRun ?? false },
    });
    const ingestionId = created.json().ingestion_id as string;

    // FAMP-CONTRACT-ADOPTION-GATE-01-R1: Dify callback HTTP route abolished (410 Gone).
    // Test helper now calls service.receiveCandidate directly to set up
    // pending-review state for the approve flow tests, bypassing the HTTP layer.
    const payload = {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: { 客户姓名: '张三', 联系方式: '13800138000', 预算区间: '3000-5000元' },
        field_confidence: {},
        evidence: {},
      },
    };

    const result = await service.receiveCandidate(ingestionId, payload);

    return {
      ingestionId,
      reviewRecordId: result.review_record_id as string,
    };
  }

  it('returns 200 with business_record_id on a successful commit', async () => {
    const { writer, write } = makeWriter(async (input) => ({
      business_record_id: `rec_customer_${input.ingestionId.slice(-6)}`,
      created: true,
    }));
    const { app, service, writeLogRepository } = await setup({ writer });

    const { ingestionId, reviewRecordId } = await createPendingReviewTask(app, service);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/approve`,
      payload: { reviewer_id: 'reviewer_1', review_record_id: reviewRecordId },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('completed');
    expect(body.business_record_id).toMatch(/^rec_customer_/);
    expect(body.error_code).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);

    // Sanitised GET response: phone in normalized_fields is masked.
    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    expect(getResponse.body).not.toContain('13800138000');
    expect(getResponse.body).toContain('138****8000');

    // Write log persisted with status=succeeded.
    const logs = await writeLogRepository!.findByIngestionId(ingestionId);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('succeeded');
  });

  it('returns 502 with FEISHU_COMMIT_FAILED when the writer raises FeishuApiError', async () => {
    // Writer throws a raw FeishuApiError (as a lower-level Feishu client would).
    // The service classifies it as FEISHU_COMMIT_FAILED and re-throws as
    // FeishuCommitFailedError, which Fastify's error handler maps to HTTP 502.
    const { writer } = makeWriter(async () => {
      throw new FeishuApiError(1254045, 'permission denied phone 13800138000');
    });
    const { app, service, writeLogRepository } = await setup({ writer });

    const { ingestionId, reviewRecordId } = await createPendingReviewTask(app, service);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/approve`,
      payload: { reviewer_id: 'reviewer_1', review_record_id: reviewRecordId },
    });

    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.error.code).toBe('FEISHU_COMMIT_FAILED');
    // HTTP error message must not contain the raw phone number.
    expect(JSON.stringify(body)).not.toContain('13800138000');

    // Task persisted as commit_failed with sanitised error_message.
    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    const task = getResponse.json();
    expect(task.status).toBe('commit_failed');
    expect(task.error_code).toBe('FEISHU_COMMIT_FAILED');
    // Sanitised message persisted (phone already masked by FeishuApiError).
    expect(task.error_message).toContain('138****8000');
    expect(task.error_message).not.toContain('13800138000');

    // Write log persisted with status=failed and FEISHU_COMMIT_FAILED code.
    const logs = await writeLogRepository!.findByIngestionId(ingestionId);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');
    expect(logs[0].error_code).toBe('FEISHU_COMMIT_FAILED');
    expect(logs[0].redacted_error_message).toContain('138****8000');
  });

  it('returns 200 with status=completed on dry_run=true (no customer write)', async () => {
    const { writer, write } = makeWriter(async () => {
      throw new Error('writer should not be called on dry_run=true');
    });
    const { app, service, writeLogRepository } = await setup({ writer });

    const { ingestionId, reviewRecordId } = await createPendingReviewTask(app, service, {
      dryRun: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/approve`,
      payload: { reviewer_id: 'reviewer_1', review_record_id: reviewRecordId },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('completed');
    expect(body.business_record_id).toBeUndefined();
    expect(write).not.toHaveBeenCalled();

    const logs = await writeLogRepository!.findByIngestionId(ingestionId);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('skipped_dry_run');
    expect(logs[0].target_table_id).toBe('dry_run');
  });

  it('retry after commit_failed: second approve returns 200 with business_record_id', async () => {
    // First call fails, second succeeds (writer finds existing record).
    const { writer, write } = makeWriter(async (input) => ({
      business_record_id: `rec_existing_${input.ingestionId.slice(-6)}`,
      created: false,
    }));
    write.mockRejectedValueOnce(new FeishuApiError(1254045, 'transient'));
    const { app, service, writeLogRepository } = await setup({ writer });

    const { ingestionId, reviewRecordId } = await createPendingReviewTask(app, service);

    const firstResponse = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/approve`,
      payload: { reviewer_id: 'reviewer_1', review_record_id: reviewRecordId },
    });
    expect(firstResponse.statusCode).toBe(502);

    const secondResponse = await app.inject({
      method: 'POST',
      url: `/v1/ingestions/${ingestionId}/approve`,
      payload: { reviewer_id: 'reviewer_1', review_record_id: reviewRecordId },
    });
    expect(secondResponse.statusCode).toBe(200);
    const body = secondResponse.json();
    expect(body.status).toBe('completed');
    expect(body.business_record_id).toMatch(/^rec_existing_/);
    expect(body.error_code).toBeUndefined();

    // Two write logs: failed (first attempt) + succeeded (retry).
    const logs = await writeLogRepository!.findByIngestionId(ingestionId);
    const statuses = logs.map((l) => l.status).sort();
    expect(statuses).toEqual(['failed', 'succeeded']);
  });
});
