import { describe, it, expect } from 'vitest';
import {
  createNoopLogger,
  NoopOperationLogger,
} from '../../../../src/server/cleaning/adapters/noop-logger-adapter.js';

describe('noop-logger-adapter', () => {
  it('createNoopLogger 不抛出且不写文件', () => {
    const logger = createNoopLogger();
    expect(() => logger.log({ operationType: 'test', tableName: 't', recordId: '1', field: '' })).not.toThrow();
    expect(() => logger.logCorrection('t', '1', { field: 'f', original: 'a', corrected: 'b', reason: 'r' })).not.toThrow();
  });

  it('NoopOperationLogger 实例方法为空操作', () => {
    const logger = new NoopOperationLogger();
    expect(() => logger.logBatchStart('batch-1', 't', 10)).not.toThrow();
    expect(() => logger.logBatchEnd('batch-1', 't', { ok: true })).not.toThrow();
  });
});
