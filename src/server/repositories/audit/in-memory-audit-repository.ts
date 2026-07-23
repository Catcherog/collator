// in-memory-audit-repository.ts
// WORKSTREAM-D (Task D4): 内存版通用审计日志仓库，供单元测试与服务层 TDD 使用。
//
// 与 FileAuditRepository 共享同一 AuditLogRepository 合同。幂等性与脱敏语义一致：
// - (ingestion_id, event_type) 至多一条记录（AC-D02）。
// - record() 在持久化边界对 details 调用 redactDetails（AC-D04）。
// - findByIngestionId 返回按 timestamp 升序的稳定序列（AC-D05/AC-D06）。
//
// 不可变性与 write-log 仓库一致：deepClone 入参与返回值，避免调用方共享引用。

import type {
  AuditEventType,
  AuditLogRecord,
  AuditLogRepository,
} from '../../../audit/audit-log-repository.js';
import { redactDetails } from '../../../audit/audit-log-repository.js';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface StoredRecord extends AuditLogRecord {
  /** 插入序号，用于 timestamp 相同时保持稳定的展示顺序。 */
  __seq: number;
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly records: StoredRecord[] = [];
  private seq = 0;

  async record(event: AuditLogRecord): Promise<AuditLogRecord> {
    // AC-D02: (ingestion_id, event_type) 至多一条。已存在则返回已存在记录。
    const existing = this.records.find(
      (r) => r.ingestion_id === event.ingestion_id && r.event_type === event.event_type
    );
    if (existing) {
      // 返回已存在记录（其 audit_id/timestamp 为首次值），忽略本次入参的 audit_id。
      return deepClone(existing);
    }

    // AC-D04: 持久化边界脱敏。
    const stored: StoredRecord = {
      ...deepClone(event),
      details: redactDetails(event.details),
      __seq: this.seq++,
    };
    this.records.push(stored);
    return deepClone(stored);
  }

  async findByIngestionId(ingestionId: string): Promise<AuditLogRecord[]> {
    return this.records
      .filter((r) => r.ingestion_id === ingestionId)
      .slice()
      .sort((a, b) => {
        if (a.timestamp < b.timestamp) return -1;
        if (a.timestamp > b.timestamp) return 1;
        return a.__seq - b.__seq;
      })
      .map((r) => deepClone(r));
  }

  async hasEventType(ingestionId: string, eventType: AuditEventType): Promise<boolean> {
    return this.records.some(
      (r) => r.ingestion_id === ingestionId && r.event_type === eventType
    );
  }

  // ---- 测试辅助（非合同方法）----

  clear(): void {
    this.records.length = 0;
    this.seq = 0;
  }

  size(): number {
    return this.records.length;
  }
}
