# Phase 2 数据合同

> **状态**：DESIGN_APPROVED_WITH_REQUIRED_CHANGES  
> **用途**：冻结 CandidateRecord → NormalizedRecord → QualityReport 全链路数据结构与语义  
> **生效范围**：`src/server/cleaning/`、`src/server/services/ingestion-service.ts`、评测 runner

---

## 一、冻结的数据结构

### 1.1 CandidateRecord

由 Dify/LLM 回调传入，作为 Phase 2 清洗验证的输入。

```typescript
export interface CandidateRecord {
  schema_name: string;           // 目标 schema，V1 固定 'customer'
  schema_version: string;        // 映射配置版本，V1 固定 '1.0.0'
  prompt_version: string;        // LLM prompt 版本，仅用于审计
  fields: Record<string, unknown>;       // 原始字段（英文 raw 字段名）
  field_confidence: Record<string, number>; // 字段级置信度，可选
  evidence: Record<string, string>;      // 字段证据文本，可选
}
```

| 字段 | 类型 | 必填 | 来源 | 可为空 | 版本策略 | 脱敏要求 |
|---|---|---|---|---|---|---|
| `schema_name` | `string` | 是 | Dify/LLM 回调 | 否 | V1 固定 `'customer'` | 无需脱敏 |
| `schema_version` | `string` | 是 | Dify/LLM 回调 | 否 | 映射配置版本，V1 固定 `'1.0.0'` | 无需脱敏 |
| `prompt_version` | `string` | 是 | Dify/LLM 回调 | 否 | 仅审计，不参与映射 | 无需脱敏 |
| `fields` | `Record<string, unknown>` | 是 | Dify/LLM 回调 | 可为 `{}` | 与 mapping config 对应 | `phone`、`wechat` 等联系方式在日志/响应中脱敏 |
| `field_confidence` | `Record<string, number>` | 否 | Dify/LLM 回调 | 可缺失 | 可选，缺失时默认为 `{}` | 无需脱敏 |
| `evidence` | `Record<string, string>` | 否 | Dify/LLM 回调 | 可缺失 | 可选，缺失时默认为 `{}` | 原始文本需脱敏 |

### 1.2 ProcessingContext

贯穿一次 Candidate 处理的生命周期上下文，不可变。

```typescript
export interface ProcessingContext {
  ingestion_id: string;          // 关联的任务 ID
  received_at: string;           // 回调接收时间（ISO 8601）
  timezone: string;              // 来源时区，默认 'Asia/Shanghai'
  locale: string;                // 语言区域，默认 'zh-CN'
  schema_name: string;           // 当前处理 schema
  schema_version: string;        // 当前处理 schema 版本
  mapping_version: string;       // 字段映射规则版本
  ruleset_version: string;       // 校验规则集版本
}
```

| 字段 | 类型 | 必填 | 来源 | 可为空 | 版本策略 | 脱敏要求 |
|---|---|---|---|---|---|---|
| `ingestion_id` | `string` | 是 | IngestionTask | 否 | 与任务绑定 | 无需脱敏 |
| `received_at` | `string`（ISO 8601） | 是 | `receiveCandidate` 调用时刻 | 否 | 决定相对日期解析基准 | 无需脱敏 |
| `timezone` | `string` | 是 | `IngestionTask.timezone` 或默认 | 否 | 影响日期解析 | 无需脱敏 |
| `locale` | `string` | 是 | 默认或后续扩展 | 否 | 影响月份/星期中文解析 | 无需脱敏 |
| `schema_name` | `string` | 是 | `CandidateRecord.schema_name` | 否 | V1 固定 `'customer'` | 无需脱敏 |
| `schema_version` | `string` | 是 | `CandidateRecord.schema_version` | 否 | 选择 schema config | 无需脱敏 |
| `mapping_version` | `string` | 是 | 由 `schema_version` 推导 | 否 | 字段映射配置版本 | 无需脱敏 |
| `ruleset_version` | `string` | 是 | 硬编码或配置 | 否 | 校验规则集版本 | 无需脱敏 |

### 1.3 NormalizedRecord

清洗后的中间记录，使用中文业务字段名，作为 ValidationEngine 的输入。

