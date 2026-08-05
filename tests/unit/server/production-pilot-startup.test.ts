import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../src/server/app.js';
import { InMemoryTaskRepository } from '../../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryReviewRepository } from '../../../src/server/repositories/in-memory-review-repository.js';
import { InMemoryRunManifestRepository } from '../../../src/server/repositories/run-manifest-repository.js';
import { NoOpPreWriteClient } from '../../fixtures/noop-pre-write-client.js';
import { MockOcrEngine, type ScreenshotOcrEngine } from '../../../src/server/services/screenshot-ocr-adapter.js';
import type {
  BatchWriterPort,
  TransactionalBatchWriterInput,
  TransactionalBatchWriterResult,
} from '../../../src/server/business/transactional-batch-writer.js';

class RecoveryWriter implements BatchWriterPort {
  recoveryCalls = 0;

  constructor(
    private readonly outcome: Array<{ previewId: string; status: 'compensated' | 'compensation_failed' }>,
  ) {}

  async writeBatch(_input: TransactionalBatchWriterInput): Promise<TransactionalBatchWriterResult> {
    throw new Error('not used by startup recovery tests');
  }

  async recoverPendingCompensations(): Promise<Array<{ previewId: string; status: 'compensated' | 'compensation_failed' }>> {
    this.recoveryCalls += 1;
    return this.outcome;
  }
}

function stubProductionPilotEnv(): void {
  vi.stubEnv('COLLATOR_WEBHOOK_SECRET', 'startup-test-secret');
  vi.stubEnv('TASK_REPOSITORY', 'memory');
  vi.stubEnv('DRY_RUN', 'true');
  vi.stubEnv('FEISHU_WRITE_ENV', 'production-pilot');
  vi.stubEnv('ENABLE_PRODUCTION_PILOT', 'true');
  vi.stubEnv('PRODUCTION_PILOT_RUN_ID', 'startup-test-run');
  vi.stubEnv('PRODUCTION_PILOT_JWT_SECRET', '');
}

async function buildStartupApp(
  writer: RecoveryWriter,
  includeVerifiedResolver = true,
  ocrEngine: ScreenshotOcrEngine = new MockOcrEngine(),
) {
  const runManifestRepository = new InMemoryRunManifestRepository();
  return buildApp({
    repository: new InMemoryTaskRepository(),
    reviewRepository: new InMemoryReviewRepository(),
    preWriteClient: new NoOpPreWriteClient(),
    runManifestRepository,
    screenshotServiceOptions: {
      ocrEngine,
      batchWriter: writer,
      runManifestRepository,
    },
    ...(includeVerifiedResolver
      ? { authenticatedOperatorResolver: () => 'startup-operator' }
      : {}),
  });
}

describe('production-pilot startup recovery gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('validates the manifest store and runs durable recovery before startup completes', async () => {
    stubProductionPilotEnv();
    const writer = new RecoveryWriter([{ previewId: 'preview_recovered', status: 'compensated' }]);

    const { app } = await buildStartupApp(writer);
    expect(writer.recoveryCalls).toBe(1);
    await app.close();
  });

  it('fails closed when startup recovery reports a compensation failure', async () => {
    stubProductionPilotEnv();
    const writer = new RecoveryWriter([{ previewId: 'preview_failed', status: 'compensation_failed' }]);

    await expect(buildStartupApp(writer)).rejects.toThrow(
      'Production pilot startup blocked: pending recovery failed.',
    );
  });

  it('fails closed when a protected write lane is wired to the mock OCR engine', async () => {
    stubProductionPilotEnv();
    vi.stubEnv('NODE_ENV', 'production');
    const writer = new RecoveryWriter([]);

    await expect(buildStartupApp(writer)).rejects.toThrow(
      'Controlled real-write startup blocked: the active OCR engine is not trusted for real writes.',
    );
  });

  it('fails closed when a protected write lane is wired to a manual-vision adapter', async () => {
    stubProductionPilotEnv();
    vi.stubEnv('NODE_ENV', 'production');
    const writer = new RecoveryWriter([]);
    const manualVisionEngine: ScreenshotOcrEngine & { engine: string } = {
      engine: 'manual-vision',
      async extract() {
        return {
          engine: 'manual-vision',
          ocr_version: 'manual-vision-1',
          text_blocks: [{ type: 'text', text: '人工转录' }],
          raw_text: '人工转录',
          confidence: 1,
          processed_at: new Date().toISOString(),
        };
      },
    };

    await expect(buildStartupApp(writer, true, manualVisionEngine)).rejects.toThrow(
      'Received manual-vision; configure SCREENSHOT_OCR_ENGINE=tesseract|feishu.',
    );
  });

  it('fails closed when production-pilot has no verified operator principal resolver', async () => {
    stubProductionPilotEnv();
    const writer = new RecoveryWriter([]);

    await expect(buildStartupApp(writer, false)).rejects.toThrow(
      'Production pilot startup blocked: verified operator principal resolver is unavailable.',
    );
  });
});
