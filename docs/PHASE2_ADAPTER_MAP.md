# Phase 2 Legacy Adapter 映射表

> **状态**：AUDIT_COMPLETE — 基于真实子进程隔离审计结果生成
> **数据来源**：`reports/phase2/legacy-module-profiles.json`（由 `npm run audit:legacy` 生成）
> **审计工具版本**：phase2a-1.0.0
> **基线 Commit**：9d62350
> **约束**：importStrategy 使用稳定枚举 `DIRECT_IMPORT | CREATE_REQUIRE | EXTRACT_PURE_FUNCTION | MIGRATE_INCREMENTALLY | DEPRECATE_WITH_REASON | BLOCKED_UNSAFE_IMPORT`

---

## 一、审计汇总

| 指标 | 值 |
|------|-----|
| discovered_module_count | 62 |
| profiled_module_count | 62 |
| excluded_module_count | 0 |
| safe_module_count | **29** |
| unsafe_module_count | **33** |
| import_failed_count | 33 |
| cjs_module_count | 62 |
| esm_module_count | 0 |
| unprofiled_modules | [] (空) |

**确定性验证**：连续两次运行结果一致，仅 `generated_at` 和 `duration_ms` 不同。

---

## 二、关键发现（推翻 Planning 预判）

### 发现 1：`schemas/index.js` 和 `config/index.js` 是 SAFE

Planning 阶段假设这两个模块有 import-time `readFileSync` 副作用（分别读 7 个和 2 个 JSON 文件）。

**真实审计结果**：`importSafe=true`，`filesystemReads=0`。

**原因**：这两个模块使用 `require('./customer.json')` 等 Node.js JSON 模块加载器，而非 `fs.readFileSync`。Node.js 的 JSON 加载器走 `internalBinding` 路径，不触发 `fs` 模块的同步函数。模块加载系统自身的文件读取已被审计器过滤。

**影响**：这两个模块可以通过 `createRequire` 安全导入，无需提取纯函数。

### 发现 2：`core/data-cleaner.js` 是 SAFE

Planning 阶段假设它有传递性副作用（通过 `schemas`/`config` 的 import-time 文件读取）。

**真实审计结果**：`importSafe=true`，`filesystemReads=0`，`filesystemWrites=0`，`globalMutations=[]`。

**原因**：传递依赖 `schemas/index.js` 和 `config/index.js` 本身是 SAFE（见发现 1）。

**影响**：`DataCleaner` 等类可以通过 `createRequire` 导入并构造（构造函数的文件 I/O 副作用是 runtime 行为，不在 import-time 审计范围）。

### 发现 3：33 个模块导入失败，9 个有 HTML 实体损坏

9 个模块源码中的运算符被 HTML 实体化：
- `&&` → `&amp;&amp;`
- `>` → `&gt;`
- `<` → `&lt;`

导致 SyntaxError。另外 21 个模块通过传递依赖间接引用这些损坏文件，同样失败。3 个模块有其他错误（子进程超时、依赖缺失）。

---

## 三、Adapter 决策矩阵

### 3.1 SAFE 模块（29 个）— importSafe=true，importStrategy=CREATE_REQUIRE

以下模块通过隔离审计验证，可在 `src/server/cleaning/` 中通过 `createRequire` 安全导入。

