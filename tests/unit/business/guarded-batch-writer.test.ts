// guarded-batch-writer.test.ts
// Workstream C: 门控批量写入器端到端测试。
//
// 覆盖：
//   - AC-C02 / AC-C03: 门禁不允许时绝不调用 FeishuClient.createRecord
//     （用 mock client spy 断言 createRecord 未被调用）。
//   - AC-C11 / 幂等：同一 ingestion 重放不产生重复业务记录、不重复 createRecord、
//     写入日志去重。
//   - AC-C09: 部分失败时整体状态非 committed，且已成功记录的 record_id 仍被
//     写入日志跟踪。
//   - AC-C10: 回滚按精确 record_id 删除。
//   - AC-C12: 结果文本不泄露密钥。
//
// 运行：vitest run tests/unit/business/guarded-batch-writer.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { FeishuClient, type FeishuRecord } from '../../../src/server/feishu/feishu-client.js';
import { FeishuApiError } from '../../../src/server/feishu/feishu-errors.js';
import { FeishuCustomerRecordWriter } from '../../../src/server/business/customer-record-writer.js';
import { FeishuProjectRecordWriter } from '../../../src/server/business/project-record-writer.js';
import { FeishuModelRecordWriter } from '../../../src/server/business/model-record-writer.js';
import { TransactionalBatchWriter } from '../../../src/server/business/transactional-batch-writer.js';
import { GuardedBatchWriter } from '../../../src/server/business/guarded-batch-writer.js';
import { InMemoryWriteLogRepository } from '../../../src/server/repositories/in-memory-write-log-repository.js';
import type { FeishuWriteConfig } from '../../../src/server/config/feishu-write-config.js';

// ============================================================================
// Mock FeishuClient — 记录所有调用，并模拟「按表存储已创建记录」以支持幂等搜索
// ============================================================================

interface MockClientCalls {
  createRecord: Array<{ tableId: string; fields: Record<string, unknown>; clientToken?: string }>;
  searchRecords: Array<{ tableId: string; opts: unknown }>;
  deleteRecord: Array<{ tableId: string; recordId: string }>;
}

function createMockFeishuClient(opts: { failCreateOnTable?: string } = {}) {
  const calls: MockClientCalls = { createRecord: [], searchRecords: [], deleteRecord: [] };
  const createdRecords = new Map<string, FeishuRecord[]>();

  const client = {
    getTenantAccessToken: vi.fn(async () => 'mock-tenant-token'),
    createRecord: vi.fn(async (tableId: string, fields: Record<string, unknown>, clientToken?: string) => {
      calls.createRecord.push({ tableId, fields, clientToken });
      if (opts.failCreateOnTable && tableId === opts.failCreateOnTable) {
        throw new FeishuApiError(1254063, 'Simulated create failure');
      }
      const recordId = `rec_${tableId}_${calls.createRecord.length}`;
      const list = createdRecords.get(tableId) ?? [];
      list.push({ record_id: recordId, fields });
      createdRecords.set(tableId, list);
      return recordId;
    }) as Mock,
    getRecord: vi.fn(async () => ({ record_id: '', fields: {} })),
    updateRecord: vi.fn(async () => ({ record_id: '', fields: {} })),
    deleteRecord: vi.fn(async (tableId: string, recordId: string) => {
      calls.deleteRecord.push({ tableId, recordId });
    }),
    searchRecords: vi.fn(async (tableId: string, opts: unknown) => {
      calls.searchRecords.push({ tableId, opts });
      return createdRecords.get(tableId) ?? [];
    }) as Mock,
  };

  return { client: client as unknown as FeishuClient, calls };
}

// ============================================================================
// Fixtures
// ============================================================================

const TABLES = {
  customer: 'tblCustomer',
  project: 'tblProject',
  model: 'tblModel',
} as const;

const BASE_TOKEN = 'base_test_001';

function allPassConfig(): FeishuWriteConfig {
  return {
    taskRepository: 'feishu',
    dryRun: false,
    enableRealFeishuWrite: true,
    feishuWriteEnv: 'test',
    testWhitelist: {
      baseAppToken: BASE_TOKEN,
      tableIds: [TABLES.customer, TABLES.project, TABLES.model],
    },
  };
}

