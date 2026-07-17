// customer-candidate-mapper.ts
// TASK-002: 无副作用 Candidate 字段映射
// 将 Dify Candidate 输出的英文键转换为 Pipeline 所需的中文字段。
// 纯函数：不修改输入，返回新对象；相同输入产生深度相等的输出。

export interface CandidateMappingWarning {
  field: string;
  code: 'UNMAPPED_CANDIDATE_FIELD' | 'CANDIDATE_FIELD_CONFLICT';
  message: string;
}

export interface CandidateMappingResult {
  mappedFields: Record<string, unknown>;
  warnings: CandidateMappingWarning[];
}

/**
 * Canonical English → Chinese field mapping.
 * Immutable constant: callers MUST NOT mutate.
 */
const CUSTOMER_FIELD_MAP = {
  customer_name: '客户姓名',
  contact: '联系方式',
  source_channel: '来源渠道',
  consultation_time: '咨询时间',
  shooting_type: '拍摄类型',
  budget: '预算区间',
  style_preferences: '意向风格',
  follow_up_notes: '跟进记录',
  review_record: '好评记录',
} as const;

const englishToChinese: ReadonlyMap<string, string> = new Map(
  Object.entries(CUSTOMER_FIELD_MAP)
);
const recognizedChineseFields: ReadonlySet<string> = new Set(
  Object.values(CUSTOMER_FIELD_MAP)
);

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Map a Candidate's raw English/Chinese fields into the normalized Chinese
 * schema expected by the CleaningPipeline.
 *
 * Rules (TASK-002 spec):
 * 1. Recognized Chinese fields are copied through unchanged.
 * 2. Recognized English keys are translated to their Chinese equivalents.
 *    If the Chinese field is already present and the values conflict, the
 *    Chinese value wins and a `CANDIDATE_FIELD_CONFLICT` warning is emitted.
 *    If the values are deeply equal, no warning is emitted.
 * 3. Unknown keys are dropped from `mappedFields` and an
 *    `UNMAPPED_CANDIDATE_FIELD` warning is emitted.
 * 4. The input object is never mutated; returned objects are fresh copies.
 */
export function mapCustomerCandidate(
  fields: Readonly<Record<string, unknown>>
): CandidateMappingResult {
  const mappedFields: Record<string, unknown> = {};
  const warnings: CandidateMappingWarning[] = [];

  // Pass 1: copy recognized Chinese fields verbatim (with deep clone so the
  // returned object is independent of the input).
  for (const [key, value] of Object.entries(fields)) {
    if (recognizedChineseFields.has(key)) {
      mappedFields[key] = deepClone(value);
    }
  }

  // Pass 2: process recognized English keys. Chinese value always wins on
  // conflict; equal values are treated as the same field (no warning).
  for (const [englishKey, value] of Object.entries(fields)) {
    if (!englishToChinese.has(englishKey)) continue;
    const chineseKey = englishToChinese.get(englishKey)!;
    const existing = mappedFields[chineseKey];
    if (existing !== undefined) {
      const sameValue = JSON.stringify(existing) === JSON.stringify(value);
      if (!sameValue) {
        warnings.push({
          field: chineseKey,
          code: 'CANDIDATE_FIELD_CONFLICT',
          message: `中英文字段冲突，已保留中文字段值: ${chineseKey}`,
        });
      }
      continue;
    }
    mappedFields[chineseKey] = deepClone(value);
  }

  // Pass 3: record unknown fields (not recognized Chinese, not recognized English).
  for (const key of Object.keys(fields)) {
    if (recognizedChineseFields.has(key)) continue;
    if (englishToChinese.has(key)) continue;
    warnings.push({
      field: key,
      code: 'UNMAPPED_CANDIDATE_FIELD',
      message: `未识别的 Candidate 字段: ${key}`,
    });
  }

  return { mappedFields, warnings };
}
