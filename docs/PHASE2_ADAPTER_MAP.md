# Phase 2 Legacy Adapter 映射表

> **状态**：AUDIT_COMPLETE / IMPLEMENTATION_COMPLETE（Phase 2B）  
> **用途**：基于实际代码阅读，决定 `src/data-cleaning/**/*.js` 各模块在 `src/server/cleaning/` 中的处理方式  
> **约束**：处理方式只能是 {REUSE, WRAP, EXTRACT_PURE_FUNCTION, MIGRATE_INCREMENTALLY, DEPRECATE_WITH_REASON}  
> **审计结果**：62 个模块中，SAFE(`CREATE_REQUIRE`) 4 个，UNSAFE(`BLOCKED_UNSAFE_IMPORT`) 57 个，BLOCKED 1 个。详见 `reports/phase2/legacy-module-profiles.json` 与 `docs/PHASE2B_ADAPTER_CONTRACTS.md`。

---

## 一、总览表

| 旧模块 | 真实导出函数/类 | 副作用 | 可变输入 | 依赖 | 处理方式 | 新 Adapter | 契约测试 |
|---|---|---|---|---|---|---|---|
| `core/data-cleaner.js` | `DataCleaner`, `CleaningPipeline`, `FormatCleaner`, `EnumMappingCleaner`, `DefaultValueCleaner`, `NullToEmptyCleaner`, `createCleaner` | 构造时默认实例化 `OperationLogger`（触发 `mkdirSync`）；`preprocessMultimodal` 调用 OCR/ASR/CLIP；**导入闭包触发 `schemas/index.js` 与 `config/index.js` 的 import-time 文件读取** | `clean(result, meta)` 修改 `cleanedData` 副本，不修改入参；`DefaultValueCleaner` 修改副本 | `../rules`, `../schemas`, `../config`, `../utils`, `./operation-logger`, `../multimodal/*` | EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY | `src/server/cleaning/adapters/cleaner-adapter.ts` | `tests/unit/cleaning/adapters/cleaner-adapter.test.ts` |
| `core/data-scanner.js` | `DataScanner`, `createDataScanner` | 构造时读 `scan-state.json`；运行时可能写 `scan-state.json` | 不修改输入记录 | `fs`, `../schemas`, `../config`, `../utils` | DEPRECATE_WITH_REASON | — | 无需新测试，旧 `test-scanner.js` 保留 |
| `core/quality-scorer.js` | `QualityScorer`, `createQualityScorer` | 无文件/网络副作用；仅依赖内存计算 | `score()` 不修改输入 | `../rules`, `../schemas` | WRAP | `src/server/cleaning/adapters/quality-adapter.ts` | `tests/unit/cleaning/adapters/quality-adapter.test.ts` |
| `core/operation-logger.js` | `OperationLogger`, `createLogger` | **构造时 `mkdirSync` 创建日志目录**；运行时 `appendFileSync` 写日志 | 不修改业务数据 | `fs`, `path` | WRAP（禁用文件 I/O） | `src/server/cleaning/adapters/noop-logger-adapter.ts` | `tests/unit/cleaning/adapters/noop-logger-adapter.test.ts` |
| `core/rule-learning.js` | `RuleLearner`, `createInstance` | 构造时读/写 `feedback.jsonl` 与 synonyms 版本文件 | `addFeedback` 修改内部 synonyms 缓存 | `fs`, `path`, `../config` | DEPRECATE_WITH_REASON | — | 无需新测试 |
| `core/batch-processor.js` | `BatchProcessor`, `createBatchProcessor` | 构造时实例化 `OperationLogger`（文件副作用）；`processBatch` 批量循环 | 不修改原始 records | `../rules`, `./quality-scorer`, `./operation-logger`, `./data-cleaner`, `../schemas` | DEPRECATE_WITH_REASON | — | 无需新测试 |
| `rules/index.js` | `validateRecord`, `validateField`, `validateRequiredFields`, `validateLogicConsistency`, `validateStateTransition`, `calculateScore`, `BUDGET_RANGES` | 无文件/网络副作用；纯内存计算 | `validateRecord` 不修改输入 | `../config`, `../utils`, `../schemas` | EXTRACT_PURE_FUNCTION | `src/server/cleaning/adapters/rules-adapter.ts`（包装为纯函数，再被新 ValidationEngine 替代） | `tests/unit/cleaning/adapters/rules-adapter.test.ts` |
| `schemas/index.js` | `loadAllSchemas`, `getSchema`, `getFieldSchema`, `getRequiredFields`, `getEnumFields`, `clearCache`, `schemaFiles` | **import-time 读 7 个 JSON schema 文件并缓存**；`loadSchema` 用 `readFileSync` | 不修改输入 | `path`, `fs` | WRAP | `src/server/cleaning/adapters/schema-adapter.ts` | `tests/unit/cleaning/adapters/schema-adapter.test.ts` |
| `schemas/customer.json` | JSON schema | 无 | 无 | — | REUSE | 被 `schema-adapter.ts` 读取为 `CustomerSchemaConfig` | `tests/unit/cleaning/adapters/schema-adapter.test.ts` |
| `config/index.js` | `loadAllConfig`, `getSynonyms`, `getCleaningRules`, `getRuleLearner`, `clearCache` | **import-time 读 `synonyms.json`/`cleaning-rules.json` 并缓存**；`getRuleLearner()` 构造 `RuleLearner`（读文件） | 不修改输入 | `path`, `fs`, `../core/rule-learning` | WRAP | `src/server/cleaning/adapters/config-adapter.ts` | `tests/unit/cleaning/adapters/config-adapter.test.ts` |
| `utils/index.js` | `parseDate`, `normalizeBudget`, `sanitizePhone`, `sanitizeText`, `sanitizeUrl`, `isValidPhone`, `isValidWechat`, `isValidUrl`, `isValidRating`, `parseAmount`, `formatDate`, `chineseToNum`, `createLogger`, `findMatchingStyle`, `findMatchingShootType` | `parseDate` 使用 `new Date()`（依赖当前时间）；`createLogger` 写 `console.log` | 纯函数不修改输入 | 无 | EXTRACT_PURE_FUNCTION | `src/server/cleaning/adapters/utils-adapter.ts` | `tests/unit/cleaning/adapters/utils-adapter.test.ts` |
| `agent/index.js` | `ZehuaiIngestionAgent`, `createAgent` | 构造时读 `agent-config.json`；`initialize()` 创建 `BitableWriter`（飞书客户端初始化） | `ingest()` 不修改输入 | `fs`, `path`, `./execution/*`, `./perception`, `./understanding`, `./workflows` | DEPRECATE_WITH_REASON | — | 无需新测试 |
| `agent/execution/bitable-writer.js` | `createBitableWriter` | 初始化飞书客户端、读环境变量、调用飞书 API | 不修改输入 | `axios`/fetch, env | DEPRECATE_WITH_REASON | — | 无需新测试 |
| `agent/execution/linkage-engine.js` | `createLinkageEngine` | 调用 `bitable-writer` 写关联字段 | 不修改输入 | `./bitable-writer` | DEPRECATE_WITH_REASON | — | 无需新测试 |
| `agent/execution/rollback-manager.js` | `createRollbackManager` | 调用 `bitable-writer` 删除记录 | 不修改输入 | `./bitable-writer` | DEPRECATE_WITH_REASON | — | 无需新测试 |
| `agent/perception/dispatcher.js` | `dispatchInput` 等 | 可能调用 OCR/ASR/CLIP | 不修改输入 | `../multimodal/*` | DEPRECATE_WITH_REASON | — | 无需新测试 |
| `agent/understanding/field-extractor.js` | `extractFields` 等 | 调用 LLM/Dify（外部网络） | 不修改输入 | `axios`/fetch | DEPRECATE_WITH_REASON | — | 无需新测试 |

