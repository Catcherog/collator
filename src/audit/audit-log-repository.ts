// audit-log-repository.ts
// WORKSTREAM-D (Task D2): 通用审计日志仓库合同。
//
// 关键区分（Amendment 5 — Audit ≠ WriteLog）：
//   现有 src/server/repositories/write-log-repository.ts 仅覆盖「写入事件」
//   （succeeded / failed / skipped_dry_run）。本合同是**独立、通用**的审计轨迹，
//   覆盖完整垂直闭环的全部状态迁移：
//     ingestion_received → ocr_started → ocr_completed/ocr_failed →
//     candidate_generated → governance_passed/reviewed/rejected →
//     write_started → write_succeeded/write_failed → idempotency_replay
//   write-log 仓库至多是「写入事件」这一子集的一个适配器，**不可**通过重命名
//   它来声称审计持久化已完成。
//
// 幂等合同（AC-D02 — 每个迁移至多一条事件）：
//   record() 在 (ingestion_id, event_type) 二元组上幂等。若 hasEventType 返回
//   true（即该迁移已记录），record() 不得创建重复条目，而是返回已存在的那条
//   记录。这是「迁移日志」语义，与 write-log 的「尝试日志」语义（失败可重试、
//   每次尝试各一条）刻意不同：审计关注的是「迁移发生过一次」，而非「第几次尝试」。
//
// PII 最小化（AC-D04）：
//   record() 在持久化边界对 details 调用 redactDetails()，确保落盘内容不含
//   密钥/token/原始图片/未脱敏手机号。已脱敏的 details 会被回写到返回的记录中。

import { randomUUID } from 'node:crypto';
import { redactDetails } from './redaction.js';

/**
 * 审计事件类型，覆盖截图垂直闭环与持续摄入闭环的全部状态迁移。
 *
 * 与 IngestionService / ScreenshotService 的映射见 src/audit/INTEGRATION.md。
 */
export type AuditEventType =
  | 'ingestion_received'
  | 'ocr_started'
  | 'ocr_completed'
  | 'ocr_failed'
  | 'candidate_generated'
  | 'governance_passed'
  | 'governance_reviewed'
  | 'governance_rejected'
  | 'write_started'
  | 'write_succeeded'
  | 'write_failed'
  | 'idempotency_replay'
  | 'pilot_preview_generated'
  | 'pilot_confirmed'
  | 'pilot_write_started'
  | 'pilot_record_created'
  | 'pilot_relation_verified'
  | 'pilot_write_completed'
  | 'pilot_write_failed'
  | 'pilot_write_blocked'
  | 'pilot_compensation_started'
  | 'pilot_compensation_completed'
  | 'pilot_compensation_failed'
  | 'internal_preview_generated'
  | 'internal_confirmed'
  | 'internal_write_started'
  | 'internal_write_succeeded'
  | 'internal_write_failed'
  | 'internal_write_unknown'
  | 'internal_write_partial'
  | 'internal_write_reconciled';

/**
 * 一条已持久化的审计日志记录。
 *
 * PII 规则（落盘前由 redactDetails 强制）：
 * - details 中命中 secret/token/password/appSecret/image/base64 的值被替换为
 *   '[REDACTED]'；所有字符串值经过 redactPhone 掩码。
 * - 永不持久化：完整原始图片、原始飞书 token、app_secret、客户完整聊天内容。
 *
 * `audit_id` 为不透明字符串。文件模式下为随机 UUID；未来 feishu 模式下可为
 * 飞书返回的真实 record_id。调用方不得假设任何前缀。
 */
export interface AuditLogRecord {
  /** 不透明审计 ID。新建时由 createAuditEvent() 生成为随机 UUID。 */
  audit_id: string;
  /** 关联的摄入任务 ID（贯穿整条闭环的唯一线索）。 */
  ingestion_id: string;
  /** 事件类型，见 AuditEventType。 */
  event_type: AuditEventType;
  /** 可选的请求/链路追踪 ID。 */
  request_id?: string;
  /**
   * 迁移结果状态（业务语义，非审计自身状态）。例如：
   * PASS / NEEDS_REVIEW / BLOCKED（治理）；succeeded / failed（写入）。
   */
  result_status?: string;
  /** ISO8601 时间戳。 */
  timestamp: string;
  /** 已脱敏、PII 最小化的附加详情。落盘前由 redactDetails 处理。 */
  details?: Record<string, unknown>;
}

/**
 * 持久化边界：通用审计日志仓库。
 *
 * 实现者必须：
 * - 在 record() 中对 details 调用 redactDetails() 后再持久化（AC-D04）。
 * - 在 (ingestion_id, event_type) 上保证至多一条记录（AC-D02）。
 * - findByIngestionId 返回按时间顺序的有序序列（AC-D05/AC-D06）。
 */
export interface AuditLogRepository {
  /**
   * 记录一次审计事件。
   *
   * 幂等性（AC-D02）：若 (ingestion_id, event_type) 已存在记录，返回已存在的那条
   * 记录（其 audit_id / timestamp 为首次写入时的值），不创建重复条目。
   *
   * 失效模式（AC-D03）：若底层写入失败——
   * - failClosed=true → 抛错（调用方感知审计缺失）。
   * - failClosed=false → 记录警告并返回已脱敏但**未持久化**的记录（降级）。
   *
   * @returns 实际持久化（或降级时未持久化）的记录，details 已脱敏。
   */
  record(event: AuditLogRecord): Promise<AuditLogRecord>;

  /**
   * 返回某 ingestion 的全部审计事件，按 timestamp 升序（AC-D05/AC-D06）。
   * 文件模式下：即使进程重启后重新实例化仓库指向同一文件，仍可读回（AC-D01）。
   */
  findByIngestionId(ingestionId: string): Promise<AuditLogRecord[]>;

  /**
   * 判断某 (ingestion_id, event_type) 迁移是否已被记录（AC-D02 去重前置检查）。
   * 文件模式下读取文件后判定。
   */
  hasEventType(ingestionId: string, eventType: AuditEventType): Promise<boolean>;
}

/**
 * 从部分输入构造一条 AuditLogRecord，自动填充 audit_id（随机 UUID）与
 * timestamp（当前 ISO8601）。调用方只需提供业务语义字段。
 *
 * details 会由 record() 在持久化边界脱敏，因此调用方可直接传入原始结构；
 * 但调用方仍应遵守 PII 最小化原则——details 不应包含完整聊天内容或原始图片。
 */
export function createAuditEvent(input: {
  ingestion_id: string;
  event_type: AuditEventType;
  request_id?: string;
  result_status?: string;
  details?: Record<string, unknown>;
}): AuditLogRecord {
  return {
    audit_id: randomUUID(),
    ingestion_id: input.ingestion_id,
    event_type: input.event_type,
    request_id: input.request_id,
    result_status: input.result_status,
    timestamp: new Date().toISOString(),
    details: input.details,
  };
}

/** 导出 redactDetails 以便适配器在持久化边界复用（AC-D04）。 */
export { redactDetails };
