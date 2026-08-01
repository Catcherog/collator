// screenshots.ts
// 主线 A1: 截图纵向闭环 — 7 个 API 路由处理器。
//
// 路由列表（与 screenshot-api-v1.ts SCREENSHOT_ROUTES 对齐）：
//   1. POST   /v1/screenshots                      — 创建截图提交
//   2. GET    /v1/screenshots/:id                  — 查询处理状态
//   3. GET    /v1/screenshots/:id/evidence          — 获取 OCR 证据和 Candidate
//   4. POST   /v1/screenshots/:id/corrections       — 提交人工修正
//   5. POST   /v1/screenshots/:id/confirm            — 确认写入
//   6. POST   /v1/screenshots/:id/escalate-review    — 转人工复核
//   7. GET    /v1/screenshots/:id/final-result       — 获取最终治理和写入结果
//
// 错误响应格式（由 app.ts 的 setErrorHandler 统一处理 CollatorError）：
//   { error: { code: string, message: string } }
//
// AC-A11: 未知 schema_version fail closed — 由 zod 校验 + service 层保证。
// AC-A08: 重复上传幂等 — 由 service.createScreenshot 的 idempotency_key 保证。
// AC-A09: 重复确认/复核幂等 — 由 service.confirmWrite/escalateReview 保证。
// AC-A03: 人工修正标记为 CONFIRMED — 由 service.submitCorrections 保证。

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ScreenshotService } from '../services/screenshot-service.js';
import { UnauthorizedError } from '../domain/errors.js';

// ============================================================================
// 请求体 Schema（zod 校验）
// ============================================================================

const createScreenshotSchema = z.object({
  source_system: z.string().min(1),
  source_record_id: z.string().min(1),
  submitted_at: z.string().datetime(),
  submitted_by: z.string().optional(),
  image_base64: z.string().optional(),
  image_filename: z.string().optional(),
  image_url: z.string().url().optional(),
  dry_run: z.boolean().optional(),
}).refine(
  (data) => data.image_base64 || data.image_url,
  { message: 'Either image_base64 or image_url is required' }
);

const submitCorrectionsSchema = z.object({
  reviewer_id: z.string().min(1),
  corrections: z.record(z.unknown()),
  correction_reason: z.string().optional(),
});

const confirmWriteSchema = z.object({
  reviewer_id: z.string().min(1),
  candidate_v1_id: z.string().min(1),
  dry_run: z.boolean().optional(),
  target_tables: z.array(z.enum(['customer', 'project', 'model'])).optional(),
  production_pilot_preview_id: z.string().uuid().optional(),
  production_pilot_nonce: z.string().uuid().optional(),
}).strict();

const createProductionPilotPreviewSchema = z.object({
  screenshot_id: z.string().min(1),
  candidate_v1_id: z.string().min(1),
}).strict();

const confirmProductionPilotPreviewSchema = z.object({
  nonce: z.string().uuid(),
}).strict();

const escalateReviewSchema = z.object({
  reviewer_id: z.string().min(1),
  reason_code: z.string().min(1),
  reason: z.string().min(1),
  suggested_fields: z.record(z.unknown()).optional(),
});

export type AuthenticatedOperatorResolver = (
  request: FastifyRequest,
) => string | undefined | Promise<string | undefined>;

export interface ScreenshotRouteOptions {
  /** Principal supplied by a verified OAuth/JWT/reverse-proxy middleware. */
  authenticatedOperatorResolver?: AuthenticatedOperatorResolver;
  /** Production-pilot must never fall back to a client-controlled header. */
  requireVerifiedOperator?: boolean;
}

async function getAuthenticatedOperator(
  request: FastifyRequest,
  options: ScreenshotRouteOptions,
): Promise<string> {
  if (options.authenticatedOperatorResolver) {
    const principal = await options.authenticatedOperatorResolver(request);
    if (principal?.trim()) return principal;
  }
  if (options.requireVerifiedOperator) {
    throw new UnauthorizedError('Verified operator principal is required');
  }
  const value = request.headers['x-operator-id'] ?? request.headers['x-authenticated-operator'];
  const operator = Array.isArray(value) ? value[0] : value;
  if (!operator?.trim()) throw new UnauthorizedError('Authenticated operator header is required');
  return operator;
}

