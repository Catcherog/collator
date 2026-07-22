import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IngestionService } from '../services/ingestion-service.js';
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

export async function ingestionRoutes(app: FastifyInstance, service: IngestionService): Promise<void> {
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

  // FAMP-CONTRACT-ADOPTION-GATE-01-R1: Dify callback 路由正式废止
  //
  // 此路由原为 Dify 回调持续摄入入口，使用 CandidateRecord 形状（非 Candidate V1
  // 合同），可经 approve 触发真实飞书客户表写入，绕过 validateCandidateV1 合同
  // 门禁。R1 将其正式废止（410 Gone），消除合同绕过路径。
  //
  // 替代入口：POST /v1/ingestions/:id/candidate-v1（使用 Candidate V1 合同）
  //
  // 废止行为：
  // - 不校验签名、不解析 body、不调用 service
  // - 返回 410 Gone + CONTRACT_ADOPTION_GATE_ABOLISHED 错误码
  // - 无副作用（不读不写 task / review 仓库）
  app.post('/v1/internal/ingestions/:id/candidate', async (_request, reply) => {
    return reply.status(410).send({
      error: {
        code: 'CONTRACT_ADOPTION_GATE_ABOLISHED',
        message: 'Dify callback candidate intake path abolished. Use POST /v1/ingestions/:id/candidate-v1 with Candidate V1 contract.',
      },
    });
  });

  // Candidate V1 持续摄入入口（R1: 唯一合法候选摄入入口）
  //
  // R1 变更：原 Dify callback 路由 `/v1/internal/ingestions/:id/candidate` 已废止
  //（410 Gone），本路由成为唯一合法候选摄入入口。
  //
  // 调用链（R1 已全线接通）：
  //   1. validateCandidateV1（合同校验，路由层） — 校验失败返回 HTTP 400
  //   2. service.adoptCandidateV1（持久化前） — 内部调用 preWriteClient.callPreWrite
  //      做 PRE_WRITE 治理（生产环境为 SopPreWriteClient，调用 SOP handlePreWrite）
  //   3. 治理 BLOCKED → fail-closed 不持久化（AC-R1-05 无副作用）
  //   4. 治理 PASS / NEEDS_REVIEW → 持久化候选
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
