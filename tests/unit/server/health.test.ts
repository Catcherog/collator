import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthRoutes } from '../../../src/server/routes/health.js';

async function buildHealthApp(options: NonNullable<Parameters<typeof healthRoutes>[1]>) {
  const app = Fastify();
  await app.register(healthRoutes, options);
  return app;
}

describe('healthRoutes readiness dependencies', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not require SOP outside protected write lanes', async () => {
    const fetchImpl = vi.fn();
    const app = await buildHealthApp({ requireSop: false, fetchImpl: fetchImpl as typeof fetch });
    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ready',
      dependencies: { sop: 'not_required' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns ready only when SOP /healthz is healthy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    const app = await buildHealthApp({
      requireSop: true,
      sopHttpUrl: 'http://127.0.0.1:3001/',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ready',
      dependencies: { sop: 'ready' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/healthz',
      expect.objectContaining({ method: 'GET' }),
    );
    await app.close();
  });

  it('returns 503 with an explicit SOP dependency state when SOP is unavailable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused'));
    const app = await buildHealthApp({ requireSop: true, fetchImpl: fetchImpl as typeof fetch });
    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'not_ready',
      dependencies: { sop: 'unavailable' },
    });
    await app.close();
  });
});
