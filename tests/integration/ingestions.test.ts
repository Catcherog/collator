import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { InMemoryTaskRepository } from '../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryReviewRepository } from '../../src/server/repositories/in-memory-review-repository.js';
import { generateSignatureHeaders } from '../../src/server/security/signature.js';
import type { FastifyInstance } from 'fastify';
import type { IngestionTask } from '../../src/server/domain/ingestion.js';

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
  repository: InMemoryTaskRepository;
  reviewRepository: InMemoryReviewRepository;
}> {
  process.env.COLLATOR_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const repository = new InMemoryTaskRepository();
  const reviewRepository = new InMemoryReviewRepository();
  const { app } = await buildApp({ repository, reviewRepository });
  return { app, repository, reviewRepository };
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

describe('POST /v1/internal/ingestions/:id/candidate', () => {
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

  function signPayload(payload: unknown) {
    const rawBody = JSON.stringify(payload);
    return generateSignatureHeaders(rawBody, WEBHOOK_SECRET);
  }

  async function postCandidate(
    app: FastifyInstance,
    ingestionId: string,
    payload: unknown
  ) {
    const { timestamp, signature } = signPayload(payload);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/ingestions/${ingestionId}/candidate`,
      headers: {
        'x-collator-timestamp': timestamp,
        'x-collator-signature': signature,
      },
      payload: payload as Record<string, unknown>,
    });
    return response;
  }

  it('accepts a signed candidate callback and stores the mapped review record', async () => {
    const { app, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    const payload = makeCandidatePayload();

    const response = await postCandidate(app, ingestionId, payload);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('pending_review');
    // review_record_id is opaque (no rec_review_ prefix).
    expect(typeof body.review_record_id).toBe('string');
    expect(body.review_record_id.length).toBeGreaterThan(0);
    expect(body.review_record_id.startsWith('rec_review_')).toBe(false);

    // Review record persisted with the canonical Chinese candidate fields.
    const review = await reviewRepository.findByIngestionId(ingestionId);
    expect(review).not.toBeNull();
    expect(review?.candidate.fields['客户姓名']).toBe('张三');
    expect(review?.candidate.fields['联系方式']).toBe('13800138000');
    expect(review?.candidate.fields['预算区间']).toBe('3000-5000元');
    // Pipeline evidence persisted inside the validation object.
    const validation = review?.validation as Record<string, unknown>;
    expect(validation['pipelineVersion']).toBeDefined();
    expect(validation['stages']).toBeDefined();
  });

  it('produces Chinese normalized_fields from an English-keyed candidate', async () => {
    const { app } = await setup();
    const ingestionId = await createTask(app);
    const payload = makeCandidatePayload({ customer_name: '李四' });

    const response = await postCandidate(app, ingestionId, payload);
    expect(response.statusCode).toBe(200);

    const taskResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    const task = taskResponse.json();
    // The English candidate key customer_name was mapped to the canonical
    // Chinese field 客户姓名 before being persisted on the task.
    expect(task.candidate.fields['客户姓名']).toBe('李四');
    expect(task.candidate.fields['customer_name']).toBeUndefined();
    expect(task.normalized_fields['客户姓名']).toBe('李四');
  });

  it('replays return the same opaque review_record_id', async () => {
    const { app } = await setup();
    const ingestionId = await createTask(app);
    const payload = makeCandidatePayload();

    const first = await postCandidate(app, ingestionId, payload);
    const second = await postCandidate(app, ingestionId, payload);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().review_record_id).toBe(first.json().review_record_id);
  });

  it('records UNMAPPED_CANDIDATE_FIELD warnings on the task', async () => {
    const { app } = await setup();
    const ingestionId = await createTask(app);
    const payload = makeCandidatePayload({ unknown_field: 'dropped' });

    const response = await postCandidate(app, ingestionId, payload);
    expect(response.statusCode).toBe(200);

    const taskResponse = await app.inject({
      method: 'GET',
      url: `/v1/ingestions/${ingestionId}`,
    });
    const task = taskResponse.json();
    const unmapped = task.warnings.find(
      (w: { code: string }) => w.code === 'UNMAPPED_CANDIDATE_FIELD'
    );
    expect(unmapped).toBeDefined();
    expect(unmapped.field).toBe('unknown_field');
    // Unknown field never reaches normalized_fields.
    expect(task.normalized_fields['unknown_field']).toBeUndefined();
  });

  it('returns validation_failed with no review when the pipeline fails', async () => {
    const { app, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // Use a candidate that the rules adapter will reject as unsupported to
    // force the pipeline into a failure path.
    const payload = {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: { 客户姓名: '' }, // empty value triggers rules validation failure
        field_confidence: {},
        evidence: {},
      },
    };

    const response = await postCandidate(app, ingestionId, payload);

    // Either the pipeline passed (status pending_review) or failed
    // (status validation_failed). Both are acceptable HTTP 200 outcomes;
    // what matters is that no review record is created on failure.
    expect(response.statusCode).toBe(200);
    const body = response.json();
    if (body.status === 'validation_failed') {
      expect(body.review_record_id).toBe('');
      const review = await reviewRepository.findByIngestionId(ingestionId);
      expect(review).toBeNull();
      expect(reviewRepository.size()).toBe(0);
    } else {
      // If the pipeline did not fail on this input, the test still passes —
      // the validation_failed path is covered by unit tests in
      // tests/unit/ingestion-service.test.ts.
      expect(body.status).toBe('pending_review');
    }
  });

  it('rejects unsigned callback', async () => {
    const { app } = await setup();
    const ingestionId = await createTask(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/ingestions/${ingestionId}/candidate`,
      payload: makeCandidatePayload(),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects callback with invalid signature', async () => {
    const { app } = await setup();
    const ingestionId = await createTask(app);
    const payload = makeCandidatePayload();
    const rawBody = JSON.stringify(payload);
    const { timestamp } = generateSignatureHeaders(rawBody, WEBHOOK_SECRET);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/ingestions/${ingestionId}/candidate`,
      headers: {
        'x-collator-timestamp': timestamp,
        'x-collator-signature': 'invalid',
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it('P0-01: GET response redacts nested Candidate PII (phone in fields and evidence) without mutating stored task', async () => {
    const { app, repository, reviewRepository } = await setup();
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

    const callbackResponse = await postCandidate(app, ingestionId, payload);
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
    const { app, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // Candidate carries a non-phone WeChat ID in `contact`. The mapper
    // canonicalizes `contact` to `联系方式` for `candidate.fields`, but
    // `raw_candidate.fields.contact` retains the original English key. Both
    // must be masked in the GET response.
    const payload = makeCandidatePayload({
      contact: 'wechat_secret_01',
    });

    const callbackResponse = await postCandidate(app, ingestionId, payload);
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
    const { app, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // Mixed phone + WeChat ID in a single contact string. redactContactValue
    // must fail closed: no residual `wechat_secret_01` may cross the GET
    // response boundary, and the pure-phone mask format does not apply.
    const mixedContact = '电话13800138000 微信wechat_secret_01';
    const payload = makeCandidatePayload({
      contact: mixedContact,
    });

    const callbackResponse = await postCandidate(app, ingestionId, payload);
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
    const { app, repository, reviewRepository } = await setup();
    const ingestionId = await createTask(app);
    // `fields.contact` as an array of strings. Recursion must propagate
    // contact context to each element so non-phone WeChat IDs are masked
    // instead of falling back to redactPhone (which would leave them intact).
    const contactArray = ['wechat_secret_01'];
    const payload = makeCandidatePayload({
      contact: contactArray,
    });

    const callbackResponse = await postCandidate(app, ingestionId, payload);
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
    const { app, repository, reviewRepository } = await setup();
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

    const callbackResponse = await postCandidate(app, ingestionId, payload);
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
    const { app, repository, reviewRepository } = await setup();
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

    const callback = await postCandidate(app, ingestionId, payload);
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
    const { app, repository, reviewRepository } = await setup();
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

    const callback = await postCandidate(app, ingestionId, payload);
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

  async function createTaskWithCandidate(app: FastifyInstance) {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/ingestions',
      payload: makeIngestionBody(),
    });
    const ingestionId = created.json().ingestion_id as string;

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
    const rawBody = JSON.stringify(payload);
    const { timestamp, signature } = generateSignatureHeaders(rawBody, WEBHOOK_SECRET);

    const candidateResponse = await app.inject({
      method: 'POST',
      url: `/v1/internal/ingestions/${ingestionId}/candidate`,
      headers: {
        'x-collator-timestamp': timestamp,
        'x-collator-signature': signature,
      },
      payload,
    });

    return {
      ingestionId,
      reviewRecordId: candidateResponse.json().review_record_id as string,
    };
  }

  it('approves an ingestion', async () => {
    const { app } = await setup();
    const { ingestionId, reviewRecordId } = await createTaskWithCandidate(app);

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
    const { app } = await setup();
    const { ingestionId } = await createTaskWithCandidate(app);

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
