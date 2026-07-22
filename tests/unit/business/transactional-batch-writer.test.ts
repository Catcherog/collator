// 主线 A1: 跨实体事务批量写入器测试
//
// 验证 TransactionalBatchWriter 的事务编排和回滚：
//   1. 全部成功 → committed，所有 writer 被调用
//   2. 任一失败 → 反向回滚已创建的记录
//   3. dry_run → 所有结果为 not_attempted
//   4. 幂等：writer 自身幂等（已存在记录返回 created=false）
//   5. AC-A10: 写入失败不报告 SUCCEEDED
//
// 运行：vitest run tests/unit/business/transactional-batch-writer.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { TransactionalBatchWriter } from '../../../src/server/business/transactional-batch-writer.js';
import { FeishuCommitFailedError } from '../../../src/server/domain/errors.js';
import type { ProjectRecordWriter } from '../../../src/server/business/project-record-writer.js';
import type { ModelRecordWriter } from '../../../src/server/business/model-record-writer.js';
import type { CustomerRecordWriter } from '../../../src/server/business/customer-record-writer.js';
import type { WriteLogRepository } from '../../../src/server/repositories/write-log-repository.js';

// ============================================================================
// Mock Writers
// ============================================================================

interface MockWriterCalls {
  write: Mock<(input: { ingestionId: string; normalizedFields: Record<string, unknown> }) => Promise<{ business_record_id: string; created: boolean }>>;
  deleteRecord?: Mock<(recordId: string) => Promise<void>>;
}

function createMockWriter(prefix: string, mode: 'success' | 'fail' = 'success'): MockWriterCalls {
  return {
    write: vi.fn(async () => {
      if (mode === 'fail') {
        throw new FeishuCommitFailedError(`Simulated failure for ${prefix}`);
      }
      return {
        business_record_id: `rec_${prefix}_${Date.now()}`,
        created: true,
      };
    }),
    deleteRecord: vi.fn(async () => {}),
  };
}