```typescript
export interface NormalizedRecord {
  record: Record<string, unknown>;       // 已清洗字段（中文 fieldName）
  corrections: NormalizationCorrection[];
  warnings: NormalizationWarning[];
  metadata: {
    schema_name: string;
    schema_version: string;
    mapping_version: string;
    cleaned_at: string;
  };
}

export interface NormalizationCorrection {
  field: string;                 // 中文字段名
  original: unknown;             // 原始值（清洗前）
  corrected: unknown;            // 清洗后值
  reason: string;                // 清洗原因，如 'phone_format', 'enum_mapping'
  confidence?: number;           // 映射置信度
}

export interface NormalizationWarning {
  field: string;
  code: string;
  message: string;
}
```

| 字段 | 类型 | 必填 | 来源 | 可为空 | 版本策略 | 脱敏要求 |
|---|---|---|---|---|---|---|
| `record` | `Record<string, unknown>` | 是 | CleaningPipeline | 可为 `{}` | 字段名与 `customer.json` 一致 | 联系方式字段在日志/响应中脱敏 |
| `corrections` | `NormalizationCorrection[]` | 是 | CleaningPipeline | 空数组 `[]` | 保留清洗痕迹 | 原始值如为联系方式需脱敏 |
| `warnings` | `NormalizationWarning[]` | 是 | CleaningPipeline | 空数组 `[]` | 清洗阶段产生的 warning | 无需脱敏 |
| `metadata` | `object` | 是 | CleaningPipeline | 否 | 审计元数据 | 无需脱敏 |

### 1.4 ValidationIssue

校验发现的问题，统一结构，所有 Validator 共用。

```typescript
export interface ValidationIssue {
  field: string;                 // 相关字段名，无字段时用 '_record'
  code: string;                  // 稳定错误码
  message: string;               // 人类可读消息
  severity: 'error' | 'warning'; // 级别
  suggestion?: string;           // 修复建议
}
```

| 字段 | 类型 | 必填 | 来源 | 可为空 | 版本策略 | 脱敏要求 |
|---|---|---|---|---|---|---|
| `field` | `string` | 是 | Validator | 否 | 中文字段名或 `_record` | 无需脱敏 |
| `code` | `string` | 是 | Validator | 否 | issue-codes.ts 冻结 | 无需脱敏 |
| `message` | `string` | 是 | Validator | 否 | 人类可读 | 原始值如为联系方式需脱敏 |
| `severity` | `'error' \| 'warning'` | 是 | Validator | 否 | 不可扩展 | 无需脱敏 |
| `suggestion` | `string` | 否 | Validator | 可缺失 | 修复建议 | 无需脱敏 |

### 1.5 ValidationRun

单次 Validator 执行结果，必须返回 `applicable` 状态。

```typescript
export interface ValidationRun {
  validator: string;             // Validator 名称，如 'RequiredFieldValidator'
  applicable: boolean;           // 当前上下文是否适用
  issues: ValidationIssue[];     // applicable=true 时发现的问题
  duration_ms?: number;          // 执行耗时（可选）
}
```

| 字段 | 类型 | 必填 | 来源 | 可为空 | 版本策略 | 脱敏要求 |
|---|---|---|---|---|---|---|
| `validator` | `string` | 是 | ValidationEngine | 否 | 与 Validator 类名一致 | 无需脱敏 |
| `applicable` | `boolean` | 是 | Validator | 否 | 不适用时不应伪装为通过 | 无需脱敏 |
| `issues` | `ValidationIssue[]` | 是 | Validator | 空数组 `[]` | applicable=false 时必须为空 | 无需脱敏 |
| `duration_ms` | `number` | 否 | Validator | 可缺失 | 性能审计 | 无需脱敏 |

### 1.6 DuplicateCandidate

重复候选检测记录（Phase 2 预留结构，V1 不自动合并）。

```typescript
export interface DuplicateCandidate {
  candidate_id: string;          // 重复候选标识
  reason: string;                // 判定理由
  confidence: number;            // 重复置信度
  action: 'flag' | 'skip' | 'merge'; // V1 固定 'flag'
}
```

