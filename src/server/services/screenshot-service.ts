/**
 * 主线 A1: 截图服务 — 核心业务逻辑
 *
 * 7 个 API 方法的业务实现：
 * 1. createScreenshot — 接收 base64 图片 → 幂等去重 → 存储 → OCR → 生成 Candidate V1
 * 2. getScreenshotStatus — 查询处理状态
 * 3. getScreenshotEvidence — 返回 OCR 证据 + Candidate V1
 * 4. submitCorrections — 应用人工修正 → 标记 CONFIRMED → 状态迁移
 * 5. confirmWrite — 调用 SOP PRE_WRITE → PASS 时写入飞书 → 返回 write_results
 * 6. escalateReview — 创建复核任务 → 返回 Governance Result V1
 * 7. getFinalResult — 聚合治理结果 + 写入日志 + 复核任务状态
 *
 * 持久化策略：
 * - 复用 TaskRepository 持久化 IngestionTask
 * - 截图特定状态存储在 pipeline_evidence 字段（generic object）
 * - screenshot_id = ingestion_id（1:1 映射）
 *
 * 幂等策略：
 * - AC-A08: 重复上传 → idempotency_key = sha256(image_content)，相同图片返回已有任务
 * - AC-A09: 重复确认 → 检查 write_results 是否已存在 succeeded 状态
 * - AC-A09: 重复复核 → 检查 review_task 是否已存在
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  TaskSaveConflictError,
  type TaskRepository,
  type TaskSaveFence,
} from '../repositories/task-repository.js';
import type { WriteLogRepository } from '../repositories/write-log-repository.js';
import type {
  ProductionPilotCommitPayload,
  ProductionPilotRunManifest,
  RunManifestRepository,
} from '../repositories/run-manifest-repository.js';
import type { IngestionTask } from '../domain/ingestion.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ProductionPilotMutationLockedError,
} from '../domain/errors.js';
import type { CandidateV1 } from '../../contracts/candidate-v1.js';
import { createIdempotencyKey } from '../../contracts/candidate-v1.js';
import type {
  CreateScreenshotRequest,
  CreateScreenshotResponse,
  GetScreenshotStatusResponse,
  GetScreenshotEvidenceResponse,
  SubmitCorrectionsRequest,
  SubmitCorrectionsResponse,
  ConfirmWriteRequest,
  ConfirmWriteResponse,
  CreateProductionPilotPreviewRequest,
  ProductionPilotPreview,
  EscalateReviewRequest,
  EscalateReviewResponse,
  GetFinalResultResponse,
  ScreenshotStatus,
  WriteResult,
  WriteResultStatus,
} from '../../contracts/screenshot-api-v1.js';
import type { ScreenshotOcrEngine, OcrResult, OcrTextBlock } from './screenshot-ocr-adapter.js';
import type { ScreenshotGovernanceClient, FullGovernanceResult } from '../governance/screenshot-governance-client.js';
import type { GuardedWriteBatchInput } from '../business/guarded-batch-writer.js';
import type { ExistingRecordVerificationInput } from '../business/transactional-batch-writer.js';
import {
  computeInternalControlledWritePlan,
  computeWritePlan,
  type WriteTable,
} from '../business/write-plan.js';
import { InternalWriteQueue, type InternalWriteExecutionContext } from '../business/internal-write-queue.js';
import type {
  InternalControlledWriteResult,
  InternalWriteLog,
  InternalWritePreview,
  InternalWriteRepository,
  InternalWriteResultItem,
} from '../repositories/internal-write-repository.js';
import {
  isInternalControlledWriteAllowed,
  type FeishuWriteConfig,
} from '../config/feishu-write-config.js';
import { createAuditEvent, type AuditLogRepository, type AuditEventType } from '../../audit/audit-log-repository.js';
import {
  buildServerProductionPilotPreviewDigest,
  createServerProductionPilotPreview,
  digestJson,
} from '../config/production-pilot.js';
import {
  InternalWriteAlreadyInProgressError,
  InternalWriteDisabledError,
  InternalWriteGateBlockedError,
  InternalWriteNeedsReconciliationError,
  InternalWriteOperatorMismatchError,
  InternalWritePlanMismatchError,
  InternalWritePreviewStaleError,
  InternalWritePreviewExpiredError,
  InternalWriteRequiresHumanConfirmationError,
  InternalWriteResultUnknownError,
  InternalWriteStateTransitionConflictError,
} from '../domain/errors.js';

// ============================================================================
// 截图状态存储类型（存储在 IngestionTask.pipeline_evidence 中）
// ============================================================================

interface ScreenshotState {
  screenshot_status: ScreenshotStatus;
  image_content_hash: string;
  image_filename?: string;
  source_system: string;
  submitted_by?: string;
  ocr_evidence?: OcrResult;
  ocr_task_id?: string;
  candidate_v1?: CandidateV1;
  governance_result_v1?: FullGovernanceResult;
  write_results?: WriteResult[];
  transaction_snapshot?: {
    snapshot_id: string;
    status: 'committed' | 'rolled_back' | 'partial';
    records_created: number;
    records_rolled_back: number;
  };
  review_task?: {
    review_task_id: string;
    status: string;
    created_at: string;
    resolved_at?: string;
    reason_code?: string;
    reason?: string;
    suggested_fields?: Record<string, unknown>;
  };
  field_authority: Record<string, 'RAW' | 'CANDIDATE' | 'CONFIRMED' | 'AUTHORITATIVE'>;
  corrections_applied?: Record<string, unknown>;
  reviewer_id?: string;
  idempotent_replay: boolean;
  internal_controlled_write?: {
    preview_id: string;
    status: InternalWritePreview['status'];
    result?: InternalControlledWriteResult;
    transaction_snapshot_id?: string;
  };
}

export type InternalWritePreviewRequest = { candidate_v1_id: string };
export type InternalWriteConfirmationRequest = {
  nonce: string;
  candidate_v1_id: string;
};

// ============================================================================
// 工具函数
// ============================================================================

function nowIso(): string {
  return new Date().toISOString();
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 将 ScreenshotStatus 映射到 IngestionStatus（用于 IngestionTask.status 字段） */
function mapToIngestionStatus(status: ScreenshotStatus): IngestionTask['status'] {
  const mapping: Record<ScreenshotStatus, IngestionTask['status']> = {
    received: 'received',
    ocr_processing: 'extracting',
    ocr_failed: 'extract_failed',
    ocr_completed: 'candidate_received',
    candidate_drafted: 'candidate_received',
    governance_passed: 'approved',
    governance_needs_review: 'pending_review',
    governance_blocked: 'review_rejected',
    write_succeeded: 'completed',
    write_failed: 'commit_failed',
    write_result_unknown: 'write_result_unknown',
    write_needs_reconciliation: 'write_needs_reconciliation',
    write_partial: 'write_partial',
    duplicate_skipped: 'completed',
    review_pending: 'pending_review',
    review_resolved: 'approved',
    expired: 'completed',
  };
  return mapping[status];
}

function mapScreenshotWriteStatus(status: ScreenshotStatus): WriteResultStatus {
  if (status === 'write_succeeded') return 'succeeded';
  if (status === 'write_failed') return 'failed';
  if (status === 'write_result_unknown') return 'unknown';
  if (status === 'write_needs_reconciliation') return 'needs_reconciliation';
  if (status === 'write_partial') return 'partial';
  return 'not_attempted';
}

const TRUSTED_REAL_OCR_ENGINES = new Set(['tesseract', 'feishu']);

/**
 * Internal-controlled real writes must be based on persisted OCR evidence from
 * an approved engine. Checking only the process-level adapter is insufficient:
 * an ingestion can survive a restart and carry stale mock/manual evidence.
 */
function assertTrustedRealOcrEvidence(state: ScreenshotState, context: string): void {
  const engine = state.ocr_evidence?.engine?.trim().toLowerCase();
  if (!engine || !TRUSTED_REAL_OCR_ENGINES.has(engine)) {
    throw new ConflictError(
      `${context} requires persisted OCR evidence from tesseract or feishu; got ${engine ?? 'missing'}. ` +
      'Re-upload the screenshot after starting Collator with a trusted OCR engine.',
    );
  }
}

/** 从 IngestionTask 提取截图状态 */
function extractScreenshotState(task: IngestionTask): ScreenshotState {
  const evidence = task.pipeline_evidence as { screenshot_state?: ScreenshotState } | undefined;
  if (!evidence?.screenshot_state) {
    throw new Error(`Screenshot state not found for ingestion ${task.ingestion_id}`);
  }
  return JSON.parse(JSON.stringify(evidence.screenshot_state)) as ScreenshotState;
}

/** 将截图状态写回 IngestionTask.pipeline_evidence */
function withScreenshotState(task: IngestionTask, state: ScreenshotState): IngestionTask {
  const evidence = {
    ...((task.pipeline_evidence ?? {}) as Record<string, unknown>),
    screenshot_state: state,
  };
  return {
    ...task,
    pipeline_evidence: evidence,
    status: mapToIngestionStatus(state.screenshot_status),
    updated_at: nowIso(),
  };
}

// ============================================================================
// OCR → Candidate V1 映射
// ============================================================================

/**
 * 从 OCR 文本块推断项目类型。
 * - 包含"客片"/"客户拍摄" → 'client'
 * - 包含"样片"/"创作"/"模特" → 'creative'
 * - 否则 → 'unknown'（触发 BR-03 NEEDS_REVIEW）
 */
function inferProjectType(textBlocks: OcrTextBlock[]): 'client' | 'creative' | 'unknown' {
  const allText = textBlocks.map((b) => b.text).join(' ');
  if (/客片|客户拍摄|客户咨询/.test(allText)) return 'client';
  if (/样片|创作|模特拍摄/.test(allText)) return 'creative';
  return 'unknown';
}

/** 从 OCR 文本块提取客户姓名 */
function extractCustomerName(textBlocks: OcrTextBlock[]): string | null {
  const nameBlock = textBlocks.find((b) => b.type === 'name');
  return nameBlock?.text ?? null;
}

/** 从 OCR 文本块提取日期并标准化为 ISO 格式 */
function extractShootDate(textBlocks: OcrTextBlock[]): string | null {
  const dateBlock = textBlocks.find((b) => b.type === 'date');
  if (!dateBlock) return null;
  // 尝试解析中文日期格式 "2026年8月15日"
  const cnMatch = dateBlock.text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cnMatch) {
    const [, y, m, d] = cnMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // 已经是 ISO 格式
  return dateBlock.text;
}

/** 从 OCR 文本块提取预算区间 */
function extractBudget(textBlocks: OcrTextBlock[]): string | null {
  const priceBlock = textBlocks.find((b) => b.type === 'price');
  if (!priceBlock) return null;
  return priceBlock.text;
}

/** 从 OCR 文本块提取风格要求 */
function extractStyle(textBlocks: OcrTextBlock[]): string | null {
  const styleBlock = textBlocks.find((b) => b.type === 'text' && /风格/.test(b.text));
  if (!styleBlock) return null;
  // 提取 "风格：XXX" 中的 XXX
  const match = styleBlock.text.match(/风格[：:]\s*(.+)/);
  return match?.[1]?.trim() ?? null;
}

/** 从 OCR 文本块提取联系方式（已脱敏） */
function extractContact(textBlocks: OcrTextBlock[]): string | null {
  const phoneBlock = textBlocks.find((b) => b.type === 'phone');
  return phoneBlock?.text ?? null;
}

/**
 * 从 OCR 结果生成 Candidate V1。
 *
 * 字段映射：
 * - project_type: inferProjectType(ocr.text_blocks)
 * - customer_ref: extractCustomerName(ocr.text_blocks)
 * - model_ref: null（client 项目无 model；creative 项目可从 OCR 提取）
 * - shoot_date: extractShootDate(ocr.text_blocks)
 * - 附加字段（passthrough）：客户姓名、联系方式、预算区间、风格要求
 *
 * 质量评分：
 * - score = ocr.confidence
 * - status = score >= 0.8 ? 'PASS' : 'NEEDS_REVIEW'
 */
function buildCandidateV1FromOcr(
  ingestionId: string,
  sourceRecordId: string,
  ocr: OcrResult,
  imageHash: string
): CandidateV1 {
  const projectType = inferProjectType(ocr.text_blocks);
  const customerName = extractCustomerName(ocr.text_blocks);
  const shootDate = extractShootDate(ocr.text_blocks);
  const budget = extractBudget(ocr.text_blocks);
  const style = extractStyle(ocr.text_blocks);
  const contact = extractContact(ocr.text_blocks);

  const qualityStatus = ocr.confidence >= 0.8 ? 'PASS' : 'NEEDS_REVIEW';
  const qualityIssues: Array<{ code: string; message: string }> = [];
  if (projectType === 'unknown') {
    qualityIssues.push({
      code: 'PROJECT_TYPE_REQUIRED',
      message: '无法从截图中确定项目类型（客片/样片）',
    });
  }
  if (!customerName && projectType === 'client') {
    qualityIssues.push({
      code: 'CUSTOMER_REQUIRED',
      message: '客片项目缺少客户信息',
    });
  }

  return {
    schema_version: 'v1',
    candidate_id: `cand_${randomUUID().replace(/-/g, '')}`,
    ingestion_id: ingestionId,
    source: {
      system: 'feishu_bitable',
      table: 'screenshot_upload',
      record_id: sourceRecordId,
    },
    entity_type: 'project',
    raw_evidence: {
      redacted: true,
      raw_text: ocr.raw_text,
      content_hash: `sha256_${imageHash}`,
    },
    normalized_fields: {
      project_type: projectType,
      customer_ref: customerName,
      model_ref: null,
      shoot_date: shootDate,
      // passthrough 字段（中文字段名，供 writer 使用）
      ...(customerName ? { 客户姓名: customerName } : {}),
      ...(contact ? { 联系方式: contact } : {}),
      ...(budget ? { 预算区间: budget } : {}),
      ...(style ? { 风格要求: style } : {}),
    },
    quality: {
      status: qualityStatus as 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED',
      issues: qualityIssues,
      score: ocr.confidence,
    },
    processing: {
      ocr_version: ocr.ocr_version,
      asr_version: 'n/a',
      processed_at: ocr.processed_at,
      agent_version: 'collator-1.0.0',
    },
    idempotency_key: createIdempotencyKey(ocr.raw_text + imageHash),
  };
}

