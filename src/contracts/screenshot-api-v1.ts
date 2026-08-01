/**
 * Screenshot API V1 — 冻结的受控 API 契约
 *
 * Task: FAMP-CHAT-SCREENSHOT-VERTICAL-SLICE-01 (Phase A0)
 * Owner: 主线 A (collator)
 * Frozen: 2026-07-22
 *
 * 这是对外受控 API 契约，供主线 B (Portal) 和辅线 C (Bot) 适配 API Client。
 * B/C 不得要求 A 修改业务语义迎合界面；只能适配此契约。
 *
 * 7 个最少 API：
 *   1. POST   /v1/screenshots                      — 创建截图提交
 *   2. GET    /v1/screenshots/:id                  — 查询处理状态
 *   3. GET    /v1/screenshots/:id/evidence          — 获取 OCR 证据和 Candidate
 *   4. POST   /v1/screenshots/:id/corrections       — 提交人工修正
 *   5. POST   /v1/screenshots/:id/confirm            — 确认写入
 *   6. POST   /v1/screenshots/:id/escalate-review    — 转人工复核
 *   7. GET    /v1/screenshots/:id/final-result       — 获取最终治理和写入结果
 *
 * 复用 Candidate V1 (10 必填字段) 和 Governance Result V1 (9 必填字段)。
 * 所有错误响应统一格式: { error: { code: string, message: string } }
 */

// ============================================================================
// 公共类型
// ============================================================================

export const SCREENSHOT_API_VERSION = 'v1' as const;

/** 截图处理状态枚举 */
export type ScreenshotStatus =
  | 'received'          // 截图已接收
  | 'ocr_processing'   // OCR 进行中
  | 'ocr_failed'       // OCR 失败
  | 'ocr_completed'    // OCR 完成
  | 'candidate_drafted' // 候选已生成
  | 'governance_passed' // 治理通过
  | 'governance_needs_review' // 治理需复核
  | 'governance_blocked'     // 治理阻止
  | 'write_succeeded'  // 写入成功
  | 'write_failed'      // 写入失败
  | 'duplicate_skipped' // 重复跳过
  | 'review_pending'   // 复核待处理
  | 'review_resolved'  // 复核已解决
  | 'expired';         // 已过期

/** 标准错误响应 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** 写入结果状态 */
export type WriteResultStatus = 'succeeded' | 'failed' | 'rolled_back' | 'not_attempted' | 'unknown';

/** 单实体写入结果 */
export interface WriteResult {
  entity_type: 'customer' | 'project' | 'model';
  target_table_id: string;
  business_record_id: string | null;
  created: boolean;
  status: WriteResultStatus;
  error_code?: string;
  write_log_id?: string;
}

// ============================================================================
// 1. POST /v1/screenshots — 创建截图提交
// ============================================================================

export interface CreateScreenshotRequest {
  /** 来源系统标识 */
  source_system: string;
  /** 来源记录 ID（飞书记录 ID 或外部系统 ID） */
  source_record_id: string;
  /** 提交时间 ISO-8601 */
  submitted_at: string;
  /** 提交者标识 */
  submitted_by?: string;
  /** Base64 编码的图片（JPEG/PNG），与 image_url 二选一 */
  image_base64?: string;
  /** 图片文件名 */
  image_filename?: string;
  /** 图片 URL（飞书附件 URL 或公网 URL），与 image_base64 二选一 */
  image_url?: string;
  /** 是否干运行（不实际写入飞书） */
  dry_run?: boolean;
}

export interface CreateScreenshotResponse {
  /** 截图 ID */
  screenshot_id: string;
  /** 摄入任务 ID（复用现有 IngestionTask） */
  ingestion_id: string;
  /** 截图状态 */
  status: ScreenshotStatus;
  /** 是否幂等重放（重复提交同一图片） */
  idempotent_replay: boolean;
  /** OCR 任务 ID */
  ocr_task_id?: string;
  /** 创建时间 ISO-8601 */
  created_at: string;
}

// ============================================================================
// 2. GET /v1/screenshots/:id — 查询处理状态
// ============================================================================