> **Phase 2B 契约测试状态**：8 个 Adapter 及 Loader 的契约测试均已实现并通过（见 `tests/unit/cleaning/`）。`DEPRECATE_WITH_REASON` 模块未创建新 Adapter，旧测试保持原样但不被新服务端代码引用。

---

## 二、逐模块详细分析

### 2.1 `core/data-cleaner.js`

- **真实导出**：`DataCleaner`, `CleaningPipeline`, `FormatCleaner`, `EnumMappingCleaner`, `DefaultValueCleaner`, `NullToEmptyCleaner`, `createCleaner`。
- **副作用**：
  - `DataCleaner` 构造函数默认 `new OperationLogger(options.loggerOptions)`，触发 `mkdirSync`。
  - `DataCleaner.preprocessMultimodal()` 调用 `ocr`, `asr`, `clip` 子模块（Phase 2 不使用）。
  - **导入闭包副作用（关键）**：`data-cleaner.js` 顶部 `require('../schemas')` 和 `require('../config')` 会在模块加载时触发 `schemas/index.js` 读取 7 个 JSON schema 文件、`config/index.js` 读取 `synonyms.json` 与 `cleaning-rules.json`。简单 WRAP（即 `import` 旧模块再包装）无法避免这些 import-time 文件 I/O。
