// in-memory-write-log-repository.ts
// TASK-003: 内存版写入日志仓库，单元测试与服务层 TDD 使用。
// 不透明 write_log_id 由 randomUUID 生成；同 (ingestion_id, target_table_id)
// 二元组上 create 幂等。

import { randomUUID } from 'crypto';
import type {
  NewWriteLogRecord,
  WriteLogRecord,
  WriteLogRepository,
} from './write-log-repository.js';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryWriteLogRepository implements WriteLogRepository {
  private readonly byLogId = new Map<string, WriteLogRecord>();
  private readonly byIngestionId = new Map<string, Set<string>>();

  async create(record: NewWriteLogRecord): Promise<WriteLogRecord> {
    // Idempotent on (ingestion_id, target_table_id) ONLY when an existing
    // log has terminal `succeeded` status: a retry of the same successful
    // write returns the existing log (no duplicate). For `failed` / `pending`
    // / `skipped_dry_run` logs a new entry is created so the audit trail
    // captures each commit attempt as a distinct event — this is critical
    // for retry-after-commit_failed observability.
    for (const id of this.byIngestionId.get(record.ingestion_id) ?? []) {
      const existing = this.byLogId.get(id);
      if (
        existing &&
        existing.target_table_id === record.target_table_id &&
        existing.status === 'succeeded'
      ) {
        return deepClone(existing);
      }
    }

    const writeLogId = randomUUID();
    const stored: WriteLogRecord = {
      ...deepClone(record),
      write_log_id: writeLogId,
    };
    this.byLogId.set(writeLogId, stored);
    if (!this.byIngestionId.has(record.ingestion_id)) {
      this.byIngestionId.set(record.ingestion_id, new Set());
    }
    this.byIngestionId.get(record.ingestion_id)!.add(writeLogId);
    return deepClone(stored);
  }

  async findByIngestionId(ingestionId: string): Promise<WriteLogRecord[]> {
    const ids = this.byIngestionId.get(ingestionId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.byLogId.get(id))
      .filter((r): r is WriteLogRecord => r !== undefined)
      .map((r) => deepClone(r));
  }

  async save(record: WriteLogRecord): Promise<void> {
    const stored = deepClone(record);
    this.byLogId.set(record.write_log_id, stored);
    if (!this.byIngestionId.has(record.ingestion_id)) {
      this.byIngestionId.set(record.ingestion_id, new Set());
    }
    this.byIngestionId.get(record.ingestion_id)!.add(record.write_log_id);
  }

  // Test helpers (not part of WriteLogRepository contract)
  clear(): void {
    this.byLogId.clear();
    this.byIngestionId.clear();
  }

  size(): number {
    return this.byLogId.size;
  }
}