function buildGuardedWriter(client: FeishuClient, writeLogRepo: InMemoryWriteLogRepository, cfg: FeishuWriteConfig = allPassConfig()) {
  const customerWriter = new FeishuCustomerRecordWriter(client, { customerTableId: TABLES.customer });
  const projectWriter = new FeishuProjectRecordWriter(client, { projectTableId: TABLES.project });
  const modelWriter = new FeishuModelRecordWriter(client, { modelTableId: TABLES.model });
  const inner = new TransactionalBatchWriter(customerWriter, projectWriter, modelWriter, writeLogRepo);
  return new GuardedBatchWriter(cfg, inner);
}

function buildInput(overrides: Record<string, unknown> = {}) {
  return {
    ingestionId: 'ing_test_001',
    normalizedFields: { 客户姓名: '张三', 项目名称: '测试项目', 模特姓名: '模特A' },
    customerTableId: TABLES.customer,
    projectTableId: TABLES.project,
    modelTableId: TABLES.model,
    governanceDecision: { decision: 'PASS' as const },
    targetBaseToken: BASE_TOKEN,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('GuardedBatchWriter — gate blocks → no Create Record (AC-C02 / AC-C03)', () => {
  let client: FeishuClient;
  let calls: MockClientCalls;
  let writeLogRepo: InMemoryWriteLogRepository;

  beforeEach(() => {
    ({ client, calls } = createMockFeishuClient());
    writeLogRepo = new InMemoryWriteLogRepository();
  });

  it('does NOT call createRecord when enableRealFeishuWrite=false', async () => {
    const cfg = { ...allPassConfig(), enableRealFeishuWrite: false };
    const guarded = buildGuardedWriter(client, writeLogRepo, cfg);

    const result = await guarded.writeBatch(buildInput());

    expect(result.status).toBe('blocked');
    expect(result.error_code).toBe('GATE_BLOCKED');
    expect(result.gate.allowed).toBe(false);
    expect(calls.createRecord).toHaveLength(0);
    expect(calls.searchRecords).toHaveLength(0);
    expect(result.write_results.every((r) => r.status === 'not_attempted')).toBe(true);
  });

  it('does NOT call createRecord when governance=NEEDS_REVIEW (AC-C03 review)', async () => {
    const guarded = buildGuardedWriter(client, writeLogRepo);
    const result = await guarded.writeBatch(buildInput({ governanceDecision: { decision: 'NEEDS_REVIEW' } }));

    expect(result.status).toBe('blocked');
    expect(calls.createRecord).toHaveLength(0);
    expect(calls.searchRecords).toHaveLength(0);
  });

  it('does NOT call createRecord when governance=BLOCKED (AC-C03 reject)', async () => {
    const guarded = buildGuardedWriter(client, writeLogRepo);
    const result = await guarded.writeBatch(buildInput({ governanceDecision: { decision: 'BLOCKED' } }));

    expect(result.status).toBe('blocked');
    expect(calls.createRecord).toHaveLength(0);
  });

  it('does NOT call createRecord when target table is not whitelisted', async () => {
    const guarded = buildGuardedWriter(client, writeLogRepo);
    const result = await guarded.writeBatch(buildInput({ projectTableId: 'tblNotWhitelisted' }));

    expect(result.status).toBe('blocked');
    expect(calls.createRecord).toHaveLength(0);
  });

  it('does NOT call createRecord when DRY_RUN=true in gate config', async () => {
    const cfg = { ...allPassConfig(), dryRun: true };
    const guarded = buildGuardedWriter(client, writeLogRepo, cfg);
    const result = await guarded.writeBatch(buildInput());

    expect(result.status).toBe('blocked');
    expect(calls.createRecord).toHaveLength(0);
  });
});

describe('GuardedBatchWriter — gate allows → writes proceed (AC-C02 positive)', () => {
  let client: FeishuClient;
  let calls: MockClientCalls;
  let writeLogRepo: InMemoryWriteLogRepository;

  beforeEach(() => {
    ({ client, calls } = createMockFeishuClient());
    writeLogRepo = new InMemoryWriteLogRepository();
  });

  it('calls createRecord for each table when all gate conditions met + PASS', async () => {
    const guarded = buildGuardedWriter(client, writeLogRepo);
    const result = await guarded.writeBatch(buildInput());

    expect(result.status).toBe('committed');
    expect(result.gate.allowed).toBe(true);
    expect(calls.createRecord).toHaveLength(3);
    expect(result.records_created).toBe(3);
    // write logs persisted for each table
    expect(writeLogRepo.size()).toBe(3);
  });
});

describe('GuardedBatchWriter — idempotent replay (AC-C11 / AC-C04)', () => {
  let client: FeishuClient;
  let calls: MockClientCalls;
  let writeLogRepo: InMemoryWriteLogRepository;

  beforeEach(() => {
    ({ client, calls } = createMockFeishuClient());
    writeLogRepo = new InMemoryWriteLogRepository();
  });

  it('replaying the same ingestion creates no duplicate records and no duplicate write logs', async () => {
    const guarded = buildGuardedWriter(client, writeLogRepo);
    const input = buildInput();

    const first = await guarded.writeBatch(input);
    expect(first.status).toBe('committed');
    expect(calls.createRecord).toHaveLength(3);
    expect(writeLogRepo.size()).toBe(3);

    // Replay — identical ingestion.
    const second = await guarded.writeBatch(input);
    expect(second.status).toBe('committed');
    // No additional createRecord calls (writers found existing records).
    expect(calls.createRecord).toHaveLength(3);
    // No duplicate write logs (InMemory repo dedupes on succeeded tuple).
    expect(writeLogRepo.size()).toBe(3);

    // Each table has exactly one succeeded log carrying the business_record_id.
    const logs = await writeLogRepo.findByIngestionId(input.ingestionId);
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.status === 'succeeded')).toBe(true);
    expect(logs.every((l) => l.business_record_id !== undefined)).toBe(true);
  });
});

