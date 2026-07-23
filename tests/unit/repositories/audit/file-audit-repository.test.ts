// WORKSTREAM-D (Task D6): FileAuditRepository 测试。
// 覆盖 AC-D01（重启持久化）、AC-D02（迁移幂等）、AC-D03（fail-closed / degrade）、
// AC-D04（落盘脱敏）、AC-D05/D06（有序）、AC-D07（并发不损坏）、AC-D08（缺失目录/文件自动创建）。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileAuditRepository,
  AuditWriteError,
  type AuditLogger,
} from '../../../../src/server/repositories/audit/file-audit-repository.js';
import type { AuditLogRecord, AuditEventType } from '../../../../src/audit/audit-log-repository.js';
import { createAuditEvent } from '../../../../src/audit/audit-log-repository.js';

function makeRecord(overrides: Partial<AuditLogRecord> = {}): AuditLogRecord {
  return {
    audit_id: randomUUID(),
    ingestion_id: 'ing_default',
    event_type: 'ingestion_received' as AuditEventType,
    timestamp: '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('FileAuditRepository', () => {
  let baseDir: string;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'audit-test-'));
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  function uniqueFile(name: string): string {
    return join(baseDir, `${name}-${randomUUID()}.log.jsonl`);
  }

  // ============================================================
  // AC-D01: 跨实例（重启）持久化
  // ============================================================
  describe('AC-D01 restart persistence', () => {
    it('records survive a new repository instance pointing at the same file', async () => {
      const file = uniqueFile('restart');
      const repo1 = new FileAuditRepository({ filePath: file });
      await repo1.record(makeRecord({ ingestion_id: 'ing_rst', event_type: 'ocr_started', timestamp: '2026-07-23T10:00:00.000Z' }));
      await repo1.record(makeRecord({ ingestion_id: 'ing_rst', event_type: 'ocr_completed', timestamp: '2026-07-23T10:01:00.000Z' }));

      // 模拟进程重启：新实例指向同一文件。
      const repo2 = new FileAuditRepository({ filePath: file });
      const found = await repo2.findByIngestionId('ing_rst');
      expect(found).toHaveLength(2);
      expect(found.map((r) => r.event_type)).toEqual(['ocr_started', 'ocr_completed']);
    });

    it('hasEventType works across a restart', async () => {
      const file = uniqueFile('restart-has');
      const repo1 = new FileAuditRepository({ filePath: file });
      await repo1.record(makeRecord({ ingestion_id: 'ing_rh', event_type: 'governance_passed' }));
      const repo2 = new FileAuditRepository({ filePath: file });
      expect(await repo2.hasEventType('ing_rh', 'governance_passed')).toBe(true);
    });
  });

  // ============================================================
  // AC-D02: (ingestion_id, event_type) 迁移至多一条
  // ============================================================
  describe('AC-D02 transition idempotency', () => {
    it('recording the same transition twice writes only one line and returns the existing record', async () => {
      const file = uniqueFile('dedup');
      const repo = new FileAuditRepository({ filePath: file });
      const first = await repo.record(makeRecord({ ingestion_id: 'ing_dup', event_type: 'ocr_started' }));
      const second = await repo.record(
        makeRecord({
          ingestion_id: 'ing_dup',
          event_type: 'ocr_started',
          audit_id: randomUUID(),
          timestamp: '2026-07-23T12:00:00.000Z',
        })
      );
      expect(second.audit_id).toBe(first.audit_id);
      expect(second.timestamp).toBe(first.timestamp);

      const raw = await readFile(file, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      expect(lines).toHaveLength(1);
    });

    it('distinct transitions for the same ingestion are all persisted', async () => {
      const file = uniqueFile('distinct');
      const repo = new FileAuditRepository({ filePath: file });
      await repo.record(makeRecord({ ingestion_id: 'ing_multi', event_type: 'ocr_started' }));
      await repo.record(makeRecord({ ingestion_id: 'ing_multi', event_type: 'ocr_failed' }));
      await repo.record(makeRecord({ ingestion_id: 'ing_multi', event_type: 'write_succeeded' }));
      const found = await repo.findByIngestionId('ing_multi');
      expect(found).toHaveLength(3);
    });
  });

  // ============================================================
  // AC-D05 / AC-D06: 有序序列
  // ============================================================
  describe('AC-D05/AC-D06 ordered sequence', () => {
    it('findByIngestionId returns records sorted by timestamp ascending', async () => {
      const file = uniqueFile('order');
      const repo = new FileAuditRepository({ filePath: file });
      // 故意以非时间顺序写入（文件序为 tiebreak）。
      await repo.record(makeRecord({ event_type: 'ocr_started', timestamp: '2026-07-23T10:30:00.000Z' }));
      await repo.record(makeRecord({ event_type: 'ocr_completed', timestamp: '2026-07-23T10:05:00.000Z' }));
      await repo.record(makeRecord({ event_type: 'write_succeeded', timestamp: '2026-07-23T10:20:00.000Z' }));
      const found = await repo.findByIngestionId('ing_default');
      expect(found.map((r) => r.event_type)).toEqual([
        'ocr_completed',
        'write_succeeded',
        'ocr_started',
      ]);
    });
  });

  // ============================================================
  // AC-D07: 并发写不损坏文件
  // ============================================================
  describe('AC-D07 concurrent writes', () => {
    it('100 concurrent records produce 100 valid JSONL lines with no corruption', async () => {
      const file = uniqueFile('concurrent');
      const repo = new FileAuditRepository({ filePath: file, maxRetries: 0 });
      const N = 100;
      const events = Array.from({ length: N }, (_, i) =>
        createAuditEvent({ ingestion_id: `ing_conc_${i}`, event_type: 'ingestion_received' })
      );
      await Promise.all(events.map((e) => repo.record(e)));

      const raw = await readFile(file, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      expect(lines).toHaveLength(N);

      const ids = new Set<string>();
      for (const line of lines) {
        const parsed = JSON.parse(line) as AuditLogRecord; // 任何损坏行都会抛错 → 测试失败
        ids.add(parsed.ingestion_id);
      }
      expect(ids.size).toBe(N);
    });
  });

  // ============================================================
  // AC-D04: 落盘内容已脱敏
  // ============================================================
  describe('AC-D04 redaction at rest', () => {
    it('secrets / image / phone are redacted in the written file', async () => {
      const file = uniqueFile('pii');
      const repo = new FileAuditRepository({ filePath: file });
      await repo.record(
        makeRecord({
          ingestion_id: 'ing_pii',
          event_type: 'candidate_generated',
          details: {
            app_secret: 'shhh-top-secret',
            image: 'data:image/png;base64,iVBORw0KGgo=',
            phone: '13800138000',
            table_id: 'tblCustomer',
          },
        })
      );

      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw.trim()) as AuditLogRecord;
      expect(parsed.details).toEqual({
        app_secret: '[REDACTED]',
        image: '[REDACTED]',
        phone: '138****8000',
        table_id: 'tblCustomer',
      });
      // 原始敏感值绝不可出现在落盘文件中。
      expect(raw).not.toContain('shhh-top-secret');
      expect(raw).not.toContain('data:image/png');
      expect(raw).not.toContain('13800138000');
    });
  });

  // ============================================================
  // AC-D03: 写入失败失效模式
  // ============================================================
  describe('AC-D03 failure modes', () => {
    it('failClosed=true throws AuditWriteError when the path is a directory', async () => {
      const dir = join(baseDir, `fcdir-${randomUUID()}`);
      await mkdir(dir, { recursive: true });
      const repo = new FileAuditRepository({ filePath: dir, failClosed: true, maxRetries: 0 });
      await expect(repo.record(makeRecord({ ingestion_id: 'ing_fc' }))).rejects.toThrow(AuditWriteError);
    });

    it('failClosed=false degrades: returns redacted record without throwing and warns', async () => {
      const dir = join(baseDir, `dgdir-${randomUUID()}`);
      await mkdir(dir, { recursive: true });
      const warns: string[] = [];
      const logger: AuditLogger = { warn: (m) => warns.push(m) };
      const repo = new FileAuditRepository({ filePath: dir, failClosed: false, maxRetries: 0, logger });
      const out = await repo.record(
        makeRecord({ ingestion_id: 'ing_dg', details: { phone: '13800138000' } })
      );
      expect(out.ingestion_id).toBe('ing_dg');
      expect(warns.length).toBeGreaterThan(0);
      // 降级返回的记录仍经过脱敏（但未持久化）。
      expect(out.details?.phone).toBe('138****8000');
    });
  });

  // ============================================================
  // AC-D08: 缺失目录/文件自动创建
  // ============================================================
  describe('AC-D08 auto-initialization', () => {
    it('creates missing nested directory and file on first write', async () => {
      const nested = join(baseDir, 'a', 'b', 'c', `init-${randomUUID()}`);
      const file = join(nested, 'audit.log.jsonl');
      expect(existsSync(nested)).toBe(false);
      const repo = new FileAuditRepository({ filePath: file });
      await repo.record(makeRecord({ ingestion_id: 'ing_init' }));
      expect(existsSync(nested)).toBe(true);
      expect(existsSync(file)).toBe(true);
      const found = await repo.findByIngestionId('ing_init');
      expect(found).toHaveLength(1);
    });
  });

  // ============================================================
  // 缺失文件读取的韧性
  // ============================================================
  describe('missing-file reads', () => {
    it('findByIngestionId returns [] when the file does not exist (ENOENT)', async () => {
      const file = uniqueFile('missing-read');
      const repo = new FileAuditRepository({ filePath: file });
      expect(await repo.findByIngestionId('ing_x')).toEqual([]);
    });

    it('hasEventType returns false when the file does not exist', async () => {
      const file = uniqueFile('missing-has');
      const repo = new FileAuditRepository({ filePath: file });
      expect(await repo.hasEventType('ing_x', 'ingestion_received')).toBe(false);
    });
  });

  // ============================================================
  // hasEventType 正向用例
  // ============================================================
  describe('hasEventType', () => {
    it('returns true after a transition is recorded, false for an unrecorded one', async () => {
      const file = uniqueFile('has');
      const repo = new FileAuditRepository({ filePath: file });
      await repo.record(makeRecord({ ingestion_id: 'ing_h', event_type: 'ocr_started' }));
      expect(await repo.hasEventType('ing_h', 'ocr_started')).toBe(true);
      expect(await repo.hasEventType('ing_h', 'ocr_failed')).toBe(false);
    });
  });
});
