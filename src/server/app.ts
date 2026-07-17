import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { ingestionRoutes } from './routes/ingestions.js';
import { IngestionService } from './services/ingestion-service.js';
import {
  createRepositories,
} from './repositories/repository-factory.js';
import type { TaskRepository } from './repositories/task-repository.js';
import type { ReviewRepository } from './repositories/review-repository.js';
import { CollatorError } from './domain/errors.js';

export interface BuildAppOptions {
  repository?: TaskRepository;
  reviewRepository?: ReviewRepository;
}

export async function buildApp(options?: BuildAppOptions) {
  const config = loadConfig();
  // Production wiring: build the matching task+review bundle from config.
  // Tests can pass explicit repositories to bypass config-driven selection.
  let repository: TaskRepository;
  let reviewRepository: ReviewRepository;
  if (options?.repository && options?.reviewRepository) {
    repository = options.repository;
    reviewRepository = options.reviewRepository;
  } else if (options?.repository) {
    // Backward-compat: caller injected only a task repository. Synthesize
    // an in-memory review repository so the service can still run.
    repository = options.repository;
    const { InMemoryReviewRepository } = await import(
      './repositories/in-memory-review-repository.js'
    );
    reviewRepository = new InMemoryReviewRepository();
  } else {
    const bundle = createRepositories(config);
    repository = bundle.taskRepository;
    reviewRepository = bundle.reviewRepository;
  }
  const service = new IngestionService(repository, reviewRepository);

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

  return { app, config, service, repository, reviewRepository };
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