- **可变输入**：每个 Cleaner 的 `clean(result, meta)` 先对 `result.data` 浅拷贝 `{ ...result.data }`，再修改副本；原始 `result` 对象中的数组（`errors`、`warnings`、`corrections`）通过 `push` 追加，但旧 pipeline 已先浅拷贝，因此输入对象不会被污染。不过 `DefaultValueCleaner` 对 `undefined/null/''` 统一填充默认值，语义上与 Phase 2 要求冲突。
- **处理方式**：**EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY**。由于导入闭包会触发 schema/config 的 import-time 文件读取，不得简单 WRAP（WRAP 仍需 `import` 旧模块，副作用无法隔离）。改为：从 `FormatCleaner.clean` 与 `EnumMappingCleaner.matchEnumValue` 中提取纯函数逻辑，重新实现为 TypeScript 纯函数，不 import 旧 `data-cleaner.js`；`DefaultValueCleaner` 与 `NullToEmptyCleaner` 不复用，改为配置化 pipeline 步骤。迁移期间旧模块保留但不被新服务端代码引用。
- **新 Adapter**：`cleaner-adapter.ts` 导出 `adaptFormatClean`, `adaptEnumMapClean` 两个纯函数，内部不 `import` 旧 `data-cleaner.js`，而是直接调用 `utils-adapter.ts` 与 `config-adapter.ts` 提供的惰性加载接口。
- **契约测试**：断言 Adapter 输出为新对象；断言导入 Adapter 不创建 `src/data-cleaning/logs/`；断言导入 Adapter 不触发 `schemas/index.js` 的 import-time 文件读取（通过 `fs.readFileSync` spy 验证）。

### 2.2 `core/operation-logger.js`

- **真实导出**：`OperationLogger`, `createLogger`。
- **副作用**：构造函数调用 `_ensureLogDir()` → `fs.mkdirSync(this.logDir, { recursive: true })`；`log()` 方法调用 `fs.appendFileSync()`。
- **可变输入**：不修改业务数据。
- **处理方式**：**WRAP（禁用文件 I/O）**。V1 不允许旧清洗模块写文件；服务端统一使用 `pino`。
- **新 Adapter**：`noop-logger-adapter.ts` 导出空实现，构造时不调用 `mkdirSync`。
- **契约测试**：断言 `new NoopLogger()` 不创建目录；断言 `log()` 不生成文件。

### 2.3 `rules/index.js`

- **真实导出**：`validateRecord`, `validateField`, `validateRequiredFields`, `validateLogicConsistency`, `validateStateTransition`, `calculateScore`, `BUDGET_RANGES`。
- **副作用**：无文件/网络副作用，纯内存计算。
- **可变输入**：不修改输入数据。
- **处理方式**：**EXTRACT_PURE_FUNCTION**。旧 `validateRecord` 返回 `{ status, score, errors, warnings, ... }`，但五重校验混在一个函数里，且状态机校验对 V1 新建记录不适用。新 ValidationEngine 将按五重 Validator 拆分，旧函数仅作为参考实现逐步替换。
- **新 Adapter**：`rules-adapter.ts` 暂时导出 `adaptValidateRecord(schemaKey, record)`，供迁移期回归测试使用；最终由新 Engine 替代。
- **契约测试**：断言输入 record 不被修改；断言非法枚举返回 `ENUM_MISMATCH`。

