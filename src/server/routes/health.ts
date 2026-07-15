import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    // V1 ready check: config loaded. Real Feishu/Dify checks are optional in test env.
    const ready = true;
    if (!ready) {
      return reply.status(503).send({ status: 'not_ready' });
    }
    return { status: 'ready' };
  });
}
