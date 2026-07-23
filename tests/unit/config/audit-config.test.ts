// WORKSTREAM-D (Task D6): loadAuditConfig 测试。
// 重点验证 AUDIT_FAIL_CLOSED 的布尔解析正确性——`z.coerce.boolean()` 会把
// "false" 误判为真，故此处显式覆盖 "false"/"0"/"no"/"off" → false，保障
// AC-D03 降级语义可由操作员通过环境变量正确开启。

import { describe, it, expect } from 'vitest';
import { loadAuditConfig } from '../../../src/server/config/audit-config.js';

describe('loadAuditConfig', () => {
  it('applies defaults when env is empty', () => {
    const cfg = loadAuditConfig({});
    expect(cfg.store).toBe('file');
    expect(cfg.filePath).toBe('./data/audit.log.jsonl');
    expect(cfg.maxRetries).toBe(2);
    expect(cfg.failClosed).toBe(true);
  });

  it('parses store / filePath / maxRetries', () => {
    const cfg = loadAuditConfig({
      AUDIT_STORE: 'feishu',
      AUDIT_FILE_PATH: '/var/log/audit.jsonl',
      AUDIT_MAX_RETRIES: '5',
    });
    expect(cfg.store).toBe('feishu');
    expect(cfg.filePath).toBe('/var/log/audit.jsonl');
    expect(cfg.maxRetries).toBe(5);
  });

  it('parses AUDIT_FAIL_CLOSED="false" as false (AC-D03 degrade switch)', () => {
    expect(loadAuditConfig({ AUDIT_FAIL_CLOSED: 'false' }).failClosed).toBe(false);
    expect(loadAuditConfig({ AUDIT_FAIL_CLOSED: '0' }).failClosed).toBe(false);
    expect(loadAuditConfig({ AUDIT_FAIL_CLOSED: 'no' }).failClosed).toBe(false);
    expect(loadAuditConfig({ AUDIT_FAIL_CLOSED: 'off' }).failClosed).toBe(false);
  });

  it('parses AUDIT_FAIL_CLOSED="true" / "1" as true', () => {
    expect(loadAuditConfig({ AUDIT_FAIL_CLOSED: 'true' }).failClosed).toBe(true);
    expect(loadAuditConfig({ AUDIT_FAIL_CLOSED: '1' }).failClosed).toBe(true);
    expect(loadAuditConfig({ AUDIT_FAIL_CLOSED: 'yes' }).failClosed).toBe(true);
  });

  it('keeps fail-closed default when AUDIT_FAIL_CLOSED is unset', () => {
    expect(loadAuditConfig({}).failClosed).toBe(true);
  });

  it('rejects unknown store values', () => {
    expect(() => loadAuditConfig({ AUDIT_STORE: 'redis' })).toThrow();
  });
});
