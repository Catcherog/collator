# Phase 2 实施计划：CandidateRecord 映射、清洗与验证接入

> **状态**：DESIGN_APPROVED_WITH_REQUIRED_CHANGES  
> **规划日期**：2026-07-15  
> **目标**：生成 Phase 2 全部实施计划文档，本轮不修改生产/测试代码  
> **使用 skill**：writing-plans

---

## 一、现状基线

### 1.1 当前 Commit

```
8d06da9832ec90d9bd360d2234b855bad04636fe Phase 1 audit: add coverage, capability matrix, and state reports
```

### 1.2 当前工作区状态

```
 M docs/ACCEPTANCE_REPORT.md
 M docs/PROJECT_STATE.md
?? 下一步给 Trae 的执行提示词.txt
```

- 进入 Phase 2 前需先提交或暂存上述变更，避免 planning commit 混入未决修改。
- 两个 Markdown 修改属于 Phase 1 审计收尾，应在 Phase 2 首个开发 commit 之前处理。

### 1.3 Phase 1 测试数量

| 类型 | 文件 | 数量 | 状态 |
|---|---|---:|---|
| 单元测试 | `tests/unit/signature.test.ts` | 6 | PASS |
| 单元测试 | `tests/unit/ingestion-service.test.ts` | 10 | PASS |
| 集成测试 | `tests/integration/ingestions.test.ts` | 10 | PASS |
| **合计** | — | **26** | **PASS** |

Phase 1 覆盖率（`src/server` 可执行代码）：Stmts 90.3% / Branch 82.56% / Funcs 88.57% / Lines 90.3%。

### 1.4 当前目录结构

```
collator/
├── .trae/
│   ├── Knowledge/           # 项目总览、业务场景、飞书API技术要点等
│   ├── rules/               # _core.md、项目操作规则.md 等
│   ├── skills/              # lark-*、collator-file-ops 等
│   └── specs/               # 历史 spec（data-cleaning-flywheel、plan-unstructured-data-mapping 等）
├── docs/
│   ├── guides/              # data-parsing-templates.md、business-rules-library.md 等
│   ├── reports/             # 历史审计与 benchmark 报告
│   ├── sop/                 # 模特招募SOP.md
│   ├── ACCEPTANCE_REPORT.md
│   ├── API_CONTRACT.md
│   ├── BASELINE_REPORT.md
│   ├── DECISIONS.md
│   └── PROJECT_STATE.md
├── src/
│   ├── config/              # JSON 配置（batch1.json、all_23_works.json 等）
│   ├── data-cleaning/       # 旧 JavaScript 清洗模块（Phase 2 不整体重写）
│   │   ├── agent/           # 感知/理解/执行/工作流（含 Dify/LLM 入口）
│   │   ├── benchmark/       # 旧 benchmark fixtures/runner
│   │   ├── config/          # cleaning-rules.json、synonyms.json、agent-config.json
│   │   ├── core/            # DataCleaner、CleaningPipeline、QualityScorer、OperationLogger 等
│   │   ├── data/            # scan-state.json、feedback.jsonl
│   │   ├── examples/        # 使用示例
│   │   ├── multimodal/      # OCR/ASR/CLIP（Phase 2 不处理）
│   │   ├── rules/           # validateRecord、validateField、业务规则
│   │   ├── schemas/         # customer.json 等 7 张核心表 schema
│   │   ├── utils/           # parseDate、normalizeBudget、sanitizePhone 等
│   │   └── index.js         # 聚合导出
│   ├── scripts/temp/        # 70+ 临时脚本（不纳入 Phase 2）
│   └── server/              # Phase 1 新建 TypeScript Core Service
│       ├── app.ts
│       ├── config.ts
│       ├── domain/
│       │   ├── errors.ts
│       │   └── ingestion.ts
│       ├── repositories/
│       ├── routes/
│       ├── security/
│       └── services/
│           └── ingestion-service.ts
├── tests/
│   ├── integration/
│   └── unit/
├── package.json
├── tsconfig.json
├── tsconfig.test.json
└── vitest.config.ts
```

### 1.5 现有 data-cleaning 模块盘点

