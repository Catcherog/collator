import type { IngestionTask } from '../domain/ingestion.js';
import {
  assertTaskSaveFence,
  TaskSaveConflictError,
  type TaskRepository,
  type TaskSaveFence,
} from './task-repository.js';
import type { FeishuClient, FeishuRecord } from '../feishu/feishu-client.js';
import { normalizeFeishuJson } from '../feishu/normalize-text.js';

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
  private readonly saveTails = new Map<string, Promise<void>>();

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
    return this.enqueueSave(task.ingestion_id, async () => {
      const existing = await this.findRecordsByIngestionId(task.ingestion_id);
      if (existing.length > 0) {
        const current = this.parseSnapshot(existing[0]);
        const next = this.nextVersionedTask(current, task);
        await this.client.updateRecord(
          this.options.ingestionTableId,
          existing[0].record_id,
          this.buildFields(next)
        );
      } else {
        await this.client.createRecord(this.options.ingestionTableId, this.buildFields(task));
      }
    });
  }

  async saveWithFence(task: IngestionTask, fence: TaskSaveFence): Promise<void> {
    return this.enqueueSave(task.ingestion_id, async () => {
      const existing = await this.findRecordsByIngestionId(task.ingestion_id);
      if (existing.length === 0) {
        throw new TaskSaveConflictError('Task disappeared before fenced save');
      }
      const current = this.parseSnapshot(existing[0]);
      assertTaskSaveFence(current, task, fence);
      await this.client.updateRecord(
        this.options.ingestionTableId,
        existing[0].record_id,
        this.buildFields({ ...task, task_version: fence.expected_task_version + 1 }),
      );
    });
  }

  private async findRecordsByIngestionId(ingestionId: string): Promise<FeishuRecord[]> {
    return this.client.searchRecords(this.options.ingestionTableId, {
      filter: {
        conjunction: 'and',
        conditions: [
          { field_name: FIELD.ingestionId, operator: 'is', value: [ingestionId] },
        ],
      },
      page_size: 2,
    });
  }

  /** Serialize the read/validate/write sequence for one task in this process. */
  private enqueueSave<T>(ingestionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.saveTails.get(ingestionId) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const tail = run.then(() => undefined, () => undefined);
    this.saveTails.set(ingestionId, tail);
    return run.finally(() => {
      if (this.saveTails.get(ingestionId) === tail) {
        this.saveTails.delete(ingestionId);
      }
    });
  }

  private nextVersionedTask(current: IngestionTask, next: IngestionTask): IngestionTask {
    if (current.task_version === undefined) return next;
    return { ...next, task_version: current.task_version + 1 };
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
   *
   * Uses the shared `normalizeFeishuJson` helper so that all three legal
   * Feishu text-field return shapes are handled transparently:
   *   - string                    (text_field_as_array=false)
   *   - { text: string }          (single-segment rich text)
   *   - Array<{ text: string }>   (multi-segment rich text / API default)
   *
   * Throws a `NormalizeTextError` if the field is missing, has an
   * unsupported shape, or contains malformed JSON. The error includes
   * repository / field name / record_id for diagnosis but never echoes
   * the raw snapshot content (which may contain PII).
   */
  private parseSnapshot(record: FeishuRecord): IngestionTask {
    return normalizeFeishuJson<IngestionTask>(
      record.fields[FIELD.snapshot],
      {
        repository: 'FeishuTaskRepository',
        fieldName: FIELD.snapshot,
        recordId: record.record_id,
        required: true,
      }
    ) as IngestionTask;
  }

  /**
   * Convert an ISO 8601 string to a value Feishu datetime fields accept.
   * Feishu datetime fields accept a number of milliseconds since epoch.
   */
  private toFeishuDatetime(iso: string): number {
    return new Date(iso).getTime();
  }
}
