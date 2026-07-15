# Phase 2 评测规范

> **状态**：PLANNING_CORRECTION_APPLIED  
> **用途**：明确 Phase 2 评测不是 LLM 抽取评测，而是 CandidateRecord 的确定性映射、清洗和校验评测  
> **范围**：`src/server/cleaning/`、`src/server/services/ingestion-service.ts` 的 Phase 2 新增逻辑

---

## 一、评测目标声明

Phase 2 评测**不测量** LLM 从非结构化文本中抽取字段的准确率。Phase 2 评测测量的是：

1. **字段映射**：`CandidateRecord.fields`（英文 raw 字段）能否正确映射为 `NormalizedRecord.record`（中文业务字段）。
2. **数据清洗**：手机号、日期、预算、枚举等字段是否按规则完成标准化。
3. **业务校验**：必填缺失、类型错误、枚举不匹配、逻辑冲突等是否被正确识别并生成稳定 issue code。
4. **QualityReport 合规性**：`review_required=true`、`write_allowed=false`、版本字段齐全、summary 准确。

所有评测输入直接来自固定 JSONL fixtures，**不调用 Dify/LLM/OCR/ASR/CLIP**。

---

## 二、Fixture JSONL Schema

每条评测数据必须包含以下字段：

```json
{
  "case_id": "string",
  "input": {
    "schema_name": "customer",
    "schema_version": "1.0.0",
    "prompt_version": "1.0.0",
    "fields": { "raw_field": "value" },
    "field_confidence": { "raw_field": 0.95 },
    "evidence": { "raw_field": "原始文本" }
  },
  "context": {
    "received_at": "2025-06-26T10:00:00+08:00",
    "timezone": "Asia/Shanghai",
    "locale": "zh-CN"
  },
  "expected": {
    "normalized_fields": { "客户姓名": "张三", "联系方式": "13800138000" },
    "errors": [
      { "field": "联系方式", "code": "PHONE_INVALID", "severity": "error" }
    ],
    "warnings": [
      { "field": "咨询时间", "code": "DATE_CONTEXT_MISSING", "severity": "warning" }
    ],
    "quality_report": {
      "review_required": true,
      "write_allowed": false
    }
  },
  "tags": ["phone", "date_relative", "enum_mapping"]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `case_id` | `string` | 是 | 全局唯一，如 `phase2_c001` |
| `input` | `CandidateRecord` | 是 | 评测输入，结构与生产回调一致 |
| `context` | `ProcessingContext` 子集 | 是 | 评测运行时的相对日期上下文 |
| `expected.normalized_fields` | `Record<string, unknown>` | 是 | 期望的清洗后中文字段 |
| `expected.errors` | `ValidationIssue[]` | 是 | 期望的 error 列表（可空） |
| `expected.warnings` | `ValidationIssue[]` | 是 | 期望的 warning 列表（可空） |
| `expected.quality_report` | `object` | 是 | 仅断言 `review_required` 与 `write_allowed` |
| `tags` | `string[]` | 是 | 分类标签，用于问题分布统计 |

---

## 三、字段准确率分母

字段准确率只计算 `expected.normalized_fields` 中**显式声明**的字段。

```
field_accuracy = 正确字段数 / expected.normalized_fields 中声明的字段总数
```

- 正确：实际 `normalized_fields[field]` 与 expected 值在比较规则下相等。
- 错误：值不相等、类型不一致、或 expected 声明但实际缺失。
- **Expected 未声明的字段不参与评分**：即使生产代码输出了额外字段，也不加分也不减分。
- 分母固定为 `Object.keys(expected.normalized_fields).length`，避免模型输出更多字段人为拉高准确率。

---

## 四、Required-field Preservation Recall

衡量必填字段在 CandidateRecord 已提供时是否被正确保留到 NormalizedRecord。

```
required_preservation_recall = 正确保留的必填字段数 / expected 中声明的必填字段总数
```

- 仅针对 `customer.json` 中 `required: true` 的字段（排除 `auto_number`、`relation` 等系统字段）。
- 若 expected 未声明某必填字段，则该字段不计入分母。
- 当前 customer schema 必填字段：`客户姓名`、`联系方式`。

---

## 五、Enum Mapping Precision

衡量非标准枚举输入被正确映射到标准枚举值的比例。

```
enum_mapping_precision = 正确映射的枚举字段数 / 实际发生映射的枚举字段总数
```

- 仅统计生产代码实际执行了映射（`corrections[].reason === 'enum_mapping'`）的字段。
- 正确映射：映射后的值在 `customer.json` 对应字段的 `enumValues` 中，且与 expected 一致。
- 错误映射：映射后的值不在 enumValues 中，或与 expected 不一致。
- 非法枚举未被映射而是保留原值并产生 `ENUM_MISMATCH` error 时，不计入 precision 分子或分母。

---

## 六、Validation Detection Recall

衡量期望中应被检测出的 error/warning 是否被实际检出。

```
validation_detection_recall = 正确检出的 issue 数 / expected 中声明的 issue 总数
```

- 正确检出：实际 issue 的 `(field, code, severity)` 三元组与 expected 中某条匹配。
- 多字段问题允许按 `field` 聚合后比较。
- 实际检出但 expected 未声明的 issue **不惩罚**（不计入分母），但会在失败样本报告中列出。

---

## 七、安全约束计数

以下安全约束为硬门槛，任何一条违反即视为该 case **整体失败**，质量分强制为 0：

| 约束 | 违反条件 | 说明 |
|---|---|---|
| 非法枚举直接通过 | 字段值不在 enumValues 中且未产生 `ENUM_MISMATCH` error | 枚举校验必须严格 |
| 缺必填字段直接通过 | 必填字段缺失且未产生 `REQUIRED_MISSING` error | 必填校验必须严格 |
| 相对日期无依据生成精确日期 | 上下文缺失时仍把相对日期解析为绝对日期 | 必须保留原值并 warning |
| 同名客户自动合并 | 出现 `duplicate_candidates[].action === 'merge'` | V1 禁止自动合并 |
| `write_allowed=true` | `QualityReport.write_allowed !== false` | V1 固定 false |

约束计数：

```
safety_constraint_violations = Σ 每条约束是否违反（0 或 1）
```

`overall_score` 计算：

```
if safety_constraint_violations > 0:
  overall_score = 0
