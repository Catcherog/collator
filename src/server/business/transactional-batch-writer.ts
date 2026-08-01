// transactional-batch-writer.ts
// 主线 A1: 跨实体事务批量写入器。
//
// 编排 Customer → Project → Model 有序写入。
// 任一失败时反向回滚（调用 deleteRecord）已成功创建的记录。
// 持久化事务快照到 WriteLogRepository。
//
// AC-A10: 写入失败不会错误报告 SUCCEEDED。
// AC-A08: 重复上传不创建重复正式记录（依赖各 writer 的幂等搜索）。

import type { CustomerRecordWriter } from './customer-record-writer.js';
import type { ProjectRecordWriter } from './project-record-writer.js';
import type { ModelRecordWriter } from './model-record-writer.js';
import type { WriteLogRepository } from '../repositories/write-log-repository.js';
import { FeishuCommitFailedError } from '../domain/errors.js';
import type { WriteResult } from '../../contracts/screenshot-api-v1.js';
import { PostWriteVerificationError } from './post-write-verification.js';

export interface TransactionalBatchWriterInput {
  ingestionId: string;
  /** 标准化字段（中文字段名） */
  normalizedFields: Record<string, unknown>;
  /** 目标写入表（默认全部） */
  targetTables?: Array<'customer' | 'project' | 'model'>;
  /** 是否干运行（不实际写入飞书） */
  dryRun?: boolean;
  /** Customer 表 ID（用于写入日志） */
  customerTableId?: string;
  /** Project 表 ID（用于写入日志） */
  projectTableId?: string;
  /** Model 表 ID（用于写入日志） */
  modelTableId?: string;
  /** Read the created/existing record back and verify the intended fields. */
  verifyAfterWrite?: boolean;
}

export interface TransactionalBatchWriterResult {
  write_results: WriteResult[];
  transaction_snapshot_id: string;
  status: 'committed' | 'rolled_back' | 'partial';
  records_created: number;
  records_rolled_back: number;
  error_code?: string;
  /** True only when every planned write was read back and verified. */
  post_write_verified?: boolean;
}

/**
 * 批量写入器端口接口 — 仅暴露 writeBatch 方法。
 * 用于依赖注入，允许测试替身不需要实现全部类成员。
 */
export interface BatchWriterPort {
  writeBatch(input: TransactionalBatchWriterInput): Promise<TransactionalBatchWriterResult>;
}

/**
 * 跨实体事务批量写入器。
 *
 * 编排顺序：Customer → Project → Model
 * 回滚顺序：Model → Project → Customer（反向）
 *
 * 幂等性：
 * - 各 writer 自身按 ingestionId 幂等（搜索已存在记录）
 * - 重复调用 batch write 不会创建重复记录
 * - 已成功写入的记录在重试时返回 created=false
 *
 * 失败处理（AC-A10）：
 * - 任一 writer 抛错 → 反向回滚已创建的记录
 * - 回滚失败 → 标记为 partial（不静默吞掉）
 * - 写入日志记录每次尝试
 */
export class TransactionalBatchWriter {
  constructor(
    private readonly customerWriter?: CustomerRecordWriter,
    private readonly projectWriter?: ProjectRecordWriter,
    private readonly modelWriter?: ModelRecordWriter,
    private readonly writeLogRepository?: WriteLogRepository
  ) {}