| 模块 | 主要导出 | 职责 | Phase 2 处理策略 |
|---|---|---|---|
| `core/data-cleaner.js` | `DataCleaner`, `CleaningPipeline`, `FormatCleaner`, `EnumMappingCleaner`, `DefaultValueCleaner`, `NullToEmptyCleaner`, `createCleaner` | 组合清洗管道 | WRAP / EXTRACT_PURE_FUNCTION |
| `core/data-scanner.js` | `DataScanner`, `createDataScanner` | 存量数据扫描 | DEPRECATE_WITH_REASON（Phase 2 不扫描存量） |
| `core/quality-scorer.js` | `QualityScorer`, `createQualityScorer` | 质量评分 | WRAP / EXTRACT_PURE_FUNCTION |
| `core/operation-logger.js` | `OperationLogger`, `createLogger` | 文件日志写入 | WRAP（文件写入需在 V1 中禁用或改为 pino） |
| `core/rule-learning.js` | `RuleLearner`, `createInstance` | 同义词自学习 | DEPRECATE_WITH_REASON（Phase 2 不自学习） |
| `core/batch-processor.js` | `BatchProcessor`, `createBatchProcessor` | 批量处理 | DEPRECATE_WITH_REASON（Phase 2 不批处理） |
| `rules/index.js` | `validateRecord`, `validateField`, `validateLogicConsistency`, `validateStateTransition`, `calculateScore` | 五重校验核心 | EXTRACT_PURE_FUNCTION / WRAP |
| `schemas/index.js` | `getSchema`, `getFieldSchema`, `getRequiredFields`, `getEnumFields` | schema 加载与缓存 | WRAP（抽象为只读配置接口） |
| `schemas/*.json` | JSON schema | 7 张核心表结构 | REUSE（作为配置源） |
| `utils/index.js` | `parseDate`, `normalizeBudget`, `sanitizePhone`, `sanitizeText` 等 | 纯工具函数 | EXTRACT_PURE_FUNCTION |
| `config/index.js` | `loadAllConfig`, `getSynonyms`, `getCleaningRules`, `getRuleLearner` | 配置加载 | WRAP（去掉 RuleLearner 初始化副作用） |
| `agent/index.js` | `ZehuaiIngestionAgent`, `createAgent` | Dify/LLM 入口 | DEPRECATE_WITH_REASON（V1 不用 Agent 直接写主表） |
| `agent/execution/bitable-writer.js` | `createBitableWriter` | 飞书正式写入 | DEPRECATE_WITH_REASON（Phase 2 不正式写入） |

### 1.6 当前 Node / TypeScript 模块系统

- `package.json` 声明 `"type": "module"`，全仓为 ESM。
- `tsconfig.json` 使用 `"module": "NodeNext"`、`"moduleResolution": "NodeNext"`。
- 生产源码入口：`src/server/app.ts`（Fastify）。
- 脚本运行：`tsx watch src/server/app.ts` / `node dist/server/app.js`。
- 测试框架：Vitest 3.x，`@vitest/coverage-v8`。
- 类型校验：`tsc -p tsconfig.test.json --noEmit` 覆盖 `src/**/*` + `tests/**/*`。

### 1.7 JavaScript 与 TypeScript 互操作风险

| 风险 | 说明 | 影响 |
|---|---|---|
| CJS 默认导出形状 | `src/data-cleaning/**/*.js` 使用 `module.exports = {...}`，从 TS ESM 引入时需 `import * as rules from '../data-cleaning/rules/index.js'` 并确认 `default` 与命名导出行为 | 编译/运行期类型丢失或 `undefined` |
| 路径扩展名 | NodeNext 要求 `import ... from './file.js'`，旧 CJS 模块互相使用无扩展名 require | 直接 import CJS 子模块需补 `.js` 扩展名 |
| 运行时类型缺失 | 旧 JS 无类型；直接复用会污染 `src/server/cleaning/` 类型安全 | 必须通过 Adapter 做边界类型转换 |
| import-time 副作用 | `schemas/index.js`、`config/index.js` 在模块加载时读文件并缓存；`operation-logger.js` 构造时创建日志目录 | 在服务端引起不可控的文件 I/O 与全局缓存 |
| `parseDate` 依赖 `new Date()` | 相对日期解析使用服务端当前时间，导致非确定性 | 评测与生产结果不一致 |
| `NullToEmptyCleaner` 修改副本 | 旧 Cleaner 对 `{ ...result.data }` 浅拷贝后修改，未改原始对象，但语义上将 `null` 与 `''` 混同 | 需重新定义空值语义 |

---

## 二、实施分段

### Phase 2A：合同与副作用审计

**目标**