### 2.4 `schemas/index.js`

- **真实导出**：`loadAllSchemas`, `getSchema`, `getFieldSchema`, `getRequiredFields`, `getEnumFields`, `clearCache`, `schemaFiles`。
- **副作用**：**import-time 副作用**。模块加载时遍历 `schemaFiles` 并 `readFileSync` 7 个 JSON 文件，缓存到 `cachedSchemas`。
- **可变输入**：不修改输入。
- **处理方式**：**WRAP**。新 Adapter 在服务端按需读取 schema JSON，并提供类型化接口；缓存只发生在首次调用后，不在 import-time 触发。
- **新 Adapter**：`schema-adapter.ts` 导出 `loadCustomerSchema(): CustomerSchemaConfig`。
- **契约测试**：断言 import `schema-adapter.ts` 不读文件；断言首次调用后才读 `customer.json`。

### 2.5 `config/index.js`

- **真实导出**：`loadAllConfig`, `getSynonyms`, `getCleaningRules`, `getRuleLearner`, `clearCache`。
- **副作用**：**import-time 副作用**。模块加载时 `readFileSync` `synonyms.json` 与 `cleaning-rules.json`；`getRuleLearner()` 首次调用时构造 `RuleLearner`（读文件/写文件）。
- **可变输入**：不修改输入。
- **处理方式**：**WRAP**。新 Adapter 按需读取 `synonyms.json` 与 `cleaning-rules.json`，不初始化 `RuleLearner`。
- **新 Adapter**：`config-adapter.ts` 导出 `loadSynonyms()`, `loadCleaningRules()`。
- **契约测试**：断言 import 不读文件；断言 `loadSynonyms()` 返回的对象不被调用方修改。

### 2.6 `utils/index.js`

- **真实导出**：`parseDate`, `normalizeBudget`, `sanitizePhone`, `sanitizeText`, `sanitizeUrl`, `isValidPhone`, `isValidWechat`, `isValidUrl`, `isValidRating`, `parseAmount`, `formatDate`, `chineseToNum`, `createLogger`, `findMatchingStyle`, `findMatchingShootType`。
- **副作用**：`parseDate` 内部使用 `new Date()`，依赖服务端当前时间；`createLogger` 写 `console.log`。
- **可变输入**：纯函数，不修改输入。
- **处理方式**：**EXTRACT_PURE_FUNCTION**。把 `sanitizePhone`, `sanitizeText`, `normalizeBudget`, `chineseToNum` 等纯函数迁移到 `src/server/cleaning/pipeline/`；`parseDate` 重构为接收上下文（`received_at`, `timezone`, `locale`）的新函数。
- **新 Adapter**：`utils-adapter.ts` 导出 `sanitizePhone`, `sanitizeText`, `normalizeBudget`, `chineseToNum` 等无状态函数。
- **契约测试**：断言纯函数输出只与输入有关；断言 `parseDate` 上下文缺失时返回原值并 warning。

### 2.7 `core/quality-scorer.js`

- **真实导出**：`QualityScorer`, `createQualityScorer`。
- **副作用**：无文件/网络副作用。
- **可变输入**：不修改输入。
- **处理方式**：**WRAP**。旧 scorer 基于旧 `validateRecord` 结果；新 `QualityReport` 由 ValidationEngine 输出直接构造，旧 scorer 逻辑仅作为参考。
- **新 Adapter**：`quality-adapter.ts` 导出 `calculateQualityScore(validationRuns)`。
- **契约测试**：断言 error 数量 > 0 时质量分 ≤ 49。

### 2.8 `core/data-scanner.js`