export interface GetScreenshotStatusResponse {
  screenshot_id: string;
  ingestion_id: string;
  status: ScreenshotStatus;
  ocr?: {
    status: 'pending' | 'processing' | 'succeeded' | 'failed';
    engine?: string;
    confidence?: number;
    text_blocks_count?: number;
    error_code?: string;
    processed_at?: string;
  };
  candidate?: {
    status: 'drafted' | 'confirmed' | 'rejected';
    candidate_id?: string;
    quality_score?: number;
    quality_status?: string;
  };
  governance?: {
    decision?: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
    rule_version?: string;
    review_task_id?: string | null;
  };
  write?: {
    status?: WriteResultStatus;
    entity_count?: number;
    completed_at?: string;
  };
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 3. GET /v1/screenshots/:id/evidence — 获取 OCR 证据和 Candidate
// ============================================================================

export interface GetScreenshotEvidenceResponse {
  screenshot_id: string;
  ocr_evidence: {
    engine: string;
    ocr_version: string;
    text_blocks: Array<{
      type: 'text' | 'date' | 'phone' | 'email' | 'price' | 'name';
      text: string;
      line?: number;
      confidence?: number;
      bbox?: { x: number; y: number; width: number; height: number };
    }>;
    raw_text: string;
    confidence: number;
    processed_at: string;
  };
  candidate_v1: {
    schema_version: string;
    candidate_id: string;
    ingestion_id: string;
    source: {
      system: string;
      table?: string;
      record_id: string;
      source_type: string;
    };
    entity_type: string;
    raw_evidence: {
      raw_text: string;
      segments?: unknown[];
      content_hash: string;
    };
    normalized_fields: Record<string, unknown>;
    quality: {
      status: string;
      issues: Array<{ code: string; message: string; severity?: string }>;
      score?: number;
    };
    processing: {
      extractor_version: string;
      attempt: number;
      created_at: string;
    };
    idempotency_key: string;
  };
}

// ============================================================================
// 4. POST /v1/screenshots/:id/corrections — 提交人工修正
// ============================================================================

export interface SubmitCorrectionsRequest {
  /** 修正者标识 */
  reviewer_id: string;
  /** 修正的字段（中英文字段名均可，复用 mapCustomerCandidate 映射） */
  corrections: Record<string, unknown>;
  /** 修正原因 */
  correction_reason?: string;
}

export interface SubmitCorrectionsResponse {
  screenshot_id: string;
  candidate_v1: {
    schema_version: string;
    candidate_id: string;
    normalized_fields: Record<string, unknown>;
    quality: {
      status: string;
      issues: unknown[];
      score?: number;
    };
  };
  /** 修正后的字段权威等级标记为 CONFIRMED */
  field_authority: 'CONFIRMED';
  correction_applied_at: string;
  reviewer_id: string;
}

// ============================================================================
// 5. POST /v1/screenshots/:id/confirm — 确认写入
// ============================================================================

export interface ConfirmWriteRequest {
  /** 确认者标识 */
  reviewer_id: string;
  /** 候选 ID（校验一致性） */
  candidate_v1_id: string;
  /** 是否干运行 */
  dry_run?: boolean;
  /** 目标写入表 */
  target_tables?: Array<'customer' | 'project' | 'model'>;
  /** Server-created opaque preview identifier. */
  production_pilot_preview_id?: string;
  /** Server-created nonce returned with the preview. */
  production_pilot_nonce?: string;
}

/**
 * Public-safe production-pilot preview payload. It contains only stable
 * digests and logical aliases; raw Base/Table/record identifiers are never
 * accepted in the preview body.
 */
export interface ProductionPilotPreview {
  preview_id: string;
  nonce: string;
  generated_at: string;
  expires_at: string;
  write_mode: 'production-pilot';
  status: 'generated' | 'confirmed' | 'consumed' | 'succeeded';
  planned_record_count: number;
  target_table_aliases: Array<'customer' | 'project' | 'model'>;
  target_table_digests: Partial<Record<'customer' | 'project' | 'model', string>>;
  base_token_digest?: string;
}

export interface CreateProductionPilotPreviewRequest {
  candidate_v1_id: string;
}

export interface ConfirmProductionPilotPreviewRequest {
  nonce: string;
}

export interface ConfirmWriteResponse {
  screenshot_id: string;
  ingestion_id: string;
  status: ScreenshotStatus;
  /** 多实体写入结果 */
  write_results: WriteResult[];
  /** 事务快照 ID（用于跨实体补偿/回滚追踪） */
  transaction_snapshot_id?: string;
  completed_at?: string;
  /** 失败时的错误码 */
  error_code?: string;
}

// ============================================================================
// 6. POST /v1/screenshots/:id/escalate-review — 转人工复核
// ============================================================================

export interface EscalateReviewRequest {
  /** 请求者标识 */
  reviewer_id: string;
  /** 原因码（如 PROJECT_TYPE_REQUIRED, CUSTOMER_MISSING 等） */
  reason_code: string;
  /** 原因描述 */
  reason: string;
  /** 建议的字段值（供人工参考） */
  suggested_fields?: Record<string, unknown>;
}

export interface EscalateReviewResponse {
  screenshot_id: string;
  governance_result_v1: {
    schema_version: string;
    candidate_id: string;
    decision: 'NEEDS_REVIEW';
    classification: {
      entity_type: string;
      project_type?: string;
      confidence?: number;
    };
    rule_version: string;
    violations: Array<{
      code: string;
      message: string;
      severity: string;
    }>;
    write: {
      status: 'NOT_ATTEMPTED';
      target_table: string;
      target_record_id: null;
    };
    review: {
      status: 'CREATED' | 'ALREADY_EXISTS';
      review_task_id: string;
      ai_explanation?: {
        available: boolean;
        reason: string;
        summary?: string;
        suggested_fix?: string;
      };
    };
    audit: {
      audit_id: string;
      timestamp: string;
      source_record_id: string;
      idempotency_key: string;
      rule_version: string;
    };
  };
  review_task: {
    review_task_id: string;
    status: 'pending_review';
    feishu_review_record_id?: string;
    created_at: string;
  };
}

// ============================================================================
// 7. GET /v1/screenshots/:id/final-result — 获取最终治理和写入结果
// ============================================================================

export interface GetFinalResultResponse {
  screenshot_id: string;
  ingestion_id: string;
  final_status: ScreenshotStatus;
  governance_result_v1: {
    schema_version: string;
    candidate_id: string;
    decision: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
    classification: {
      entity_type: string;
      project_type?: string;
      confidence?: number;
    };
    rule_version: string;
    violations: Array<{
      code: string;
      message: string;
      severity: string;
    }>;
    write: {
      status: WriteResultStatus;
      target_table: string;
      target_record_id: string | null;
      attempted_at?: string;
    };
    review: {
      status: string;
      review_task_id: string | null;
      ai_explanation?: {
        available: boolean;
        reason: string;
        summary?: string;
        suggested_fix?: string;
      };
    };
    audit: {
      audit_id: string;
      timestamp: string;
      source_record_id: string;
      idempotency_key: string;
      rule_version: string;
    };
  };
  write_logs: Array<{
    write_log_id: string;
    ingestion_id: string;
    target_table_id: string;
    business_record_id: string | null;
    status: WriteResultStatus;
    error_code?: string;
    created_at: string;
  }>;
  review_task?: {
    review_task_id: string;
    status: string;
    created_at: string;
    resolved_at?: string;
  } | null;
  transaction_snapshot?: {
    snapshot_id: string;
    status: 'committed' | 'rolled_back' | 'partial';
    records_created: number;
    records_rolled_back: number;
  };
  completed_at?: string;
}

// ============================================================================
// 路由定义汇总（供 collator Fastify 注册）
// ============================================================================

export const SCREENSHOT_ROUTES = [
  { method: 'POST',   path: '/v1/screenshots',                  handler: 'createScreenshot' },
  { method: 'GET',    path: '/v1/screenshots/:id',              handler: 'getScreenshotStatus' },
  { method: 'GET',    path: '/v1/screenshots/:id/evidence',     handler: 'getScreenshotEvidence' },
  { method: 'POST',   path: '/v1/screenshots/:id/corrections',  handler: 'submitCorrections' },
  { method: 'POST',   path: '/v1/screenshots/:id/confirm',       handler: 'confirmWrite' },
  { method: 'POST',   path: '/v1/screenshots/:id/escalate-review', handler: 'escalateReview' },
  { method: 'GET',    path: '/v1/screenshots/:id/final-result',  handler: 'getFinalResult' },
] as const;

export type ScreenshotRouteHandler =
  | 'createScreenshot'
  | 'getScreenshotStatus'
  | 'getScreenshotEvidence'
  | 'submitCorrections'
  | 'confirmWrite'
  | 'escalateReview'
  | 'getFinalResult';