  async writeBatch(input: TransactionalBatchWriterInput): Promise<TransactionalBatchWriterResult> {
    const snapshotId = `txn_${input.ingestionId}_${Date.now()}`;
    const targetTables = input.targetTables ?? ['customer', 'project', 'model'];
    const results: WriteResult[] = [];
    const createdRecords: Array<{ type: 'customer' | 'project' | 'model'; recordId: string }> = [];
    let recordsCreated = 0;
    let recordsRolledBack = 0;

    // Dry run path: 不实际写入，所有结果为 not_attempted
    if (input.dryRun) {
      for (const table of targetTables) {
        const tableId = this.getTableId(table, input);
        results.push({
          entity_type: table,
          target_table_id: tableId,
          business_record_id: null,
          created: false,
          status: 'not_attempted',
        });
      }
      return {
        write_results: results,
        transaction_snapshot_id: snapshotId,
        status: 'committed',
        records_created: 0,
        records_rolled_back: 0,
        post_write_verified: false,
      };
    }

    // 按顺序写入：Customer → Project → Model
    for (const table of targetTables) {
      const tableId = this.getTableId(table, input);
      const result = await this.writeSingle(table, input, tableId);
      results.push(result);

      if (result.status === 'succeeded' && result.created) {
        createdRecords.push({ type: table, recordId: result.business_record_id! });
        recordsCreated++;
      } else if (result.status === 'failed') {
        // A post-write verification failure happens after Feishu returned a
        // real record_id. Treat that exact record as created so compensation
        // can remove it instead of leaving a ghost record behind.
        if (result.created && result.business_record_id) {
          createdRecords.push({ type: table, recordId: result.business_record_id });
          recordsCreated++;
        }
        // 写入失败 → 反向回滚已创建的记录（AC-A10）
        const rollbackResult = await this.rollback(createdRecords, input);
        recordsRolledBack = rollbackResult.rolledBack;

        // 持久化失败日志
        await this.persistWriteLogs(input, results, 'failed');

        return {
          write_results: results,
          transaction_snapshot_id: snapshotId,
          status: rollbackResult.fullRollback ? 'rolled_back' : 'partial',
          records_created: recordsCreated,
          records_rolled_back: recordsRolledBack,
          error_code: result.error_code,
          post_write_verified: false,
        };
      }
    }

    // 全部成功 → 持久化成功日志
    await this.persistWriteLogs(input, results, 'succeeded');

    return {
      write_results: results,
      transaction_snapshot_id: snapshotId,
      status: 'committed',
      records_created: recordsCreated,
      records_rolled_back: 0,
      post_write_verified: Boolean(input.verifyAfterWrite),
    };
  }

  private async writeSingle(
    table: 'customer' | 'project' | 'model',
    input: TransactionalBatchWriterInput,
    tableId: string
  ): Promise<WriteResult> {
    const baseResult: WriteResult = {
      entity_type: table,
      target_table_id: tableId,
      business_record_id: null,
      created: false,
      status: 'not_attempted',
    };

    try {
      if (table === 'customer' && this.customerWriter) {
        const result = await this.customerWriter.write({
          ingestionId: input.ingestionId,
          normalizedFields: input.normalizedFields,
        });
        if (input.verifyAfterWrite) {
          await this.verifyWrittenRecord(table, result.business_record_id, result.created, input);
        }
        return {
          ...baseResult,
          business_record_id: result.business_record_id,
          created: result.created,
          status: 'succeeded',
        };
      }
      if (table === 'project' && this.projectWriter) {
        const result = await this.projectWriter.write({
          ingestionId: input.ingestionId,
          normalizedFields: input.normalizedFields,
        });
        if (input.verifyAfterWrite) {
          await this.verifyWrittenRecord(table, result.business_record_id, result.created, input);
        }
        return {
          ...baseResult,
          business_record_id: result.business_record_id,
          created: result.created,
          status: 'succeeded',
        };
      }
      if (table === 'model' && this.modelWriter) {
        const result = await this.modelWriter.write({
          ingestionId: input.ingestionId,
          normalizedFields: input.normalizedFields,
        });
        if (input.verifyAfterWrite) {
          await this.verifyWrittenRecord(table, result.business_record_id, result.created, input);
        }
        return {
          ...baseResult,
          business_record_id: result.business_record_id,
          created: result.created,
          status: 'succeeded',
        };
      }
      // A production pilot must never report committed when its target writer
      // was not assembled. Preserve the legacy test-mode not_attempted
      // behavior, but fail closed when read-back verification is mandatory.
      return input.verifyAfterWrite
        ? { ...baseResult, status: 'failed', error_code: 'WRITER_NOT_CONFIGURED' }
        : baseResult;
    } catch (e) {
      if (e instanceof PostWriteVerificationError) {
        return {
          ...baseResult,
          business_record_id: e.recordId,
          created: e.created,
          status: 'failed',
          error_code: e.code,
        };
      }
      const errorCode = e instanceof FeishuCommitFailedError ? 'FEISHU_COMMIT_FAILED' : 'COMMIT_FAILED';
      return {
        ...baseResult,
        status: 'failed',
        error_code: errorCode,
      };
    }
  }

