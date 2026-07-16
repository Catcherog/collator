// noop-logger-adapter.ts
// 替代 src/data-cleaning/core/operation-logger.js，禁用文件 I/O，构造时不创建目录。

export interface LogEntry {
  operationType: string;
  tableName: string;
  recordId: string;
  field: string;
  originalValue?: unknown;
  newValue?: unknown;
  reason?: string;
  operator?: string;
}

export interface LogCorrection {
  field: string;
  original: unknown;
  corrected: unknown;
  reason: string;
  confidence?: number;
}

export interface NoopLogger {
  log: (entry: LogEntry) => void;
  logCorrection: (tableName: string, recordId: string, correction: LogCorrection, operator?: string) => void;
  logBatchStart: (batchId: string, tableName: string, totalRecords: number) => void;
  logBatchEnd: (batchId: string, tableName: string, summary: Record<string, unknown>) => void;
}

export function createNoopLogger(): NoopLogger {
  return {
    log: (_entry: LogEntry) => { /* no-op */ },
    logCorrection: (_tableName: string, _recordId: string, _correction: LogCorrection, _operator?: string) => { /* no-op */ },
    logBatchStart: (_batchId: string, _tableName: string, _totalRecords: number) => { /* no-op */ },
    logBatchEnd: (_batchId: string, _tableName: string, _summary: Record<string, unknown>) => { /* no-op */ },
  };
}

export class NoopOperationLogger implements NoopLogger {
  log(_entry: LogEntry): void { /* no-op */ }
  logCorrection(_tableName: string, _recordId: string, _correction: LogCorrection, _operator?: string): void { /* no-op */ }
  logBatchStart(_batchId: string, _tableName: string, _totalRecords: number): void { /* no-op */ }
  logBatchEnd(_batchId: string, _tableName: string, _summary: Record<string, unknown>): void { /* no-op */ }
}