// ============================================================================
// ScreenshotService
// ============================================================================

// ============================================================================
// Workstream C/E: 截图服务批量写入器端口
// ============================================================================

/**
 * 写入结果视图。接受 TransactionalBatchWriterResult 与 GuardedBatchWriterResult
 * 的公共字段；`status` 放宽为 string（GuardedBatchWriter 可能返回 'blocked'）。
 * confirmWrite 将任何非 'committed' 状态（含 'blocked'）视为 write_failed。
 */
interface BatchWriterResultView {
  write_results: WriteResult[];
  transaction_snapshot_id: string;
  status: string;
  records_created: number;
  records_rolled_back: number;
  error_code?: string;
  post_write_verified?: boolean;
  compensation_events_emitted?: boolean;
}

const PILOT_MUTATION_LOCKED_STATUSES = new Set<ProductionPilotRunManifest['status']>([
  'consumed',
  'executing',
  'verifying',
  'committing',
]);

/**
 * 截图服务批量写入器端口。接受 TransactionalBatchWriter 与 GuardedBatchWriter
 * （Amendment 6 双层放行门）。writeBatch 入参为 GuardedWriteBatchInput（含治理决定
 * 与目标 Base/Table），透传给门控写入器校验；普通写入器/测试 Fake 忽略额外字段。
 *
 * 类型说明：方法签名采用 bivariant 检查，故 FakeBatchWriter
 * (writeBatch(TransactionalBatchWriterInput): TransactionalBatchWriterResult)
 * 与 GuardedBatchWriter (writeBatch(GuardedWriteBatchInput): GuardedBatchWriterResult)
 * 均可赋值给此端口。
 */
interface ScreenshotBatchWriter {
  writeBatch(input: GuardedWriteBatchInput): Promise<BatchWriterResultView>;
  preflight?(input: GuardedWriteBatchInput): Promise<{ allowed: boolean; reason: string }>;
  findByIngestionId?(entity: WriteTable, ingestionId: string): Promise<string[]>;
  verifyExistingByIngestion?(
    entity: WriteTable,
    recordId: string,
    input: ExistingRecordVerificationInput,
  ): Promise<void>;
  recoverPendingCompensations?(hooks?: {
    onCompensationStarted?: (recordCount: number) => Promise<void>;
    onCompensationCompleted?: (status: 'completed' | 'failed', recordCount: number) => Promise<void>;
  }): Promise<Array<{ previewId: string; status: 'compensated' | 'compensation_failed' }>>;
}

export type ProductionPilotRecoveryOutcome = {
  previewId: string;
  status: 'compensated' | 'compensation_failed' | 'committed' | 'commit_recovery_failed';
};

export interface ScreenshotServiceOptions {
  ocrEngine?: ScreenshotOcrEngine;
  governanceClient?: ScreenshotGovernanceClient;
  batchWriter?: ScreenshotBatchWriter;
  writeLogRepository?: WriteLogRepository;
  /**
   * Workstream C/E: 写入门禁上下文。confirmWrite 将这些值透传给
   * GuardedBatchWriter.writeBatch，供双层放行门（Amendment 6）校验目标
   * Base/Table 白名单。仅在 feishu 模式下由 buildApp 从 config 注入。
   * 缺省时 targetBaseToken/tableId 为 undefined → 门禁白名单不命中 → blocked（安全默认）。
   */
  feishuWriteContext?: {
    targetBaseToken?: string;
    customerTableId?: string;
    projectTableId?: string;
    modelTableId?: string;
  };
  /**
   * Workstream D/E: 可选审计日志仓库。覆盖截图垂直闭环的状态迁移
   * （ingestion_received / ocr_completed / governance_passed|reviewed|rejected /
   * write_started / write_succeeded / write_failed）。
   *
   * 缺省 undefined 时，所有 record() 调用被 `if (this.options.auditLogRepository)`
   * 守卫跳过，既有测试行为不变。生产模式由 buildApp 注入 FileAuditRepository。
   */
  auditLogRepository?: AuditLogRepository;
  /** Process-level production-pilot recovery journal; mandatory for pilot writes. */
  runManifestRepository?: RunManifestRepository;
  /** Confirmation window for a server-created manifest. */
  productionPilotManifestTtlMs?: number;
  /** Server-bound pilot run id; absent means the pilot cannot execute. */
  productionPilotRunId?: string;
  /** Durable preview/result journal for the separately named internal lane. */
  internalWriteRepository?: InternalWriteRepository;
  /** Single-process internal write serializer. */
  internalWriteQueue?: InternalWriteQueue;
  /** Full Feishu config is required for the internal lane. */
  internalWriteConfig?: FeishuWriteConfig;
  /** Optional caller-visible timeout; the queue slot remains occupied until settlement. */
  internalWriteTimeoutMs?: number;
}

export class ScreenshotService {
  private readonly internalInFlight = new Set<string>();

  constructor(
    private readonly repository: TaskRepository,
    private readonly options: ScreenshotServiceOptions = {}
  ) {}

  /**
   * Workstream D/E: 审计记录守卫辅助。auditLogRepository 缺省（测试模式）时为 no-op，
   * 既有测试行为不变；生产模式由 buildApp 注入 FileAuditRepository。
   * 默认 fail-closed：record() 失败时向上冒泡（AC-D03）。
   */
  private async auditRecord(
    ingestionId: string,
    eventType: AuditEventType,
    resultStatus?: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (this.options.auditLogRepository) {
      await this.options.auditLogRepository.record(
        createAuditEvent({
          ingestion_id: ingestionId,
          event_type: eventType,
          result_status: resultStatus,
          details,
        }),
      );
    }
  }

  private async assertPilotMutationUnlocked(ingestionId: string): Promise<void> {
    const manifestRepository = this.options.runManifestRepository;
    const pilotRunId = this.options.productionPilotRunId?.trim();
    if (!manifestRepository || !pilotRunId) return;
    const manifest = await manifestRepository.findByRunId(pilotRunId);
    if (manifest?.ingestionId === ingestionId && PILOT_MUTATION_LOCKED_STATUSES.has(manifest.status)) {
      throw new ProductionPilotMutationLockedError(
        `Production pilot mutation is locked while manifest ${manifest.status}`,
      );
    }
  }

  private async savePilotTaskWithFence(
    task: IngestionTask,
    state: ScreenshotState,
    fence: TaskSaveFence,
  ): Promise<void> {
    if (!this.repository.saveWithFence || !Number.isInteger(task.task_version)) {
      throw new TaskSaveConflictError('Production pilot task CAS is unavailable');
    }
    await this.repository.saveWithFence(withScreenshotState(task, state), fence);
  }

  // ==========================================================================
  // 1. POST /v1/screenshots — 创建截图提交
  // ==========================================================================

  async createScreenshot(req: CreateScreenshotRequest): Promise<CreateScreenshotResponse> {
    // 校验输入：image_base64 或 image_url 至少一个
    if (!req.image_base64 && !req.image_url) {
      throw new BadRequestError('Either image_base64 or image_url is required');
    }

    // 解码图片并计算内容哈希（幂等键）
    let imageBuffer: Buffer;
    let imageContent = '';
    if (req.image_base64) {
      imageBuffer = Buffer.from(req.image_base64, 'base64');
      imageContent = req.image_base64;
    } else {
      // image_url 模式：第一阶段不实际下载，使用 URL 作为内容标识
      const imageUrl = req.image_url!;
      imageBuffer = Buffer.from(imageUrl, 'utf8');
      imageContent = imageUrl;
    }

    const imageHash = sha256Hex(imageContent);
    const idempotencyKey = `sha256_${imageHash}`;

    // AC-A08: 幂等检查 — 相同图片内容返回已有任务
    const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      const state = extractScreenshotState(existing);
      return {
        screenshot_id: existing.ingestion_id,
        ingestion_id: existing.ingestion_id,
        status: state.screenshot_status,
        idempotent_replay: true,
        ocr_task_id: state.ocr_task_id,
        created_at: existing.created_at,
      };
    }

    // 创建 IngestionTask
    const ingestionId = `ing_${randomUUID().replace(/-/g, '')}`;
    const now = nowIso();
    const initialState: ScreenshotState = {
      screenshot_status: 'received',
      image_content_hash: imageHash,
      image_filename: req.image_filename,
      source_system: req.source_system,
      submitted_by: req.submitted_by,
      field_authority: {},
      idempotent_replay: false,
    };

    const task: IngestionTask = {
      ingestion_id: ingestionId,
      task_version: 1,
      idempotency_key: idempotencyKey,
      status: 'received',
      source_system: req.source_system,
      source_record_id: req.source_record_id,
      source_type: 'IMAGE_OCR',
      target_domain: 'project',
      content: req.image_base64 ? `<base64 image ${imageHash.slice(0, 16)}...>` : req.image_url ?? '',
      submitted_at: req.submitted_at,
      timezone: 'Asia/Shanghai',
      submitted_by: req.submitted_by,
      dry_run: req.dry_run ?? false,
      attempt_count: 1,
      warnings: [],
      errors: [],
      duplicate_candidates: [],
      created_at: now,
      updated_at: now,
      pipeline_evidence: { screenshot_state: initialState },
    };

    await this.repository.save(task);

    // Workstream D/E: 审计 — 截图接收（仅新记录；幂等重放在上方已提前返回）。
    await this.auditRecord(ingestionId, 'ingestion_received', 'received', {
      source_system: req.source_system,
      image_content_hash: imageHash,
    });

    // 同步触发 OCR（mock 引擎即时返回）
    try {
      await this.runOcrAndBuildCandidate(ingestionId, imageBuffer, imageHash);
    } catch (err) {
      // OCR 失败：标记为 ocr_failed（而非 ocr_processing），使轮询方能立即检测
      // 终态而非超时。之前错误设为 ocr_processing 导致 poller 永远等不到终态。
      const currentTask = await this.repository.findById(ingestionId);
      if (currentTask) {
        const state = extractScreenshotState(currentTask);
        state.screenshot_status = 'ocr_failed';
        state.ocr_evidence = undefined;
        await this.repository.save(withScreenshotState(currentTask, state));
      }
      await this.auditRecord(ingestionId, 'ocr_failed', 'ocr_failed', {
        error_message: err instanceof Error ? err.message : String(err),
      });
    }

    const finalTask = await this.repository.findById(ingestionId);
    const finalState = finalTask ? extractScreenshotState(finalTask) : initialState;

