import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { screenshotRoutes } from '../../../../src/server/routes/screenshots.js';
import type { ScreenshotService } from '../../../../src/server/services/screenshot-service.js';
import { CollatorError } from '../../../../src/server/domain/errors.js';

function createPreviewRouteApp(options: Parameters<typeof screenshotRoutes>[2]) {
  const service = {
    createProductionPilotPreview: vi.fn(async () => ({
      preview_id: '00000000-0000-4000-8000-000000000001',
      nonce: '00000000-0000-4000-8000-000000000002',
      status: 'generated',
    })),
  } as unknown as ScreenshotService & {
    createProductionPilotPreview: ReturnType<typeof vi.fn>;
  };
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CollatorError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } });
  });
  return { app, service, register: () => screenshotRoutes(app, service, options) };
}

describe('production-pilot verified operator boundary', () => {
  it('uses the verified principal instead of a spoofed operator header', async () => {
    const context = createPreviewRouteApp({
      requireVerifiedOperator: true,
      authenticatedOperatorResolver: () => 'verified-principal',
    });
    await context.register();

    const response = await context.app.inject({
      method: 'POST',
      url: '/v1/production-pilot/previews',
      headers: { 'x-operator-id': 'spoofed-header-operator' },
      payload: {
        screenshot_id: 'shot_auth_boundary',
        candidate_v1_id: 'candidate_auth_boundary',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(context.service.createProductionPilotPreview).toHaveBeenCalledWith(
      'shot_auth_boundary',
      { candidate_v1_id: 'candidate_auth_boundary' },
      'verified-principal',
    );
    await context.app.close();
  });

  it('rejects production-pilot requests when the verified principal resolver is absent', async () => {
    const context = createPreviewRouteApp({ requireVerifiedOperator: true });
    await context.register();

    const response = await context.app.inject({
      method: 'POST',
      url: '/v1/production-pilot/previews',
      headers: { 'x-operator-id': 'spoofed-header-operator' },
      payload: {
        screenshot_id: 'shot_auth_missing',
        candidate_v1_id: 'candidate_auth_missing',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(context.service.createProductionPilotPreview).not.toHaveBeenCalled();
    await context.app.close();
  });
});