| 旧模块 | 真实导出 | adapterDecision | 新 Adapter | 原因 |
|--------|---------|----------------|-----------|------|
| `core/data-cleaner.js` | `DataCleaner`, `CleaningPipeline`, `FormatCleaner`, `EnumMappingCleaner`, `DefaultValueCleaner`, `NullToEmptyCleaner`, `createCleaner` | **WRAP** | `cleaner-adapter.ts` | 需复用 FormatCleaner/EnumMappingCleaner 逻辑；构造函数有 runtime 副作用（mkdirSync），Adapter 必须注入 NoopLogger |
| `core/quality-scorer.js` | `QualityScorer`, `createQualityScorer` | **WRAP** | `quality-adapter.ts` | 纯内存计算，无 import-time 副作用 |
| `core/operation-logger.js` | `OperationLogger`, `createLogger` | **WRAP（禁用 I/O）** | `noop-logger-adapter.ts` | import 安全但 runtime 构造时 mkdirSync + appendFileSync；Adapter 替换为 pino |
| `core/data-scanner.js` | `DataScanner`, `createDataScanner` | **DEPRECATE_WITH_REASON** | — | Phase 2 不扫描存量数据；构造时 runtime 读 scan-state.json |
| `core/rule-learning.js` | `RuleLearner`, `createInstance` | **DEPRECATE_WITH_REASON** | — | Phase 2 不实现规则自学习；runtime 读写 feedback.jsonl |
| `core/batch-processor.js` | `BatchProcessor`, `createBatchProcessor` | **DEPRECATE_WITH_REASON** | — | Phase 2 逐条处理不批处理；构造时实例化 OperationLogger |
| `rules/index.js` | `validateField`, `validateRequiredFields`, `validateStateTransition`, `validateLogicConsistency`, `validateRecord`, `makeIssue`, `isEmpty` | **WRAP** | `rules-adapter.ts` | 纯内存计算；旧 validateRecord 返回值作为参考实现 |
| `schemas/index.js` | `loadAllSchemas`, `getSchema`, `getSchemaByTableId`, `getSchemaByTableName`, `getFieldSchema`, `getFieldByFieldId`, `getRequiredFields`, `getEnumFields`, `clearCache`, `schemaFiles` | **WRAP** | `schema-adapter.ts` | import 安全（JSON 走 require 加载，非 fs.readFileSync）；按需调用 getSchema |
| `config/index.js` | `loadAllConfig`, `getSynonyms`, `getCleaningRules`, `getStyleSynonyms`, `getShootTypeMapping`, `getFieldFormatRule`, `getStateMachine`, `getValidationLevel`, `clearCache`, `getRuleLearner`, `RuleLearner` | **WRAP** | `config-adapter.ts` | import 安全；按需调用 getSynonyms/getCleaningRules；不得调用 getRuleLearner()（runtime 副作用） |
| `utils/index.js` | `toHalfWidth`, `sanitizePhone`, `sanitizeText`, `sanitizeUrl`, `isValidPhone`, `isValidWechat`, `isValidUrl`, `isValidRating`, `parseAmount`, `parseDate`, `normalizeBudget`, `createLogger`, `findMatchingStyle`, `findMatchingShootType` | **WRAP** | `utils-adapter.ts` | import 安全；parseDate 依赖 new Date()（runtime），Adapter 需注入时间上下文 |
| `agent/execution/bitable-writer.js` | `BitableWriter`, `createBitableWriter` | **DEPRECATE_WITH_REASON** | — | Phase 2 不写飞书；runtime 初始化飞书客户端 |
| `agent/execution/confirmation-ui.js` | `generateConfirmation`, `generateSuccessReport`, `generateErrorReport`, `generateBatchPreview`, `SCENE_NAMES`, `CONFIDENCE_LEVELS` | **DEPRECATE_WITH_REASON** | — | UI 报告生成，Phase 2 服务端不需要 |
| `agent/execution/rollback-manager.js` | `RollbackManager`, `createRollbackManager` | **DEPRECATE_WITH_REASON** | — | Phase 2 不回滚 |
| `agent/perception/doc-parser.js` | `extractText` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理文档解析 |
| `agent/understanding/ambiguity-detector.js` | `detectAmbiguities`, `stringSimilarity` | **DEPRECATE_WITH_REASON** | — | Phase 2 不做歧义检测 |
| `agent/workflows/base-workflow.js` | `default` | **DEPRECATE_WITH_REASON** | — | Phase 2 不使用旧工作流 |
| `agent/workflows/batch-import.js` | `default` | **DEPRECATE_WITH_REASON** | — | Phase 2 不批处理 |
| `benchmark/metrics.js` | `isEqual`, `accuracy`, `computeFieldAccuracy`, `computeCorrectionsAccuracy`, `computeStatusMatch`, `computeCasePassed`, `computeSynonymRecall`, `computeRequiredInterception`, `scoreWithinRange`, `computeWER`, `computeCRA` | **WRAP** | `benchmark-adapter.ts` | 纯函数，评测 runner 可复用 |
| `multimodal/asr/feishu-minutes-adapter.js` | `transcribe`, `checkFeishuAvailable`, `_deps` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理 ASR |
| `multimodal/asr/index.js` | `transcribe`, `whisperAdapter`, `feishuAdapter` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理 ASR |
| `multimodal/asr/local-whisper-adapter.js` | `transcribe`, `checkWhisperAvailable` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理 ASR |
| `multimodal/asr/wechat-voice-converter.js` | `isSilkFile`, `convertSilkToWav` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理语音转换 |
| `multimodal/clip/index.js` | `checkImageTextMatch` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理 CLIP |
| `multimodal/clip/python-bridge.js` | `checkPythonAvailable`, `computeSimilarity`, `checkImageTextMatch` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理 CLIP |
| `multimodal/ocr/business-card-parser.js` | `parseBusinessCard`, `parseContract`, `parsePhone`, `parseWechat`, `parseName`, `parseAmount`, `parseDate` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理 OCR |
| `multimodal/ocr/feishu-ocr-adapter.js` | `extractText`, `checkFeishuAvailable` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理 OCR |
| `multimodal/ocr/index.js` | `extractText`, `isImage`, `tesseractAdapter`, `feishuAdapter` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理 OCR |
| `multimodal/ocr/tesseract-adapter.js` | `extractText`, `checkTesseractAvailable` | **DEPRECATE_WITH_REASON** | — | Phase 2 不处理 OCR |
| `core/index.js` | `DataCleaner`, `CleaningPipeline`, `FormatCleaner`, ..., `createBatchProcessor` | **DEPRECATED_AGGREGATOR** | — | 聚合入口，Phase 2 不直接引用 |

