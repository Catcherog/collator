// types.ts
// Phase 2F: Gate C-Core 离线评测类型定义
// 仅评测确定性 CleaningPipeline（CandidateRecord → 清洗/校验 → NormalizedRecord），
// 不调用 Dify、LLM、飞书、数据库或任何外部网络。

import type { PipelineCandidate } from '../server/cleaning/pipeline/cleaning-pipeline.js';

// ---------------------------------------------------------------------------
// Fixture 结构
// ---------------------------------------------------------------------------

/** 评测集来源标识 */
export type FixtureSource = 'synthetic' | 'regression' | 'boundary';

/** 单条评测 fixture（JSONL 中的一行） */
export interface EvaluationFixture {
  case_id: string;
  source: FixtureSource;
  scenario_tags: string[];
  /** 输入：直接传入 runCleaningPipeline 的 candidate */
  candidate: PipelineCandidate;
  /** 期望输出 */
  expected: ExpectedResult;
  /** 评分配置：指定哪些字段参与指标计算 */
  scoring: ScoringConfig;
}

/** 期望输出（只比较列出的字段，错误用 code+field/stage 比较，不比较文案） */
export interface ExpectedResult {
  /** 期望的标准化记录字段（只比较列出的 key） */
  normalized_fields: Record<string, unknown>;
  /** 期望的 Pipeline 阶段错误（用 stage+code 比较） */
  pipeline_errors: ExpectedPipelineError[];
  /** 期望的校验错误（用 field+code 比较） */
  validation_errors: ExpectedValidationIssue[];
  /** 期望的校验警告（用 field+code 比较） */
  validation_warnings: ExpectedValidationIssue[];
  /** 期望的 success 状态 */
  success: boolean;
}

export interface ExpectedPipelineError {
  stage: string;
  code: string;
}

export interface ExpectedValidationIssue {
  field: string;
  code: string;
}

/** 评分配置 */
export interface ScoringConfig {
  /** 参与字段准确率计算的字段列表 */
  evaluated_fields: string[];
  /** 标记为必填的字段（参与必填召回率计算） */
  required_fields: string[];
  /** 标记为枚举的字段（参与枚举精确率计算） */
  enum_fields: string[];
  /** 是否期望被 Pipeline 拦截（参与错误拦截率计算） */
  expect_intercepted: boolean;
}

// ---------------------------------------------------------------------------
// 比较结果
// ---------------------------------------------------------------------------

/** 单条 fixture 比较结果 */
export interface CaseComparison {
  case_id: string;
  passed: boolean;
  field_matches: FieldMatch[];
  pipeline_error_match: boolean;
  validation_error_match: boolean;
  validation_warning_match: boolean;
  success_match: boolean;
  interception_match: boolean;
  actual: ActualResultSummary;
  expected: ExpectedResult;
  discrepancies: string[];
}

export interface FieldMatch {
  field: string;
  expected: unknown;
  actual: unknown;
  match: boolean;
}

/** 实际结果摘要（避免泄露完整 PII，但保留比较所需信息） */
export interface ActualResultSummary {
  success: boolean;
  standardizedRecord: Record<string, unknown>;
  pipeline_error_codes: Array<{ stage: string; code: string }>;
  validation_error_codes: Array<{ field: string; code: string }>;
  validation_warning_codes: Array<{ field: string; code: string }>;
  pipeline_version: string;
}

// ---------------------------------------------------------------------------
// 指标
// ---------------------------------------------------------------------------

/** 单项指标值 */
export interface MetricValue {
  name: string;
  numerator: number;
  denominator: number;
  /** 通过率（0-1）或 'NOT_APPLICABLE'（如持久化指标） */
  rate: number | 'NOT_APPLICABLE';
  /** 门槛（0-1） */
  threshold: number;
  passed: boolean;
}

/** 全量指标结果 */
export interface MetricsResult {
  total_cases: number;
  passed_cases: number;
  /** 字段准确率：所有 evaluated_fields 中正确匹配的比例 */
  field_accuracy: MetricValue;
  /** 必填字段召回率：required_fields 中正确填充的比例 */
  required_field_recall: MetricValue;
  /** 枚举映射精确率：enum_fields 中正确映射的比例 */
  enum_precision: MetricValue;
  /** 错误拦截率：期望被拦截的 fixture 中实际拦截的比例 */
  error_interception_rate: MetricValue;
  /** 持久化检查：本阶段不涉及，标记为 NOT_APPLICABLE */
  persistence_check: MetricValue;
}

/** Gate C-Core 门槛 */
export interface GateThresholds {
  field_accuracy: number;          // >= 0.90
  required_field_recall: number;   // >= 0.95
  enum_precision: number;          // >= 0.95
  error_interception_rate: number; // >= 0.95
}

/** 默认门槛（Gate C-Core） */
export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  field_accuracy: 0.90,
  required_field_recall: 0.95,
  enum_precision: 0.95,
  error_interception_rate: 0.95,
};

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

/** 完整评测报告 */
export interface EvaluationReport {
  generated_at: string;
  pipeline_version: string;
  fixture_path: string;
  total_cases: number;
  passed_cases: number;
  gate_result: 'PASS' | 'FAIL';
  metrics: MetricsResult;
  case_comparisons: CaseComparison[];
  thresholds: GateThresholds;
}

// ---------------------------------------------------------------------------
// Runner 退出码
// ---------------------------------------------------------------------------

export const EXIT_CODE = {
  /** Gate 通过 */
  GATE_PASS: 0,
  /** 指标未达标 */
  GATE_FAIL: 1,
  /** Runner/fixture/环境错误 */
  RUNNER_ERROR: 2,
} as const;

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];
