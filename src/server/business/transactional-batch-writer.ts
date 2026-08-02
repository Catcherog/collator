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
import type {
  RunManifestRepository,
  ProductionPilotRunManifest,
} from '../repositories/run-manifest-repository.js';
import { RunManifestStateError } from '../repositories/run-manifest-repository.js';
import { FeishuCommitFailedError, InternalWriteResultUnknownError } from '../domain/errors.js';
import type { WriteResult } from '../../contracts/screenshot-api-v1.js';
import { PostWriteVerificationError } from './post-write-verification.js';
import {
  CreateLifecyclePersistenceError,
  type CreateLifecycleIntent,
  type CreateRecordLifecycle,
} from './create-lifecycle.js';

export interface WriteContext {
  customerRecordId?: string;
  modelRecordId?: string;
}

class RelationContextError extends Error {
  readonly code = 'RELATION_CONTEXT_MISSING';
}

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
  /** Production-pilot mode: require real relation ids before Project create. */
  enforceProjectRelationContext?: boolean;
  /** Server-created manifest that owns this production-pilot write. */
  pilotPreviewId?: string;
  /** Test/adapter injection; production wiring supplies this at construction. */
  runManifestRepository?: RunManifestRepository;
  /** Production-pilot requires every write-log entry to persist. */
  requireDurableWriteLogs?: boolean;
  /** Called immediately before and after exact-record compensation deletes. */
  onCompensationStarted?: (recordCount: number) => Promise<void>;
  onCompensationCompleted?: (
    status: 'completed' | 'failed',
    recordCount: number
  ) => Promise<void>;
  /** Internal-controlled writes preserve partial/unknown records for manual action. */
  compensationPolicy?: 'automatic' | 'manual';
  internalControlledWrite?: boolean;
  internalPreviewId?: string;
  candidateId?: string;
  requestedCandidateId?: string;
  humanConfirmed?: boolean;
}

/** Server-owned input for verifying an already existing record during
 * internal-write reconciliation.  It is intentionally separate from the
 * create input so relation IDs can be bound to records found by the marker. */
export interface ExistingRecordVerificationInput {
  ingestionId: string;
  normalizedFields: Record<string, unknown>;
  targetTables: Array<'customer' | 'project' | 'model'>;
  enforceProjectRelationContext?: boolean;
  relationContext?: WriteContext;
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
  /** True when this writer invoked the compensation audit hooks. */
  compensation_events_emitted?: boolean;
}

/**
 * 批量写入器端口接口 — 仅暴露 writeBatch 方法。
 * 用于依赖注入，允许测试替身不需要实现全部类成员。
 */