### 3.2 UNSAFE 模块（33 个）— importSafe=false，importStrategy=BLOCKED_UNSAFE_IMPORT

以下模块在子进程隔离审计中导入失败。Phase 2B **不得**通过 `createRequire` 或 `import` 引入这些模块。

#### 3.2.1 HTML 实体损坏（9 个直接损坏 + 12 个传递性损坏）

**直接损坏**（源码含 `&amp;` / `&gt;` / `&lt;` 代替 `&&` / `>` / `<`）：

| 旧模块 | adapterDecision | 处理方式 |
|--------|----------------|---------|
| `agent/execution/linkage-engine.js` | **EXTRACT_PURE_FUNCTION** | Phase 2B 不处理跨表联动，废弃 |
| `agent/perception/dispatcher.js` | **DEPRECATE_WITH_REASON** | Phase 2 不处理感知分发 |
| `agent/perception/input-classifier.js` | **DEPRECATE_WITH_REASON** | Phase 2 不做输入分类 |
| `agent/understanding/confidence-scorer.js` | **DEPRECATE_WITH_REASON** | Phase 2 不做置信度评分 |
| `agent/understanding/field-extractor.js` | **DEPRECATE_WITH_REASON** | Phase 2 不做 LLM 字段提取 |
| `agent/understanding/scene-classifier.js` | **DEPRECATE_WITH_REASON** | Phase 2 不做场景分类 |
| `agent/workflows/customer-consultation.js` | **DEPRECATE_WITH_REASON** | Phase 2 不使用旧工作流 |
| `agent/workflows/namecard-ocr.js` | **DEPRECATE_WITH_REASON** | Phase 2 不使用旧工作流 |
| `agent/workflows/resource-onboarding.js` | **DEPRECATE_WITH_REASON** | Phase 2 不使用旧工作流 |