- 在编码前完成 `src/data-cleaning` 全部相关模块的副作用审计，形成书面结论。
- 明确哪些函数/类可直接复用、哪些必须包装、哪些必须废弃。
- 产出 `src/server/cleaning/legacy-audit.ts`（类型化审计记录）与测试。

**修改文件**

- `docs/PHASE2_ADAPTER_MAP.md`（作为本阶段首要交付，提前冻结）
- `src/server/cleaning/legacy-audit.ts`（新增）

**新增文件**

- `src/server/cleaning/types/legacy.ts`
- `tests/unit/cleaning/legacy-audit.test.ts`

**测试文件**

- `tests/unit/cleaning/legacy-audit.test.ts`：验证审计表至少覆盖 12 个旧模块、每个模块都有 `sideEffects` 与 `mutatesInput` 判定。

**完成条件**

- [ ] `PHASE2_ADAPTER_MAP.md` 表格完成，且每一行的“处理方式”均属于 {REUSE, WRAP, EXTRACT_PURE_FUNCTION, MIGRATE_INCREMENTALLY, DEPRECATE_WITH_REASON}。
- [ ] `legacy-audit.ts` 中每个旧模块都有 `LegacyModuleProfile` 记录。
- [ ] 测试通过且覆盖率计入 `src/server/cleaning/**`。

**失败回滚方式**

- 删除 `src/server/cleaning/` 下新增文件；保留 docs 规划文档。

**建议 Commit 消息**

```
docs: add Phase 2 cleaning integration plan
feat(audit): add legacy data-cleaning side-effect audit
```

---

### Phase 2B：Legacy Adapter

**目标**

- 为可复用/可包装的旧函数创建不可变、无副作用、类型安全的 Adapter。
- 彻底隔离 import-time 副作用：Adapter 不得触发旧模块的模块级文件读取或日志目录创建。
- 对 `schemas/index.js`、`config/index.js` 做惰性加载包装；对 `operation-logger.js` 构造时的 `mkdirSync` 进行短路。

**修改文件**

- `src/server/cleaning/legacy-audit.ts`（补充 Adapter 映射关系）
- `vitest.config.ts`（调整 coverage include）

**新增文件**

- `src/server/cleaning/adapters/schema-adapter.ts`
- `src/server/cleaning/adapters/config-adapter.ts`
- `src/server/cleaning/adapters/cleaner-adapter.ts`
- `src/server/cleaning/adapters/rules-adapter.ts`
- `src/server/cleaning/adapters/utils-adapter.ts`
- `tests/unit/cleaning/adapters/*.test.ts`

**测试文件**

- `tests/unit/cleaning/adapters/schema-adapter.test.ts`
- `tests/unit/cleaning/adapters/config-adapter.test.ts`
- `tests/unit/cleaning/adapters/cleaner-adapter.test.ts`
- `tests/unit/cleaning/adapters/rules-adapter.test.ts`
- `tests/unit/cleaning/adapters/utils-adapter.test.ts`

每个 Adapter 测试必须断言：

1. 输入对象不被修改。
2. 导入旧模块不创建日志目录。
3. 调用过程不读取 `process.env` 之外的运行时环境。

**完成条件**

- [ ] 所有 Adapter 均通过契约测试。
- [ ] `src/server/cleaning/adapters/` 覆盖率 ≥ 80% lines，≥ 75% branches。
- [ ] Adapter 不直接暴露旧模块的类实例，只暴露纯函数。

**失败回滚方式**

- 回退到 Phase 2A 状态；保留 Adapter 接口草稿，回滚实现。

**建议 Commit 消息**

```
feat(cleaning): add versioned legacy cleaning adapters
```

---

### Phase 2C：领域模型和 CleaningPipeline

**目标**

- 在 `src/server/domain/ingestion.ts` 旁新增 `src/server/domain/cleaning.ts`，同时提供 TypeScript 类型与 Zod Runtime Schema。
- 实现新的 `CleaningPipeline`（TypeScript，不可变，配置化，版本化），替代旧 JS pipeline 的隐式构造。
- 实现 `CustomerSchemaAdapter`，通过版本化 mapping config 将 `CandidateRecord.fields` 映射到中文 schema 字段。
- 明确 `absent`、`undefined`、`null`、空字符串语义，不再无差别复用 `NullToEmptyCleaner`。

**修改文件**

