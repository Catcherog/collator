import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { loadConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { ingestionRoutes } from './routes/ingestions.js';
import { screenshotRoutes } from './routes/screenshots.js';
import { IngestionService } from './services/ingestion-service.js';
import { ScreenshotService, type ScreenshotServiceOptions } from './services/screenshot-service.js';
import { createOcrEngineFromEnv } from '../ocr/ocr-engine-factory.js';
import { loadAuditConfig } from './config/audit-config.js';
import { createFileAuditRepository, type AuditLogger } from './repositories/audit/file-audit-repository.js';
import type { AuditLogRepository } from '../audit/audit-log-repository.js';
import { SopScreenshotGovernanceClient } from './governance/screenshot-governance-client.js';
import { TransactionalBatchWriter } from './business/transactional-batch-writer.js';
import { GuardedBatchWriter } from './business/guarded-batch-writer.js';
import { loadFeishuWriteConfig } from './config/feishu-write-config.js';
import { FeishuProjectRecordWriter } from './business/project-record-writer.js';
import { FeishuModelRecordWriter } from './business/model-record-writer.js';
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
import { FeishuClient } from './feishu/feishu-client.js';
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
  /**
   * 主线 A1: 截图纵向闭环 — 截图服务选项。
   *
   * 测试模式可注入 mock OCR / fake governance client / fake batch writer。
   * 生产模式（未注入时）自动装配：
   *   - OCR: createOcrEngineFromEnv（fail-closed，amendment 3）
   *   - Governance: SopScreenshotGovernanceClient（调用 SOP /v1/pre-write）
   *   - BatchWriter: 仅在 feishu 模式且有 project/model 表 ID 时装配
   */
  screenshotServiceOptions?: ScreenshotServiceOptions;
}

export async function buildApp(options?: BuildAppOptions) {
  const config = loadConfig();

  // Workstream D/E: create Fastify early so app.log (pino) is available for
  // the audit repository adapter before services are constructed.
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  // Workstream D/E: 审计日志仓库（文件后端，无外部凭据依赖，AC-D01）。
  // 仅在生产/config-driven 模式（未注入 repository）下创建，避免测试写盘。
  // 服务以 `if (this.auditLogRepository)` 守卫 record() 调用，故测试模式不受影响。
  let auditLogRepository: AuditLogRepository | undefined;
  if (!options?.repository) {
    const auditConfig = loadAuditConfig(process.env);
    // pino warn(obj, msg) 与 AuditLogger.warn(msg, extra) 形参顺序不同，需适配。
    const auditLogger: AuditLogger = {
      warn: (msg, extra) => app.log.child({ module: 'audit' }).warn(extra ?? {}, msg),
    };
    auditLogRepository = createFileAuditRepository(auditConfig, auditLogger);
  }

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
    preWriteClient,
    auditLogRepository
  );

  // 主线 A1: 截图纵向闭环 — 装配 ScreenshotService
  const screenshotServiceOptions: ScreenshotServiceOptions = options?.screenshotServiceOptions ?? {};
  // 生产模式自动装配 OCR + Governance Client（测试模式由调用方注入）
  if (!options?.screenshotServiceOptions) {
    // Workstream B/E: 真实 OCR 引擎由工厂装配（amendment 3 fail-closed）。
    // createOcrEngineFromEnv 缺失/非法 SCREENSHOT_OCR_ENGINE → 抛 OcrConfigError，
    // 进程启动失败，不退化为 mock。测试须显式设置 SCREENSHOT_OCR_ENGINE=mock。
    screenshotServiceOptions.ocrEngine =
      screenshotServiceOptions.ocrEngine ?? createOcrEngineFromEnv(process.env);
    screenshotServiceOptions.governanceClient = screenshotServiceOptions.governanceClient ?? new SopScreenshotGovernanceClient();
    screenshotServiceOptions.writeLogRepository = screenshotServiceOptions.writeLogRepository ?? writeLogRepository;
    // Workstream D/E: 审计仓库透传到截图服务。
    screenshotServiceOptions.auditLogRepository = screenshotServiceOptions.auditLogRepository ?? auditLogRepository;
    // 仅在 feishu 模式且有 project/model 表 ID 时装配 batch writer
    if (
      !screenshotServiceOptions.batchWriter &&
      config.taskRepository === 'feishu' &&
      config.feishuAppId && config.feishuAppSecret && config.feishuBaseAppToken &&
      config.feishuProjectTableId && config.feishuModelTableId
    ) {
      const feishuClient = new FeishuClient({
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
        baseToken: config.feishuBaseAppToken,
      });
      const projectWriter = new FeishuProjectRecordWriter(feishuClient, {
        projectTableId: config.feishuProjectTableId,
      });
      const modelWriter = new FeishuModelRecordWriter(feishuClient, {
        modelTableId: config.feishuModelTableId,
      });
      const innerWriter = new TransactionalBatchWriter(
        customerRecordWriter,
        projectWriter,
        modelWriter,
        writeLogRepository
      );
      // Workstream C/E: 用 GuardedBatchWriter 包裹 TransactionalBatchWriter，
      // 在 Create Record 前执行双层放行门（Amendment 6）。默认配置下门禁全部
      // fail-closed（6 条件任一不满足即 blocked，绝不调用 Create Record API）。
      const gateConfig = loadFeishuWriteConfig();
      screenshotServiceOptions.batchWriter = new GuardedBatchWriter(gateConfig, innerWriter);
      // 透传写入门禁上下文（目标 Base/Table ID）供 GuardedBatchWriter 校验白名单。
      screenshotServiceOptions.feishuWriteContext = {
        targetBaseToken: config.feishuBaseAppToken,
        customerTableId: config.feishuCustomerTableId,
        projectTableId: config.feishuProjectTableId,
        modelTableId: config.feishuModelTableId,
      };
    }
  }
  const screenshotService = new ScreenshotService(repository, screenshotServiceOptions);

  // 主线 A1: 注册 CORS 和 multipart 插件（供截图上传和跨域调用）
  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: config.screenshotMaxFileSizeBytes,
      files: config.screenshotMaxCount,
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
  await app.register(async (instance) => {
    await screenshotRoutes(instance, screenshotService);
  });

  return { app, config, service, repository, reviewRepository, screenshotService };
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
