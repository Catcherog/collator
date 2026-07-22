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
import type { WriteLogRepository } from './repositories/write-log-repository.js';
import type { CustomerRecordWriter } from './business/customer-record-writer.js';
import type { PreWriteClient } from './governance/pre-write-client.js';
import {
  SopPreWriteClient,
} from './governance/pre-write-client.js';
import { CollatorError } from './domain/errors.js';

export interface BuildAppOptions {
  repository?: TaskRepository;
  reviewRepository?: ReviewRepository;
  /**
   * Optional customer-record writer. When provided alongside
   * `writeLogRepository`, `approve()` runs the full TASK-003 commit
   * flow (pending_review → approved → committing → completed/commit_failed).
   * When absent, `approve()` falls back to the legacy Phase 3B path.
   */
  customerRecordWriter?: CustomerRecordWriter;
  writeLogRepository?: WriteLogRepository;
  /**
   * FAMP-CONTRACT-ADOPTION-GATE-01-R1 / AC-R1-02
   * FAMP-CONTRACT-ADOPTION-GATE-01-R1-FIX / RF-02 / RF-FIX-02
   *
   * PRE_WRITE governance client. Required when repository/reviewRepository
   * are explicitly injected (test mode). No silent NoOp fallback (RF-02).
   * Tests must inject a PreWriteClient from tests/fixtures/ (e.g. NoOp fixture),
   * FakePreWriteClient, or SopPreWriteClient explicitly.
   *
   * When omitted in production mode (config-driven bundle), defaults to SopPreWriteClient.
   */
  preWriteClient?: PreWriteClient;
}

export async function buildApp(options?: BuildAppOptions) {
  const config = loadConfig();
  // Production wiring: build the matching task+review bundle from config.
  // Tests can pass explicit repositories to bypass config-driven selection.
  let repository: TaskRepository;
  let reviewRepository: ReviewRepository;
  let customerRecordWriter: CustomerRecordWriter | undefined;
  let writeLogRepository: WriteLogRepository | undefined;
  // R1: PRE_WRITE 治理客户端。RF-02: 测试模式必须显式注入，生产模式默认 SopPreWriteClient。
  let preWriteClient: PreWriteClient;
  if (options?.repository && options?.reviewRepository) {
    repository = options.repository;
    reviewRepository = options.reviewRepository;
    customerRecordWriter = options.customerRecordWriter;
    writeLogRepository = options.writeLogRepository;
    // RF-02: 测试模式必须显式注入 preWriteClient，不再提供 NoOp 默认 fallback。
    // RF-FIX-02: NoOp 实现位于 tests/fixtures/，生产源码不含 NoOp。
    // 测试 fixture 应通过 createTestApp() 或显式注入 tests/fixtures/ 中的 NoOp。
    if (!options.preWriteClient) {
      throw new Error(
        'buildApp: test mode (repository injected) requires explicit preWriteClient. ' +
        'Inject a NoOp fixture from tests/fixtures/ for unit tests, FakePreWriteClient for PRE_WRITE behavior tests, ' +
        'or SopPreWriteClient for integration tests. No silent fallback (RF-02 / RF-FIX-02).'
      );
    }
    preWriteClient = options.preWriteClient;
  } else if (options?.repository) {
    // Backward-compat: caller injected only a task repository. Synthesize
    // an in-memory review repository so the service can still run.
    repository = options.repository;
    const { InMemoryReviewRepository } = await import(
      './repositories/in-memory-review-repository.js'
    );
    reviewRepository = new InMemoryReviewRepository();
    customerRecordWriter = options.customerRecordWriter;
    writeLogRepository = options.writeLogRepository;
    // RF-02: 同样必须显式注入 preWriteClient。
    if (!options.preWriteClient) {
      throw new Error(
        'buildApp: test mode (repository-only injected) requires explicit preWriteClient (RF-02).'
      );
    }
    preWriteClient = options.preWriteClient;
  } else {
    const bundle = createRepositories(config);
    repository = bundle.taskRepository;
    reviewRepository = bundle.reviewRepository;
    customerRecordWriter = bundle.customerRecordWriter;
    writeLogRepository = bundle.writeLogRepository;
    // 生产模式：默认 SopPreWriteClient，将 SOP handlePreWrite 接入持续摄入链路。
    preWriteClient = options?.preWriteClient ?? new SopPreWriteClient();
  }
  const service = new IngestionService(
    repository,
    reviewRepository,
    customerRecordWriter,
    writeLogRepository,
    preWriteClient
  );

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
    await ingestionRoutes(instance, service);
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