- `src/server/domain/ingestion.ts`（不修改现有类型，仅作为引用）
- `src/server/services/ingestion-service.ts`（不修改业务逻辑，仅 import 新 domain）
- `vitest.config.ts`（必要时排除旧 JS 文件）

**新增文件**

- `src/server/domain/cleaning.ts`
- `src/server/cleaning/config/customer-mapping-v1.ts`
- `src/server/cleaning/pipeline/context.ts`
- `src/server/cleaning/pipeline/normalize-null.ts`
- `src/server/cleaning/pipeline/normalize-phone.ts`
- `src/server/cleaning/pipeline/normalize-date.ts`
- `src/server/cleaning/pipeline/normalize-budget.ts`
- `src/server/cleaning/pipeline/normalize-enum.ts`
- `src/server/cleaning/pipeline/customer-schema-adapter.ts`
- `src/server/cleaning/pipeline/cleaning-pipeline.ts`
- `tests/unit/cleaning/pipeline/*.test.ts`

**测试文件**

- `tests/unit/cleaning/domain/cleaning.test.ts`（Zod schema 校验）
- `tests/unit/cleaning/pipeline/customer-schema-adapter.test.ts`
- `tests/unit/cleaning/pipeline/normalize-null.test.ts`
- `tests/unit/cleaning/pipeline/normalize-date.test.ts`
- `tests/unit/cleaning/pipeline/normalize-budget.test.ts`
- `tests/unit/cleaning/pipeline/normalize-enum.test.ts`
- `tests/unit/cleaning/pipeline/cleaning-pipeline.test.ts`

**完成条件**

- [ ] `cleaning.ts` 中所有领域类型都有对应的 `z.object(...)` 且 `.parse()` 通过。
- [ ] `CustomerSchemaAdapter` 通过版本号选择 mapping config，无硬编码 if/switch。
- [ ] 清洗步骤输入输出均为新对象，原始 `CandidateRecord` 不被修改。
- [ ] 缺失上下文时相对日期只保留原值并产生 warning。

**失败回滚方式**

- 保留 `src/server/domain/cleaning.ts` 类型草稿；删除 pipeline 实现，回退到 Phase 2B。

**建议 Commit 消息**

```
feat(cleaning): implement immutable cleaning pipeline with versioned schema adapter
```

---

### Phase 2D：ValidationEngine

**目标**

- 实现五重 Validator，每重返回 `applicable` 状态；不适用的校验不得伪装为通过。
- 五重：RequiredFieldValidator、TypeValidator、EnumValidator、FormatValidator、LogicConsistencyValidator。
- 统一 `ValidationIssue` 结构，包含稳定错误码、字段、级别（error/warning）、消息、建议。
- 旧 `rules/index.js` 中的状态机校验（`STATE_NOT_INITIAL`）在 V1 新建记录场景下标记为 `applicable=false`。

**修改文件**

- `src/server/domain/cleaning.ts`（补充 ValidationIssue / ValidationRun 类型与 Zod schema）

**新增文件**

- `src/server/cleaning/validation/engine.ts`
- `src/server/cleaning/validation/validator.ts`
- `src/server/cleaning/validation/required-validator.ts`
- `src/server/cleaning/validation/type-validator.ts`
- `src/server/cleaning/validation/enum-validator.ts`
- `src/server/cleaning/validation/format-validator.ts`
- `src/server/cleaning/validation/logic-validator.ts`
- `src/server/cleaning/validation/issue-codes.ts`
- `tests/unit/cleaning/validation/*.test.ts`

**测试文件**

- `tests/unit/cleaning/validation/engine.test.ts`
- `tests/unit/cleaning/validation/required-validator.test.ts`
- `tests/unit/cleaning/validation/type-validator.test.ts`
- `tests/unit/cleaning/validation/enum-validator.test.ts`
- `tests/unit/cleaning/validation/format-validator.test.ts`
- `tests/unit/cleaning/validation/logic-validator.test.ts`
- `tests/unit/cleaning/validation/applicable.test.ts`（专门验证不适用状态）

**完成条件**

- [ ] 每个 Validator 实现 `Validator` 接口：`validate(ctx, record) -> { applicable, issues }`。
- [ ] 不适用状态返回 `applicable: false` 且 `issues` 为空。
- [ ] 非法枚举值直接产生 error，不被默认值覆盖。
- [ ] 缺必填字段直接产生 error。

**失败回滚方式**

