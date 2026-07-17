import { describe, it, expect } from 'vitest';
import {
  createRepositories,
  createTaskRepository,
} from '../../../src/server/repositories/repository-factory.js';
import { InMemoryTaskRepository } from '../../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryReviewRepository } from '../../../src/server/repositories/in-memory-review-repository.js';
import { FeishuTaskRepository } from '../../../src/server/repositories/feishu-task-repository.js';
import { FeishuReviewRepository } from '../../../src/server/repositories/feishu-review-repository.js';
import type { Config } from '../../../src/server/config.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    port: 8787,
    logLevel: 'info',
    webhookSecret: 'secret',
    autoCommitEnabled: false,
    dryRun: true,
    difyBaseUrl: undefined,
    difyWorkflowApiKey: undefined,
    difyWorkflowId: undefined,
    feishuAppId: undefined,
    feishuAppSecret: undefined,
    feishuBaseAppToken: undefined,
    feishuIngestionTableId: undefined,
    feishuReviewTableId: undefined,
    feishuWriteLogTableId: undefined,
    feishuCustomerTableId: undefined,
    defaultTimezone: 'Asia/Shanghai',
    taskRepository: 'memory',
    ...overrides,
  } as Config;
}

describe('createTaskRepository (legacy compat)', () => {
  describe('TASK_REPOSITORY=memory', () => {
    it('returns an InMemoryTaskRepository', () => {
      const repo = createTaskRepository(makeConfig({ taskRepository: 'memory' }));
      expect(repo).toBeInstanceOf(InMemoryTaskRepository);
    });

    it('ignores feishu config when memory mode is selected', () => {
      // Even with no feishu config, memory mode must work.
      const repo = createTaskRepository(makeConfig({ taskRepository: 'memory' }));
      expect(repo).toBeInstanceOf(InMemoryTaskRepository);
    });
  });

  describe('TASK_REPOSITORY=feishu', () => {
    const fullFeishu: Partial<Config> = {
      taskRepository: 'feishu',
      feishuAppId: 'cli_xxx',
      feishuAppSecret: 'secret_xxx',
      feishuBaseAppToken: 'base_token_xxx',
      feishuIngestionTableId: 'tblIngestion',
      feishuReviewTableId: 'tblReview',
      feishuWriteLogTableId: 'tblWriteLog',
      feishuCustomerTableId: 'tblCustomer',
    };

    it('returns a FeishuTaskRepository when all required config is present', () => {
      const repo = createTaskRepository(makeConfig(fullFeishu));
      expect(repo).toBeInstanceOf(FeishuTaskRepository);
    });

    it('throws a clear error when feishuAppId is missing', () => {
      expect(() =>
        createTaskRepository(makeConfig({ ...fullFeishu, feishuAppId: undefined }))
      ).toThrow(/FEISHU_APP_ID/);
    });

    it('throws a clear error when feishuAppSecret is missing', () => {
      expect(() =>
        createTaskRepository(makeConfig({ ...fullFeishu, feishuAppSecret: undefined }))
      ).toThrow(/FEISHU_APP_SECRET/);
    });

    it('throws a clear error when feishuBaseAppToken is missing', () => {
      expect(() =>
        createTaskRepository(makeConfig({ ...fullFeishu, feishuBaseAppToken: undefined }))
      ).toThrow(/FEISHU_BASE_APP_TOKEN/);
    });

    it('throws a clear error when feishuIngestionTableId is missing', () => {
      expect(() =>
        createTaskRepository(makeConfig({ ...fullFeishu, feishuIngestionTableId: undefined }))
      ).toThrow(/FEISHU_INGESTION_TABLE_ID/);
    });

    it('does not silently fall back to InMemoryTaskRepository on missing config', () => {
      try {
        createTaskRepository(makeConfig({ taskRepository: 'feishu' }));
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).not.toBeInstanceOf(InMemoryTaskRepository);
        expect((e as Error).message).toMatch(/FEISHU_/);
      }
    });
  });
});

describe('createRepositories (TASK-002)', () => {
  describe('TASK_REPOSITORY=memory', () => {
    it('returns an InMemoryTaskRepository as taskRepository', () => {
      const bundle = createRepositories(makeConfig({ taskRepository: 'memory' }));
      expect(bundle.taskRepository).toBeInstanceOf(InMemoryTaskRepository);
    });

    it('returns an InMemoryReviewRepository as reviewRepository', () => {
      const bundle = createRepositories(makeConfig({ taskRepository: 'memory' }));
      expect(bundle.reviewRepository).toBeInstanceOf(InMemoryReviewRepository);
    });

    it('ignores feishu config when memory mode is selected', () => {
      const bundle = createRepositories(makeConfig({ taskRepository: 'memory' }));
      expect(bundle.taskRepository).toBeInstanceOf(InMemoryTaskRepository);
      expect(bundle.reviewRepository).toBeInstanceOf(InMemoryReviewRepository);
    });
  });

  describe('TASK_REPOSITORY=feishu', () => {
    const fullFeishu: Partial<Config> = {
      taskRepository: 'feishu',
      feishuAppId: 'cli_xxx',
      feishuAppSecret: 'secret_xxx',
      feishuBaseAppToken: 'base_token_xxx',
      feishuIngestionTableId: 'tblIngestion',
      feishuReviewTableId: 'tblReview',
      feishuWriteLogTableId: 'tblWriteLog',
      feishuCustomerTableId: 'tblCustomer',
    };

    it('returns FeishuTaskRepository and FeishuReviewRepository when all required config is present', () => {
      const bundle = createRepositories(makeConfig(fullFeishu));
      expect(bundle.taskRepository).toBeInstanceOf(FeishuTaskRepository);
      expect(bundle.reviewRepository).toBeInstanceOf(FeishuReviewRepository);
    });

    it('throws a clear error when feishuReviewTableId is missing', () => {
      expect(() =>
        createRepositories(
          makeConfig({ ...fullFeishu, feishuReviewTableId: undefined })
        )
      ).toThrow(/FEISHU_REVIEW_TABLE_ID/);
    });

    it('throws a clear error when feishuReviewTableId is empty', () => {
      expect(() =>
        createRepositories(
          makeConfig({ ...fullFeishu, feishuReviewTableId: '   ' })
        )
      ).toThrow(/FEISHU_REVIEW_TABLE_ID/);
    });

    it('does not silently fall back to InMemoryReviewRepository on missing review table', () => {
      try {
        createRepositories(
          makeConfig({ ...fullFeishu, feishuReviewTableId: undefined })
        );
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).not.toBeInstanceOf(InMemoryReviewRepository);
        expect((e as Error).message).toMatch(/FEISHU_REVIEW_TABLE_ID/);
      }
    });

    it('still surfaces existing ingestion table validation', () => {
      expect(() =>
        createRepositories(
          makeConfig({ ...fullFeishu, feishuIngestionTableId: undefined })
        )
      ).toThrow(/FEISHU_INGESTION_TABLE_ID/);
    });
  });
});