else:
  overall_score = 基础分 - error_penalty - warning_penalty
```

---

## 八、字段比较方式

### 8.1 浮点数

- 使用绝对误差 `|actual - expected| ≤ 1e-6`。
- 评测 fixtures 中尽量避免浮点数；预算区间使用字符串枚举值。

### 8.2 数组

- 忽略顺序：`[ 'a', 'b' ]` 与 `[ 'b', 'a' ]` 视为相等。
- 去重后比较元素集合。
- 空数组 `[]` 与 `undefined`/`null` 在字段准确率中视为不等（除非 expected 显式声明为 `[]`）。

### 8.3 日期

- 统一比较 `YYYY-MM-DD` 字符串。
- datetime 字段只比较日期部分。
- 上下文缺失时 actual 为原值，expected 也应为原值。

### 8.4 null

- `null`、`undefined`、`''` 在字段准确率中按值严格区分，除非 expected 显式声明。
- 必填校验统一把这四种状态视为缺失。

---

## 九、Expected 未声明字段

- `expected.normalized_fields` 未声明的字段不参与字段准确率评分。
- `expected.errors` / `expected.warnings` 未声明的 issue 不降低 recall，但会在报告中标记为 `unexpected_issue`。
- `expected.quality_report` 仅检查 `review_required` 和 `write_allowed`；其他字段（如 `overall_score`）可在报告中展示，但不参与 pass/fail 判定。

---

## 十、Warning / Error code 比较方式

- 比较 `field`、`code`、`severity` 三元组。
- `message` 与 `suggestion` 不参与严格匹配，但会在失败样本报告中展示差异供人工复核。
- 同一字段同一 code 出现多次时只计一次。
- error code 必须来自 `src/server/cleaning/validation/issue-codes.ts` 注册列表。

---

## 十一、失败样本报告格式

评测 runner 输出 JSON 报告，结构如下：

```json
{
  "summary": {
    "total_cases": 50,
    "passed_cases": 42,
    "failed_cases": 8,
    "field_accuracy": 0.94,
    "required_preservation_recall": 0.98,
    "enum_mapping_precision": 0.96,
    "validation_detection_recall": 0.89,
    "safety_constraint_violations": 0,
    "overall_score_avg": 76.5
  },
  "distribution": {
    "tags": { "phone": 8, "date_relative": 6, "enum_mapping": 10 }
  },
  "failures": [
    {
      "case_id": "phase2_c003",
      "tags": ["enum_mapping"],
      "field_accuracy": 0.8,
      "missing_expected_errors": [{ "field": "来源渠道", "code": "ENUM_MISMATCH" }],
      "unexpected_issues": [{ "field": "咨询时间", "code": "DATE_CONTEXT_MISSING" }],
      "field_mismatches": [
        { "field": "预算区间", "expected": "3000-5000元", "actual": "5000元以上" }
      ],
      "safety_violations": [],
      "quality_report_snapshot": { "review_required": true, "write_allowed": false }
    }
  ]
}
```

---

## 十二、重复运行确定性要求

### 12.1 确定性输入

- fixtures.jsonl 固定不变。
- 每个 fixture 的 `context.received_at` 固定，避免相对日期解析结果随时间变化。
- `timezone` 与 `locale` 固定为 `'Asia/Shanghai'` / `'zh-CN'`。

### 12.2 确定性代码

- 生产 Pipeline 中的日期解析必须基于 `context.received_at`，不得调用 `new Date()`。
- 枚举映射使用静态 `synonyms.json` 与 mapping config，不得引入随机性或 LLM。
- QualityReport 中的 `generated_at` 允许不同（由实际运行时间决定），但不得影响任何评分指标。

### 12.3 重复运行验收

```bash
npm run test:evaluation:phase2
npm run test:evaluation:phase2
```

两次运行结果必须：

- `summary` 中所有指标完全一致。
- `failures` 列表完全一致（顺序可不同，但 case_id 集合相同）。
- `quality_report_snapshot` 中的 `review_required` / `write_allowed` 全部为 `true` / `false`。

---

## 十三、评测脚本接口

```typescript
// tests/evaluation/phase2/runner.ts
export interface Phase2EvaluationReport {
  summary: Phase2Summary;
  distribution: { tags: Record<string, number> };
  failures: Phase2Failure[];
}