- 保留 issue codes 定义；删除 Validator 实现，回退到 Phase 2C。

**建议 Commit 消息**

```
feat(cleaning): implement validation engine and issue codes
```

---

### Phase 2E：IngestionService 集成

**目标**

- 在 `receiveCandidate` 中串接 `CustomerSchemaAdapter → CleaningPipeline → ValidationEngine → QualityReport`。
- 任务状态原子更新：`received` → `candidate_received` → `validating` → `pending_review`。
- 任意环节失败进入 `validation_failed`，记录 `error_code` 与 `error_message`。
- Callback 重放保护：已存在 `candidate` 时直接返回现有 review record；校验失败时幂等返回失败状态。
- `QualityReport` 固定 `review_required=true`、`write_allowed=false`，包含 schema/mapping/ruleset 版本与 `validation_runs`。
- 不调用任何飞书写入接口。

**修改文件**

- `src/server/services/ingestion-service.ts`
- `src/server/domain/ingestion.ts`（扩展 `IngestionTask` 可选字段：`normalized_fields`、`quality_report`、`validation_runs`）
- `src/server/routes/ingestions.ts`（若 Candidate 回调返回体需新增字段，保持向后兼容）
- `tests/unit/ingestion-service.test.ts`（新增测试用例）
- `tests/integration/ingestions.test.ts`（新增集成测试用例）

**新增文件**

- `src/server/cleaning/quality-report.ts`
- `src/server/cleaning/index.ts`（统一对外暴露 pipeline 入口）
- `tests/unit/cleaning/quality-report.test.ts`

**测试文件**

- `tests/unit/ingestion-service.test.ts` 新增：
  - 合法 Candidate 进入 `pending_review`。
  - 非法枚举 Candidate 进入 `validation_failed`。
  - 缺必填字段 Candidate 进入 `validation_failed`。
  - 重复 callback 幂等返回同一 review_record_id。
  - 失败 callback 重放返回同一失败状态。
- `tests/integration/ingestions.test.ts` 新增：
  - Candidate 回调签名通过后返回 `review_record_id`。
  - 返回体包含 `review_required: true`、`write_allowed: false`。

**完成条件**

- [ ] `receiveCandidate` 不再直接设置 `pending_review`，而是先完成完整清洗验证流程。
- [ ] `QualityReport` 中 `review_required=true`、`write_allowed=false` 写死并通过测试断言。
- [ ] 状态更新使用 repository `save` 单条原子写入。
- [ ] 服务端不调用飞书 API、不写文件、不改全局状态。

**失败回滚方式**

- 恢复 `ingestion-service.ts` 到 Phase 2C 之前的版本（git checkout 或手动回退）。

**建议 Commit 消息**

```
feat(ingestion): integrate quality report into candidate callback
```

---

### Phase 2F：固定评测集与评测脚本

**目标**

- 明确 Phase 2 评测口径：不是 LLM 抽取准确率，而是 CandidateRecord 的映射、清洗、验证确定性评测。
- 创建 50 条固定 JSONL 评测数据，每条包含 `case_id`、`input`、`expected.normalized_fields`、`expected.errors`、`expected.warnings`、`tags`。
- 实现评测 runner，复用生产 `CleaningPipeline` + `ValidationEngine`，不复制清洗逻辑。
- 输出字段准确率、Required-field Preservation Recall、Enum Mapping Precision、Validation Detection Recall、安全约束计数。

**新增文件**

- `tests/evaluation/phase2/fixtures.jsonl`
- `tests/evaluation/phase2/runner.ts`
- `tests/evaluation/phase2/metrics.ts`
- `tests/evaluation/phase2/report.ts`
- `tests/evaluation/phase2/README.md`

**测试文件**

- `tests/unit/evaluation/metrics.test.ts`
- `tests/unit/evaluation/runner.test.ts`

**完成条件**

- [ ] fixtures.jsonl 50 条数据全部 schema 合法。
- [ ] runner 能生成 JSON 报告，包含 `overall_score` 与每条失败样本详情。
- [ ] 固定安全约束全部通过（见 PHASE2_EVALUATION_SPEC.md）。
- [ ] 重复运行结果按确定性要求一致（同一 seed/上下文）。

**失败回滚方式**

- 删除 `tests/evaluation/phase2/`；将 runner 降级为临时脚本（按 `_temp_script.md` 处理）。

**建议 Commit 消息**

```
test(cleaning): add fixed Phase 2 evaluation dataset and runner
```

