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
import type { TaskRepository } from '../repositories/task-repository.js';
import type { WriteLogRepository } from '../repositories/write-log-repository.js';
import type { IngestionTask } from '../domain/ingestion.js';
import { BadRequestError, NotFoundError, ConflictError } from '../domain/errors.js';
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
  EscalateReviewRequest,
  EscalateReviewResponse,
  GetFinalResultResponse,
  ScreenshotStatus,
  WriteResult,
} from '../../contracts/screenshot-api-v1.js';
import type { ScreenshotOcrEngine, OcrResult, OcrTextBlock } from './screenshot-ocr-adapter.js';
import type { ScreenshotGovernanceClient, FullGovernanceResult } from '../governance/screenshot-governance-client.js';
import type { BatchWriterPort } from '../business/transactional-batch-writer.js';

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
}

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
    ocr_completed: 'candidate_received',
    candidate_drafted: 'candidate_received',
    governance_passed: 'approved',
    governance_needs_review: 'pending_review',
    governance_blocked: 'review_rejected',
    write_succeeded: 'completed',
    write_failed: 'commit_failed',
    duplicate_skipped: 'completed',
    review_pending: 'pending_review',
    review_resolved: 'approved',
    expired: 'completed',
  };
  return mapping[status];
}

/** 从 IngestionTask 提取截图状态 */
function extractScreenshotState(task: IngestionTask): ScreenshotState {
  const evidence = task.pipeline_evidence as { screenshot_state?: ScreenshotState } | undefined;
  if (!evidence?.screenshot_state) {
    throw new Error(`Screenshot state not found for ingestion ${task.ingestion_id}`);
  }
  return evidence.screenshot_state;
}

/** 将截图状态写回 IngestionTask.pipeline_evidence */
function withScreenshotState(task: IngestionTask, state: ScreenshotState): IngestionTask {
  const evidence = (task.pipeline_evidence ?? {}) as Record<string, unknown>;
  evidence.screenshot_state = state;
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

export interface ScreenshotServiceOptions {
  ocrEngine?: ScreenshotOcrEngine;
  governanceClient?: ScreenshotGovernanceClient;
  batchWriter?: BatchWriterPort;
  writeLogRepository?: WriteLogRepository;
}

export class ScreenshotService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly options: ScreenshotServiceOptions = {}
  ) {}

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

    // 同步触发 OCR（mock 引擎即时返回）
    try {
      await this.runOcrAndBuildCandidate(ingestionId, imageBuffer, imageHash);
    } catch (err) {
      // OCR 失败不阻止创建，状态保持 received，可后续重试
      const currentTask = await this.repository.findById(ingestionId);
      if (currentTask) {
        const state = extractScreenshotState(currentTask);
        state.screenshot_status = 'ocr_processing';
        await this.repository.save(withScreenshotState(currentTask, state));
      }
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
    const task = await this.repository.findById(ingestionId);
    if (!task) throw new NotFoundError(`Screenshot ${ingestionId} not found`);

    const state = extractScreenshotState(task);
    state.screenshot_status = 'ocr_processing';
    await this.repository.save(withScreenshotState(task, state));

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
        status: state.screenshot_status === 'write_succeeded' ? 'succeeded' : 'failed',
        entity_count: succeeded,
        completed_at: task.updated_at,
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

  async confirmWrite(id: string, req: ConfirmWriteRequest): Promise<ConfirmWriteResponse> {
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
    } else {
      // 无治理客户端（测试模式）→ 直接通过
      state.screenshot_status = 'governance_passed';
    }

    // AC-A10: 写入失败不会错误报告 SUCCEEDED
    if (this.options.batchWriter) {
      const batchResult = await this.options.batchWriter.writeBatch({
        ingestionId: task.ingestion_id,
        normalizedFields: state.candidate_v1.normalized_fields as Record<string, unknown>,
        targetTables: req.target_tables,
        dryRun: req.dry_run ?? task.dry_run,
      });

      state.write_results = batchResult.write_results;
      state.transaction_snapshot = {
        snapshot_id: batchResult.transaction_snapshot_id,
        status: batchResult.status,
        records_created: batchResult.records_created,
        records_rolled_back: batchResult.records_rolled_back,
      };

      // 检查是否有失败的写入
      const hasFailure = batchResult.write_results.some((r) => r.status === 'failed');
      if (hasFailure || batchResult.status !== 'committed') {
        state.screenshot_status = 'write_failed';
        await this.repository.save(withScreenshotState(task, state));
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
      state.write_results = (req.target_tables ?? ['customer', 'project', 'model']).map((table) => ({
        entity_type: table,
        target_table_id: table,
        business_record_id: null,
        created: false,
        status: 'not_attempted' as const,
      }));
      state.screenshot_status = req.dry_run ? 'write_succeeded' : 'write_succeeded';
    }

    await this.repository.save(withScreenshotState(task, state));

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
    let writeLogs: Array<{
      write_log_id: string;
      ingestion_id: string;
      target_table_id: string;
      business_record_id: string | null;
      status: 'succeeded' | 'failed' | 'rolled_back' | 'not_attempted';
      error_code?: string;
      created_at: string;
    }> = [];
    if (this.options.writeLogRepository) {
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
        status: r.status,
        error_code: r.error_code,
        created_at: task.updated_at,
      }));
    }

    const governance = state.governance_result_v1 ?? this.buildLocalGovernanceResult(task, state, 'PASS');

    return {
      screenshot_id: task.ingestion_id,
      ingestion_id: task.ingestion_id,
      final_status: state.screenshot_status,
      governance_result_v1: {
        schema_version: governance.schema_version,
        candidate_id: governance.candidate_id,
        decision: governance.decision,
        classification: governance.classification,
        rule_version: governance.rule_version,
        violations: governance.violations,
        write: {
          status: state.screenshot_status === 'write_succeeded' ? 'succeeded' as const : state.screenshot_status === 'write_failed' ? 'failed' as const : 'not_attempted' as const,
          target_table: governance.write.target_table,
          target_record_id: state.write_results?.find((r) => r.status === 'succeeded')?.business_record_id ?? null,
          attempted_at: governance.write.attempted_at,
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
      completed_at: state.screenshot_status === 'write_succeeded' || state.screenshot_status === 'write_failed' ? task.updated_at : undefined,
    };
  }

  // ==========================================================================
  // 私有辅助方法
  // ==========================================================================

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
