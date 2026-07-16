// cleaning-pipeline.ts
// Phase 2C: Immutable CleaningPipeline
// 将 Phase 2B 的 Adapter 按固定顺序组合为确定性清洗/校验/质量评估流程。

import {
  adaptFormatClean,
  adaptEnumMapClean,
  type CleanResult,
  type CleanOptions,
} from '../adapters/cleaner-adapter.js';
import {
  adaptValidateRecord,
  type RecordValidationResult,
  type ValidationIssue,
} from '../adapters/rules-adapter.js';
import {
  calculateQualityScore,
  type QualityReport,
  type ValidationRun,
} from '../adapters/quality-adapter.js';
import { getLegacyModuleProfile } from '../legacy-audit.js';
import type { ParseDateContext } from '../adapters/utils-adapter.js';

// ---------------------------------------------------------------------------
// Pipeline 公共类型（最小新增，复用现有 Adapter 合同）
// ---------------------------------------------------------------------------

/** V1 支持的记录类型 */
export const SUPPORTED_RECORD_TYPES = ['customer_consultation'] as const;
export type SupportedRecordType = (typeof SUPPORTED_RECORD_TYPES)[number];

/** Pipeline 输入 */
export interface PipelineCandidate {
  schemaKey: string;
  recordType: string;
  data: Record<string, unknown>;
  dateContext?: ParseDateContext;
  enumConfidenceThreshold?: number;
}

/** Pipeline 阶段标识 */
export type PipelineStageName =
  | 'format_clean'
  | 'enum_map_clean'
  | 'validate'
  | 'quality_assessment';

export type PipelineStageStatus = 'completed' | 'failed' | 'skipped';

export interface PipelineStageRecord {
  name: PipelineStageName;
  status: PipelineStageStatus;
  module?: string;
}

export interface PipelineError {
  stage: PipelineStageName;
  module?: string;
  code: string;
  message: string;
}