export async function runPhase2Evaluation(
  fixturePath: string,
  options?: { writeReport?: boolean; reportPath?: string }
): Promise<Phase2EvaluationReport>;

export function evaluateSingleCase(
  input: CandidateRecord,
  context: EvaluationContext,
  expected: ExpectedResult
): SingleCaseResult;
```

---

## 十四、Pass/Fail 门槛

门槛分为主门槛与补充门槛。主门槛必须与《Collator 跨窗口实施手册 v1.0》第 11.3 节 Gate C 保持一致，不得低于手册指标；补充门槛用于辅助诊断，不影响主门槛的验收判定。

| 指标 | 类别 | 门槛 | 说明 |
|---|---|---|---|
| 字段准确率 | 主门槛 | ≥ 90% | expected 声明字段 |
| Required-field Preservation Recall | 主门槛 | ≥ 95% | 必填字段保留 |
| Enum Mapping Precision | 主门槛 | ≥ 95% | 实际发生映射的字段（与手册 Gate C 一致） |
| 安全约束违反 | 主门槛 | = 0 | 硬门槛 |
| 固定安全约束 | 主门槛 | 全部通过 | 见第六节 |
| Validation Detection Recall | 补充门槛 | ≥ 85% | expected issue 检出；仅用于诊断，不得用于降低主门槛验收标准 |

任何一项主门槛未达标，Phase 2 验收不通过。补充门槛未达标时在报告中标记为风险项，但不直接阻断主门槛验收。

---

## 十五、固定安全约束清单

评测 runner 必须显式检查并输出以下 5 条约束的通过状态：

1. **非法枚举直接通过 = 0**：不存在 enum 非法且无 `ENUM_MISMATCH` error 的 case。
2. **缺必填字段直接通过 = 0**：不存在必填缺失且无 `REQUIRED_MISSING` error 的 case。
3. **相对日期无依据生成精确日期 = 0**：不存在上下文缺失但相对日期被解析为绝对日期的 case。
4. **同名客户自动合并 = 0**：不存在 `duplicate_candidates[].action === 'merge'` 的 case。
5. **`write_allowed=true` = 0**：不存在 `QualityReport.write_allowed !== false` 的 case。
