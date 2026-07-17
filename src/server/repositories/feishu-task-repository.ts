import type { IngestionTask } from '../domain/ingestion.js';
import type { TaskRepository } from './task-repository.js';
import type { FeishuClient } from '../feishu/feishu-client.js';

/**
 * Field names in the "Collator 摄入任务" Feishu table.
 * Kept in one place so future schema changes only touch here.
 */
const FIELD = {
  ingestionId: '摄入 ID',
  idempotencyKey: '幂等键',
  status: '状态',
  sourceRecordId: '来源记录 ID',
  snapshot: '任务快照 JSON',
  createdAt: '创建时间',
  updatedAt: '更新时间',
} as const;

export interface FeishuTaskRepositoryOptions {
  ingestionTableId: string;
}

/**
 * Production-grade TaskRepository backed by a Feishu Base table.
 *
 * Storage strategy:
 * - Indexed columns (`摄入 ID`, `幂等键`, `状态`, `来源记录 ID`, `创建时间`,
 *   `更新时间`) mirror key task fields for queryability.
 * - The full IngestionTask is stored as JSON in `任务快照 JSON`. Reads always
 *   reconstruct the task from this snapshot to guarantee deep field equality
 *   (TASK-001 acceptance: "保存后可由新的 Repository 实例完整读取，字段深度
 *   等价"). Indexed columns are NOT used to reconstruct the task.
 *
 * Concurrency:
 * - `save()` first searches by `摄入 ID`. If a record exists, it updates;
 *   otherwise it creates. Concurrent saves for the same ingestion_id may both
 *   miss the search and both create — the caller (IngestionService) is
 *   responsible for serialising same-key calls. The 20-concurrent-request
 *   acceptance is enforced at the service layer, not here.
 */
export class FeishuTaskRepository implements TaskRepository {
  constructor(
    private readonly client: FeishuClient,
    private readonly options: FeishuTaskRepositoryOptions
  ) {}

  async findById(ingestionId: string): Promise<IngestionTask | null> {
    const records = await this.client.searchRecords(this.options.ingestionTableId, {
      filter: {
        conjunction: 'and',
        conditions: [
          { field_name: FIELD.ingestionId, operator: 'is', value: [ingestionId] },
        ],
      },
      page_size: 2,
    });
    if (records.length === 0) return null;
    return this.parseSnapshot(records[0]);
  }

  async findByIdempotencyKey(key: string): Promise<IngestionTask | null> {
    const records = await this.client.searchRecords(this.options.ingestionTableId, {
      filter: {
        conjunction: 'and',
        conditions: [
          { field_name: FIELD.idempotencyKey, operator: 'is', value: [key] },
        ],
      },
      page_size: 2,
    });
    if (records.length === 0) return null;
    return this.parseSnapshot(records[0]);
  }

  async save(task: IngestionTask): Promise<void> {
    const fields = this.buildFields(task);
    const existing = await this.client.searchRecords(this.options.ingestionTableId, {
      filter: {
        conjunction: 'and',
        conditions: [
          { field_name: FIELD.ingestionId, operator: 'is', value: [task.ingestion_id] },
        ],
      },
      page_size: 2,
    });
    if (existing.length > 0) {
      await this.client.updateRecord(
        this.options.ingestionTableId,
        existing[0].record_id,
        fields
      );
    } else {
      await this.client.createRecord(this.options.ingestionTableId, fields);
    }
  }

  /**
   * Build the Feishu field payload from an IngestionTask.
   * The snapshot field always carries the full task; the other fields are
   * indexed views.
   */
  private buildFields(task: IngestionTask): Record<string, unknown> {
    return {
      [FIELD.ingestionId]: task.ingestion_id,
      [FIELD.idempotencyKey]: task.idempotency_key,
      [FIELD.status]: task.status,
      [FIELD.sourceRecordId]: task.source_record_id,
      [FIELD.snapshot]: JSON.stringify(task),
      [FIELD.createdAt]: this.toFeishuDatetime(task.created_at),
      [FIELD.updatedAt]: this.toFeishuDatetime(task.updated_at),
    };
  }

  /**
   * Parse the 任务快照 JSON field back into an IngestionTask.
   * Throws if the snapshot is missing or malformed — the indexed columns
   * alone cannot reconstruct a full task.
   */
  private parseSnapshot(record: { fields: Record<string, unknown> }): IngestionTask {
    const raw = record.fields[FIELD.snapshot];
    if (typeof raw !== 'string') {
      throw new Error(
        `FeishuTaskRepository: 任务快照 JSON missing or not a string for record`
      );
    }
    try {
      return JSON.parse(raw) as IngestionTask;
    } catch (e) {
      throw new Error(
        `FeishuTaskRepository: 任务快照 JSON parse failed: ${(e as Error).message}`
      );
    }
  }

  /**
   * Convert an ISO 8601 string to a value Feishu datetime fields accept.
   * Feishu datetime fields accept a number of milliseconds since epoch.
   */
  private toFeishuDatetime(iso: string): number {
    return new Date(iso).getTime();
  }
}