---

### Phase 2G：覆盖率、文档和验收证据

**目标**

- 调整 `vitest.config.ts` coverage 范围：`src/server/cleaning/**` + `src/server/services/ingestion-service.ts` Phase 2 新增逻辑。
- 确保 Lines/Statements/Functions ≥ 80%，Branches ≥ 75%。
- 补齐 `docs/ACCEPTANCE_REPORT.md` 中 Phase 2 验收条目。
- 运行全量测试与覆盖率，输出 `coverage/phase2-coverage.json` 作为验收证据。

**修改文件**

- `vitest.config.ts`
- `docs/ACCEPTANCE_REPORT.md`
- `docs/PROJECT_STATE.md`

**新增文件**

- `coverage/phase2-coverage.json`（由 `test:coverage` 自动生成）
- `docs/reports/PHASE2_ACCEPTANCE_EVIDENCE.md`

**测试文件**

- 无新增独立测试文件；依赖前几阶段测试集合。

**完成条件**

- [ ] `npm run typecheck` 通过。
- [ ] `npm run lint` 通过。
- [ ] `npm run test` 通过（含新增 cleaning 单元测试）。
- [ ] `npm run test:integration` 通过。
- [ ] `npm run test:coverage` 通过，且 coverage 范围与门槛达标。
- [ ] `docs/reports/PHASE2_ACCEPTANCE_EVIDENCE.md` 记录最终覆盖率和评测结果。

**失败回滚方式**

- 若覆盖率未达标，回退部分非核心分支（如扩展的 warning 路径）或补充测试，不允许降低门槛。

**建议 Commit 消息**

```
ci(coverage): finalize Phase 2 coverage and acceptance evidence
```

---

## 三、任务必须可原子提交

| Commit 顺序 | Commit 消息 | 对应子阶段 |
|---|---|---|
| 1 | `docs: add Phase 2 cleaning integration plan` | Planning（本文档） |
| 2 | `feat(audit): add legacy data-cleaning side-effect audit` | 2A |
| 3 | `feat(cleaning): add versioned legacy cleaning adapters` | 2B |
| 4 | `feat(cleaning): implement immutable cleaning pipeline with versioned schema adapter` | 2C |
| 5 | `feat(cleaning): implement validation engine and issue codes` | 2D |
| 6 | `feat(ingestion): integrate quality report into candidate callback` | 2E |
| 7 | `test(cleaning): add fixed Phase 2 evaluation dataset and runner` | 2F |
| 8 | `ci(coverage): finalize Phase 2 coverage and acceptance evidence` | 2G |

禁止将 2A–2G 合并为单个 commit。每个 commit 都必须能独立通过 `npm run test`。

---

## 四、每个任务依赖关系

```
Phase 2A（审计）
  │ 产出：PHASE2_ADAPTER_MAP.md、LegacyModuleProfile
  ▼
Phase 2B（Legacy Adapter）
  │ 依赖审计结论选择 REUSE/WRAP/DEPRECATE
  │ 产出：无副用、不可变、类型安全的 Adapter 层
  ▼
Phase 2C（领域模型 + CleaningPipeline）
  │ 依赖 Adapter 提供的 schema/config/utils 只读接口
  │ domain schemas 在本阶段冻结（TS 类型 + Zod schema）
  │ 产出：CandidateRecord → NormalizedRecord 的确定路径
  ▼
Phase 2D（ValidationEngine）
  │ 依赖 cleaning.ts 中的 ValidationIssue / ValidationRun 合同
  │ ValidationIssue code 在本阶段冻结（issue-codes.ts）
  │ 产出：NormalizedRecord → ValidationRun[]
  ▼
Phase 2E（IngestionService 集成）
  │ 依赖 Pipeline + ValidationEngine + QualityReport
  │ receiveCandidate 调用 cleaning/index.ts 统一入口，避免复制清洗逻辑
  │ 产出：任务状态原子更新与 QualityReport
  ▼
Phase 2F（评测集与评测脚本）
  │ 依赖生产 Pipeline 与 ValidationEngine（不得复制实现）
  │ 产出：50 条 fixtures + runner + 报告
  ▼
Phase 2G（覆盖率与验收）
  │ 依赖前面所有测试
  │ 产出：覆盖率报告与验收证据
```

### 关键依赖说明

