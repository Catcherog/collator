// guarded-batch-writer.ts
// Workstream C / Amendment 6: 门控批量写入器。
//
// 在任何 Create Record 调用之前执行双层放行门（isRealWriteAllowed）。
// 门禁不允许时，立即返回 'blocked' 结果且绝不调用内部 writer —— 即绝不
// 触发 FeishuClient.createRecord（AC-C02 / AC-C03 fail-closed）。
//
// 这是 Workstream E 把双层门接入写入路径的现成集成点：E 只需用
// GuardedBatchWriter 包裹既有的 TransactionalBatchWriter，并在
// writeBatch 输入中带上 governanceDecision 与 targetBaseToken。

import {
  isRealWriteAllowed,
  type FeishuWriteConfig,
  type GovernanceDecisionInput,
} from '../config/feishu-write-config.js';
import type { BatchWriterPort, TransactionalBatchWriterInput, TransactionalBatchWriterResult } from './transactional-batch-writer.js';
import type { WriteResult } from '../../contracts/screenshot-api-v1.js';

/**
 * Input for the guarded batch writer. Extends the inner writer's input with
 * the governance decision (condition 6) and the target base token
 * (condition 5 base match). Per-table target table ids are taken from the
 * existing `customerTableId` / `projectTableId` / `modelTableId` fields.
 */
export interface GuardedWriteBatchInput extends TransactionalBatchWriterInput {
  governanceDecision: GovernanceDecisionInput;
  targetBaseToken?: string;
}

/**
 * Guarded result. Adds a `'blocked'` status and the evaluated `gate` so
 * callers can distinguish "gate refused" from a real commit/rollback/partial.
 */
export interface GuardedBatchWriterResult {
  write_results: WriteResult[];
  transaction_snapshot_id: string;
  status: TransactionalBatchWriterResult['status'] | 'blocked';
  records_created: number;
  records_rolled_back: number;
  error_code?: string;
  /** The gate evaluation that decided this write. */
  gate: { allowed: boolean; reason: string };
}

/**
 * A batch writer that enforces the double-layer gate before delegating.
 *
 * Fail-closed semantics:
 * - The gate is evaluated for EVERY target table in the batch. If ANY
 *   target is not allowed, the WHOLE batch is blocked (no inner call, no
 *   Create Record). This avoids partial writes into a mix of allowed and
 *   disallowed tables.
 * - The blocked result carries per-table `not_attempted` WriteResults and
 *   `status: 'blocked'` with `error_code: 'GATE_BLOCKED'`.
 *
 * When the gate allows all targets, the call delegates to the inner
 * `BatchWriterPort` (typically `TransactionalBatchWriter`) unchanged.
 */
export class GuardedBatchWriter {
  constructor(
    private readonly gateConfig: FeishuWriteConfig,
    private readonly inner: BatchWriterPort
  ) {}

  async writeBatch(input: GuardedWriteBatchInput): Promise<GuardedBatchWriterResult> {
    const targetTables = input.targetTables ?? ['customer', 'project', 'model'];

    // Evaluate the gate for each target table. Fail closed on the first
    // disallowed target so NO Create Record call is ever issued.
    for (const table of targetTables) {
      const tableId = this.getTableId(table, input);
      const gate = isRealWriteAllowed(
        this.gateConfig,
        input.governanceDecision,
        input.targetBaseToken,
        tableId
      );
      if (!gate.allowed) {
        return this.blockedResult(input.ingestionId, targetTables, input, gate.reason);
      }
    }

    // All targets allowed — delegate to the inner writer.
    const innerResult = await this.inner.writeBatch(input);
    return {
      write_results: innerResult.write_results,
      transaction_snapshot_id: innerResult.transaction_snapshot_id,
      status: innerResult.status,
      records_created: innerResult.records_created,
      records_rolled_back: innerResult.records_rolled_back,
      error_code: innerResult.error_code,
      gate: { allowed: true, reason: 'All gate conditions met; inner writer invoked.' },
    };
  }

  private blockedResult(
    ingestionId: string,
    targetTables: Array<'customer' | 'project' | 'model'>,
    input: GuardedWriteBatchInput,
    reason: string
  ): GuardedBatchWriterResult {
    const write_results: WriteResult[] = targetTables.map((table) => ({
      entity_type: table,
      target_table_id: this.getTableId(table, input),
      business_record_id: null,
      created: false,
      status: 'not_attempted',
    }));
    return {
      write_results,
      transaction_snapshot_id: `gate_blocked_${ingestionId}_${Date.now()}`,
      status: 'blocked',
      records_created: 0,
      records_rolled_back: 0,
      error_code: 'GATE_BLOCKED',
      gate: { allowed: false, reason },
    };
  }

  private getTableId(
    table: 'customer' | 'project' | 'model',
    input: GuardedWriteBatchInput
  ): string {
    if (table === 'customer') return input.customerTableId ?? 'customer';
    if (table === 'project') return input.projectTableId ?? 'project';
    return input.modelTableId ?? 'model';
  }
}
