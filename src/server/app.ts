import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { ingestionRoutes } from './routes/ingestions.js';
import { IngestionService } from './services/ingestion-service.js';
import { InMemoryTaskRepository } from './repositories/in-memory-task-repository.js';
import { CollatorError } from './domain/errors.js';

export async function buildApp(options?: { repository?: import('./repositories/task-repository.js').TaskRepository }) {
  const config = loadConfig();
  const repository = options?.repository ?? new InMemoryTaskRepository();
  const service = new IngestionService(repository);

  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof CollatorError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof Error && error.name === 'ZodError') {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
        },
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  });

  await app.register(healthRoutes);
  await app.register(async (instance) => {
    await ingestionRoutes(instance, service, config.webhookSecret);
  });

  return { app, config, service, repository };
}

async function main() {
  const { app, config } = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Collator server listening on port ${config.port}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
