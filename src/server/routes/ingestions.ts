import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CollatorError } from '../domain/errors.js';
import type { IngestionService } from '../services/ingestion-service.js';
import { verifySignature } from '../security/signature.js';
import { redactObject } from '../security/redaction.js';

const createIngestionSchema = z.object({
  source_system: z.string().min(1),
  source_record_id: z.string().min(1),
  source_type: z.string().min(1),
  target_domain: z.string().min(1),
  content: z.string().min(1),
  submitted_at: z.string().datetime(),
  timezone: z.string().optional(),
  submitted_by: z.string().optional(),
  dry_run: z.boolean().optional(),
});

const candidateCallbackSchema = z.object({
  candidate: z.object({
    schema_name: z.string(),
    schema_version: z.string(),
    prompt_version: z.string(),
    fields: z.record(z.unknown()),
    field_confidence: z.record(z.number()).default({}),
    evidence: z.record(z.string()).default({}),
  }),
  workflow_run_id: z.string().optional(),
});

const approveSchema = z.object({
  reviewer_id: z.string().min(1),
  review_record_id: z.string().min(1),
  corrections: z.record(z.unknown()).optional(),
});

const rejectSchema = z.object({
  reviewer_id: z.string().min(1),
  reason_code: z.string().min(1),
  reason: z.string().min(1),
});

function redactTask(task: import('../domain/ingestion.js').IngestionTask): Record<string, unknown> {
  return redactObject(task as unknown as Record<string, unknown>);
}

export async function ingestionRoutes(app: FastifyInstance, service: IngestionService, webhookSecret: string): Promise<void> {
  app.post('/v1/ingestions', async (request, reply) => {
    const body = createIngestionSchema.parse(request.body);
    const result = await service.createIngestion(body);
    return reply.status(202).send(result);
  });

  app.get('/v1/ingestions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const task = await service.getIngestion(id);
    return redactTask(task);
  });

  app.post('/v1/internal/ingestions/:id/candidate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const timestamp = request.headers['x-collator-timestamp'] as string | undefined;
    const signature = request.headers['x-collator-signature'] as string | undefined;
    const rawBody = JSON.stringify(request.body);

    const verification = verifySignature(rawBody, timestamp ?? '', signature ?? '', webhookSecret);
    if (!verification.valid) {
      request.log.warn({ reason: verification.reason }, 'Invalid callback signature');
      throw new CollatorError('UNAUTHORIZED', verification.reason ?? 'Invalid signature', 401);
    }

    const body = candidateCallbackSchema.parse(request.body);
    const result = await service.receiveCandidate(id, body);
    return reply.status(200).send(result);
  });

  app.post('/v1/ingestions/:id/approve', async (request) => {
    const { id } = request.params as { id: string };
    const body = approveSchema.parse(request.body);
    const result = await service.approve(id, body);
    return redactTask(result);
  });

  app.post('/v1/ingestions/:id/reject', async (request) => {
    const { id } = request.params as { id: string };
    const body = rejectSchema.parse(request.body);
    const result = await service.reject(id, body);
    return redactTask(result);
  });
}
