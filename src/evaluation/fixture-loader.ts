// fixture-loader.ts
// Phase 2F: 评测集加载与结构校验
//
// 职责：
// 1. 从 JSONL 文件读取评测 fixture。
// 2. 逐行解析并做结构性校验（不校验业务值合法性，那是 Pipeline 的事）。
// 3. 保证 case_id 唯一性。
// 4. 失败时抛出 FixtureLoaderError，含行号与可识别的 case_id。
//
// 不调用任何外部网络、数据库或 Dify/LLM。

import fs from 'node:fs';
import path from 'node:path';
import type { EvaluationFixture, FixtureSource } from './types.js';

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

export class FixtureLoaderError extends Error {
  readonly line: number;
  readonly caseId: string | null;

  constructor(message: string, line: number, caseId: string | null = null) {
    const prefix = caseId ? `[${caseId}]` : `[line ${line}]`;
    super(`${prefix} ${message}`);
    this.name = 'FixtureLoaderError';
    this.line = line;
    this.caseId = caseId;
  }
}

// ---------------------------------------------------------------------------
// 结构校验
// ---------------------------------------------------------------------------

const ALLOWED_SOURCES: readonly FixtureSource[] = ['synthetic', 'regression', 'boundary'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

/**
 * 校验单条 fixture 的结构。失败时抛出 FixtureLoaderError。
 * 仅做结构性校验，不验证业务字段值的语义。
 */
function validateFixture(raw: unknown, line: number): EvaluationFixture {
  if (!isObject(raw)) {
    throw new FixtureLoaderError('fixture 必须是 JSON 对象', line);
  }

  // case_id
  const caseIdRaw = raw.case_id;
  if (typeof caseIdRaw !== 'string' || caseIdRaw.length === 0) {
    throw new FixtureLoaderError('case_id 必须是非空字符串', line, null);
  }
  const case_id = caseIdRaw;

  // source
  const source = raw.source;
  if (!ALLOWED_SOURCES.includes(source as FixtureSource)) {
    throw new FixtureLoaderError(
      `source 必须是 ${ALLOWED_SOURCES.join(' | ')} 之一，实际为 ${JSON.stringify(source)}`,
      line,
      case_id
    );
  }

  // scenario_tags
  if (!isStringArray(raw.scenario_tags)) {
    throw new FixtureLoaderError('scenario_tags 必须是字符串数组', line, case_id);
  }

  // candidate
  const candidateRaw = raw.candidate;
  if (!isObject(candidateRaw)) {
    throw new FixtureLoaderError('candidate 必须是对象', line, case_id);
  }
  if (typeof candidateRaw.schemaKey !== 'string' || candidateRaw.schemaKey.length === 0) {
    throw new FixtureLoaderError('candidate.schemaKey 必须是非空字符串', line, case_id);
  }
  if (typeof candidateRaw.recordType !== 'string' || candidateRaw.recordType.length === 0) {
    throw new FixtureLoaderError('candidate.recordType 必须是非空字符串', line, case_id);
  }
  if (!isObject(candidateRaw.data)) {
    throw new FixtureLoaderError('candidate.data 必须是对象', line, case_id);
  }
  // dateContext 可选，但若存在必须有 referenceDate 字符串
  if (candidateRaw.dateContext !== undefined) {
    if (!isObject(candidateRaw.dateContext)) {
      throw new FixtureLoaderError('candidate.dateContext 若提供必须是对象', line, case_id);
    }
    if (typeof candidateRaw.dateContext.referenceDate !== 'string') {
      throw new FixtureLoaderError(
        'candidate.dateContext.referenceDate 必须是字符串 (YYYY-MM-DD)',
        line,
        case_id
      );
    }
  }
  // enumConfidenceThreshold 可选，但若存在必须是数字
  if (
    candidateRaw.enumConfidenceThreshold !== undefined &&
    typeof candidateRaw.enumConfidenceThreshold !== 'number'
  ) {
    throw new FixtureLoaderError(
      'candidate.enumConfidenceThreshold 若提供必须是数字',
      line,
      case_id
    );
  }

  // expected
  const expectedRaw = raw.expected;
  if (!isObject(expectedRaw)) {
    throw new FixtureLoaderError('expected 必须是对象', line, case_id);
  }
  if (!isObject(expectedRaw.normalized_fields)) {
    throw new FixtureLoaderError('expected.normalized_fields 必须是对象', line, case_id);
  }
  if (!isExpectedPipelineErrorArray(expectedRaw.pipeline_errors)) {
    throw new FixtureLoaderError(
      'expected.pipeline_errors 必须是 { stage: string, code: string }[]',
      line,
      case_id
    );
  }
  if (!isExpectedValidationIssueArray(expectedRaw.validation_errors)) {
    throw new FixtureLoaderError(
      'expected.validation_errors 必须是 { field: string, code: string }[]',
      line,
      case_id
    );
  }
  if (!isExpectedValidationIssueArray(expectedRaw.validation_warnings)) {
    throw new FixtureLoaderError(
      'expected.validation_warnings 必须是 { field: string, code: string }[]',
      line,
      case_id
    );
  }
  if (typeof expectedRaw.success !== 'boolean') {
    throw new FixtureLoaderError('expected.success 必须是布尔值', line, case_id);
  }

  // scoring
  const scoringRaw = raw.scoring;
  if (!isObject(scoringRaw)) {
    throw new FixtureLoaderError('scoring 必须是对象', line, case_id);
  }
  if (!isStringArray(scoringRaw.evaluated_fields)) {
    throw new FixtureLoaderError('scoring.evaluated_fields 必须是字符串数组', line, case_id);
  }
  if (!isStringArray(scoringRaw.required_fields)) {
    throw new FixtureLoaderError('scoring.required_fields 必须是字符串数组', line, case_id);
  }
  if (!isStringArray(scoringRaw.enum_fields)) {
    throw new FixtureLoaderError('scoring.enum_fields 必须是字符串数组', line, case_id);
  }
  if (typeof scoringRaw.expect_intercepted !== 'boolean') {
    throw new FixtureLoaderError('scoring.expect_intercepted 必须是布尔值', line, case_id);
  }

  return {
    case_id,
    source: source as FixtureSource,
    scenario_tags: raw.scenario_tags as string[],
    candidate: {
      schemaKey: candidateRaw.schemaKey as string,
      recordType: candidateRaw.recordType as string,
      data: candidateRaw.data as Record<string, unknown>,
      ...(candidateRaw.dateContext !== undefined
        ? {
            dateContext: {
              referenceDate: (candidateRaw.dateContext as { referenceDate: string }).referenceDate,
              ...((candidateRaw.dateContext as { timezone?: string }).timezone !== undefined
                ? { timezone: (candidateRaw.dateContext as { timezone?: string }).timezone }
                : {}),
            },
          }
        : {}),
      ...(candidateRaw.enumConfidenceThreshold !== undefined
        ? { enumConfidenceThreshold: candidateRaw.enumConfidenceThreshold as number }
        : {}),
    },
    expected: {
      normalized_fields: expectedRaw.normalized_fields as Record<string, unknown>,
      pipeline_errors: expectedRaw.pipeline_errors as EvaluationFixture['expected']['pipeline_errors'],
      validation_errors: expectedRaw.validation_errors as EvaluationFixture['expected']['validation_errors'],
      validation_warnings: expectedRaw.validation_warnings as EvaluationFixture['expected']['validation_warnings'],
      success: expectedRaw.success as boolean,
    },
    scoring: {
      evaluated_fields: scoringRaw.evaluated_fields as string[],
      required_fields: scoringRaw.required_fields as string[],
      enum_fields: scoringRaw.enum_fields as string[],
      expect_intercepted: scoringRaw.expect_intercepted as boolean,
    },
  };
}

function isExpectedPipelineErrorArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every(item => {
    if (!isObject(item)) return false;
    return typeof item.stage === 'string' && typeof item.code === 'string';
  });
}

function isExpectedValidationIssueArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every(item => {
    if (!isObject(item)) return false;
    return typeof item.field === 'string' && typeof item.code === 'string';
  });
}

// ---------------------------------------------------------------------------
// 加载入口
// ---------------------------------------------------------------------------

export interface LoadFixturesOptions {
  /** 是否允许空文件。默认 false（空文件视为错误）。 */
  allowEmpty?: boolean;
}

export interface LoadFixturesResult {
  fixtures: EvaluationFixture[];
  /** 实际解析的非空行数 */
  lineCount: number;
  /** 文件绝对路径 */
  resolvedPath: string;
}

/**
 * 从 JSONL 文件加载评测 fixture。
 *
 * @param fixturePath JSONL 文件路径（相对路径基于 cwd 解析）
 * @throws FixtureLoaderError 当文件不存在、解析失败、结构不合法或 case_id 重复时
 */
export function loadFixtures(
  fixturePath: string,
  options: LoadFixturesOptions = {}
): LoadFixturesResult {
  const resolvedPath = path.resolve(process.cwd(), fixturePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new FixtureLoaderError(`评测集文件不存在: ${resolvedPath}`, 0);
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new FixtureLoaderError(`评测集路径不是文件: ${resolvedPath}`, 0);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const fixtures: EvaluationFixture[] = [];
  const seenCaseIds = new Set<string>();
  let parsedCount = 0;

  // 行号从 1 开始
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];

    // 跳过空行（含纯空白）
    if (line.trim().length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new FixtureLoaderError(
        `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        lineNo
      );
    }

    const fixture = validateFixture(parsed, lineNo);
    parsedCount++;

    if (seenCaseIds.has(fixture.case_id)) {
      throw new FixtureLoaderError(
        `case_id 重复: ${fixture.case_id}`,
        lineNo,
        fixture.case_id
      );
    }
    seenCaseIds.add(fixture.case_id);
    fixtures.push(fixture);
  }

  if (parsedCount === 0 && !options.allowEmpty) {
    throw new FixtureLoaderError(`评测集文件为空或仅含空行: ${resolvedPath}`, 0);
  }

  return {
    fixtures,
    lineCount: parsedCount,
    resolvedPath,
  };
}

/**
 * 默认评测集路径（项目根目录相对路径）。
 * 调用方通常使用 loadFixtures(DEFAULT_FIXTURE_PATH)。
 */
export const DEFAULT_FIXTURE_PATH = 'tests/fixtures/customer-consultation-50.jsonl';