// ============================================================================
// 路由注册
// ============================================================================

export async function screenshotRoutes(
  app: FastifyInstance,
  service: ScreenshotService,
  options: ScreenshotRouteOptions = {},
): Promise<void> {
  const createPilotPreview = async (request: { body?: unknown; headers: Record<string, string | string[] | undefined> }, reply: { send: (body: unknown) => unknown }) => {
    const body = createProductionPilotPreviewSchema.parse(request.body);
    const operator = await getAuthenticatedOperator(request as FastifyRequest, options);
    const result = await service.createProductionPilotPreview(
      body.screenshot_id,
      { candidate_v1_id: body.candidate_v1_id },
      operator,
    );
    return reply.send(result);
  };
  const confirmPilotPreview = async (
    request: { body?: unknown; params?: unknown; headers: Record<string, string | string[] | undefined> },
  ) => {
    const body = confirmProductionPilotPreviewSchema.parse(request.body);
    const { id } = request.params as { id: string };
    return service.confirmProductionPilotPreview(id, await getAuthenticatedOperator(request as FastifyRequest, options), body.nonce);
  };

  app.post('/v1/production-pilot/previews', createPilotPreview);
  app.post('/production-pilot/previews', createPilotPreview);
  app.post('/v1/production-pilot/previews/:id/confirm', confirmPilotPreview);
  app.post('/production-pilot/previews/:id/confirm', confirmPilotPreview);

  // 1. POST /v1/screenshots — 创建截图提交
  app.post('/v1/screenshots', async (request, reply) => {
    const body = createScreenshotSchema.parse(request.body);
    const result = await service.createScreenshot(body);
    const status = result.idempotent_replay ? 200 : 202;
    return reply.status(status).send(result);
  });

  // 2. GET /v1/screenshots/:id — 查询处理状态
  app.get('/v1/screenshots/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await service.getScreenshotStatus(id);
  });

  // 3. GET /v1/screenshots/:id/evidence — 获取 OCR 证据和 Candidate
  app.get('/v1/screenshots/:id/evidence', async (request) => {
    const { id } = request.params as { id: string };
    return await service.getScreenshotEvidence(id);
  });

  // 4. POST /v1/screenshots/:id/corrections — 提交人工修正
  app.post('/v1/screenshots/:id/corrections', async (request) => {
    const { id } = request.params as { id: string };
    const body = submitCorrectionsSchema.parse(request.body);
    return await service.submitCorrections(id, body);
  });

  // 5. POST /v1/screenshots/:id/confirm — 确认写入
  app.post('/v1/screenshots/:id/confirm', async (request) => {
    const { id } = request.params as { id: string };
    const body = confirmWriteSchema.parse(request.body);
    const operator = body.production_pilot_preview_id || body.production_pilot_nonce
      ? await getAuthenticatedOperator(request, options)
      : undefined;
    return await service.confirmWrite(id, body, operator);
  });

  const executeProductionPilotWrite = async (request: { body?: unknown; params?: unknown; headers: Record<string, string | string[] | undefined> }) => {
    const { id } = request.params as { id: string };
    const body = confirmWriteSchema.parse(request.body);
    const operator = await getAuthenticatedOperator(request as FastifyRequest, options);
    return service.confirmWrite(id, body, operator);
  };
  app.post('/v1/screenshots/:id/confirm-write', executeProductionPilotWrite);
  app.post('/screenshots/:id/confirm-write', executeProductionPilotWrite);

  // 6. POST /v1/screenshots/:id/escalate-review — 转人工复核
  app.post('/v1/screenshots/:id/escalate-review', async (request) => {
    const { id } = request.params as { id: string };
    const body = escalateReviewSchema.parse(request.body);
    return await service.escalateReview(id, body);
  });

  // 7. GET /v1/screenshots/:id/final-result — 获取最终治理和写入结果
  app.get('/v1/screenshots/:id/final-result', async (request) => {
    const { id } = request.params as { id: string };
    return await service.getFinalResult(id);
  });
}