| 字段 | 类型 | 必填 | 来源 | 可为空 | 版本策略 | 脱敏要求 |
|---|---|---|---|---|---|---|
| `candidate_id` | `string` | 是 | DuplicateDetector | 否 | 预留 | 无需脱敏 |
| `reason` | `string` | 是 | DuplicateDetector | 否 | 预留 | 无需脱敏 |
| `confidence` | `number` | 是 | DuplicateDetector | 否 | 预留 | 无需脱敏 |
| `action` | `'flag' \| 'skip' \| 'merge'` | 是 | DuplicateDetector | 否 | V1 固定 `'flag'` | 无需脱敏 |

### 1.7 QualityReport

Phase 2 最终输出，决定任务状态与是否允许写入。

```typescript
export interface QualityReport {
  schema_name: string;
  schema_version: string;
  mapping_version: string;
  ruleset_version: string;
  generated_at: string;
  overall_score: number;         // 0-100
  review_required: true;         // V1 固定 true
  write_allowed: false;          // V1 固定 false
  validation_runs: ValidationRun[];
  duplicate_candidates: DuplicateCandidate[];
  summary: {
    total_issues: number;
    error_count: number;
    warning_count: number;
    missing_required_count: number;
    enum_mapping_count: number;
  };
}
```

| 字段 | 类型 | 必填 | 来源 | 可为空 | 版本策略 | 脱敏要求 |
|---|---|---|---|---|---|---|
| `schema_name` | `string` | 是 | ProcessingContext | 否 | V1 固定 `'customer'` | 无需脱敏 |
| `schema_version` | `string` | 是 | ProcessingContext | 否 | 与 schema 配置版本一致 | 无需脱敏 |
| `mapping_version` | `string` | 是 | ProcessingContext | 否 | 与 mapping config 版本一致 | 无需脱敏 |
| `ruleset_version` | `string` | 是 | ProcessingContext | 否 | 与校验规则集版本一致 | 无需脱敏 |
| `generated_at` | `string` | 是 | 生成时刻 | 否 | ISO 8601 | 无需脱敏 |
| `overall_score` | `number` | 是 | QualityReport builder | 否 | 0-100 | 无需脱敏 |
| `review_required` | `true` | 是 | 硬编码 | 否 | V1 固定 `true` | 无需脱敏 |
| `write_allowed` | `false` | 是 | 硬编码 | 否 | V1 固定 `false` | 无需脱敏 |
| `validation_runs` | `ValidationRun[]` | 是 | ValidationEngine | 空数组 `[]` | 五重校验结果 | 无需脱敏 |
| `duplicate_candidates` | `DuplicateCandidate[]` | 是 | DuplicateDetector | 空数组 `[]` | V1 固定为空 | 无需脱敏 |
| `summary` | `object` | 是 | QualityReport builder | 否 | 聚合统计 | 无需脱敏 |

---

## 二、冻结的语义

### 2.1 Null normalization 语义

V1 必须区分以下四种状态，禁止无差别复用 `NullToEmptyCleaner`：

| 状态 | 输入表现 | 清洗后表现 | 说明 |
|---|---|---|---|
| `absent` | `CandidateRecord.fields` 中不存在该 key | `NormalizedRecord.record` 中不存在该 key | 字段完全未提供，必填校验视为缺失 |
| `undefined` | key 存在但值为 `undefined` | 保持 `undefined` 或根据字段策略处理 | 显式未定义，语义同 `absent` |
| `null` | key 存在且值为 `null` | 保持 `null` 或根据字段策略处理 | 显式空值，不可自动转为 `''` |
| `''` | key 存在且值为空字符串 | 保持 `''` | 空字符串是合法值，必填校验视为缺失（若字段必填） |

**规则**：

1. 清洗阶段不得把 `null`/`undefined` 自动替换为空字符串。
2. 默认值填充只在字段 `absent` 或值为 `undefined` 时生效；`null` 与 `''` 不触发默认值填充。
3. 必填校验把 `absent`、`undefined`、`null`、`''` 均视为缺失。

### 2.2 日期解析语义

日期解析必须接收上下文，禁止依赖服务端当前时间：

```typescript
function normalizeDate(
  input: unknown,
  ctx: { received_at: string; timezone: string; locale: string }
): { value: string | null; warnings: NormalizationWarning[] }
```

