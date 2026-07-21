import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CollatorError } from '../domain/errors.js';
import type { IngestionService } from '../services/ingestion-service.js';
import { verifySignature } from '../security/signature.js';
import { redactObject } from '../security/redaction.js';
import {
  validateCandidateV1,
  ContractValidationError,
} from '../../contracts/candidate-v1.js';

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

  // Task 3 Adoption Gate — Candidate V1 持续摄入入口
  //
  // 此路由是 AC-10 Adoption Gate 的 collator 侧采用点：路由在调用任何
  // 下游服务前，先通过 `validateCandidateV1` 校验请求体是否符合 Candidate V1
  // 合同。校验失败时返回 HTTP 400 并附带合同错误代码（UNKNOWN_SCHEMA_VERSION /
  // MISSING_REQUIRED_FIELD / INVALID_FIELD_TYPE），**不**调用 service，**不**
  // 产生飞书业务写入副作用。校验通过时调用 `service.adoptCandidateV1` 持久化
  // V1 候选作为采用证据（不触发 customer_consultation 清洗管道）。
  //
  // 与现有 `/v1/internal/ingestions/:id/candidate` 路由的关系：新增路由，不修改
  // 现有 Dify 回调链路。Dify 回调仍使用 CandidateRecord 形状，V1 合同接入是
  // 新增路径而非重构现有路径。
  app.post('/v1/ingestions/:id/candidate-v1', async (request, reply) => {
    const { id } = request.params as { id: string };

    let candidate;
    try {
      candidate = validateCandidateV1(request.body);
    } catch (err) {
      if (err instanceof ContractValidationError) {
        return reply.status(400).send({
          error: {
            code: err.code,
            message: err.message,
            field: err.field,
          },
        });
      }
      throw err;
    }

    const result = await service.adoptCandidateV1(id, candidate);
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