describe('GuardedBatchWriter — partial failure (AC-C09 / AC-C10)', () => {
  let client: FeishuClient;
  let calls: MockClientCalls;
  let writeLogRepo: InMemoryWriteLogRepository;

  beforeEach(() => {
    ({ client, calls } = createMockFeishuClient({ failCreateOnTable: TABLES.project }));
    writeLogRepo = new InMemoryWriteLogRepository();
  });

  it('second writer failing → status not committed, first record_id still tracked, rollback by record_id', async () => {
    const guarded = buildGuardedWriter(client, writeLogRepo);
    const result = await guarded.writeBatch(buildInput());

    // AC-C09: never report committed/success on partial failure.
    expect(result.status).not.toBe('committed');
    expect(result.write_results.some((r) => r.status === 'failed')).toBe(true);

    // customer record was created first, then project failed.
    expect(calls.createRecord.some((c) => c.tableId === TABLES.customer)).toBe(true);
    expect(calls.createRecord.some((c) => c.tableId === TABLES.project)).toBe(true);

    // AC-C09: the customer record_id is tracked in the write log (succeeded entry).
    const logs = await writeLogRepo.findByIngestionId('ing_test_001');
    const customerLog = logs.find((l) => l.target_table_id === TABLES.customer);
    expect(customerLog).toBeDefined();
    expect(customerLog?.status).toBe('succeeded');
    expect(customerLog?.business_record_id).toBeDefined();
    expect(customerLog?.business_record_id).toMatch(/^rec_tblCustomer_/);

    // AC-C10: rollback deleted the customer record by exact record_id.
    expect(calls.deleteRecord.length).toBeGreaterThanOrEqual(1);
    const deletedCustomerIds = calls.deleteRecord
      .filter((d) => d.tableId === TABLES.customer)
      .map((d) => d.recordId);
    expect(deletedCustomerIds).toContain(customerLog?.business_record_id);
  });
});

describe('GuardedBatchWriter — secret redaction in results (AC-C12)', () => {
  it('blocked result reason does not leak env secrets', async () => {
    const SECRET = 'SUPER_SECRET_APP_SECRET_VALUE_xyz';
    const { client, calls } = createMockFeishuClient();
    const writeLogRepo = new InMemoryWriteLogRepository();
    const cfg = { ...allPassConfig(), enableRealFeishuWrite: false };
    const guarded = buildGuardedWriter(client, writeLogRepo, cfg);

    // Stash a secret in process.env to prove it cannot reach the result.
    const prev = process.env.FEISHU_APP_SECRET;
    process.env.FEISHU_APP_SECRET = SECRET;
    try {
      const result = await guarded.writeBatch(buildInput());
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(SECRET);
      expect(result.gate.reason).not.toContain(SECRET);
    } finally {
      if (prev === undefined) delete process.env.FEISHU_APP_SECRET;
      else process.env.FEISHU_APP_SECRET = prev;
    }
    void calls;
  });
});