**传递性损坏**（自身语法正确，但 require 链引用了上述损坏文件）：

| 旧模块 | adapterDecision | 原因 |
|--------|----------------|------|
| `agent/execution/index.js` | **DEPRECATE_WITH_REASON** | require('./linkage-engine') 传递失败 |
| `agent/index.js` | **DEPRECATE_WITH_REASON** | 聚合入口，引用 agent/* 传递失败 |
| `agent/perception/index.js` | **DEPRECATE_WITH_REASON** | require('./dispatcher') 传递失败 |
| `agent/understanding/index.js` | **DEPRECATE_WITH_REASON** | require('./confidence-scorer') 传递失败 |
| `agent/workflows/index.js` | **DEPRECATE_WITH_REASON** | require('./customer-consultation') 传递失败 |
| `benchmark/run-benchmark.js` | **DEPRECATE_WITH_REASON** | 依赖 agent/* 传递失败 |
| `examples/example-add-synonym.js` | **DEPRECATE_WITH_REASON** | 示例脚本，引用 index.js 传递失败 |
| `examples/example-batch-process.js` | **DEPRECATE_WITH_REASON** | 示例脚本，引用 index.js 传递失败 |
| `examples/example-single-clean.js` | **DEPRECATE_WITH_REASON** | 示例脚本，引用 index.js 传递失败 |
| `index.js` (根聚合) | **DEPRECATE_WITH_REASON** | 聚合入口，传递失败 |
| `multimodal/asr/test-asr.js` | **DEPRECATE_WITH_REASON** | 测试脚本，引用 agent/* 传递失败 |
| `test-integration.js` | **DEPRECATE_WITH_REASON** | 集成测试，引用 index.js 传递失败 |
| `test-multimodal-integration.js` | **DEPRECATE_WITH_REASON** | 集成测试，引用 index.js 传递失败 |

#### 3.2.2 import-time 执行 + stdout 污染（7 个）

这些测试文件在 import 时执行 `console.log` / 断言逻辑，污染子进程 stdout（JSON 输出被截断）。

| 旧模块 | adapterDecision | 原因 |
|--------|----------------|------|
| `core/test-batch.js` | **DEPRECATE_WITH_REASON** | 测试脚本，import 时执行并输出 |
| `core/test-cleaner.js` | **DEPRECATE_WITH_REASON** | 测试脚本，import 时执行并输出 |
| `core/test-learning.js` | **DEPRECATE_WITH_REASON** | 测试脚本，import 时执行并输出 |
| `core/test-quality.js` | **DEPRECATE_WITH_REASON** | 测试脚本，import 时执行并输出 |
| `core/test-scanner.js` | **DEPRECATE_WITH_REASON** | 测试脚本，import 时执行并输出 |
| `multimodal/clip/test-clip.js` | **DEPRECATE_WITH_REASON** | 测试脚本，import 时执行并输出 |
| `multimodal/ocr/test-ocr.js` | **DEPRECATE_WITH_REASON** | 测试脚本，import 时执行并输出 |

#### 3.2.3 子进程超时（2 个）

| 旧模块 | adapterDecision | 原因 |
|--------|----------------|------|
| `core/test-logger.js` | **DEPRECATE_WITH_REASON** | import 时执行测试逻辑导致超时 |
| `rules/test-rules.js` | **DEPRECATE_WITH_REASON** | import 时执行测试逻辑导致超时 |

#### 3.2.4 依赖缺失（1 个）

| 旧模块 | adapterDecision | 原因 |
|--------|----------------|------|
| `multimodal/test-modules.js` | **DEPRECATE_WITH_REASON** | `Cannot find module '../../benchmark/metrics'` |

#### 3.2.5 import-time stdout 输出

| 旧模块 | adapterDecision | 原因 |
|--------|----------------|------|
| `utils/test-utils.js` | **DEPRECATE_WITH_REASON** | 测试脚本，import 时执行并输出 |

---

## 四、Adapter 实施决策总结

### Phase 2B 需实现的 Adapter（8 个）

| Adapter | 旧模块 | importStrategy | 关键约束 |
|---------|--------|----------------|---------|
| `cleaner-adapter.ts` | `core/data-cleaner.js` | CREATE_REQUIRE | 构造 DataCleaner 时注入 NoopLogger，禁止 mkdirSync；只暴露 FormatCleaner/EnumMappingCleaner 逻辑 |
| `quality-adapter.ts` | `core/quality-scorer.js` | CREATE_REQUIRE | 纯内存计算，直接 createRequire 后调用 |
| `noop-logger-adapter.ts` | `core/operation-logger.js` | CREATE_REQUIRE | 不调用旧 OperationLogger 构造函数，替换为 pino |
| `rules-adapter.ts` | `rules/index.js` | CREATE_REQUIRE | 纯内存计算，直接 createRequire 后调用 validateRecord |
| `schema-adapter.ts` | `schemas/index.js` | CREATE_REQUIRE | import 安全；按需调用 getSchema/getFieldSchema/getRequiredFields/getEnumFields |
| `config-adapter.ts` | `config/index.js` | CREATE_REQUIRE | import 安全；按需调用 getSynonyms/getCleaningRules；**禁止调用 getRuleLearner()** |
| `utils-adapter.ts` | `utils/index.js` | CREATE_REQUIRE | 按需调用 sanitizePhone/sanitizeText/normalizeBudget 等；parseDate 需注入时间上下文 |
| `benchmark-adapter.ts` | `benchmark/metrics.js` | CREATE_REQUIRE | 评测 runner 复用 accuracy/computeFieldAccuracy 等纯函数 |

### Phase 2B 不实现的 Adapter（55 个模块）

- **全部 33 个 UNSAFE 模块**：BLOCKED_UNSAFE_IMPORT，不得 import
- **21 个 SAFE 但废弃的模块**：DEPRECATE_WITH_REASON，Phase 2 代码不引用

---

## 五、Adapter 边界原则（不变）

1. **无副作用穿越**：Adapter 不得把旧模块的 runtime 副作用（文件读取、目录创建、环境变量读取）带到 `src/server/cleaning/`
2. **不可变契约**：Adapter 输出新对象；调用方输入对象在测试前后必须 `===` 自身
3. **类型安全**：Adapter 内部可用 `any` 与旧 CJS 交互，但对外导出的函数必须带 TypeScript 类型
4. **不暴露旧类**：Adapter 不直接导出 `DataCleaner`、`QualityScorer` 等旧类实例，只导出纯函数
5. **DEPRECATE 模块不创建 Adapter**：对废弃模块，Phase 2 代码不 import

---

## 六、LegacyModuleProfile 契约

完整的 LegacyModuleProfile 类型定义在 `src/server/cleaning/contracts/legacy-module-profile.ts`。

**6 个必填字段**（审计器输出）：
- `importSafe`: boolean — import-time 是否安全
- `importStrategy`: ImportStrategy 枚举 — 导入策略建议
- `transitiveSideEffects`: string[] — 传递性副作用
- `runtimeInterop`: string[] — CJS/ESM 互操作风险
- `allowedExports`: string[] — 允许暴露的导出
- `sideEffectTest`: string — 副作用测试断言描述

**规则**：
- `importSafe=false` 的模块 `importStrategy` 必须为 `BLOCKED_UNSAFE_IMPORT`
- `importSafe=true` 的模块 `importStrategy` 为 `CREATE_REQUIRE`（由审计器自动建议）
- `allowedExports` 仅在 `importSafe=true` 时非空
- 真实审计报告通过 Zod Runtime Schema 校验（`AuditReportSchema`）
