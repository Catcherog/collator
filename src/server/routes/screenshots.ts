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

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ScreenshotService } from '../services/screenshot-service.js';

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
  pilot_run_id: z.string().min(1).optional(),
  human_confirmed: z.boolean().optional(),
  production_pilot_preview: z.object({
    previewId: z.string().regex(/^[a-f0-9]{64}$/),
    generatedAt: z.string().datetime(),
    writeMode: z.literal('production-pilot'),
    plannedRecordCount: z.number().int().nonnegative(),
    targetTableAliases: z.array(z.enum(['customer', 'project', 'model'])),
    targetTableDigests: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
    baseTokenDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    confirmed: z.boolean(),
    confirmedAt: z.string().datetime().optional(),
  }).optional(),
});

const escalateReviewSchema = z.object({
  reviewer_id: z.string().min(1),
  reason_code: z.string().min(1),
  reason: z.string().min(1),
  suggested_fields: z.record(z.unknown()).optional(),
});

// ============================================================================
// 路由注册
// ============================================================================

export async function screenshotRoutes(
  app: FastifyInstance,
  service: ScreenshotService
): Promise<void> {
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
    return await service.confirmWrite(id, body);
  });

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