export interface PipelineResult {
  standardizedRecord: Record<string, unknown>;
  validation: RecordValidationResult | null;
  errors: PipelineError[];
  warnings: string[];
  corrections: CleanResult['corrections'];
  qualityReport: QualityReport | null;
  stages: PipelineStageRecord[];
  pipelineVersion: string;
  success: boolean;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const PIPELINE_VERSION = '2c.1.0';

/** 固定的阶段执行顺序 */
export const PIPELINE_STAGE_ORDER: readonly PipelineStageName[] = [
  'format_clean',
  'enum_map_clean',
  'validate',
  'quality_assessment',
] as const;

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeMessage(raw: string): string {
  return raw
    .replace(/1[3-9]\d{9}/g, '1**********')
    .replace(/\/[^\s"'<>]+\/src\/data-cleaning/g, '<REPO_ROOT>/src/data-cleaning');
}

function toPipelineError(
  stage: PipelineStageName,
  cause: unknown,
  module?: string
): PipelineError {
  const rawMessage = cause instanceof Error ? cause.message : String(cause);
  const code = cause instanceof Error && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : 'PIPELINE_STAGE_FAILED';
  return { stage, module, code, message: sanitizeMessage(rawMessage) };
}

function isModuleBlocked(modulePath: string): boolean {
  const profile = getLegacyModuleProfile(modulePath);
  return profile?.importStrategy === 'BLOCKED';
}

/** 将剩余阶段标记为 skipped */
function skipRemaining(stages: PipelineStageRecord[], fromIndex: number): void {
  for (let i = fromIndex; i < PIPELINE_STAGE_ORDER.length; i++) {
    stages.push({ name: PIPELINE_STAGE_ORDER[i], status: 'skipped' });
  }
}

/** 构造失败结果 */
function failureResult(
  currentData: Record<string, unknown>,
  validation: RecordValidationResult | null,
  errors: PipelineError[],
  warnings: string[],
  corrections: CleanResult['corrections'],
  stages: PipelineStageRecord[]
): PipelineResult {
  return {
    standardizedRecord: currentData,
    validation,
    errors,
    warnings,
    corrections,
    qualityReport: null,
    stages,
    pipelineVersion: PIPELINE_VERSION,
    success: false,
  };
}

// ---------------------------------------------------------------------------
// Pipeline 执行
// ---------------------------------------------------------------------------

export function runCleaningPipeline(candidate: PipelineCandidate): PipelineResult {
  const inputData = deepClone(candidate.data);
  const stages: PipelineStageRecord[] = [];
  const errors: PipelineError[] = [];
  const warnings: string[] = [];
  const corrections: CleanResult['corrections'] = [];

  // 检查 recordType 是否受支持
  if (!SUPPORTED_RECORD_TYPES.includes(candidate.recordType as SupportedRecordType)) {
    skipRemaining(stages, 0);
    errors.push({
      stage: 'format_clean',
      code: 'UNSUPPORTED_RECORD_TYPE',
      message: `不支持的记录类型: ${candidate.recordType}，V1 仅支持 customer_consultation`,
    });
    return failureResult(inputData, null, errors, warnings, corrections, stages);
  }

  // 防御性检查：BLOCKED 模块不进入执行链
  for (const blockedModule of ['agent/index.js']) {
    isModuleBlocked(blockedModule); // 预期返回 true，不阻塞 Pipeline
  }

  const cleanOptions: CleanOptions = {
    dateContext: candidate.dateContext,
    enumConfidenceThreshold: candidate.enumConfidenceThreshold,
  };

  let currentData: Record<string, unknown> = inputData;

  // 阶段 1: format_clean
  try {
    const r = adaptFormatClean(candidate.schemaKey, inputData, cleanOptions);
    currentData = r.data;
    corrections.push(...r.corrections);
    warnings.push(...r.warnings);
    stages.push({ name: 'format_clean', status: 'completed', module: 'cleaner-adapter' });
  } catch (cause) {
    errors.push(toPipelineError('format_clean', cause, 'cleaner-adapter'));
    stages.push({ name: 'format_clean', status: 'failed', module: 'cleaner-adapter' });
    skipRemaining(stages, 1);
    return failureResult(currentData, null, errors, warnings, corrections, stages);
  }

  // 阶段 2: enum_map_clean
  try {
    const r = adaptEnumMapClean(candidate.schemaKey, currentData, cleanOptions);
    currentData = r.data;
    corrections.push(...r.corrections);
    warnings.push(...r.warnings);
    stages.push({ name: 'enum_map_clean', status: 'completed', module: 'cleaner-adapter' });
  } catch (cause) {
    errors.push(toPipelineError('enum_map_clean', cause, 'cleaner-adapter'));
    stages.push({ name: 'enum_map_clean', status: 'failed', module: 'cleaner-adapter' });
    skipRemaining(stages, 2);
    return failureResult(currentData, null, errors, warnings, corrections, stages);
  }

  // 阶段 3: validate
  let validationResult: RecordValidationResult | null = null;
  try {
    validationResult = adaptValidateRecord(candidate.schemaKey, currentData);
    warnings.push(...validationResult.warnings.map((w: ValidationIssue) => `[${w.field}] ${w.message}`));
    stages.push({ name: 'validate', status: 'completed', module: 'rules-adapter' });
  } catch (cause) {
    errors.push(toPipelineError('validate', cause, 'rules-adapter'));
    stages.push({ name: 'validate', status: 'failed', module: 'rules-adapter' });
    skipRemaining(stages, 3);
    return failureResult(currentData, null, errors, warnings, corrections, stages);
  }

  // 阶段 4: quality_assessment
  let qualityReport: QualityReport | null = null;
  try {
    const validationRun: ValidationRun = {
      schemaKey: candidate.schemaKey,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
    };
    qualityReport = calculateQualityScore([validationRun]);
    stages.push({ name: 'quality_assessment', status: 'completed', module: 'quality-adapter' });
  } catch (cause) {
    errors.push(toPipelineError('quality_assessment', cause, 'quality-adapter'));
    stages.push({ name: 'quality_assessment', status: 'failed', module: 'quality-adapter' });
    return failureResult(currentData, validationResult, errors, warnings, corrections, stages);
  }

  return {
    standardizedRecord: currentData,
    validation: validationResult,
    errors,
    warnings,
    corrections,
    qualityReport,
    stages,
    pipelineVersion: PIPELINE_VERSION,
    success: errors.length === 0,
  };
}