- **真实导出**：`DataScanner`, `createDataScanner`。
- **副作用**：构造时读 `scan-state.json`；运行时可能写 `scan-state.json`。
- **可变输入**：不修改输入。
- **处理方式**：**DEPRECATE_WITH_REASON**。Phase 2 处理单条 Candidate callback，不扫描存量数据。
- **废弃原因**：`DataScanner` 用于全表扫描与增量同步，超出 Phase 2 范围；V1 只接入新候选记录。

### 2.9 `core/rule-learning.js`

- **真实导出**：`RuleLearner`, `createInstance`。
- **副作用**：构造时读/写 `feedback.jsonl` 与 synonyms 版本文件。
- **可变输入**：`addFeedback` 修改内部 synonyms 缓存。
- **处理方式**：**DEPRECATE_WITH_REASON**。Phase 2 不实现规则自学习；同义词映射由静态 `synonyms.json` + mapping config 提供。
- **废弃原因**：自学习属于数据飞轮闭环，Phase 2 聚焦确定性映射/清洗/验证。

### 2.10 `core/batch-processor.js`

- **真实导出**：`BatchProcessor`, `createBatchProcessor`。
- **副作用**：构造时实例化 `OperationLogger`（文件副作用）；批量循环处理。
- **可变输入**：不修改原始 records。
- **处理方式**：**DEPRECATE_WITH_REASON**。Phase 2 明确不进行批处理。
- **废弃原因**：`receiveCandidate` 是单条回调；评测 runner 逐条处理 fixtures。

### 2.11 `agent/index.js`（ZehuaiIngestionAgent）

- **真实导出**：`ZehuaiIngestionAgent`, `createAgent`。
- **副作用**：构造时读 `agent-config.json`；`initialize()` 创建 `BitableWriter`（飞书客户端初始化）。
- **可变输入**：`ingest()` 不修改输入。
- **处理方式**：**DEPRECATE_WITH_REASON**。V1 Core Service 已替代旧 Agent 入口；Phase 2 不允许 Dify 或 LLM 直接写业务主表。
- **废弃原因**：旧 Agent 是 LLM/Dify 驱动入口，与 Phase 2 的确定性 pipeline 架构冲突。

### 2.12 `agent/execution/bitable-writer.js`

- **真实导出**：`createBitableWriter`。
- **副作用**：初始化飞书客户端、读环境变量、调用飞书 API。
- **可变输入**：不修改输入。
- **处理方式**：**DEPRECATE_WITH_REASON**。Phase 2 不进行飞书正式写入。
- **废弃原因**：V1 固定 `write_allowed=false`，所有写入需人工审核后由外部系统执行。

### 2.13 `agent/execution/linkage-engine.js` / `rollback-manager.js`

- **真实导出**：`createLinkageEngine`, `createRollbackManager`。
- **副作用**：调用 `bitable-writer` 进行飞书写入/删除。
- **处理方式**：**DEPRECATE_WITH_REASON**。Phase 2 不处理跨表联动与回滚。
- **废弃原因**：跨表联动与回滚依赖飞书写入，超出 Phase 2 范围。

### 2.14 `agent/perception/*` / `agent/understanding/*`

- **真实导出**：`dispatchInput`, `input-classifier`, `doc-parser`, `field-extractor`, `confidence-scorer`, `ambiguity-detector`, `scene-classifier`。
- **副作用**：可能调用 OCR/ASR/CLIP/LLM/Dify（外部网络与文件）。
- **处理方式**：**DEPRECATE_WITH_REASON**。Phase 2 不处理 OCR/ASR/CLIP，也不由 LLM 直接抽取字段。
- **废弃原因**：Phase 2 输入是已经被 Dify/LLM 初步解析后的 `CandidateRecord`；感知与理解层在 V1 Core Service 之外。

---

## 三、Adapter 边界原则

