/**
 * Candidate V1 合同 — Collator → SOP 标准化数据单元
 * 项目：飞书智能业务数据中台 / collator
 * 章程引用：docs/project_control/PROJECT_CHARTER.md 第 8 节
 * 不变量：见 .trae/knowledge/合同规范.md 第 3 节（10 条）
 * 安全：不得包含 Secret / Token / App Secret / 真实 Base 标识
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// 支持的合同版本
// ---------------------------------------------------------------------------

/**
 * 当前支持的 Candidate schema_version 列表。
 * 未知版本必须 fail closed（不尝试向下兼容）。
 */
export const SUPPORTED_SCHEMA_VERSIONS = ['v1'] as const;

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

export type ContractValidationErrorCode =
  | 'UNKNOWN_SCHEMA_VERSION'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_FIELD_TYPE';

/**
 * Candidate 合同校验错误。
 * 所有 fail-closed 场景统一抛出此错误，附带错误代码以便上层分类处理。
 */
export class ContractValidationError extends Error {
  readonly code: ContractValidationErrorCode;
  readonly field?: string;

  constructor(
    code: ContractValidationErrorCode,
    message: string,
    field?: string,
  ) {
    super(message);
    this.name = 'ContractValidationError';
    this.code = code;
    this.field = field;
  }
}

// ---------------------------------------------------------------------------
// 子 Schema 定义
// ---------------------------------------------------------------------------

/**
 * 来源信息 — 必须可追溯到飞书原始记录。
 * system 为字面量 'feishu_bitable'，确保只接收来自飞书 Bitable 的记录。
 * table / record_id 在公开示例中必须使用脱敏占位符（如 rec_demo_*）。
 */
const SourceSchema = z.object({
  system: z.literal('feishu_bitable'),
  table: z.string().min(1),
  record_id: z.string().min(1),
});

/**
 * 原始证据 — 保留红端文本/字段。
 * redacted 必须为 true（fail closed：未脱敏的原始证据不得跨模块传递）。
 * 其他字段允许 passthrough，因为不同 entity_type 携带的红端字段不同。
 */
const RawEvidenceSchema = z
  .object({
    redacted: z.literal(true),
  })
  .passthrough();

/**
 * Project 实体的归一化字段。
 * project_type 枚举：client / creative / unknown。
 * customer_ref / model_ref 允许 null（具体业务规则由 SOP 判定，Collator 不在此层强制）。
 * shoot_date 可选，允许 null。
 * passthrough 允许扩展字段，为后续 entity_type 留余地。
 */
const ProjectNormalizedFieldsSchema = z
  .object({
    project_type: z.enum(['client', 'creative', 'unknown']),
    customer_ref: z.string().nullable(),
    model_ref: z.string().nullable(),
    shoot_date: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * 质量问题条目 — 透明可解释，便于 SOP 决策。
 */
const QualityIssueSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .passthrough();

/**
 * 质量评分与指标 — 透明可解释。
 * status: PASS / NEEDS_REVIEW / BLOCKED。
 * score: 0-1 之间的数字。
 */
const QualitySchema = z.object({
  status: z.enum(['PASS', 'NEEDS_REVIEW', 'BLOCKED']),
  issues: z.array(QualityIssueSchema),
  score: z.number().min(0).max(1),
});

/**
 * 处理过程元数据 — 可审计。
 * processed_at 必须为 ISO 8601 字符串。
 * passthrough 允许未来扩展（如 clip_version 等）。
 */
const ProcessingSchema = z
  .object({
    ocr_version: z.string().min(1),
    asr_version: z.string().min(1),
    processed_at: z.string().min(1),
    agent_version: z.string().min(1),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Candidate V1 主 Schema
// ---------------------------------------------------------------------------

/**
 * Candidate V1 Schema — 10 个必填字段，对应 10 条不变量。
 * 任何字段缺失 / 类型错误 / 未知版本都 fail closed。
 */
export const CandidateV1Schema = z.object({
  // 1. schema_version 必填（不变量 1）
  schema_version: z.literal('v1'),
  // 2. candidate_id 全局唯一（不变量 2）
  candidate_id: z.string().min(1),
  // 3. ingestion_id 可追溯（不变量 3）
  ingestion_id: z.string().min(1),
  // 4. source 完整（不变量 4）
  source: SourceSchema,
  // 5. entity_type 为候选（不变量 10），当前仅支持 'project'
  entity_type: z.literal('project'),
  // 6. raw_evidence 不可篡改（不变量 5）
  raw_evidence: RawEvidenceSchema,
  // 7. normalized_fields 可重现（不变量 6）
  normalized_fields: ProjectNormalizedFieldsSchema,
  // 8. quality 透明（不变量 7）
  quality: QualitySchema,
  // 9. processing 可审计（不变量 8）
  processing: ProcessingSchema,
  // 10. idempotency_key 唯一（不变量 9），格式 sha256_<hex>
  idempotency_key: z.string().regex(/^sha256_[0-9a-f]+$/),
});

export type CandidateV1 = z.infer<typeof CandidateV1Schema>;

// ---------------------------------------------------------------------------
// 校验入口
// ---------------------------------------------------------------------------

const SUPPORTED_VERSIONS_LIST: readonly string[] = SUPPORTED_SCHEMA_VERSIONS;

/**
 * 校验输入是否为合法的 Candidate V1。
 *
 * Fail-closed 策略：
 * - 未知 schema_version → UNKNOWN_SCHEMA_VERSION
 * - 必填字段缺失 → MISSING_REQUIRED_FIELD
 * - 字段类型/取值错误 → INVALID_FIELD_TYPE
 *
 * 不做业务规则校验（BR-01 ~ BR-06 由 SOP 决策），仅做形态/合同校验。
 */
export function validateCandidateV1(input: unknown): CandidateV1 {
  // Step 1: 优先检查 schema_version（fail closed 未知版本）
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    const version = obj.schema_version;
    if (typeof version === 'string' && !SUPPORTED_VERSIONS_LIST.includes(version)) {
      throw new ContractValidationError(
        'UNKNOWN_SCHEMA_VERSION',
        `Unknown schema_version: ${version}. Supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
        'schema_version',
      );
    }
  }

  // Step 2: zod 解析
  const result = CandidateV1Schema.safeParse(input);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const fieldPath = firstIssue.path.join('.');

    let code: ContractValidationErrorCode;
    if (
      firstIssue.code === 'invalid_type' &&
      (firstIssue as { received?: unknown }).received === 'undefined'
    ) {
      code = 'MISSING_REQUIRED_FIELD';
    } else if (
      firstIssue.code === 'invalid_literal_value' &&
      fieldPath.includes('schema_version')
    ) {
      code = 'UNKNOWN_SCHEMA_VERSION';
    } else {
      code = 'INVALID_FIELD_TYPE';
    }

    throw new ContractValidationError(
      code,
      `${fieldPath}: ${firstIssue.message}`,
      fieldPath,
    );
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// 幂等键工具
// ---------------------------------------------------------------------------

/**
 * 基于内容生成幂等键。
 * 返回 `sha256_` + sha256(content) 的前 16 个十六进制字符。
 * 相同内容必定生成相同 key（确定性）。
 */
export function createIdempotencyKey(content: string): string {
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
  return `sha256_${hash.slice(0, 16)}`;
}