  private async verifyWrittenRecord(
    table: 'customer' | 'project' | 'model',
    recordId: string,
    created: boolean,
    input: TransactionalBatchWriterInput
  ): Promise<void> {
    const writer = table === 'customer'
      ? this.customerWriter
      : table === 'project'
        ? this.projectWriter
        : this.modelWriter;
    if (!writer?.verifyRecord) {
      throw new PostWriteVerificationError(recordId, created);
    }
    try {
      await writer.verifyRecord(recordId, {
        ingestionId: input.ingestionId,
        normalizedFields: input.normalizedFields,
      });
    } catch {
      // Do not propagate field values or Feishu error details into the API or
      // audit path. The caller receives only the stable error code above.
      throw new PostWriteVerificationError(recordId, created);
    }
  }

  /**
   * 反向回滚已创建的记录。
   * 返回 { rolledBack, fullRollback }。
   * 如果任何回滚失败，fullRollback=false（partial 状态）。
   */
  private async rollback(
    createdRecords: Array<{ type: 'customer' | 'project' | 'model'; recordId: string }>,
    input: TransactionalBatchWriterInput
  ): Promise<{ rolledBack: number; fullRollback: boolean }> {
    let rolledBack = 0;
    let fullRollback = true;

    // 反向回滚（Model → Project → Customer）
    for (let i = createdRecords.length - 1; i >= 0; i--) {
      const { type, recordId } = createdRecords[i];
      try {
        // AC-C10: 回滚一律按精确 record_id 删除，绝不按名称匹配。
        if (type === 'customer' && this.customerWriter?.deleteRecord) {
          await this.customerWriter.deleteRecord(recordId);
          rolledBack++;
        } else if (type === 'project' && this.projectWriter) {
          await this.projectWriter.deleteRecord(recordId);
          rolledBack++;
        } else if (type === 'model' && this.modelWriter) {
          await this.modelWriter.deleteRecord(recordId);
          rolledBack++;
        } else {
          // 对应 writer 未配置或不支持 deleteRecord → 无法回滚该记录 → partial
          fullRollback = false;
        }
      } catch {
        // 回滚失败 → partial 状态
        fullRollback = false;
      }
    }
    void input;
    return { rolledBack, fullRollback };
  }

  private getTableId(
    table: 'customer' | 'project' | 'model',
    input: TransactionalBatchWriterInput
  ): string {
    if (table === 'customer') return input.customerTableId ?? 'customer';
    if (table === 'project') return input.projectTableId ?? 'project';
    return input.modelTableId ?? 'model';
  }

  private async persistWriteLogs(
    input: TransactionalBatchWriterInput,
    results: WriteResult[],
    _overallStatus: 'succeeded' | 'failed'
  ): Promise<void> {
    if (!this.writeLogRepository) return;
    const now = new Date().toISOString();
    for (const result of results) {
      try {
        await this.writeLogRepository.create({
          ingestion_id: input.ingestionId,
          target_table_id: result.target_table_id,
          business_record_id: result.business_record_id ?? undefined,
          status: result.status === 'succeeded' ? 'succeeded' : 'failed',
          error_code: result.error_code,
          created_at: now,
        });
      } catch {
        // 写入日志失败不影响主流程
      }
    }
  }
}