| 输入类型 | 处理方式 | 示例 |
|---|---|---|
| 已符合 `YYYY-MM-DD` | 直接返回 | `'2025-06-26'` → `'2025-06-26'` |
| 相对日期（今天/明天/昨天/后天） | 基于 `received_at` 计算 | `received_at='2025-06-26'`，`'今天'` → `'2025-06-26'` |
| 相对日期（本周/下周/周末） | 基于 `received_at` 所在周计算 | `'下周三'` → 具体日期 |
| 月-日 | 基于 `received_at` 的年份推断；若日期早于 `received_at` 则加一年 | `'12月25日'` → `'2025-12-25'` 或 `'2026-12-25'` |
| 无法解析 | 保留原值并产生 warning | `'过两天'` → 原值 + warning |
| 上下文缺失 | 保留原值并产生 warning | 不猜测当前时间 |

**规则**：

- 缺失 `received_at`、`timezone`、`locale` 任一上下文时，相对日期只保留原值并产生 `DATE_CONTEXT_MISSING` warning。
- 解析结果必须是 `YYYY-MM-DD` 字符串；datetime 字段取日期部分。

### 2.3 Evidence 语义

| 类型 | 含义 | 使用场景 |
|---|---|---|
| `field_confidence[field]` | 模型对字段值的置信度 | 可选参考，不决定是否写入 |
| `evidence[field]` | 字段原始文本证据 | 用于审核界面展示，需脱敏 |
| `corrections[].confidence` | 自动清洗/映射的置信度 | 低置信度映射产生 warning |
| `corrections[].reason` | 清洗原因 | 审计与可解释性 |

**规则**：

- Evidence 不直接参与校验通过/失败判定，只用于人工审核与评测标记。
- 评测时 `evidence` 字段不纳入字段准确率分母。

### 2.4 Confidence 阈值

| 阈值 | 值 | 用途 |
|---|---|---|
| `ENUM_MAPPING_HIGH` | `0.85` | 高置信度枚举映射，直接应用 |
| `ENUM_MAPPING_LOW` | `0.50` | 低置信度映射，保留原值并 warning |
| `OVERALL_QUALITY_PASS` | `80` | 质量分参考线（V1 仍强制 review） |
| `OVERALL_QUALITY_BLOCK` | `49` | 存在 error 时质量分上限 |

**规则**：

- 枚举映射置信度 < 0.85 时不自动映射；< 0.50 时不提示可能映射。
- 任何 error 存在时，`overall_score ≤ 49`。

### 2.5 error / warning 区分

| 级别 | 定义 | 对 QualityReport 的影响 |
|---|---|---|
| `error` | 数据不符合硬性约束，无法进入人工审核后的自动写入 | `write_allowed=false`（已固定），`overall_score ≤ 49` |
| `warning` | 数据存在可疑但可人工确认的情况，仍可进入审核 | `review_required=true`（已固定），质量分扣减 |

**error 场景**：

- 必填字段缺失（`REQUIRED_MISSING`）
- 类型错误（`TYPE_ERROR`）
- 枚举值不匹配（`ENUM_MISMATCH`）
- 日期不存在或格式非法（`INVALID_DATE`, `FORMAT_ERROR`）
- 手机号格式非法（`PHONE_INVALID`）

**warning 场景**：

- 相对日期上下文缺失（`DATE_CONTEXT_MISSING`）
- 字段长度超过建议值（`LENGTH_WARNING`）
- 低置信度枚举映射（`ENUM_LOW_CONFIDENCE`）
- 状态机校验不适用但发现旧状态（`STATE_NOT_INITIAL`，applicable=false 时不产生）

### 2.6 稳定错误码命名规则

错误码全部使用 `SCREAMING_SNAKE_CASE`，按 `{CATEGORY}_{DETAIL}` 结构命名：

| 前缀 | 类别 |
|---|---|
| `REQUIRED_` | 必填相关 |
| `TYPE_` | 类型相关 |
| `FORMAT_` | 格式相关 |
| `ENUM_` | 枚举相关 |
| `DATE_` | 日期相关 |
| `PHONE_` | 手机号相关 |
| `BUDGET_` | 预算相关 |
| `STATE_` | 状态机相关 |
| `LOGIC_` | 逻辑一致性相关 |
| `SYSTEM_` | 系统/异常相关 |

