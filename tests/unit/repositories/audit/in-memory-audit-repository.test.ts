// WORKSTREAM-D (Task D6): InMemoryAuditLogRepository 合同测试。
// 验证 AC-D02（迁移至多一条）、AC-D04（脱敏）、AC-D05/D06（有序）、hasEventType。

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryAuditLogRepository } from '../../../../src/server/repositories/audit/in-memory-audit-repository.js';
import type { AuditLogRecord, AuditEventType } from '../../../../src/audit/audit-log-repository.js';

function makeRecord(overrides: Partial<AuditLogRecord> = {}): AuditLogRecord {
  return {
    audit_id: randomUUID(),
    ingestion_id: 'ing_001',
    event_type: 'ingestion_received' as AuditEventType,
    timestamp: '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('InMemoryAuditLogRepository', () => {
  let repo: InMemoryAuditLogRepository;

  beforeEach(() => {
    repo = new InMemoryAuditLogRepository();
  });

  it('record returns the stored record with its audit_id', async () => {
    const rec = makeRecord();
    const out = await repo.record(rec);
    expect(out.audit_id).toBe(rec.audit_id);
    expect(out.ingestion_id).toBe(rec.ingestion_id);
    expect(repo.size()).toBe(1);
  });

  it('AC-D02: record same (ingestion_id, event_type) twice → one entry, returns existing', async () => {
    const rec = makeRecord();
    const first = await repo.record(rec);
    // 第二次：不同 audit_id / timestamp，但同 (ingestion_id, event_type)
    const second = await repo.record(makeRecord({ audit_id: randomUUID(), timestamp: '2026-07-23T11:00:00.000Z' }));
    expect(second.audit_id).toBe(first.audit_id);
    expect(second.timestamp).toBe(first.timestamp); // 返回首次记录的时间戳
    expect(repo.size()).toBe(1);
  });

  it('AC-D02: distinct event_types for same ingestion are all stored', async () => {
    await repo.record(makeRecord({ event_type: 'ingestion_received' }));
    await repo.record(makeRecord({ event_type: 'ocr_started' }));
    await repo.record(makeRecord({ event_type: 'write_succeeded' }));
    const found = await repo.findByIngestionId('ing_001');
    expect(found).toHaveLength(3);
  });

  it('AC-D02: distinct ingestion_ids with same event_type are all stored', async () => {
    await repo.record(makeRecord({ ingestion_id: 'ing_a', event_type: 'ingestion_received' }));
    await repo.record(makeRecord({ ingestion_id: 'ing_b', event_type: 'ingestion_received' }));
    expect(repo.size()).toBe(2);
    expect(await repo.findByIngestionId('ing_a')).toHaveLength(1);
    expect(await repo.findByIngestionId('ing_b')).toHaveLength(1);
  });

  it('AC-D05/AC-D06: findByIngestionId returns records ordered by timestamp', async () => {
    // 故意以非时间顺序插入
    await repo.record(makeRecord({ event_type: 'ocr_started', timestamp: '2026-07-23T10:30:00.000Z' }));
    await repo.record(makeRecord({ event_type: 'ocr_completed', timestamp: '2026-07-23T10:05:00.000Z' }));
    await repo.record(makeRecord({ event_type: 'write_succeeded', timestamp: '2026-07-23T10:20:00.000Z' }));
    const found = await repo.findByIngestionId('ing_001');
    expect(found.map((r) => r.event_type)).toEqual([
      'ocr_completed',
      'write_succeeded',
      'ocr_started',
    ]);
  });

  it('hasEventType returns true after record, false otherwise', async () => {
    await repo.record(makeRecord({ event_type: 'ocr_completed' }));
    expect(await repo.hasEventType('ing_001', 'ocr_completed')).toBe(true);
    expect(await repo.hasEventType('ing_001', 'ocr_failed')).toBe(false);
    expect(await repo.hasEventType('ing_unknown', 'ocr_completed')).toBe(false);
  });

  it('AC-D04: details are redacted at the persistence boundary', async () => {
    const out = await repo.record(
      makeRecord({
        event_type: 'candidate_generated',
        details: {
          app_secret: 'shhh',
          phone: '13800138000',
          table_id: 'tblCustomer',
        },
      })
    );
    expect(out.details).toEqual({
      app_secret: '[REDACTED]',
      phone: '138****8000',
      table_id: 'tblCustomer',
    });
    const found = await repo.findByIngestionId('ing_001');
    expect(found[0].details).toEqual({
      app_secret: '[REDACTED]',
      phone: '138****8000',
      table_id: 'tblCustomer',
    });
  });

  it('defensively deep-copies stored records so callers cannot mutate state', async () => {
    const rec = makeRecord({ details: { phone: '13800138000' } });
    const out = await repo.record(rec);
    out.details!.phone = 'mutated';
    out.audit_id = 'mutated';

    const found = await repo.findByIngestionId('ing_001');
    expect(found[0].audit_id).toBe(rec.audit_id);
    expect(found[0].details?.phone).toBe('138****8000');
  });

  it('returns an empty array for an unknown ingestion', async () => {
    expect(await repo.findByIngestionId('nope')).toEqual([]);
  });

  it('clear() empties the repository', async () => {
    await repo.record(makeRecord());
    expect(repo.size()).toBe(1);
    repo.clear();
    expect(repo.size()).toBe(0);
    expect(await repo.findByIngestionId('ing_001')).toEqual([]);
  });
});