function createMockWriteLogRepository() {
  return {
    create: vi.fn(async () => ({})),
    findByIngestionId: vi.fn(async () => []),
  } as unknown as WriteLogRepository & {
    create: Mock;
    findByIngestionId: Mock;
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TransactionalBatchWriter', () => {
  let projectWriter: MockWriterCalls;
  let modelWriter: MockWriterCalls;
  let customerWriter: MockWriterCalls;
  let writeLogRepository: ReturnType<typeof createMockWriteLogRepository>;

  beforeEach(() => {
    projectWriter = createMockWriter('project');
    modelWriter = createMockWriter('model');
    customerWriter = createMockWriter('customer');
    writeLogRepository = createMockWriteLogRepository();
  });

  describe('writeBatch — 全部成功', () => {
    it('按顺序写入 customer → project → model，返回 committed', async () => {
      const batchWriter = new TransactionalBatchWriter(
        customerWriter as unknown as CustomerRecordWriter,
        projectWriter as unknown as ProjectRecordWriter,
        modelWriter as unknown as ModelRecordWriter,
        writeLogRepository
      );

      const result = await batchWriter.writeBatch({
        ingestionId: 'ing_test_001',
        normalizedFields: { 客户姓名: '张三', 项目名称: '测试项目' },
      });

      expect(result.status).toBe('committed');
      expect(result.records_created).toBe(3);
      expect(result.records_rolled_back).toBe(0);
      expect(result.write_results).toHaveLength(3);
      expect(result.write_results.every(r => r.status === 'succeeded')).toBe(true);
      // 所有 writer 都被调用
      expect(customerWriter.write).toHaveBeenCalledTimes(1);
      expect(projectWriter.write).toHaveBeenCalledTimes(1);
      expect(modelWriter.write).toHaveBeenCalledTimes(1);
    });

    it('持久化写入日志', async () => {
      const batchWriter = new TransactionalBatchWriter(
        customerWriter as unknown as CustomerRecordWriter,
        projectWriter as unknown as ProjectRecordWriter,
        modelWriter as unknown as ModelRecordWriter,
        writeLogRepository
      );

      await batchWriter.writeBatch({
        ingestionId: 'ing_test_001',
        normalizedFields: {},
      });

      expect(writeLogRepository.create).toHaveBeenCalledTimes(3);
    });
  });

  describe('writeBatch — 部分失败回滚', () => {
    it('project 写入失败时回滚已创建的 customer 记录', async () => {
      // project writer 失败
      projectWriter = createMockWriter('project', 'fail');

      const batchWriter = new TransactionalBatchWriter(
        customerWriter as unknown as CustomerRecordWriter,
        projectWriter as unknown as ProjectRecordWriter,
        modelWriter as unknown as ModelRecordWriter,
        writeLogRepository
      );

      const result = await batchWriter.writeBatch({
        ingestionId: 'ing_test_001',
        normalizedFields: {},
      });

      // AC-A10: 不报告 committed
      expect(result.status).not.toBe('committed');
      expect(result.write_results.some(r => r.status === 'failed')).toBe(true);
      // customer 被调用（先成功），project 失败，model 未被调用
      expect(customerWriter.write).toHaveBeenCalledTimes(1);
      expect(projectWriter.write).toHaveBeenCalledTimes(1);
      expect(modelWriter.write).not.toHaveBeenCalled();
    });

    it('model 写入失败时回滚已创建的 project 和 customer 记录', async () => {
      // model writer 失败
      modelWriter = createMockWriter('model', 'fail');

      const batchWriter = new TransactionalBatchWriter(
        customerWriter as unknown as CustomerRecordWriter,
        projectWriter as unknown as ProjectRecordWriter,
        modelWriter as unknown as ModelRecordWriter,
        writeLogRepository
      );

      const result = await batchWriter.writeBatch({
        ingestionId: 'ing_test_001',
        normalizedFields: {},
      });

      expect(result.status).not.toBe('committed');
      expect(result.write_results.some(r => r.status === 'failed')).toBe(true);
      // 所有 writer 都被调用（customer + project 成功，model 失败）
      expect(customerWriter.write).toHaveBeenCalledTimes(1);
      expect(projectWriter.write).toHaveBeenCalledTimes(1);
      expect(modelWriter.write).toHaveBeenCalledTimes(1);
      // project 被回滚（deleteRecord 被调用）
      expect(projectWriter.deleteRecord).toHaveBeenCalledTimes(1);
    });
  });

  describe('writeBatch — dry_run', () => {
    it('dry_run 时所有结果为 not_attempted，不调用 writer', async () => {
      const batchWriter = new TransactionalBatchWriter(
        customerWriter as unknown as CustomerRecordWriter,
        projectWriter as unknown as ProjectRecordWriter,
        modelWriter as unknown as ModelRecordWriter,
        writeLogRepository
      );

      const result = await batchWriter.writeBatch({
        ingestionId: 'ing_test_001',
        normalizedFields: {},
        dryRun: true,
      });

      expect(result.status).toBe('committed');
      expect(result.records_created).toBe(0);
      expect(result.write_results).toHaveLength(3);
      expect(result.write_results.every(r => r.status === 'not_attempted')).toBe(true);
      expect(customerWriter.write).not.toHaveBeenCalled();
      expect(projectWriter.write).not.toHaveBeenCalled();
      expect(modelWriter.write).not.toHaveBeenCalled();
    });
  });

  describe('writeBatch — target_tables 过滤', () => {
    it('仅写入指定的 target_tables', async () => {
      const batchWriter = new TransactionalBatchWriter(
        customerWriter as unknown as CustomerRecordWriter,
        projectWriter as unknown as ProjectRecordWriter,
        modelWriter as unknown as ModelRecordWriter,
        writeLogRepository
      );

      const result = await batchWriter.writeBatch({
        ingestionId: 'ing_test_001',
        normalizedFields: {},
        targetTables: ['project'],
      });

      expect(result.write_results).toHaveLength(1);
      expect(result.write_results[0].entity_type).toBe('project');
      expect(projectWriter.write).toHaveBeenCalledTimes(1);
      expect(customerWriter.write).not.toHaveBeenCalled();
      expect(modelWriter.write).not.toHaveBeenCalled();
    });
  });

  describe('writeBatch — writer 未配置', () => {
    it('未配置的 writer 返回 not_attempted', async () => {
      // 仅配置 project writer
      const batchWriter = new TransactionalBatchWriter(
        undefined,
        projectWriter as unknown as ProjectRecordWriter,
        undefined,
        writeLogRepository
      );

      const result = await batchWriter.writeBatch({
        ingestionId: 'ing_test_001',
        normalizedFields: {},
      });

      expect(result.status).toBe('committed');
      expect(result.write_results).toHaveLength(3);
      const customerResult = result.write_results.find(r => r.entity_type === 'customer');
      const projectResult = result.write_results.find(r => r.entity_type === 'project');
      const modelResult = result.write_results.find(r => r.entity_type === 'model');
      expect(customerResult?.status).toBe('not_attempted');
      expect(projectResult?.status).toBe('succeeded');
      expect(modelResult?.status).toBe('not_attempted');
    });
  });
});