1. **无副作用穿越**：Adapter 不得把旧模块的 import-time 副作用（文件读取、目录创建、环境变量读取、全局缓存）带到 `src/server/cleaning/`。
2. **不可变契约**：Adapter 输出新对象；调用方输入对象在测试前后必须 `===` 自身且内部值不变。
3. **类型安全**：Adapter 内部可用 `any` 与旧 CJS 交互，但对外导出的函数必须带 TypeScript 类型。
4. **不暴露旧类**：Adapter 不直接导出 `DataCleaner`、`QualityScorer` 等旧类实例，只导出纯函数。
5. **DEPRECATE 模块不创建 Adapter**：对废弃模块，Phase 2 代码不 import；旧测试与脚本保持原样，但不得被新服务端代码引用。

---

## 四、LegacyModuleProfile 结构要求

`src/server/cleaning/legacy-audit.ts` 中每个旧模块的 `LegacyModuleProfile` 记录必须包含以下 6 个字段。缺少任一字段视为审计不完整，Phase 2A 验收不通过。

```typescript
export interface LegacyModuleProfile {
  /** 模块路径，如 'core/data-cleaner.js' */
  module: string;
  /** 模块导入是否安全（是否触发 import-time 文件 I/O、目录创建、全局缓存等副作用） */
  importSafe: boolean;
  /** 导入策略：'direct'（直接 import）/ 'lazy'（惰性加载）/ 'none'（不导入） */
  importStrategy: 'direct' | 'lazy' | 'none';
  /** 传递性副作用清单：被依赖模块的 import-time 副作用描述 */
  transitiveSideEffects: string[];
  /** 运行时互操作风险：CJS/ESM、默认导出形状、类型缺失等 */
  runtimeInterop: string[];
  /** 允许通过 Adapter 暴露的导出名单 */
  allowedExports: string[];
  /** 验证副作用隔离的测试断言描述 */
  sideEffectTest: string;
  /** 处理方式：REUSE / WRAP / EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY / DEPRECATE_WITH_REASON */
  handling: 'REUSE' | 'WRAP' | 'EXTRACT_PURE_FUNCTION' | 'MIGRATE_INCREMENTALLY' | 'DEPRECATE_WITH_REASON';
  /** 废弃原因（仅 DEPRECATE_WITH_REASON 时必填） */
  deprecateReason?: string;
}
```

**字段说明**：

| 字段 | 必填 | 用途 | 示例 |
|---|---|---|---|
| `importSafe` | 是 | 判断该模块能否被直接 import 而不触发副作用 | `false`（`data-cleaner.js` 导入闭包触发 schema/config 文件读取） |
| `importStrategy` | 是 | 指导 Adapter 如何导入旧模块 | `'none'`（`data-cleaner.js` 不导入，改为提取纯函数）；`'lazy'`（`schemas/index.js` 惰性加载） |
| `transitiveSideEffects` | 是 | 记录传递性副作用，确保 Adapter 隔离时覆盖所有依赖链 | `['schemas/index.js import-time readFileSync x7', 'config/index.js import-time readFileSync x2']` |
| `runtimeInterop` | 是 | 记录 CJS/ESM 互操作风险 | `['CJS module.exports，TS ESM 需 import * as', '无类型声明']` |
| `allowedExports` | 是 | 限定 Adapter 只暴露白名单内的导出 | `['adaptFormatClean', 'adaptEnumMapClean']` |
| `sideEffectTest` | 是 | 描述验证副作用隔离的测试方法 | `'fs.readFileSync spy 断言导入时不读文件；fs.existsSync 断言不创建 logs 目录'` |

**规则**：

- `importSafe=false` 的模块不得使用 `importStrategy='direct'`，必须改为 `'lazy'` 或 `'none'`。
- `handling='WRAP'` 仅适用于 `importSafe=true` 或通过惰性加载可隔离副作用的模块；`importSafe=false` 且无法惰性加载的模块必须使用 `EXTRACT_PURE_FUNCTION` 或 `MIGRATE_INCREMENTALLY`。
- `transitiveSideEffects` 必须覆盖直接依赖链中的所有 import-time 副作用，不得遗漏。
- `sideEffectTest` 必须对应一个实际存在的测试用例，测试文件路径在 Phase 2A 审计时记录。