    return {
      screenshot_id: ingestionId,
      ingestion_id: ingestionId,
      status: finalState.screenshot_status,
      idempotent_replay: false,
      ocr_task_id: finalState.ocr_task_id,
      created_at: now,
    };
  }

  /**
   * 运行 OCR 并构建 Candidate V1。
   * 状态迁移：received → ocr_processing → ocr_completed → candidate_drafted
   */
  private async runOcrAndBuildCandidate(
    ingestionId: string,
    imageBuffer: Buffer,
    imageHash: string
  ): Promise<void> {
    let task = await this.repository.findById(ingestionId);
    if (!task) throw new NotFoundError(`Screenshot ${ingestionId} not found`);

    let state = extractScreenshotState(task);
    state.screenshot_status = 'ocr_processing';
    await this.repository.save(withScreenshotState(task, state));
    task = await this.repository.findById(ingestionId);
    if (!task) throw new NotFoundError(`Screenshot ${ingestionId} not found after OCR start`);
    state = extractScreenshotState(task);

    // 调用 OCR 引擎
    const engine = this.options.ocrEngine;
    if (!engine) {
      throw new Error('OCR engine not configured');
    }
    const ocrResult = await engine.extract(imageBuffer);
    state.ocr_evidence = ocrResult;
    state.ocr_task_id = `ocr_${randomUUID().replace(/-/g, '')}`;
    state.screenshot_status = 'ocr_completed';
    await this.repository.save(withScreenshotState(task, state));
    task = await this.repository.findById(ingestionId);
    if (!task) throw new NotFoundError(`Screenshot ${ingestionId} not found after OCR completion`);
    state = extractScreenshotState(task);

    // Workstream D/E: 审计 — OCR 完成。
    await this.auditRecord(ingestionId, 'ocr_completed', 'ocr_completed', {
      ocr_task_id: state.ocr_task_id,
      engine: ocrResult.engine,
      ocr_version: ocrResult.ocr_version,
      confidence: ocrResult.confidence,
      text_blocks_count: ocrResult.text_blocks.length,
    });

    // 构建 Candidate V1
    const candidate = buildCandidateV1FromOcr(
      ingestionId,
      task.source_record_id,
      ocrResult,
      imageHash
    );
    state.candidate_v1 = candidate;

    // 初始化字段权威等级（所有 AI 提取的字段为 CANDIDATE）
    state.field_authority = {};
    for (const key of Object.keys(candidate.normalized_fields)) {
      state.field_authority[key] = 'CANDIDATE';
    }

    state.screenshot_status = 'candidate_drafted';
    await this.repository.save(withScreenshotState(task, state));
  }

  // ==========================================================================
  // 2. GET /v1/screenshots/:id — 查询处理状态
  // ==========================================================================

  async getScreenshotStatus(id: string): Promise<GetScreenshotStatusResponse> {
    const task = await this.getTaskOrThrow(id);
    const state = extractScreenshotState(task);

    const response: GetScreenshotStatusResponse = {
      screenshot_id: task.ingestion_id,
      ingestion_id: task.ingestion_id,
      status: state.screenshot_status,
      created_at: task.created_at,
      updated_at: task.updated_at,
    };

    if (state.ocr_evidence) {
      response.ocr = {
        status: 'succeeded',
        engine: state.ocr_evidence.engine,
        confidence: state.ocr_evidence.confidence,
        text_blocks_count: state.ocr_evidence.text_blocks.length,
        processed_at: state.ocr_evidence.processed_at,
      };
    }

    if (state.candidate_v1) {
      response.candidate = {
        status: state.field_authority.project_type === 'CONFIRMED' ? 'confirmed' : 'drafted',
        candidate_id: state.candidate_v1.candidate_id,
        quality_score: state.candidate_v1.quality.score,
        quality_status: state.candidate_v1.quality.status,
      };
    }

    if (state.governance_result_v1) {
      response.governance = {
        decision: state.governance_result_v1.decision,
        rule_version: state.governance_result_v1.rule_version,
        review_task_id: state.governance_result_v1.review.review_task_id,
      };
    }

    if (state.write_results) {
      const succeeded = state.write_results.filter((r) => r.status === 'succeeded').length;
      response.write = {
        status: mapScreenshotWriteStatus(state.screenshot_status),
        entity_count: succeeded,
        completed_at: task.updated_at,
        error_code: state.internal_controlled_write?.result?.error_code,
      };
    }

    return response;
  }

  // ==========================================================================
  // 3. GET /v1/screenshots/:id/evidence — 获取 OCR 证据和 Candidate
  // ==========================================================================

  async getScreenshotEvidence(id: string): Promise<GetScreenshotEvidenceResponse> {
    const task = await this.getTaskOrThrow(id);
    const state = extractScreenshotState(task);

    if (!state.ocr_evidence || !state.candidate_v1) {
      throw new ConflictError('OCR evidence and candidate are not yet available');
    }

    return {
      screenshot_id: task.ingestion_id,
      ocr_evidence: {
        engine: state.ocr_evidence.engine,
        ocr_version: state.ocr_evidence.ocr_version,
        text_blocks: state.ocr_evidence.text_blocks.map((b) => ({
          type: b.type,
          text: b.text,
          line: b.line,
          confidence: b.confidence,
          bbox: b.bbox,
        })),
        raw_text: state.ocr_evidence.raw_text,
        confidence: state.ocr_evidence.confidence,
        processed_at: state.ocr_evidence.processed_at,
      },
      candidate_v1: {
        schema_version: state.candidate_v1.schema_version,
        candidate_id: state.candidate_v1.candidate_id,
        ingestion_id: state.candidate_v1.ingestion_id,
        source: {
          system: state.candidate_v1.source.system,
          table: state.candidate_v1.source.table,
          record_id: state.candidate_v1.source.record_id,
          source_type: state.candidate_v1.entity_type,
        },
        entity_type: state.candidate_v1.entity_type,
        raw_evidence: {
          raw_text: state.ocr_evidence.raw_text,
          content_hash: state.candidate_v1.idempotency_key,
        },
        normalized_fields: state.candidate_v1.normalized_fields,
        quality: state.candidate_v1.quality,
        processing: {
          extractor_version: state.ocr_evidence.ocr_version,
          attempt: 1,
          created_at: state.ocr_evidence.processed_at,
        },
        idempotency_key: state.candidate_v1.idempotency_key,
      },
    };
  }

  // ==========================================================================
  // 4. POST /v1/screenshots/:id/corrections — 提交人工修正
  // ==========================================================================

  async submitCorrections(id: string, req: SubmitCorrectionsRequest): Promise<SubmitCorrectionsResponse> {
    await this.assertPilotMutationUnlocked(id);
    const task = await this.getTaskOrThrow(id);
    const state = extractScreenshotState(task);

    if (!state.candidate_v1) {
      throw new ConflictError('Candidate V1 not yet available — wait for OCR to complete');
    }

    // AC-A03: 人工修正标记为 CONFIRMED，不被后续 AI 候选覆盖
    const candidate = state.candidate_v1;
    const updatedFields = { ...candidate.normalized_fields };
    for (const [key, value] of Object.entries(req.corrections)) {
      updatedFields[key] = value;
      state.field_authority[key] = 'CONFIRMED';
    }

    // 更新 candidate 的 normalized_fields
    candidate.normalized_fields = updatedFields;
    state.candidate_v1 = candidate;
    state.corrections_applied = { ...state.corrections_applied, ...req.corrections };
    state.reviewer_id = req.reviewer_id;

    // 重新评估质量状态
    const projectType = updatedFields.project_type as string;
    if (projectType && projectType !== 'unknown') {
      // 人工修正了项目类型 → 移除 PROJECT_TYPE_REQUIRED 问题
      candidate.quality.issues = candidate.quality.issues.filter(
        (i) => i.code !== 'PROJECT_TYPE_REQUIRED'
      );
    }
    if (updatedFields.customer_ref && projectType === 'client') {
      // 人工修正了客户 → 移除 CUSTOMER_REQUIRED 问题
      candidate.quality.issues = candidate.quality.issues.filter(
        (i) => i.code !== 'CUSTOMER_REQUIRED'
      );
    }
    if (candidate.quality.issues.length === 0) {
      candidate.quality.status = 'PASS';
    } else {
      candidate.quality.status = 'NEEDS_REVIEW';
    }

    // 状态迁移到 pending_review（等待确认写入或转复核）
    if (state.screenshot_status === 'candidate_drafted' || state.screenshot_status === 'ocr_completed') {
      state.screenshot_status = 'governance_needs_review';
    }

    await this.repository.save(withScreenshotState(task, state));

    return {
      screenshot_id: task.ingestion_id,
      candidate_v1: {
        schema_version: candidate.schema_version,
        candidate_id: candidate.candidate_id,
        normalized_fields: candidate.normalized_fields,
        quality: candidate.quality,
      },
      field_authority: 'CONFIRMED',
      correction_applied_at: nowIso(),
      reviewer_id: req.reviewer_id,
    };
  }

  // ==========================================================================
  // 5. POST /v1/screenshots/:id/confirm — 确认写入
  // ==========================================================================

  /**
   * Create the server-owned production-pilot preview. Callers cannot supply a
   * full preview object or any confirmation flag.
   */
  async createProductionPilotPreview(
    id: string,
    req: CreateProductionPilotPreviewRequest,
    authenticatedOperator: string,
  ): Promise<ProductionPilotPreview> {
    if (!authenticatedOperator?.trim()) {
      throw new BadRequestError('authenticated operator is required');
    }
    await this.assertPilotMutationUnlocked(id);
    const task = await this.getTaskOrThrow(id);
    const state = extractScreenshotState(task);
    assertTrustedRealOcrEvidence(state, 'Production pilot preview');
    const candidate = state.candidate_v1;
    if (!candidate) throw new ConflictError('Candidate V1 not yet available');
    if (!Number.isInteger(task.task_version)) {
      throw new ConflictError('Production pilot task version is unavailable');
    }
    if (candidate.candidate_id !== req.candidate_v1_id) {
      throw new BadRequestError('candidate_v1_id mismatch');
    }
    if (!this.options.runManifestRepository) {
      throw new ConflictError('Production pilot manifest repository is unavailable');
    }
    if (!this.options.productionPilotRunId?.trim()) {
      throw new ConflictError('Production pilot run id is not server-bound');
    }

    const governance = this.options.governanceClient
      ? await this.options.governanceClient.callPreWriteFull(candidate)
      : state.governance_result_v1 ?? this.buildLocalGovernanceResult(task, state, 'PASS');
    state.governance_result_v1 = governance;
    if (governance.decision !== 'PASS') {
      state.screenshot_status = governance.decision === 'BLOCKED'
        ? 'governance_blocked'
        : 'governance_needs_review';
      await this.repository.save(withScreenshotState(task, state));
      await this.auditRecord(
        task.ingestion_id,
        governance.decision === 'BLOCKED' ? 'governance_rejected' : 'governance_reviewed',
        governance.decision,
        { rule_version: governance.rule_version },
      );
      throw new ConflictError(`Production pilot preview requires governance PASS, got ${governance.decision}`);
    }
    state.screenshot_status = 'governance_passed';
    await this.repository.save(withScreenshotState(task, state));
    await this.auditRecord(task.ingestion_id, 'governance_passed', 'PASS', {
      rule_version: governance.rule_version,
    });

    const targetTables = computeWritePlan(candidate, governance);
    if (targetTables.length === 0) throw new ConflictError('Production pilot target plan is empty');
    const targetTableIds: Partial<Record<'customer' | 'project' | 'model', string>> = {};
    for (const table of targetTables) {
      const tableId = this.tableIdFor(table);
      if (!tableId) throw new ConflictError('Production pilot target table is not configured');
      targetTableIds[table] = tableId;
    }
    const targetTableDigests: Partial<Record<'customer' | 'project' | 'model', string>> = {};
    for (const table of targetTables) targetTableDigests[table] = sha256Hex(targetTableIds[table]!);
    const baseTokenDigest = this.options.feishuWriteContext?.targetBaseToken
      ? sha256Hex(this.options.feishuWriteContext.targetBaseToken)
      : undefined;
    const candidateDigest = digestJson(candidate);
    const governanceDigest = digestJson(governance);
    const authoritativePlanDigest = digestJson({ targetTables, targetTableDigests, baseTokenDigest });
    const createdAt = nowIso();
    const ttlMs = this.options.productionPilotManifestTtlMs ?? 15 * 60 * 1000;
    const expiresAt = new Date(Date.parse(createdAt) + ttlMs).toISOString();
    const previewInput = {
      ingestionId: task.ingestion_id,
      targetTables,
      targetTableDigests,
      baseTokenDigest,
      candidateDigest,
      governanceDigest,
      authoritativePlanDigest,
      pilotRunId: this.options.productionPilotRunId,
      createdAt,
      expiresAt,
    };
    const preview = createServerProductionPilotPreview(previewInput);
    const manifest = await this.options.runManifestRepository.createGenerated({
      previewId: preview.preview_id,
      ingestionId: task.ingestion_id,
      runId: this.options.productionPilotRunId,
      previewDigest: buildServerProductionPilotPreviewDigest(previewInput, preview.preview_id),
      operator: authenticatedOperator,
      createdAt,
      expiresAt,
      candidateDigest,
      governanceDigest,
      authoritativePlanDigest,
      targetTables: [...targetTables],
      targetTableDigests,
      baseTokenDigest,
    });
    await this.auditRecord(task.ingestion_id, 'pilot_preview_generated', 'previewed', {
      preview_id_digest: sha256Hex(manifest.previewId),
      target_aliases: targetTables,
      table_digests: targetTableDigests,
      base_digest: baseTokenDigest,
      planned_record_count: targetTables.length,
    });
    return this.toPublicProductionPilotPreview(manifest);
  }

  async confirmProductionPilotPreview(
    previewId: string,
    authenticatedOperator: string,
    nonce: string,
  ): Promise<ProductionPilotPreview> {
    if (!authenticatedOperator?.trim()) throw new BadRequestError('authenticated operator is required');
    if (!nonce?.trim()) throw new BadRequestError('production pilot nonce is required');
    if (!this.options.runManifestRepository) {
      throw new ConflictError('Production pilot manifest repository is unavailable');
    }
    const manifest = await this.options.runManifestRepository.confirm(
      previewId,
      authenticatedOperator,
      nowIso(),
      nonce,
    );
    try {
      await this.auditRecord(manifest.ingestionId, 'pilot_confirmed', 'confirmed', {
        preview_id_digest: sha256Hex(manifest.previewId),
        confirmation: 'authenticated_operator',
      });
    } catch {
      // A confirmed preview without a durable confirmation audit is not
      // executable. Move it out of the one-shot confirmation state so a
      // failed audit can never be bypassed by calling the execute endpoint.
      await this.options.runManifestRepository.markCompensationRequired(manifest.previewId).catch(() => undefined);
      await this.options.runManifestRepository.completeCompensation(manifest.previewId, true).catch(() => undefined);
      throw new ConflictError('Production pilot confirmation audit could not be persisted');
    }
    return this.toPublicProductionPilotPreview(manifest);
  }

  /**
   * Generate a server-owned internal-controlled preview.  The request only
   * identifies the candidate; governance, table aliases, digests, nonce and
   * expiry are all calculated on the server.
   */
  async createInternalWritePreview(
    id: string,
    req: InternalWritePreviewRequest,
    authenticatedOperator: string,
  ): Promise<InternalWritePreview> {
    const config = this.requireInternalWriteConfig();
    const internal = config.internalControlledWrite!;
    if (!authenticatedOperator?.trim()) throw new BadRequestError('authenticated operator is required');
    const repository = this.options.internalWriteRepository;
    if (!repository) throw new ConflictError('Internal controlled write repository is unavailable');
    const task = await this.getTaskOrThrow(id);
    const state = extractScreenshotState(task);
    assertTrustedRealOcrEvidence(state, 'Internal controlled preview');
    const candidate = state.candidate_v1;
    if (!candidate) throw new ConflictError('Candidate V1 not yet available');
    if (candidate.candidate_id !== req.candidate_v1_id) throw new BadRequestError('candidate_v1_id mismatch');

    const governance = this.options.governanceClient
      ? await this.options.governanceClient.callPreWriteFull(candidate)
      : state.governance_result_v1 ?? this.buildLocalGovernanceResult(task, state, 'PASS');
    state.governance_result_v1 = governance;
    if (governance.decision !== 'PASS') {
      state.screenshot_status = governance.decision === 'BLOCKED'
        ? 'governance_blocked'
        : 'governance_needs_review';
      await this.repository.save(withScreenshotState(task, state));
      throw new ConflictError(`Internal controlled preview requires governance PASS, got ${governance.decision}`);
    }

    const targetTables = computeInternalControlledWritePlan(candidate, governance);
    if (targetTables.length === 0) throw new ConflictError('Internal controlled target plan is empty');
    const targetTableIds: Partial<Record<WriteTable, string>> = {};
    const targetTableDigests: Partial<Record<WriteTable, string>> = {};
    for (const table of targetTables) {
      const tableId = this.tableIdFor(table);
      if (!tableId) throw new ConflictError('Internal controlled target table is not configured');
      targetTableIds[table] = tableId;
      targetTableDigests[table] = sha256Hex(tableId);
    }
    const baseTokenDigest = this.options.feishuWriteContext?.targetBaseToken
      ? sha256Hex(this.options.feishuWriteContext.targetBaseToken)
      : undefined;
    const candidateDigest = digestJson(candidate);
    const governanceDigest = digestJson(governance);
    const authoritativePlanDigest = digestJson({ targetTables, targetTableDigests, baseTokenDigest });
    const createdAt = nowIso();
    const expiresAt = new Date(Date.parse(createdAt) + internal.previewTtlMs).toISOString();
    const preview = await repository.createPreview({
      preview_id: randomUUID(),
      nonce: randomUUID(),
      ingestion_id: task.ingestion_id,
      candidate_id: candidate.candidate_id,
      candidate_digest: candidateDigest,
      governance_digest: governanceDigest,
      authoritative_plan_digest: authoritativePlanDigest,
      operator: authenticatedOperator,
      target_tables: [...targetTables],
      target_table_digests: targetTableDigests,
      base_token_digest: baseTokenDigest,
      created_at: createdAt,
      expires_at: expiresAt,
    });
    state.screenshot_status = 'governance_passed';
    state.internal_controlled_write = {
      preview_id: preview.preview_id,
      status: preview.status,
    };
    await this.repository.save(withScreenshotState(task, state));
    await this.auditRecord(task.ingestion_id, 'internal_preview_generated', 'previewed', {
      preview_id_digest: sha256Hex(preview.preview_id),
      target_aliases: targetTables,
      table_digests: targetTableDigests,
      base_digest: baseTokenDigest,
      planned_record_count: targetTables.length,
    });
    return preview;
  }

  async confirmInternalWritePreview(
    previewId: string,
    req: InternalWriteConfirmationRequest,
    authenticatedOperator: string,
  ): Promise<InternalWritePreview> {
    this.requireInternalWriteConfig();
    if (!authenticatedOperator?.trim()) throw new BadRequestError('authenticated operator is required');
    if (!req.nonce?.trim()) throw new BadRequestError('internal controlled write nonce is required');
    const repository = this.options.internalWriteRepository;
    if (!repository) throw new ConflictError('Internal controlled write repository is unavailable');
    const existing = await repository.findPreview(previewId);
    if (!existing) throw new ConflictError('Internal controlled write preview was not found');
    if (Date.parse(existing.expires_at) <= Date.now()) throw new InternalWritePreviewExpiredError();
    if (existing.candidate_id !== req.candidate_v1_id) throw new BadRequestError('candidate_v1_id mismatch');
    if (existing.operator !== authenticatedOperator) throw new InternalWriteOperatorMismatchError();
    let confirmed: InternalWritePreview;
    try {
      confirmed = await repository.confirm(previewId, authenticatedOperator, req.nonce, nowIso());
    } catch (error) {
      const code = (error as { message?: unknown }).message;
      if (code === 'INTERNAL_WRITE_OPERATOR_MISMATCH') throw new InternalWriteOperatorMismatchError();
      if (code === 'INTERNAL_WRITE_NONCE_MISMATCH') throw new ConflictError('Internal controlled write nonce does not match');
      throw new ConflictError('Internal controlled write preview is not confirmable');
    }
    const task = await this.getTaskOrThrow(confirmed.ingestion_id);
    const state = extractScreenshotState(task);
    state.internal_controlled_write = {
      preview_id: confirmed.preview_id,
      status: confirmed.status,
    };
    await this.repository.save(withScreenshotState(task, state));
    await this.auditRecord(task.ingestion_id, 'internal_confirmed', 'confirmed', {
      preview_id_digest: sha256Hex(confirmed.preview_id),
      confirmation: 'authenticated_operator',
    });
    return confirmed;
  }

  /** Execute only a confirmed server preview.  The returned terminal result is
   * replayable; a result-unknown preview can be reconciled, never blindly
   * retried through this method. */
  async executeInternalControlledWrite(
    previewId: string,
    req: InternalWriteConfirmationRequest,
    authenticatedOperator: string,
  ): Promise<InternalControlledWriteResult> {
    const config = this.requireInternalWriteConfig();
    const internal = config.internalControlledWrite!;
    if (this.internalInFlight.has(previewId)) throw new InternalWriteAlreadyInProgressError();
    this.internalInFlight.add(previewId);
    let underlyingExecutionStarted = false;
    try {
      const repository = this.options.internalWriteRepository;
      if (!repository) throw new ConflictError('Internal controlled write repository is unavailable');
      const preview = await repository.findPreview(previewId);
      if (!preview) throw new ConflictError('Internal controlled write preview was not found');
      if (Date.parse(preview.expires_at) <= Date.now()) throw new InternalWritePreviewExpiredError();
      if (!req.nonce?.trim() || preview.nonce !== req.nonce) {
        throw new ConflictError('Internal controlled write nonce does not match');
      }
      if (preview.candidate_id !== req.candidate_v1_id) throw new BadRequestError('candidate_v1_id mismatch');
      if (preview.operator !== authenticatedOperator) throw new InternalWriteOperatorMismatchError();
      if (preview.status === 'preview_generated') throw new InternalWriteRequiresHumanConfirmationError();
      if (preview.status === 'executing' || preview.status === 'verifying') {
        throw new InternalWriteAlreadyInProgressError();
      }
      if (preview.status === 'result_unknown' || preview.status === 'needs_reconciliation') {
        throw new InternalWriteNeedsReconciliationError();
      }
      if (preview.result && ['succeeded', 'partial', 'failed'].includes(preview.status)) {
        return preview.result;
      }
      if (preview.status !== 'confirmed') throw new ConflictError('Internal controlled write preview is not ready for execution');

      const task = await this.getTaskOrThrow(preview.ingestion_id);
      const state = extractScreenshotState(task);
      assertTrustedRealOcrEvidence(state, 'Internal controlled execute');
      const candidate = state.candidate_v1;
      if (!candidate || candidate.candidate_id !== req.candidate_v1_id) throw new BadRequestError('candidate_v1_id mismatch');
      const governance = state.governance_result_v1;
      if (!governance || governance.decision !== 'PASS') throw new ConflictError('Internal controlled write requires governance PASS');
      if (!this.options.auditLogRepository || !(await this.options.auditLogRepository.hasEventType(task.ingestion_id, 'internal_confirmed'))) {
        throw new InternalWriteGateBlockedError();
      }
      const targetTables = computeInternalControlledWritePlan(candidate, governance);
      const targetTableIds = this.targetTableIds(targetTables);
      const candidateDigest = digestJson(candidate);
      const governanceDigest = digestJson(governance);
      const baseTokenDigest = this.options.feishuWriteContext?.targetBaseToken
        ? sha256Hex(this.options.feishuWriteContext.targetBaseToken)
        : undefined;
      const authoritativePlanDigest = digestJson({
        targetTables,
        targetTableDigests: Object.fromEntries(
          targetTables.map((table) => [table, sha256Hex(targetTableIds[table]!)])
        ),
        baseTokenDigest,
      });
      if (
        preview.authoritative_plan_digest !== authoritativePlanDigest
        || JSON.stringify(preview.target_tables) !== JSON.stringify(targetTables)
      ) {
        throw new InternalWritePlanMismatchError();
      }
      if (preview.candidate_digest !== candidateDigest || preview.governance_digest !== governanceDigest) {
        throw new InternalWritePreviewStaleError();
      }

      const gate = isInternalControlledWriteAllowed(config, {
        ingestionId: task.ingestion_id,
        governanceDecision: governance,
        targetBaseToken: this.options.feishuWriteContext?.targetBaseToken,
        targetTableId: targetTables[0] ? targetTableIds[targetTables[0]] : undefined,
        targetTables,
        targetTableIds,
        candidateId: candidate.candidate_id,
        requestedCandidateId: req.candidate_v1_id,
        candidateDigest,
        governanceDigest,
        authoritativePlanDigest,
        operator: authenticatedOperator,
        humanConfirmed: true,
        dryRun: false,
        preview: {
          status: 'confirmed',
          candidateDigest: preview.candidate_digest,
          governanceDigest: preview.governance_digest,
          authoritativePlanDigest: preview.authoritative_plan_digest,
          operator: preview.operator,
        },
      });
      if (!gate.allowed) throw new InternalWriteGateBlockedError();
      if (!this.options.batchWriter) throw new ConflictError('Internal controlled batch writer is unavailable');
      if (!this.options.batchWriter.preflight) throw new ConflictError('Internal controlled preflight is unavailable');

      const queue = this.options.internalWriteQueue ?? new InternalWriteQueue({ maxConcurrency: 1 });
      const execution = queue.runWithSettlement(
        (executionContext) => this.runInternalControlledWrite(
          preview,
          task,
          state,
          candidate,
          targetTables,
          targetTableIds,
          authenticatedOperator,
          executionContext,
        ),
        this.options.internalWriteTimeoutMs ?? internal.maxExecutionMs,
      );
      underlyingExecutionStarted = true;
      void execution.settlementPromise.then(() => {
        this.internalInFlight.delete(previewId);
      });
      try {
        return await execution.responsePromise;
      } catch (error) {
        if ((error as { message?: unknown }).message === 'INTERNAL_WRITE_TIMEOUT') {
          const settled = await repository.findPreview(previewId);
          if (settled?.result) return settled.result;
          const timeoutTask = await this.getTaskOrThrow(preview.ingestion_id);
          const timeoutState = extractScreenshotState(timeoutTask);
          const timeoutResult: InternalControlledWriteResult = {
            status: 'result_unknown',
            write_results: this.emptyInternalResults(targetTables).map((item) => ({
              ...item,
              status: 'unknown',
              error_code: 'INTERNAL_WRITE_RESULT_UNKNOWN',
            })),
            error_code: 'INTERNAL_WRITE_RESULT_UNKNOWN',
            additional_create_calls: 0,
            completed_at: nowIso(),
          };
          return this.completeInternalResult(
            preview,
            timeoutTask,
            timeoutState,
            timeoutResult,
            await repository.findWriteLogs(preview.preview_id),
            'internal_write_unknown',
          );
        }
        throw error;
      }
    } finally {
      if (!underlyingExecutionStarted) this.internalInFlight.delete(previewId);
    }
  }

  async reconcileInternalControlledWrite(
    previewId: string,
    authenticatedOperator: string,
  ): Promise<InternalControlledWriteResult> {
    const config = this.requireInternalWriteConfig();
    const internal = config.internalControlledWrite!;
    const repository = this.options.internalWriteRepository;
    if (!repository) throw new ConflictError('Internal controlled write repository is unavailable');
    const preview = await repository.findPreview(previewId);
    if (!preview) throw new ConflictError('Internal controlled write preview was not found');
    if (preview.operator !== authenticatedOperator) throw new InternalWriteOperatorMismatchError();
    if (this.internalInFlight.has(previewId)) throw new InternalWriteAlreadyInProgressError();
    if (preview.result && preview.status === 'succeeded') return preview.result;
    if (!['result_unknown', 'needs_reconciliation'].includes(preview.status)) {
      throw new ConflictError('Internal controlled write is not awaiting reconciliation');
    }
    const reconciliationTask = await this.getTaskOrThrow(preview.ingestion_id);
    const reconciliationState = extractScreenshotState(reconciliationTask);
    const normalizedFields = reconciliationState.candidate_v1?.normalized_fields as Record<string, unknown> ?? {};
    if (!internal.reconciliationEnabled) throw new ConflictError('Internal controlled reconciliation is disabled');
    const writer = this.options.batchWriter;
    if (!writer?.findByIngestionId) {
      return this.completeInternalReconciliation(preview, {
        status: 'needs_reconciliation',
        write_results: preview.result?.write_results ?? this.emptyInternalResults(preview.target_tables),
        error_code: 'INTERNAL_WRITE_RECONCILIATION_UNAVAILABLE',
        additional_create_calls: 0,
        reconciliation: 'unavailable',
      }, 'internal_write_failed');
    }
    if (preview.target_tables.some((table) => !internal.markerFields[table])) {
      return this.completeInternalReconciliation(preview, {
        status: 'needs_reconciliation',
        write_results: preview.result?.write_results ?? this.emptyInternalResults(preview.target_tables),
        error_code: 'INTERNAL_WRITE_RECONCILIATION_MARKER_UNAVAILABLE',
        additional_create_calls: 0,
        reconciliation: 'unavailable',
      }, 'internal_write_failed');
    }

    const prior = preview.result?.write_results ?? this.emptyInternalResults(preview.target_tables);
    const results = prior.map((item) => ({ ...item }));
    const matchedRecordIds = new Map<WriteTable, string>();
    let uniqueCount = 0;
    let noneCount = 0;
    let multipleCount = 0;
    for (const table of preview.target_tables) {
      const matches = await writer.findByIngestionId(table, preview.ingestion_id);
      const result = results.find((item) => item.entity_type === table)!;
      if (matches.length === 1) {
        matchedRecordIds.set(table, matches[0]);
        result.business_record_id = matches[0];
        result.created = false;
        uniqueCount += 1;
      } else if (matches.length === 0) {
        result.status = 'unknown';
        noneCount += 1;
      } else {
        result.status = 'unknown';
        result.error_code = 'DUPLICATE_CANDIDATES_FOUND';
        multipleCount += 1;
      }
    }
    if (uniqueCount !== preview.target_tables.length) {
      const errorCode = multipleCount > 0
        ? 'DUPLICATE_CANDIDATES_FOUND'
        : noneCount > 0
          ? 'INTERNAL_WRITE_RECONCILIATION_NOT_FOUND'
          : 'INTERNAL_WRITE_RECONCILIATION_UNAVAILABLE';
      return this.completeInternalReconciliation(preview, {
        status: 'needs_reconciliation',
        write_results: results,
        error_code: errorCode,
        additional_create_calls: 0,
        reconciliation: multipleCount > 0 ? 'multiple' : 'none',
      }, 'internal_write_failed');
    }

    if (!writer.verifyExistingByIngestion) {
      return this.completeInternalReconciliation(preview, {
        status: 'needs_reconciliation',
        write_results: results.map((item) => ({
          ...item,
          status: 'unknown',
          error_code: 'RELATION_VERIFICATION_FAILED',
        })),
        error_code: 'RELATION_VERIFICATION_FAILED',
        additional_create_calls: 0,
        reconciliation: 'unavailable',
      }, 'internal_write_failed');
    }

    const relationContext = {
      customerRecordId: matchedRecordIds.get('customer'),
      modelRecordId: matchedRecordIds.get('model'),
    };
    try {
      for (const table of preview.target_tables) {
        const recordId = matchedRecordIds.get(table)!;
        await writer.verifyExistingByIngestion(table, recordId, {
          ingestionId: preview.ingestion_id,
          normalizedFields,
          targetTables: [...preview.target_tables],
          enforceProjectRelationContext: true,
          relationContext,
        });
      }
    } catch {
      return this.completeInternalReconciliation(preview, {
        status: 'needs_reconciliation',
        write_results: results.map((item) => ({
          ...item,
          status: 'unknown',
          error_code: 'RELATION_VERIFICATION_FAILED',
        })),
        error_code: 'RELATION_VERIFICATION_FAILED',
        additional_create_calls: 0,
        reconciliation: 'unavailable',
      }, 'internal_write_failed');
    }

    for (const table of preview.target_tables) {
      const result = results.find((item) => item.entity_type === table)!;
      const recordId = matchedRecordIds.get(table)!;
      result.business_record_id = recordId;
      result.created = false;
      result.status = 'succeeded';
      result.error_code = undefined;
      await repository.updateWriteLog(preview.preview_id, table, {
        business_record_id: recordId,
        status: 'reconciled',
        resolved_at: nowIso(),
      }).catch(() => undefined);
    }
    return this.completeInternalReconciliation(preview, {
      status: 'succeeded',
      write_results: results,
      additional_create_calls: 0,
      reconciliation: 'unique',
      completed_at: nowIso(),
    }, 'internal_write_reconciled');
  }

  async confirmWrite(
    id: string,
    req: ConfirmWriteRequest,
    authenticatedOperator?: string,
  ): Promise<ConfirmWriteResponse> {
    if (req.production_pilot_preview_id || req.production_pilot_nonce) {
      return this.confirmProductionPilotExecution(id, req, authenticatedOperator);
    }
    await this.assertPilotMutationUnlocked(id);
    const task = await this.getTaskOrThrow(id);
    const state = extractScreenshotState(task);

    if (!state.candidate_v1) {
      throw new ConflictError('Candidate V1 not yet available');
    }

    // 校验 candidate_v1_id 一致性
    if (state.candidate_v1.candidate_id !== req.candidate_v1_id) {
      throw new BadRequestError('candidate_v1_id mismatch');
    }

    // AC-A09: 重复确认幂等 — 已成功写入则返回已有结果
    if (state.screenshot_status === 'write_succeeded' && state.write_results) {
      return {
        screenshot_id: task.ingestion_id,
        ingestion_id: task.ingestion_id,
        status: 'write_succeeded',
        write_results: state.write_results,
        transaction_snapshot_id: state.transaction_snapshot?.snapshot_id,
        completed_at: task.updated_at,
      };
    }

    // 调用 SOP PRE_WRITE 治理
    if (this.options.governanceClient) {
      const governance = await this.options.governanceClient.callPreWriteFull(state.candidate_v1);
      state.governance_result_v1 = governance;

      if (governance.decision === 'BLOCKED') {
        state.screenshot_status = 'governance_blocked';
        await this.repository.save(withScreenshotState(task, state));
        // Workstream D/E: 审计 — 治理拒绝（BLOCKED）。
        await this.auditRecord(task.ingestion_id, 'governance_rejected', 'BLOCKED', {
          rule_version: governance.rule_version,
        });
        return {
          screenshot_id: task.ingestion_id,
          ingestion_id: task.ingestion_id,
          status: 'governance_blocked',
          write_results: [],
          error_code: 'GOVERNANCE_BLOCKED',
        };
      }

      if (governance.decision === 'NEEDS_REVIEW') {
        state.screenshot_status = 'governance_needs_review';
        await this.repository.save(withScreenshotState(task, state));
        // Workstream D/E: 审计 — 治理转复核（NEEDS_REVIEW）。
        await this.auditRecord(task.ingestion_id, 'governance_reviewed', 'NEEDS_REVIEW', {
          review_task_id: governance.review.review_task_id,
        });
        return {
          screenshot_id: task.ingestion_id,
          ingestion_id: task.ingestion_id,
          status: 'governance_needs_review',
          write_results: [],
          error_code: 'NEEDS_REVIEW',
        };
      }

      // PASS → 继续写入
      state.screenshot_status = 'governance_passed';
      await this.repository.save(withScreenshotState(task, state));
      // Workstream D/E: 审计 — 治理通过（PASS）。
      await this.auditRecord(task.ingestion_id, 'governance_passed', 'PASS', {
        rule_version: governance.rule_version,
      });
    } else {
      // 无治理客户端（测试模式）→ 直接通过
      state.screenshot_status = 'governance_passed';
    }

    // RF-01: computeWritePlan 是业务实体范围的唯一权威来源。生产 Pilot
    // 请求可以携带 target_tables 作为客户端声明，但不能用它覆盖 Candidate +
    // Governance 推导出的计划；任何不一致都在进入 writer 前 fail-closed。
    const authoritativeTargetTables = computeWritePlan(
      state.candidate_v1,
      state.governance_result_v1
    );

    // Legacy/test callers may still provide target_tables. Production Pilot
    // never consumes that client-controlled value; it always uses the
    // authoritative plan above.
    const effectiveTargetTables = req.target_tables ?? authoritativeTargetTables;

    // AC-A10: 写入失败不会错误报告 SUCCEEDED
    if (this.options.batchWriter) {
      // Workstream D/E: 审计 — 写入开始。
      await this.auditRecord(task.ingestion_id, 'write_started', 'committing', {
        target_tables: effectiveTargetTables,
      });
      // Workstream C/E: 透传双层放行门所需上下文（governanceDecision +
      // targetBaseToken + 各表 ID）。GuardedBatchWriter 在 Create Record 前校验
      // 6 条件（Amendment 6）；普通写入器/Fake 忽略额外字段。
      const ctx = this.options.feishuWriteContext;
      const batchInput: GuardedWriteBatchInput = {
        ingestionId: task.ingestion_id,
        normalizedFields: state.candidate_v1.normalized_fields as Record<string, unknown>,
        targetTables: effectiveTargetTables,
        dryRun: req.dry_run ?? task.dry_run,
        governanceDecision: { decision: state.governance_result_v1?.decision ?? 'PASS' },
        targetBaseToken: ctx?.targetBaseToken,
        customerTableId: ctx?.customerTableId,
        projectTableId: ctx?.projectTableId,
        modelTableId: ctx?.modelTableId,
      };
      const batchResult = await this.options.batchWriter.writeBatch(batchInput);
      state.write_results = batchResult.write_results;
      // BatchWriterResultView.status 为 string（GuardedBatchWriter 可能返回 'blocked'）。
      // 下方 status !== 'committed' 检查会将 'blocked' 等非 committed 状态路由到
      // write_failed 分支并提前返回；此处的 cast 仅用于诊断快照持久化，安全。
      state.transaction_snapshot = {
        snapshot_id: batchResult.transaction_snapshot_id,
        status: batchResult.status as 'committed' | 'rolled_back' | 'partial',
        records_created: batchResult.records_created,
        records_rolled_back: batchResult.records_rolled_back,
      };

      // 检查是否有失败的写入
      const hasFailure = batchResult.write_results.some((r) => r.status === 'failed');
      if (hasFailure || batchResult.status !== 'committed') {
        state.screenshot_status = 'write_failed';
        await this.repository.save(withScreenshotState(task, state));
        // Workstream D/E: 审计 — 写入失败。包在 try/catch 中：审计失败不得掩盖
        // 写入失败响应（写入失败状态已持久化；审计缺口由运维补救）。
        try {
          await this.auditRecord(task.ingestion_id, 'write_failed', 'failed', {
            error_code: batchResult.error_code ?? 'WRITE_FAILED',
          });
        } catch {
          // 审计失败不掩盖写入失败响应。
        }
        return {
          screenshot_id: task.ingestion_id,
          ingestion_id: task.ingestion_id,
          status: 'write_failed',
          write_results: batchResult.write_results,
          transaction_snapshot_id: batchResult.transaction_snapshot_id,
          error_code: batchResult.error_code ?? 'WRITE_FAILED',
        };
      }

      state.screenshot_status = 'write_succeeded';
    } else {
      // 无 batch writer（测试模式）→ 干运行
      state.write_results = effectiveTargetTables.map((table) => ({
        entity_type: table,
        target_table_id: table,
        business_record_id: null,
        created: false,
        status: 'not_attempted' as const,
      }));
      state.screenshot_status = req.dry_run ? 'write_succeeded' : 'write_succeeded';
    }

    await this.repository.save(withScreenshotState(task, state));

    try {
      // Workstream D/E: 审计 — 写入成功。业务写入已落库，审计失败应 fail-closed。
      await this.auditRecord(task.ingestion_id, 'write_succeeded', 'succeeded', {
        transaction_snapshot_id: state.transaction_snapshot?.snapshot_id,
      });

    } catch {
      throw new Error('AUDIT_PERSIST_FAILED');
    }

    return {
      screenshot_id: task.ingestion_id,
      ingestion_id: task.ingestion_id,
      status: state.screenshot_status,
      write_results: state.write_results,
      transaction_snapshot_id: state.transaction_snapshot?.snapshot_id,
      completed_at: nowIso(),
    };
  }

  // ==========================================================================
  // 6. POST /v1/screenshots/:id/escalate-review — 转人工复核
  // ==========================================================================

  async escalateReview(id: string, req: EscalateReviewRequest): Promise<EscalateReviewResponse> {
    await this.assertPilotMutationUnlocked(id);
    const task = await this.getTaskOrThrow(id);
    const state = extractScreenshotState(task);

    // AC-A09: 重复复核幂等 — 已有复核任务则返回已有
    if (state.review_task) {
      const governance = state.governance_result_v1 ?? this.buildLocalGovernanceResult(task, state, 'NEEDS_REVIEW', req.reason_code, req.reason);
      return {
        screenshot_id: task.ingestion_id,
        governance_result_v1: this.toEscalateGovernanceResult(governance, state.review_task.review_task_id),
        review_task: {
          review_task_id: state.review_task.review_task_id,
          status: state.review_task.status as 'pending_review',
          created_at: state.review_task.created_at,
        },
      };
    }

    // 创建复核任务
    const reviewTaskId = `rt_${randomUUID().replace(/-/g, '')}`;
    const now = nowIso();
    state.review_task = {
      review_task_id: reviewTaskId,
      status: 'pending_review',
      created_at: now,
      reason_code: req.reason_code,
      reason: req.reason,
      suggested_fields: req.suggested_fields,
    };
    state.screenshot_status = 'review_pending';

    // 构建治理结果
    if (!state.governance_result_v1) {
      state.governance_result_v1 = this.buildLocalGovernanceResult(task, state, 'NEEDS_REVIEW', req.reason_code, req.reason);
    }

    await this.repository.save(withScreenshotState(task, state));

    return {
      screenshot_id: task.ingestion_id,
      governance_result_v1: this.toEscalateGovernanceResult(state.governance_result_v1, reviewTaskId),
      review_task: {
        review_task_id: reviewTaskId,
        status: 'pending_review',
        created_at: now,
      },
    };
  }

  // ==========================================================================
  // 7. GET /v1/screenshots/:id/final-result — 获取最终治理和写入结果
  // ==========================================================================

  async getFinalResult(id: string): Promise<GetFinalResultResponse> {
    const task = await this.getTaskOrThrow(id);
    const state = extractScreenshotState(task);

    // 获取写入日志
    let writeLogs: GetFinalResultResponse['write_logs'] = [];
    if (state.internal_controlled_write?.result || state.write_results?.some((result) => result.status === 'unknown')) {
      writeLogs = (state.write_results ?? []).map((r) => ({
        write_log_id: r.write_log_id ?? `wl_${task.ingestion_id}_${r.entity_type}`,
        ingestion_id: task.ingestion_id,
        target_table_id: r.target_table_id,
        business_record_id: r.business_record_id,
        status: r.status,
        error_code: r.error_code ?? state.internal_controlled_write?.result?.error_code,
        created_at: task.updated_at,
      }));
    } else if (this.options.writeLogRepository) {
      const logs = await this.options.writeLogRepository.findByIngestionId(task.ingestion_id);
      writeLogs = logs.map((l) => ({
        write_log_id: l.write_log_id,
        ingestion_id: l.ingestion_id,
        target_table_id: l.target_table_id,
        business_record_id: l.business_record_id ?? null,
        status: l.status === 'succeeded' ? 'succeeded' : l.status === 'failed' ? 'failed' : 'not_attempted',
        error_code: l.error_code,
        created_at: l.created_at,
      }));
    } else if (state.write_results) {
      // 无写入日志仓库时从 write_results 构造
      writeLogs = state.write_results.map((r) => ({
        write_log_id: `wl_${task.ingestion_id}_${r.entity_type}`,
        ingestion_id: task.ingestion_id,
        target_table_id: r.target_table_id,
        business_record_id: r.business_record_id,
        status: r.status === 'succeeded'
          ? 'succeeded'
          : r.status === 'failed'
            ? 'failed'
            : r.status === 'rolled_back'
              ? 'rolled_back'
              : r.status,
        error_code: r.error_code,
        created_at: task.updated_at,
      }));
    }

    const governance = state.governance_result_v1 ?? this.buildLocalGovernanceResult(task, state, 'PASS');

    return {
      screenshot_id: task.ingestion_id,
      ingestion_id: task.ingestion_id,
      final_status: state.screenshot_status,
      error_code: state.internal_controlled_write?.result?.error_code,
      governance_result_v1: {
        schema_version: governance.schema_version,
        candidate_id: governance.candidate_id,
        decision: governance.decision,
        classification: governance.classification,
        rule_version: governance.rule_version,
        violations: governance.violations,
        write: {
          status: mapScreenshotWriteStatus(state.screenshot_status),
          target_table: governance.write.target_table,
          target_record_id: state.write_results?.find((r) => r.status === 'succeeded')?.business_record_id ?? null,
          attempted_at: governance.write.attempted_at,
          error_code: state.internal_controlled_write?.result?.error_code,
        },
        review: {
          status: state.review_task?.status ?? governance.review.status,
          review_task_id: state.review_task?.review_task_id ?? governance.review.review_task_id,
          ai_explanation: governance.review.ai_explanation,
        },
        audit: governance.audit,
      },
      write_logs: writeLogs,
      review_task: state.review_task ? {
        review_task_id: state.review_task.review_task_id,
        status: state.review_task.status,
        created_at: state.review_task.created_at,
        resolved_at: state.review_task.resolved_at,
      } : null,
      transaction_snapshot: state.transaction_snapshot,
      completed_at: [
        'write_succeeded',
        'write_failed',
        'write_result_unknown',
        'write_needs_reconciliation',
        'write_partial',
      ].includes(state.screenshot_status) ? task.updated_at : undefined,
    };
  }

  // ==========================================================================
  // 私有辅助方法
  // ==========================================================================

  /**
   * Reconciles production-pilot manifests after a process restart. In-flight
   * execution states are compensated by the batch writer; a COMMITTING
   * manifest is never compensated because its external records may already be
   * reflected in the task repository. Its persisted commit payload is replayed
   * idempotently until both stores converge.
   */
  async recoverPendingProductionPilotRuns(): Promise<ProductionPilotRecoveryOutcome[]> {
    const manifestRepository = this.options.runManifestRepository;
    const batchWriter = this.options.batchWriter;
    if (!manifestRepository || !batchWriter?.recoverPendingCompensations) {
      throw new ConflictError('Production pilot recovery journal is unavailable');
    }

    const outcomes: ProductionPilotRecoveryOutcome[] = await batchWriter.recoverPendingCompensations();
    const pendingCommits = await manifestRepository.findPendingCommits();
    for (const manifest of pendingCommits) {
      try {
        await this.reconcilePendingPilotCommit(manifest);
        outcomes.push({ previewId: manifest.previewId, status: 'committed' });
      } catch {
        outcomes.push({ previewId: manifest.previewId, status: 'commit_recovery_failed' });
      }
    }
    return outcomes;
  }

  private async reconcilePendingPilotCommit(
    manifest: ProductionPilotRunManifest,
  ): Promise<void> {
    const payload = manifest.commitPayload;
    const auditLogRepository = this.options.auditLogRepository;
    const manifestRepository = this.options.runManifestRepository;
    if (!payload || !auditLogRepository || !manifestRepository) {
      throw new Error('RUN_MANIFEST_COMMIT_PAYLOAD_MISSING');
    }
    const task = await this.repository.findById(manifest.ingestionId);
    if (!task) {
      throw new Error('RUN_MANIFEST_TASK_NOT_FOUND');
    }
    const state = extractScreenshotState(task);
    const candidate = state.candidate_v1;
    const governance = state.governance_result_v1;
    if (!candidate || !governance) {
      throw new Error('RUN_MANIFEST_TASK_BINDING_MISSING');
    }
    if (!Number.isInteger(task.task_version)) {
      throw new Error('RUN_MANIFEST_TASK_VERSION_MISSING');
    }

    // Recovery is allowed to write audit/task state only after every
    // server-owned binding has been revalidated against the current task and
    // current write configuration. A changed candidate, governance result,
    // plan, or task version requires manual reconciliation; it must never be
    // repaired by replaying the old commit payload.
    const currentCandidateDigest = digestJson(candidate);
    const currentGovernanceDigest = digestJson(governance);
    if (
      manifest.candidateDigest !== currentCandidateDigest
      || payload.expected_candidate_digest !== currentCandidateDigest
    ) {
      throw new Error('RUN_MANIFEST_CANDIDATE_BINDING_MISMATCH');
    }
    if (
      governance.decision !== 'PASS'
      || manifest.governanceDigest !== currentGovernanceDigest
      || payload.expected_governance_digest !== currentGovernanceDigest
    ) {
      throw new Error('RUN_MANIFEST_GOVERNANCE_BINDING_MISMATCH');
    }

    const targetTables = computeWritePlan(candidate, governance);
    const targetTableDigests: Partial<Record<'customer' | 'project' | 'model', string>> = {};
    for (const table of targetTables) {
      const tableId = this.tableIdFor(table);
      if (!tableId) throw new Error('RUN_MANIFEST_TARGET_TABLE_UNAVAILABLE');
      targetTableDigests[table] = sha256Hex(tableId);
    }
    const baseTokenDigest = this.options.feishuWriteContext?.targetBaseToken
      ? sha256Hex(this.options.feishuWriteContext.targetBaseToken)
      : undefined;
    const authoritativePlanDigest = digestJson({ targetTables, targetTableDigests, baseTokenDigest });
    if (
      manifest.authoritativePlanDigest !== authoritativePlanDigest
      || payload.expected_authoritative_plan_digest !== authoritativePlanDigest
      || JSON.stringify(manifest.targetTables) !== JSON.stringify(targetTables)
      || JSON.stringify(manifest.targetTableDigests) !== JSON.stringify(targetTableDigests)
      || manifest.baseTokenDigest !== baseTokenDigest
    ) {
      throw new Error('RUN_MANIFEST_AUTHORITATIVE_PLAN_MISMATCH');
    }

    const expectedSnapshot = payload.transactionSnapshot;
    const sameCommittedState = state.screenshot_status === 'write_succeeded'
      && JSON.stringify(state.write_results) === JSON.stringify(payload.writeResults)
      && JSON.stringify(state.transaction_snapshot) === JSON.stringify(expectedSnapshot);
    if (
      state.screenshot_status === 'write_succeeded'
      && (!sameCommittedState || task.task_version !== payload.expected_task_version + 1)
    ) {
      throw new Error('RUN_MANIFEST_TASK_COMMIT_CONFLICT');
    }

    if (!sameCommittedState) {
      if (task.task_version !== payload.expected_task_version) {
        throw new Error('RUN_MANIFEST_TASK_VERSION_CONFLICT');
      }
      for (const event of payload.auditEvents) {
        await this.auditRecord(
          manifest.ingestionId,
          event.eventType,
          event.resultStatus,
          event.details,
        );
      }
      state.write_results = payload.writeResults;
      state.transaction_snapshot = expectedSnapshot;
      state.screenshot_status = 'write_succeeded';
      await this.savePilotTaskWithFence(task, state, {
        expected_task_version: payload.expected_task_version,
        expected_candidate_digest: payload.expected_candidate_digest,
        expected_governance_digest: payload.expected_governance_digest,
      });
    }
    await manifestRepository.completeSuccess(manifest.previewId);
  }

  private async confirmProductionPilotExecution(
    id: string,
    req: ConfirmWriteRequest,
    authenticatedOperator?: string,
  ): Promise<ConfirmWriteResponse> {
    if (!authenticatedOperator?.trim()) {
      throw new BadRequestError('authenticated operator is required');
    }
    if (!req.production_pilot_preview_id || !req.production_pilot_nonce) {
      throw new BadRequestError('production pilot preview_id and nonce are required');
    }
    const task = await this.getTaskOrThrow(id);
    const state = extractScreenshotState(task);
    const candidate = state.candidate_v1;
    if (!candidate) throw new ConflictError('Candidate V1 not yet available');
    const expectedTaskVersion = task.task_version;
    if (typeof expectedTaskVersion !== 'number' || !Number.isInteger(expectedTaskVersion)) {
      throw new ConflictError('Production pilot task version is unavailable');
    }
    if (candidate.candidate_id !== req.candidate_v1_id) {
      throw new BadRequestError('candidate_v1_id mismatch');
    }
    const manifestRepository = this.options.runManifestRepository;
    const batchWriter = this.options.batchWriter;
    if (!manifestRepository || !batchWriter?.preflight || !this.options.auditLogRepository || !this.options.writeLogRepository) {
      throw new ConflictError('Production pilot recovery boundary is unavailable');
    }
    const manifest = await manifestRepository.findByPreviewId(req.production_pilot_preview_id);
    if (!manifest || manifest.ingestionId !== task.ingestion_id) {
      throw new ConflictError('Production pilot manifest is not bound to this screenshot');
    }
    if (manifest.operator !== authenticatedOperator) {
      throw new ConflictError('Production pilot operator does not match the server manifest');
    }
    if (manifest.nonce !== req.production_pilot_nonce) {
      throw new ConflictError('Production pilot nonce does not match the server manifest');
    }
    if (manifest.status === 'succeeded' && state.screenshot_status === 'write_succeeded' && state.write_results) {
      return {
        screenshot_id: task.ingestion_id,
        ingestion_id: task.ingestion_id,
        status: 'write_succeeded',
        write_results: state.write_results,
        transaction_snapshot_id: state.transaction_snapshot?.snapshot_id,
        completed_at: task.updated_at,
      };
    }
    if (manifest.candidateDigest !== digestJson(candidate)) {
      throw new ConflictError('Production pilot candidate binding does not match the server manifest');
    }
    const governance = state.governance_result_v1;
    if (!governance || governance.decision !== 'PASS' || manifest.governanceDigest !== digestJson(governance)) {
      throw new ConflictError('Production pilot governance binding does not match the server manifest');
    }
    const targetTables = computeWritePlan(candidate, governance);
    const targetTableDigests: Partial<Record<'customer' | 'project' | 'model', string>> = {};
    for (const table of targetTables) {
      const tableId = this.tableIdFor(table);
      if (tableId) targetTableDigests[table] = sha256Hex(tableId);
    }
    const baseTokenDigest = this.options.feishuWriteContext?.targetBaseToken
      ? sha256Hex(this.options.feishuWriteContext.targetBaseToken)
      : undefined;
    const authoritativePlanDigest = digestJson({ targetTables, targetTableDigests, baseTokenDigest });
    if (
      manifest.authoritativePlanDigest !== authoritativePlanDigest
      || JSON.stringify(manifest.targetTables) !== JSON.stringify(targetTables)
    ) {
      throw new ConflictError('Production pilot authoritative plan does not match the server manifest');
    }
    if (req.target_tables && JSON.stringify(req.target_tables) !== JSON.stringify(targetTables)) {
      return this.persistPilotBlockedResult(
        task,
        state,
        targetTables,
        'TARGET_PLAN_MISMATCH',
      );
    }

    let consumed;
    try {
      consumed = await manifestRepository.consume(
        manifest.previewId,
        nowIso(),
        authenticatedOperator,
        req.production_pilot_nonce,
      );
    } catch {
      throw new ConflictError('Production pilot preview is not confirmed, expired, or already consumed');
    }
    const pilotAuditContext: Record<string, unknown> = {
      preview_id_digest: sha256Hex(consumed.previewId),
      target_aliases: targetTables,
      table_digests: targetTableDigests,
      base_digest: baseTokenDigest,
      run_id_digest: sha256Hex(consumed.runId),
    };
    const ctx = this.options.feishuWriteContext;
    const batchInput: GuardedWriteBatchInput = {
      ingestionId: task.ingestion_id,
      normalizedFields: candidate.normalized_fields as Record<string, unknown>,
      targetTables,
      dryRun: req.dry_run ?? task.dry_run,
      governanceDecision: { decision: 'PASS' },
      targetBaseToken: ctx?.targetBaseToken,
      customerTableId: ctx?.customerTableId,
      projectTableId: ctx?.projectTableId,
      modelTableId: ctx?.modelTableId,
      pilotRunId: consumed.runId,
      operator: authenticatedOperator,
      candidateDigest: manifest.candidateDigest,
      governanceDigest: manifest.governanceDigest,
      authoritativePlanDigest: manifest.authoritativePlanDigest,
      pilotManifest: consumed,
      enforceProjectRelationContext: true,
      pilotPreviewId: consumed.previewId,
      runManifestRepository: manifestRepository,
      requireDurableWriteLogs: true,
      onCompensationStarted: async (recordCount) => {
        await this.auditRecord(task.ingestion_id, 'pilot_compensation_started', 'started', {
          ...pilotAuditContext,
          record_count: recordCount,
        });
      },
      onCompensationCompleted: async (status, recordCount) => {
        await this.auditRecord(
          task.ingestion_id,
          status === 'completed' ? 'pilot_compensation_completed' : 'pilot_compensation_failed',
          status,
          { ...pilotAuditContext, record_count: recordCount },
        );
      },
    };
    const preflight = await batchWriter.preflight(batchInput);
    if (!preflight.allowed) {
      await manifestRepository.markCompensationRequired(consumed.previewId);
      await manifestRepository.completeCompensation(consumed.previewId, true);
      return this.persistPilotBlockedResult(task, state, targetTables, 'GATE_BLOCKED', {
        expected_task_version: expectedTaskVersion,
        expected_candidate_digest: manifest.candidateDigest!,
        expected_governance_digest: manifest.governanceDigest!,
      });
    }
    await manifestRepository.markExecuting(consumed.previewId);
    await this.auditRecord(task.ingestion_id, 'pilot_write_started', 'committing', pilotAuditContext);

    let batchResult: BatchWriterResultView;
    try {
      batchResult = await batchWriter.writeBatch(batchInput);
    } catch {
      state.screenshot_status = 'write_failed';
      state.write_results = [];
      await this.savePilotTaskWithFence(task, state, {
        expected_task_version: expectedTaskVersion,
        expected_candidate_digest: manifest.candidateDigest!,
        expected_governance_digest: manifest.governanceDigest!,
      });
      await manifestRepository.markCompensationRequired(consumed.previewId).catch(() => undefined);
      return {
        screenshot_id: task.ingestion_id,
        ingestion_id: task.ingestion_id,
        status: 'write_failed',
        write_results: [],
        error_code: 'WRITE_FAILED',
      };
    }
    state.write_results = batchResult.write_results;
    state.transaction_snapshot = {
      snapshot_id: batchResult.transaction_snapshot_id,
      status: batchResult.status as 'committed' | 'rolled_back' | 'partial',
      records_created: batchResult.records_created,
      records_rolled_back: batchResult.records_rolled_back,
    };
    if (
      batchResult.status !== 'committed'
      || batchResult.write_results.some((result) => result.status === 'failed')
    ) {
      state.screenshot_status = 'write_failed';
      await this.savePilotTaskWithFence(task, state, {
        expected_task_version: expectedTaskVersion,
        expected_candidate_digest: manifest.candidateDigest!,
        expected_governance_digest: manifest.governanceDigest!,
      });
      await this.auditRecord(task.ingestion_id, 'pilot_write_failed', 'failed', {
        ...pilotAuditContext,
        error_code: batchResult.error_code ?? 'WRITE_FAILED',
      });
      return {
        screenshot_id: task.ingestion_id,
        ingestion_id: task.ingestion_id,
        status: 'write_failed',
        write_results: batchResult.write_results,
        transaction_snapshot_id: batchResult.transaction_snapshot_id,
        error_code: batchResult.error_code ?? 'WRITE_FAILED',
      };
    }

    await manifestRepository.markVerifying(consumed.previewId);
    try {
      const createdResults = batchResult.write_results.filter(
        (result) => result.status === 'succeeded' && result.created && result.business_record_id,
      );
      const verifiedResults = batchResult.write_results.filter(
        (result) => result.status === 'succeeded' && result.business_record_id,
      );
      const auditEvents: ProductionPilotCommitPayload['auditEvents'] = [];
      if (createdResults.length > 0) {
        auditEvents.push({
          eventType: 'pilot_record_created',
          resultStatus: 'succeeded',
          details: {
            ...pilotAuditContext,
            record_count: createdResults.length,
            record_digests: createdResults.map((result) => sha256Hex(result.business_record_id!)),
          },
        });
      }
      if (batchResult.post_write_verified && verifiedResults.some((result) => result.entity_type === 'project')) {
        auditEvents.push({
          eventType: 'pilot_relation_verified',
          resultStatus: 'verified',
          details: {
            ...pilotAuditContext,
            verified_record_count: verifiedResults.length,
          },
        });
      }
      auditEvents.push({
        eventType: 'pilot_write_completed',
        resultStatus: 'succeeded',
        details: {
          ...pilotAuditContext,
          record_count: verifiedResults.length,
        },
      });
      auditEvents.push({
        eventType: 'write_succeeded',
        resultStatus: 'succeeded',
        details: {
          transaction_snapshot_id: batchResult.transaction_snapshot_id,
        },
      });

      const commitPayload: ProductionPilotCommitPayload = {
        writeResults: batchResult.write_results,
        transactionSnapshot: state.transaction_snapshot!,
        expected_task_version: expectedTaskVersion,
        expected_candidate_digest: manifest.candidateDigest!,
        expected_governance_digest: manifest.governanceDigest!,
        expected_authoritative_plan_digest: manifest.authoritativePlanDigest!,
        auditEvents,
      };
      // COMMITTING is the durable fence between external Feishu success and
      // task/audit persistence. Recovery of this state completes the commit;
      // it must never compensate records that may already be task-visible.
      await manifestRepository.markCommitting(consumed.previewId, commitPayload);
      for (const event of auditEvents) {
        await this.auditRecord(task.ingestion_id, event.eventType, event.resultStatus, event.details);
      }
      state.screenshot_status = 'write_succeeded';
      await this.savePilotTaskWithFence(task, state, {
        expected_task_version: expectedTaskVersion,
        expected_candidate_digest: manifest.candidateDigest!,
        expected_governance_digest: manifest.governanceDigest!,
      });
      await manifestRepository.completeSuccess(consumed.previewId);
    } catch (error) {
      return {
        screenshot_id: task.ingestion_id,
        ingestion_id: task.ingestion_id,
        status: 'write_failed',
        write_results: state.write_results ?? [],
        transaction_snapshot_id: state.transaction_snapshot?.snapshot_id,
        error_code: error instanceof TaskSaveConflictError
          ? 'PILOT_TASK_VERSION_CONFLICT'
          : 'PILOT_AUDIT_PERSIST_FAILED',
      };
    }
    return {
      screenshot_id: task.ingestion_id,
      ingestion_id: task.ingestion_id,
      status: 'write_succeeded',
      write_results: state.write_results ?? [],
      transaction_snapshot_id: state.transaction_snapshot?.snapshot_id,
      completed_at: nowIso(),
    };
  }

  private async persistPilotBlockedResult(
    task: IngestionTask,
    state: ScreenshotState,
    targetTables: Array<'customer' | 'project' | 'model'>,
    errorCode: string,
    fence?: TaskSaveFence,
  ): Promise<ConfirmWriteResponse> {
    const writeResults: WriteResult[] = targetTables.map((table) => ({
      entity_type: table,
      target_table_id: this.tableIdFor(table) ?? table,
      business_record_id: null,
      created: false,
      status: 'not_attempted',
    }));
    state.write_results = writeResults;
    state.screenshot_status = 'write_failed';
    if (fence) {
      await this.savePilotTaskWithFence(task, state, fence);
    } else {
      await this.repository.save(withScreenshotState(task, state));
    }
    await this.auditRecord(task.ingestion_id, 'pilot_write_blocked', 'blocked', {
      reason_code: errorCode,
      target_aliases: targetTables,
    });
    return {
      screenshot_id: task.ingestion_id,
      ingestion_id: task.ingestion_id,
      status: 'write_failed',
      write_results: writeResults,
      error_code: errorCode,
    };
  }

  private getInternalWriteConfig(): FeishuWriteConfig | undefined {
    const configured = this.options.internalWriteConfig;
    if (!configured || !('taskRepository' in configured)) return undefined;
    return configured;
  }

  private requireInternalWriteConfig(): FeishuWriteConfig {
    const configured = this.getInternalWriteConfig();
    if (!configured?.internalControlledWrite?.enabled) {
      throw new InternalWriteDisabledError();
    }
    return configured;
  }

  private targetTableIds(targetTables: readonly WriteTable[]): Partial<Record<WriteTable, string>> {
    const targetTableIds: Partial<Record<WriteTable, string>> = {};
    for (const table of targetTables) {
      const tableId = this.tableIdFor(table);
      if (!tableId) throw new ConflictError('Internal controlled target table is not configured');
      targetTableIds[table] = tableId;
    }
    return targetTableIds;
  }

  private emptyInternalResults(targetTables: readonly WriteTable[]): InternalWriteResultItem[] {
    return targetTables.map((table) => ({
      entity_type: table,
      // Internal result payloads expose aliases only. Raw table IDs remain
      // in the server-side allowlist/digest boundary, never in logs/errors.
      target_table_id: table,
      business_record_id: null,
      created: false,
      status: 'not_attempted',
    }));
  }

  private async runInternalControlledWrite(
    preview: InternalWritePreview,
    task: IngestionTask,
    state: ScreenshotState,
    candidate: CandidateV1,
    targetTables: WriteTable[],
    targetTableIds: Partial<Record<WriteTable, string>>,
    operator: string,
    executionContext: InternalWriteExecutionContext,
  ): Promise<InternalControlledWriteResult> {
    const repository = this.options.internalWriteRepository!;
    const writer = this.options.batchWriter!;
    const startedAt = nowIso();
    await repository.markExecuting(preview.preview_id, startedAt);
    state.internal_controlled_write = {
      preview_id: preview.preview_id,
      status: 'executing',
    };
    await this.repository.save(withScreenshotState(task, state));
    const logs: InternalWriteLog[] = [];
    for (const table of targetTables) {
      logs.push(await repository.appendWriteLog({
        ingestion_id: task.ingestion_id,
        preview_id: preview.preview_id,
        entity_type: table,
        logical_write_key: sha256Hex(`${preview.preview_id}:${task.ingestion_id}:${table}`),
        target_table_id_digest: preview.target_table_digests[table] ?? sha256Hex(targetTableIds[table] ?? ''),
        business_record_id: null,
        request_started_at: startedAt,
        operator,
        status: 'intent',
      }));
    }
    await this.auditRecord(task.ingestion_id, 'internal_write_started', 'committing', {
      preview_id_digest: sha256Hex(preview.preview_id),
      target_aliases: targetTables,
      table_digests: preview.target_table_digests,
    });

    const ctx = this.options.feishuWriteContext;
    const input: GuardedWriteBatchInput = {
      ingestionId: task.ingestion_id,
      normalizedFields: candidate.normalized_fields as Record<string, unknown>,
      targetTables: [...targetTables],
      dryRun: false,
      governanceDecision: { decision: 'PASS' },
      candidateId: candidate.candidate_id,
      requestedCandidateId: candidate.candidate_id,
      operator,
      targetBaseToken: ctx?.targetBaseToken,
      customerTableId: ctx?.customerTableId,
      projectTableId: ctx?.projectTableId,
      modelTableId: ctx?.modelTableId,
      internalControlledWrite: true,
      internalPreviewId: preview.preview_id,
      candidateDigest: preview.candidate_digest,
      governanceDigest: preview.governance_digest,
      authoritativePlanDigest: preview.authoritative_plan_digest,
      humanConfirmed: true,
      internalPreview: preview,
      compensationPolicy: 'manual',
      verifyAfterWrite: true,
      enforceProjectRelationContext: true,
      requireDurableWriteLogs: true,
    };
    const preflight = writer.preflight;
    if (!preflight) throw new ConflictError('Internal controlled preflight is unavailable');
    const preflightResult = await preflight.call(writer, input);
    if (!preflightResult.allowed) {
      const result: InternalControlledWriteResult = {
        status: 'failed',
        write_results: this.emptyInternalResults(targetTables).map((item) => ({
          ...item,
          error_code: 'INTERNAL_WRITE_GATE_BLOCKED',
        })),
        error_code: 'INTERNAL_WRITE_GATE_BLOCKED',
        additional_create_calls: 0,
        completed_at: nowIso(),
      };
      return this.completeInternalResult(preview, task, state, result, logs, 'internal_write_failed');
    }

    let batchResult: BatchWriterResultView;
    try {
      batchResult = await writer.writeBatch(input);
      if (executionContext.isTimedOut()) {
        const result: InternalControlledWriteResult = {
          status: 'result_unknown',
          write_results: batchResult.write_results.map((item) => ({
            entity_type: item.entity_type,
            target_table_id: item.entity_type,
            business_record_id: item.business_record_id,
            created: item.created,
            status: 'unknown',
            error_code: 'INTERNAL_WRITE_RESULT_UNKNOWN',
            write_log_id: item.write_log_id,
          })),
          transaction_snapshot_id: batchResult.transaction_snapshot_id,
          error_code: 'INTERNAL_WRITE_RESULT_UNKNOWN',
          additional_create_calls: 0,
          completed_at: nowIso(),
        };
        return this.completeInternalResult(preview, task, state, result, logs, 'internal_write_unknown');
      }
    } catch (error) {
      if (executionContext.isTimedOut() || this.isUnknownInternalError(error)) {
        const result: InternalControlledWriteResult = {
          status: 'result_unknown',
          write_results: this.emptyInternalResults(targetTables).map((item) => ({
            ...item,
            status: 'unknown',
            error_code: 'INTERNAL_WRITE_RESULT_UNKNOWN',
          })),
          error_code: 'INTERNAL_WRITE_RESULT_UNKNOWN',
          additional_create_calls: 0,
          completed_at: nowIso(),
        };
        return this.completeInternalResult(preview, task, state, result, logs, 'internal_write_unknown');
      }
      const result: InternalControlledWriteResult = {
        status: 'failed',
        write_results: this.emptyInternalResults(targetTables).map((item) => ({
          ...item,
          status: 'failed',
          error_code: 'INTERNAL_WRITE_FAILED',
        })),
        error_code: 'INTERNAL_WRITE_FAILED',
        additional_create_calls: 0,
        completed_at: nowIso(),
      };
      return this.completeInternalResult(preview, task, state, result, logs, 'internal_write_failed');
    }

    const writeResults: InternalWriteResultItem[] = batchResult.write_results.map((item) => ({
      entity_type: item.entity_type,
      target_table_id: item.entity_type,
      business_record_id: item.business_record_id,
      created: item.created,
      status: item.status === 'succeeded' ? 'succeeded' : item.status === 'failed' ? 'failed' : 'not_attempted',
      error_code: item.error_code,
      write_log_id: item.write_log_id,
    }));
    const hasFailure = writeResults.some((item) => item.status === 'failed');
    const isPartial = batchResult.status === 'partial' || hasFailure;
    const result: InternalControlledWriteResult = {
      status: isPartial ? 'partial' : batchResult.status === 'committed' ? 'succeeded' : 'failed',
      write_results: writeResults,
      transaction_snapshot_id: batchResult.transaction_snapshot_id,
      error_code: isPartial ? 'INTERNAL_WRITE_PARTIAL' : batchResult.error_code,
      additional_create_calls: 0,
      completed_at: nowIso(),
    };
    return this.completeInternalResult(
      preview,
      task,
      state,
      result,
      logs,
      result.status === 'succeeded' ? 'internal_write_succeeded' : 'internal_write_partial',
    );
  }

  private isUnknownInternalError(error: unknown): boolean {
    return error instanceof InternalWriteResultUnknownError
      || (error as { code?: unknown }).code === 'INTERNAL_WRITE_RESULT_UNKNOWN'
      || (error as { resultUnknown?: unknown }).resultUnknown === true;
  }

  private async completeInternalResult(
    preview: InternalWritePreview,
    task: IngestionTask,
    state: ScreenshotState,
    result: InternalControlledWriteResult,
    logs: InternalWriteLog[],
    auditType: AuditEventType,
    source: 'execution' | 'reconciliation' = 'execution',
  ): Promise<InternalControlledWriteResult> {
    const repository = this.options.internalWriteRepository!;
    const completed = source === 'reconciliation'
      ? await repository.completeReconciliation(
          preview.preview_id,
          result,
          preview.operator,
          result.completed_at ?? nowIso(),
        )
      : await repository.completeExecution(
          preview.preview_id,
          result,
          preview.operator,
          result.completed_at ?? nowIso(),
        );

    // A late execution callback is allowed to observe a reconciliation
    // success, but it is not allowed to mutate logs, task state, or audit.
    if (!completed.result || completed.status !== completed.result.status) {
      throw new InternalWriteStateTransitionConflictError();
    }
    if (
      completed.status !== result.status
      || JSON.stringify(completed.result) !== JSON.stringify(result)
    ) {
      // The repository rejected this source/status transition (for example,
      // a timeout fired while the operation was still queued).  Do not let a
      // rejected preview transition leak into the task or audit state.
      return completed.result;
    }

    for (const item of result.write_results) {
      const log = logs.find((candidate) => candidate.entity_type === item.entity_type);
      if (!log) continue;
      await repository.updateWriteLog(preview.preview_id, item.entity_type, {
        business_record_id: item.business_record_id,
        status: result.reconciliation === 'unique' && item.status === 'succeeded'
          ? 'reconciled'
          : item.status === 'succeeded'
            ? 'succeeded'
          : result.status === 'result_unknown'
            ? 'unknown'
            : item.status === 'failed' ? 'failed' : 'not_attempted',
        error_code: item.error_code ?? result.error_code,
        resolved_at: result.status === 'succeeded' ? nowIso() : undefined,
        request_completed_at: result.completed_at ?? nowIso(),
      }).catch(() => undefined);
    }
    state.internal_controlled_write = {
      preview_id: preview.preview_id,
      status: result.status,
      result,
      transaction_snapshot_id: result.transaction_snapshot_id,
    };
    state.write_results = result.write_results.map((item) => ({
      entity_type: item.entity_type,
      target_table_id: item.target_table_id,
      business_record_id: item.business_record_id,
      created: item.created,
      status: item.status === 'succeeded'
        ? 'succeeded'
        : item.status === 'failed' ? 'failed'
          : item.status === 'unknown' ? 'unknown' : 'not_attempted',
      error_code: item.error_code,
      write_log_id: item.write_log_id,
    }));
    if (result.status === 'succeeded') {
      state.screenshot_status = 'write_succeeded';
    } else if (result.status === 'result_unknown') {
      state.screenshot_status = 'write_result_unknown';
    } else if (result.status === 'needs_reconciliation') {
      state.screenshot_status = 'write_needs_reconciliation';
    } else if (result.status === 'partial') {
      state.screenshot_status = 'write_partial';
    } else {
      state.screenshot_status = 'write_failed';
    }
    if (result.transaction_snapshot_id) {
      state.transaction_snapshot = {
        snapshot_id: result.transaction_snapshot_id,
        status: result.status === 'succeeded' ? 'committed' : 'partial',
        records_created: result.write_results.filter((item) => item.created).length,
        records_rolled_back: 0,
      };
    }
    await this.repository.save(withScreenshotState(task, state));
    await this.auditRecord(task.ingestion_id, auditType, result.status, {
      preview_id_digest: sha256Hex(preview.preview_id),
      error_code: result.error_code,
      record_count: result.write_results.filter((item) => item.business_record_id).length,
    });
    return result;
  }

  private async completeInternalReconciliation(
    preview: InternalWritePreview,
    result: InternalControlledWriteResult,
    auditType: AuditEventType,
  ): Promise<InternalControlledWriteResult> {
    const task = await this.getTaskOrThrow(preview.ingestion_id);
    const state = extractScreenshotState(task);
    return this.completeInternalResult(
      preview,
      task,
      state,
      result,
      await this.options.internalWriteRepository!.findWriteLogs(preview.preview_id),
      auditType,
      'reconciliation',
    );
  }

  private tableIdFor(table: 'customer' | 'project' | 'model'): string | undefined {
    const context = this.options.feishuWriteContext;
    if (table === 'customer') return context?.customerTableId;
    if (table === 'project') return context?.projectTableId;
    return context?.modelTableId;
  }

  private toPublicProductionPilotPreview(
    manifest: import('../repositories/run-manifest-repository.js').ProductionPilotRunManifest,
  ): ProductionPilotPreview {
    const status = ['generated', 'confirmed', 'consumed', 'succeeded'].includes(manifest.status)
      ? manifest.status as ProductionPilotPreview['status']
      : 'generated';
    return {
      preview_id: manifest.previewId,
      nonce: manifest.nonce,
      generated_at: manifest.createdAt,
      expires_at: manifest.expiresAt,
      write_mode: 'production-pilot',
      status,
      planned_record_count: manifest.targetTables?.length ?? 0,
      target_table_aliases: [...(manifest.targetTables ?? [])],
      target_table_digests: { ...(manifest.targetTableDigests ?? {}) },
      base_token_digest: manifest.baseTokenDigest,
    };
  }

  private async getTaskOrThrow(id: string): Promise<IngestionTask> {
    const task = await this.repository.findById(id);
    if (!task) {
      throw new NotFoundError(`Screenshot ${id} not found`);
    }
    return task;
  }

  /**
   * 构建本地治理结果（当 SOP 不可用时使用）。
   * 应用 BR-01~BR-06 的简化版本。
   */
  private buildLocalGovernanceResult(
    task: IngestionTask,
    state: ScreenshotState,
    decision: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED',
    reasonCode?: string,
    reason?: string
  ): FullGovernanceResult {
    const candidate = state.candidate_v1;
    const now = nowIso();
    const projectType = candidate?.normalized_fields.project_type ?? 'unknown';

    const violations: FullGovernanceResult['violations'] = [];
    if (reasonCode) {
      violations.push({
        code: reasonCode,
        message: reason ?? `Review required: ${reasonCode}`,
        severity: 'warning',
      });
    }

    return {
      schema_version: 'v1',
      candidate_id: candidate?.candidate_id ?? '<unknown>',
      decision,
      classification: {
        entity_type: 'project',
        project_type: projectType,
        confidence: candidate?.quality.score ?? 0,
      },
      rule_version: 'project-rules-1.0',
      violations,
      write: {
        status: 'NOT_ATTEMPTED',
        target_table: 'projects_demo',
        target_record_id: null,
        attempted_at: now,
      },
      review: {
        status: decision === 'NEEDS_REVIEW' ? 'CREATED' : 'NOT_REQUIRED',
        review_task_id: state.review_task?.review_task_id ?? null,
        ai_explanation: {
          available: false,
          reason: 'Local governance (SOP unavailable)',
        },
      },
      audit: {
        audit_id: `audit_${task.ingestion_id}_${Date.now()}`,
        timestamp: now,
        source_record_id: task.source_record_id,
        idempotency_key: task.idempotency_key,
        rule_version: 'project-rules-1.0',
      },
    };
  }

  /**
   * 将治理结果转换为 EscalateReviewResponse 所需的形态。
   */
  private toEscalateGovernanceResult(
    governance: FullGovernanceResult,
    reviewTaskId: string
  ): EscalateReviewResponse['governance_result_v1'] {
    return {
      schema_version: governance.schema_version,
      candidate_id: governance.candidate_id,
      decision: 'NEEDS_REVIEW',
      classification: governance.classification,
      rule_version: governance.rule_version,
      violations: governance.violations,
      write: {
        status: 'NOT_ATTEMPTED',
        target_table: governance.write.target_table,
        target_record_id: null,
      },
      review: {
        status: 'CREATED',
        review_task_id: reviewTaskId,
        ai_explanation: governance.review.ai_explanation,
      },
      audit: governance.audit,
    };
  }
}