- **domain schemas 在 Adapter 之后**：Adapter 只提供配置读取接口，不定义合同；合同在 `src/server/domain/cleaning.ts` 中统一冻结。
- **mapping config 被 CustomerSchemaAdapter 使用**：`customer-mapping-v1.ts` 是配置，不是代码；Adapter 根据 `schema_version` 选择配置对象。
- **ValidationIssue code 在 2D 冻结**：2E/2F 只能使用 issue-codes.ts 中已定义的 code，禁止临时新增字符串。
- **Evaluation runner 复用生产 Pipeline**：runner 必须 import `src/server/cleaning/index.ts` 中的 `processCandidate`，不得另写一套清洗逻辑。
- **IngestionService 避免复制清洗逻辑**：`receiveCandidate` 仅做状态机与 repository 调用，把 CandidateRecord 交给 cleaning 层处理。

---

## 五、必须列出的风险

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| CommonJS / ESM 互操作 | 旧 `src/data-cleaning/**/*.js` 为 CJS，`src/server/**/*.ts` 为 ESM NodeNext | Adapter 层做边界转换；TypeScript 中显式声明 `import type` 与运行时包装函数 |
| import-time 副作用 | `schemas/index.js`、`config/index.js` 模块加载时读文件；`operation-logger.js` 构造时创建目录 | Adapter 延迟加载旧模块；V1 禁用文件日志；测试用 `fs.existsSync` 断言无目录创建 |
| Legacy Cleaner 修改原对象 | 旧 Cleaner 对浅拷贝修改，虽不污染原始对象，但语义上将 null 与 '' 混同 | 新 Pipeline 完全不可变；定义明确空值语义（见 PHASE2_DATA_CONTRACTS.md） |
| Null 语义不兼容 | 旧 `NullToEmptyCleaner` 把 null/undefined 都转为 '' | 新语义：`absent`（字段不存在）、`undefined`（显式缺失）、`null`（显式空）、`''`（空字符串）四者分离 |
| 枚举非法值被默认值覆盖 | `DefaultValueCleaner` 在空值时填充默认值，可能掩盖缺失必填字段 | 必填校验在默认值填充之前执行；非法枚举直接报错 |
| 日期解析依赖当前时间 | `utils.parseDate` 使用 `new Date()`，导致相对日期结果不确定 | 新 `normalizeDate` 必须接收 `received_at`、`timezone`、`locale`；缺失上下文时保留原值并 warning |
| Callback 重放 | 相同 Candidate callback 多次调用可能重复更新状态 | `receiveCandidate` 先检查 `task.candidate`；失败状态也持久化，重放返回同一结果 |
| 状态与 QualityReport 不一致 | `review_required`/`write_allowed` 与 task status 可能不同步 | `QualityReport` 由 Pipeline/Validation 结果唯一决定；status 根据报告结果自动设置 |
| 评测口径虚高 | 若把 LLM 抽取准确率计入 Phase 2，会掩盖映射/清洗问题 | Phase 2 评测仅衡量映射、清洗、验证；input 字段直接来自 fixtures，不调用 LLM |
| 旧测试回归 | 调整 `vitest.config.ts` coverage 范围可能影响既有覆盖率计算 | 保留 `src/server/**` 既有 include，仅新增 `src/server/cleaning/**` 与 ingestion-service 相关范围 |
| 覆盖率通过但分支缺失 | 高 lines coverage 可能掩盖未覆盖的 error/warning 分支 | 要求 Branches ≥ 75%；对 issue codes 与 applicable 路径单独测试 |

---

## 六、验收标准

| Gate | 标准 | 证据 |
|---|---|---|
| 计划完整性 | 4 份规划文档已生成并冻结 | `docs/PHASE2_IMPLEMENTATION_PLAN.md` 等 |
| 架构合规 | 不整体重写 `src/data-cleaning`；新增 `src/server/cleaning/` | 目录结构 diff |
| 状态合规 | V1 `review_required=true`、`write_allowed=false` | 测试断言 + QualityReport 字段 |
| 评测合规 | 50 条 fixtures，评测口径为映射/清洗/验证 | `tests/evaluation/phase2/fixtures.jsonl` + runner 报告 |
| 覆盖率合规 | Lines/Statements/Functions ≥ 80%，Branches ≥ 75% | `coverage/phase2-coverage.json` |
| 安全合规 | 不调用飞书写入、LLM 不写业务主表、无 import-time 副作用 | Adapter 审计表 + 集成测试 |