export interface BatchWriterPort {
  writeBatch(input: TransactionalBatchWriterInput): Promise<TransactionalBatchWriterResult>;
  findByIngestionId?(entity: 'customer' | 'project' | 'model', ingestionId: string): Promise<string[]>;
  verifyExistingByIngestion?(
    entity: 'customer' | 'project' | 'model',
    recordId: string,
    input: ExistingRecordVerificationInput,
  ): Promise<void>;
  recoverPendingCompensations?(hooks?: {
    onCompensationStarted?: (recordCount: number) => Promise<void>;
    onCompensationCompleted?: (status: 'completed' | 'failed', recordCount: number) => Promise<void>;
  }): Promise<Array<{ previewId: string; status: 'compensated' | 'compensation_failed' }>>;
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
    private readonly writeLogRepository?: WriteLogRepository,
    private readonly runManifestRepository?: RunManifestRepository
  ) {}

  async findByIngestionId(
    entity: 'customer' | 'project' | 'model',
    ingestionId: string,
  ): Promise<string[]> {
    const writer = entity === 'customer'
      ? this.customerWriter
      : entity === 'project'
        ? this.projectWriter
        : this.modelWriter;
    return writer?.findByIngestionId ? writer.findByIngestionId(ingestionId) : [];
  }

  async verifyExistingByIngestion(
    entity: 'customer' | 'project' | 'model',
    recordId: string,
    input: ExistingRecordVerificationInput,
  ): Promise<void> {
    const writer = entity === 'customer'
      ? this.customerWriter
      : entity === 'project'
        ? this.projectWriter
        : this.modelWriter;
    if (!writer?.verifyRecord) {
      throw new PostWriteVerificationError(recordId, false);
    }

    const normalizedFields = entity === 'project' && input.enforceProjectRelationContext
      ? this.buildProjectRelationFields(
          input.normalizedFields,
          input.relationContext ?? {},
          input.targetTables,
        )
      : input.normalizedFields;
    try {
      await writer.verifyRecord(recordId, {
        ingestionId: input.ingestionId,
        normalizedFields,
      });
    } catch {
      throw new PostWriteVerificationError(recordId, false);
    }
  }

  async writeBatch(input: TransactionalBatchWriterInput): Promise<TransactionalBatchWriterResult> {
    const snapshotId = `txn_${input.ingestionId}_${Date.now()}`;
    const targetTables = input.targetTables ?? ['customer', 'project', 'model'];
    const executionTables = input.enforceProjectRelationContext
      ? this.orderForProjectRelations(targetTables)
      : targetTables;
    const manifestRepository = input.runManifestRepository ?? this.runManifestRepository;
    const pilotPreviewId = input.pilotPreviewId;
    const results: WriteResult[] = [];
    const createdRecords: Array<{ type: 'customer' | 'project' | 'model'; recordId: string }> = [];
    const writeContext: WriteContext = {};
    let recordsCreated = 0;
    let recordsRolledBack = 0;
    let compensationEventsEmitted = false;

    // Dry run path: 不实际写入，所有结果为 not_attempted
    if (input.dryRun) {
      for (const table of executionTables) {
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
    for (const table of executionTables) {
      const tableId = this.getTableId(table, input);
      const result = await this.writeSingle(
        table,
        input,
        tableId,
        writeContext,
        targetTables,
        manifestRepository,
        pilotPreviewId,
      );
      results.push(result);

      if (result.status === 'succeeded' && result.business_record_id) {
        if (table === 'customer') writeContext.customerRecordId = result.business_record_id;
        if (table === 'model') writeContext.modelRecordId = result.business_record_id;
      }

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
          if (pilotPreviewId && manifestRepository) {
            // The concrete writer records CREATE_CONFIRMED before returning.
            // Keep the exact local id here as a second compensation fence when
            // the process failed while persisting that boundary.
          }
        }
        // Internal-controlled mode never guesses whether a remote write
        // happened and never auto-deletes a partial/unknown result.
        if (input.compensationPolicy === 'manual') {
          if (!input.internalControlledWrite) {
            try {
              await this.persistWriteLogs(input, results, 'failed');
            } catch {
              // Preserve the historical manual-compensation behavior for
              // non-internal callers.
            }
          }
          return {
            write_results: results,
            transaction_snapshot_id: snapshotId,
            status: 'partial',
            records_created: recordsCreated,
            records_rolled_back: 0,
            error_code: result.error_code ?? 'INTERNAL_WRITE_PARTIAL',
            post_write_verified: false,
            compensation_events_emitted: false,
          };
        }

        // Legacy/test path: 写入失败 → 反向回滚已创建的记录（AC-A10）
        const rollbackResult = await this.rollback(
          createdRecords,
          input,
          manifestRepository,
          pilotPreviewId,
        );
        recordsRolledBack = rollbackResult.rolledBack;
        compensationEventsEmitted ||= rollbackResult.compensationEventsEmitted;

        // 持久化失败日志
        let errorCode = result.error_code;
        try {
          await this.persistWriteLogs(input, results, 'failed');
        } catch {
          errorCode = 'WRITE_LOG_PERSIST_FAILED';
        }

        return {
          write_results: results,
          transaction_snapshot_id: snapshotId,
          status: rollbackResult.fullRollback ? 'rolled_back' : 'partial',
          records_created: recordsCreated,
          records_rolled_back: recordsRolledBack,
          error_code: errorCode,
          post_write_verified: false,
          compensation_events_emitted: compensationEventsEmitted,
        };
      }
    }

    // 全部成功 → 持久化成功日志
    try {
      // Internal-controlled writes use the dedicated redacted journal owned
      // by ScreenshotService; the legacy log schema contains raw table IDs.
      if (!input.internalControlledWrite) {
        await this.persistWriteLogs(input, results, 'succeeded');
      }
    } catch {
      const rollbackResult = await this.rollback(
        createdRecords,
        input,
        manifestRepository,
        pilotPreviewId,
      );
      recordsRolledBack = rollbackResult.rolledBack;
      compensationEventsEmitted ||= rollbackResult.compensationEventsEmitted;
      return {
        write_results: results,
        transaction_snapshot_id: snapshotId,
        status: rollbackResult.fullRollback ? 'rolled_back' : 'partial',
        records_created: recordsCreated,
        records_rolled_back: recordsRolledBack,
        error_code: 'WRITE_LOG_PERSIST_FAILED',
        post_write_verified: false,
        compensation_events_emitted: compensationEventsEmitted,
      };
    }

    return {
      write_results: results,
      transaction_snapshot_id: snapshotId,
      status: 'committed',
      records_created: recordsCreated,
      records_rolled_back: 0,
      post_write_verified: Boolean(input.verifyAfterWrite),
      compensation_events_emitted: compensationEventsEmitted,
    };
  }

  private async writeSingle(
    table: 'customer' | 'project' | 'model',
    input: TransactionalBatchWriterInput,
    tableId: string,
    writeContext: WriteContext,
    targetTables: Array<'customer' | 'project' | 'model'>,
    manifestRepository?: RunManifestRepository,
    pilotPreviewId?: string,
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
          internalWriteKey: this.internalWriteKey(input, table),
          createLifecycle: this.createLifecycle(
            table,
            tableId,
            manifestRepository,
            pilotPreviewId,
          ),
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
        const normalizedFields = input.enforceProjectRelationContext
          ? this.buildProjectRelationFields(input.normalizedFields, writeContext, targetTables)
          : input.normalizedFields;
        const result = await this.projectWriter.write({
          ingestionId: input.ingestionId,
          normalizedFields,
          internalWriteKey: this.internalWriteKey(input, table),
          createLifecycle: this.createLifecycle(
            table,
            tableId,
            manifestRepository,
            pilotPreviewId,
          ),
        });
        if (input.verifyAfterWrite) {
          await this.verifyWrittenRecord(table, result.business_record_id, result.created, {
            ...input,
            normalizedFields,
          });
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
          internalWriteKey: this.internalWriteKey(input, table),
          createLifecycle: this.createLifecycle(
            table,
            tableId,
            manifestRepository,
            pilotPreviewId,
          ),
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
      if (input.internalControlledWrite && (e instanceof InternalWriteResultUnknownError || (e as { resultUnknown?: unknown }).resultUnknown === true)) {
        throw new InternalWriteResultUnknownError();
      }
      if (e instanceof PostWriteVerificationError) {
        return {
          ...baseResult,
          business_record_id: e.recordId,
          created: e.created,
          status: 'failed',
          error_code: input.internalControlledWrite && table === 'project'
            ? 'RELATION_VERIFICATION_FAILED'
            : e.code,
        };
      }
      if (e instanceof CreateLifecyclePersistenceError) {
        return {
          ...baseResult,
          business_record_id: e.recordId,
          created: true,
          status: 'failed',
          error_code: 'RUN_MANIFEST_PERSIST_FAILED',
        };
      }
      if (e instanceof RelationContextError) {
        return {
          ...baseResult,
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

  private createLifecycle(
    table: 'customer' | 'project' | 'model',
    tableId: string,
    manifestRepository?: RunManifestRepository,
    pilotPreviewId?: string,
  ): CreateRecordLifecycle | undefined {
    if (!manifestRepository || !pilotPreviewId) return undefined;
    let intent: CreateLifecycleIntent | undefined;
    return {
      beforeCreate: async (candidate) => {
        intent = candidate;
        await manifestRepository.recordCreateIntent(pilotPreviewId, candidate);
      },
      afterCreate: async (recordId) => {
        if (!intent) {
          throw new Error('CREATE_INTENT missing before CREATE_CONFIRMED');
        }
        await manifestRepository.recordCreated(pilotPreviewId, {
          entity: table,
          tableId,
          operationKey: intent.operationKey,
          recordId,
          createdAt: intent.createdAt,
        });
      },
    };
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

  private internalWriteKey(
    input: TransactionalBatchWriterInput,
    table: 'customer' | 'project' | 'model',
  ): string | undefined {
    if (!input.internalControlledWrite || !input.internalPreviewId) return undefined;
    return `internal-write:${input.ingestionId}:${input.internalPreviewId}:${table}`;
  }

  /**
   * 反向回滚已创建的记录。
   * 返回 { rolledBack, fullRollback }。
   * 如果任何回滚失败，fullRollback=false（partial 状态）。
   */
  private async rollback(
    createdRecords: Array<{ type: 'customer' | 'project' | 'model'; recordId: string }>,
    input: TransactionalBatchWriterInput,
    manifestRepository?: RunManifestRepository,
    pilotPreviewId?: string,
  ): Promise<{
    rolledBack: number;
    fullRollback: boolean;
    compensationEventsEmitted: boolean;
  }> {
    let rolledBack = 0;
    let fullRollback = true;
    let compensationEventsEmitted = false;

    if (pilotPreviewId && manifestRepository) {
      try {
        await manifestRepository.markCompensationRequired(pilotPreviewId);
      } catch {
        fullRollback = false;
      }
    }

    const records = new Map<string, {
      type: 'customer' | 'project' | 'model';
      recordId: string;
      createdAt: string;
    }>();
    for (const record of createdRecords) {
      records.set(`${record.type}:${record.recordId}`, {
        ...record,
        createdAt: new Date().toISOString(),
      });
    }
    if (pilotPreviewId && manifestRepository) {
      try {
        const manifest = await manifestRepository.findByPreviewId(pilotPreviewId);
        for (const record of manifest?.createdRecords ?? []) {
          if (record.state !== 'DELETED') {
            records.set(`${record.entity}:${record.recordId}`, {
              type: record.entity,
              recordId: record.recordId,
              createdAt: record.createdAt,
            });
          }
        }
      } catch {
        fullRollback = false;
      }
    }

    const compensationOrder: Record<'project' | 'model' | 'customer', number> = {
      // Delete dependents before the records they reference. Timestamps are
      // retained only as a deterministic tie-breaker, never as the ordering
      // contract.
      project: 0,
      model: 1,
      customer: 2,
    };
    const recordsToDelete = Array.from(records.values()).sort((left, right) =>
      compensationOrder[left.type] - compensationOrder[right.type]
      || right.createdAt.localeCompare(left.createdAt)
      || left.recordId.localeCompare(right.recordId)
    );
    if (recordsToDelete.length === 0) {
      if (manifestRepository && pilotPreviewId) {
        const manifest = await manifestRepository.findByPreviewId(pilotPreviewId).catch(() => null);
        if (manifest?.createIntents.some((intent) => intent.state === 'PENDING')) {
          // A process may have died after Create Record but before
          // CREATE_CONFIRMED. Leave compensation_required durable so restart
          // recovery can resolve the intent by ingestion id.
          return { rolledBack, fullRollback: false, compensationEventsEmitted };
        }
      }
      if (manifestRepository && pilotPreviewId) {
        try {
          await manifestRepository.completeCompensation(pilotPreviewId, true);
        } catch {
          fullRollback = false;
        }
      }
      void input;
      return { rolledBack, fullRollback, compensationEventsEmitted };
    }

    try {
      await input.onCompensationStarted?.(recordsToDelete.length);
      compensationEventsEmitted = true;
    } catch {
      // The delete fence still runs when the audit callback fails. The
      // caller receives a non-full result and can recover the audit gap.
      fullRollback = false;
    }

    // 反向回滚（Model → Project → Customer）
    for (const { type, recordId } of recordsToDelete) {
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
        if (manifestRepository && pilotPreviewId && (type === 'customer' ? this.customerWriter?.deleteRecord : type === 'project' ? this.projectWriter?.deleteRecord : this.modelWriter?.deleteRecord)) {
          try {
            await manifestRepository.markRecordDeleted(pilotPreviewId, type, recordId);
          } catch {
            fullRollback = false;
          }
        }
      } catch {
        // 回滚失败 → partial 状态
        fullRollback = false;
        if (manifestRepository && pilotPreviewId) {
          try {
            await manifestRepository.markRecordDeleteFailed(
              pilotPreviewId,
              type,
              recordId,
              'COMPENSATION_DELETE_FAILED',
            );
          } catch {
            fullRollback = false;
          }
        }
      }
    }

    try {
      await input.onCompensationCompleted?.(
        fullRollback ? 'completed' : 'failed',
        recordsToDelete.length,
      );
      compensationEventsEmitted = true;
    } catch {
      fullRollback = false;
    }

    if (manifestRepository && pilotPreviewId) {
      const manifest = await manifestRepository.findByPreviewId(pilotPreviewId).catch(() => null);
      if (manifest?.createIntents.some((intent) => intent.state === 'PENDING')) {
        return { rolledBack, fullRollback: false, compensationEventsEmitted };
      }
      try {
        await manifestRepository.completeCompensation(pilotPreviewId, fullRollback);
      } catch {
        fullRollback = false;
      }
    }

    return { rolledBack, fullRollback, compensationEventsEmitted };
  }

  /**
   * Replays durable compensation after a process restart. The manifest, not
   * the previous process' heap, is the source of record ids to delete.
   */
  async recoverPendingCompensations(hooks?: {
    onCompensationStarted?: (recordCount: number) => Promise<void>;
    onCompensationCompleted?: (status: 'completed' | 'failed', recordCount: number) => Promise<void>;
  }): Promise<Array<{ previewId: string; status: 'compensated' | 'compensation_failed' }>> {
    if (!this.runManifestRepository) {
      return [];
    }
    const pending = await this.runManifestRepository.findPendingCompensation();
    const outcomes: Array<{ previewId: string; status: 'compensated' | 'compensation_failed' }> = [];
    for (const manifest of pending) {
      if (manifest.status === 'confirmed') {
        await this.runManifestRepository.markCompensationRequired(manifest.previewId);
      }
      await this.resolvePendingCreateIntents(manifest);
      const recoveredManifest = await this.runManifestRepository.findByPreviewId(manifest.previewId);
      if (!recoveredManifest) {
        throw new RunManifestStateError(
          'RUN_MANIFEST_NOT_FOUND',
          `Production-pilot manifest ${manifest.previewId} disappeared during recovery`
        );
      }
      const records = recoveredManifest.createdRecords
        .filter((record) => record.state !== 'DELETED')
        .map((record) => ({ type: record.entity, recordId: record.recordId }));
      const result = await this.rollback(
        records,
        {
          ingestionId: recoveredManifest.ingestionId,
          normalizedFields: {},
          targetTables: records.map((record) => record.type),
          onCompensationStarted: hooks?.onCompensationStarted,
          onCompensationCompleted: hooks?.onCompensationCompleted,
        },
        this.runManifestRepository,
        recoveredManifest.previewId,
      );
      outcomes.push({
        previewId: recoveredManifest.previewId,
        status: result.fullRollback ? 'compensated' : 'compensation_failed',
      });
    }
    return outcomes;
  }

  private async resolvePendingCreateIntents(manifest: ProductionPilotRunManifest): Promise<void> {
    const pendingIntents = manifest.createIntents.filter((intent) => intent.state === 'PENDING');
    for (const intent of pendingIntents) {
      const writer = intent.entity === 'customer'
        ? this.customerWriter
        : intent.entity === 'project'
          ? this.projectWriter
          : this.modelWriter;
      if (!writer?.findByIngestionId) {
        throw new RunManifestStateError(
          'RUN_MANIFEST_RECOVERY_AMBIGUOUS',
          `Cannot recover CREATE_INTENT ${intent.operationKey} without an ingestion lookup`
        );
      }
      const recordIds = await writer.findByIngestionId(manifest.ingestionId);
      if (recordIds.length > 1) {
        throw new RunManifestStateError(
          'RUN_MANIFEST_RECOVERY_AMBIGUOUS',
          `CREATE_INTENT ${intent.operationKey} matched multiple records`
        );
      }
      if (recordIds.length === 1) {
        await this.runManifestRepository!.recordCreated(manifest.previewId, {
          entity: intent.entity,
          tableId: intent.tableId,
          operationKey: intent.operationKey,
          recordId: recordIds[0],
          createdAt: intent.createdAt,
        });
      } else {
        await this.runManifestRepository!.markCreateIntentResolved(
          manifest.previewId,
          intent.operationKey,
          'NOT_FOUND',
        );
      }
    }
  }

  private getTableId(
    table: 'customer' | 'project' | 'model',
    input: TransactionalBatchWriterInput
  ): string {
    if (table === 'customer') return input.customerTableId ?? 'customer';
    if (table === 'project') return input.projectTableId ?? 'project';
    return input.modelTableId ?? 'model';
  }

  private orderForProjectRelations(
    targetTables: Array<'customer' | 'project' | 'model'>
  ): Array<'customer' | 'project' | 'model'> {
    if (!targetTables.includes('project') || !targetTables.includes('model')) {
      return targetTables;
    }
    const remaining = targetTables.filter(
      (table) => table !== 'model' && table !== 'project'
    ) as Array<'customer' | 'project' | 'model'>;
    return remaining.concat(['model', 'project']);
  }

  private buildProjectRelationFields(
    normalizedFields: Record<string, unknown>,
    writeContext: WriteContext,
    targetTables: Array<'customer' | 'project' | 'model'>
  ): Record<string, unknown> {
    const fields = { ...normalizedFields };
    if (targetTables.includes('customer')) {
      if (!writeContext.customerRecordId) {
        throw new RelationContextError('Project customer relation id is missing');
      }
      fields['客户关联'] = [writeContext.customerRecordId];
    }
    if (targetTables.includes('model')) {
      if (!writeContext.modelRecordId) {
        throw new RelationContextError('Project model relation id is missing');
      }
      fields['模特关联'] = [writeContext.modelRecordId];
    }
    return fields;
  }

  private async persistWriteLogs(
    input: TransactionalBatchWriterInput,
    results: WriteResult[],
    _overallStatus: 'succeeded' | 'failed'
  ): Promise<void> {
    if (!this.writeLogRepository) {
      if (input.requireDurableWriteLogs) {
        throw new Error('WRITE_LOG_REPOSITORY_UNAVAILABLE');
      }
      return;
    }
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
        if (input.requireDurableWriteLogs) {
          throw new Error('WRITE_LOG_PERSIST_FAILED');
        }
        // Legacy mode preserves the historical best-effort behavior.
      }
    }
  }
}