**规则**：

- 新增 error code 必须经过 issue-codes.ts 注册，禁止在 Validator 中硬编码字符串。
- code 一旦写入 `tests/evaluation/phase2/fixtures.jsonl`，不可再修改（保持评测稳定）。

### 2.7 不适用 Validator 的表示方式

当某个 Validator 在当前上下文中不适用时，必须返回：

```typescript
{
  validator: 'StateTransitionValidator',
  applicable: false,
  issues: [],
  duration_ms: 0
}
```

**规则**：

- `applicable: false` 的 ValidationRun 不计入 `total_issues`。
- 不允许将 `applicable: false` 转换为 `issues: [{ severity: 'warning', ... }]` 来伪装通过。
- 旧 `rules/index.js` 中的 `STATE_NOT_INITIAL` 在 V1 新建记录场景下视为不适用；只有在显式处理状态迁移的场景（Phase 3+）才 applicable。

---

## 三、Zod Runtime Schema 合同

`src/server/domain/cleaning.ts` 必须同时提供 TypeScript 类型与 Zod schema。示例如下：

```typescript
import { z } from 'zod';

export const candidateRecordSchema = z.object({
  schema_name: z.string().min(1),
  schema_version: z.string().min(1),
  prompt_version: z.string().min(1),
  fields: z.record(z.unknown()),
  field_confidence: z.record(z.number().min(0).max(1)).default({}),
  evidence: z.record(z.string()).default({}),
});

export const processingContextSchema = z.object({
  ingestion_id: z.string().min(1),
  received_at: z.string().datetime(),
  timezone: z.string().min(1),
  locale: z.string().min(1),
  schema_name: z.string().min(1),
  schema_version: z.string().min(1),
  mapping_version: z.string().min(1),
  ruleset_version: z.string().min(1),
});

export const validationIssueSchema = z.object({
  field: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(['error', 'warning']),
  suggestion: z.string().optional(),
});

export const validationRunSchema = z.object({
  validator: z.string().min(1),
  applicable: z.boolean(),
  issues: z.array(validationIssueSchema),
  duration_ms: z.number().nonnegative().optional(),
});

export const qualityReportSchema = z.object({
  schema_name: z.string().min(1),
  schema_version: z.string().min(1),
  mapping_version: z.string().min(1),
  ruleset_version: z.string().min(1),
  generated_at: z.string().datetime(),
  overall_score: z.number().min(0).max(100),
  review_required: z.literal(true),
  write_allowed: z.literal(false),
  validation_runs: z.array(validationRunSchema),
  duplicate_candidates: z.array(z.any()),
  summary: z.object({
    total_issues: z.number().int().nonnegative(),
    error_count: z.number().int().nonnegative(),
    warning_count: z.number().int().nonnegative(),
    missing_required_count: z.number().int().nonnegative(),
    enum_mapping_count: z.number().int().nonnegative(),
  }),
});
```

---

## 四、版本策略

| 配置/代码 | 版本字段 | 升级方式 |
|---|---|---|
| `customer.json` schema | `schema_version` | 新增 `src/data-cleaning/schemas/customer-v2.json` 并新增 Adapter |
| 字段 mapping config | `mapping_version` | 新增 `src/server/cleaning/config/customer-mapping-v2.ts` |
| 校验规则集 | `ruleset_version` | 新增 Validator 或修改 issue-codes.ts，版本号递增 |
| QualityReport 结构 | 由 `schema_version` + `mapping_version` + `ruleset_version` 共同决定 | 向后兼容：新增可选字段 |

---

## 五、脱敏要求

| 数据 | 脱敏规则 | 责任层 |
|---|---|---|
| 手机号 | 中间 4 位替换为 `*` | `src/server/security/redaction.ts` |
| 微信 ID | 保留首尾各 2 字符，中间替换为 `*` | `src/server/security/redaction.ts` |
| 原始聊天记录 | 仅展示摘要，完整内容不进入 QualityReport | CleaningPipeline / redaction |
| `QualityReport` 中的 `record` | 经 `redactObject` 处理后再返回 | `src/server/routes/ingestions.ts` |
