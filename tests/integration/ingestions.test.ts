import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { InMemoryTaskRepository } from '../../src/server/repositories/in-memory-task-repository.js';
import { generateSignatureHeaders } from '../../src/server/security/signature.js';
import type { FastifyInstance } from 'fastify';

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

async function setup(): Promise<{ app: FastifyInstance; repository: InMemoryTaskRepository }> {
  process.env.COLLATOR_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const repository = new InMemoryTaskRepository();
  const { app } = await buildApp({ repository });
  return { app, repository };
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

  function makeCandidatePayload() {
    return {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: { budget: '3000-5000元' },
        field_confidence: { budget: 0.95 },
        evidence: { budget: '预算3000元左右' },
      },
    };
  }

  it('accepts a signed candidate callback', async () => {
    const { app } = await setup();
    const ingestionId = await createTask(app);
    const payload = makeCandidatePayload();
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

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('pending_review');
    expect(body.review_record_id).toMatch(/^rec_review_[a-f0-9]{32}$/);
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
        fields: { budget: '3000-5000元' },
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
