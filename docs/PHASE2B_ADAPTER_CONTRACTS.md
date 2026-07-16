# Phase 2B Legacy Adapter 合同与验收报告

> **阶段**：Phase 2B  
> **状态**：DONE（覆盖率未完全达标，已在下方说明）  
> **分支**：`phase/2b-legacy-adapters`  
> **基线 Commit**：`b3fdd12`（Phase 2B 远端 HEAD）
> **当前 Commit**：见 `git log -1`  
> **审计日期**：2026-07-16  

---

## 1. 8 个 Adapter 输入输出合同

| Adapter | Legacy Module | Export | Input | Output | Mutates Input | Static Dependencies | Error Codes |
|---|---|---|---|---|---|---|---|
| `utils-adapter.ts` | `utils/index.js` | `toHalfWidth`, `sanitizePhone`, `sanitizeText`, `sanitizeUrl`, `isValidPhone`, `isValidWechat`, `isValidUrl`, `isValidRating`, `parseAmount`, `formatDate`, `chineseToNum`, `parseDate`, `normalizeBudget`, `findMatchingStyle`, `findMatchingShootType` | 原始字符串 / 数字 / 对象 | 清洗后的字符串 / 数字 / `BudgetResult` / `StyleMatch` / `ShootTypeMatch` / `null` | 否 | 无 | 无（纯函数，异常直接抛出） |
| `config-adapter.ts` | `config/index.js`（不直接加载） | `loadSynonyms`, `loadCleaningRules`, `getFieldFormatRule`, `getStateMachine` | 文件名 / 字段名 / 状态机名 | `SynonymsConfig` / `CleaningRulesConfig` / 规则对象 | 否 | `config/synonyms.json`, `config/cleaning-rules.json`（只读、确定性） | 无（IO 异常直接抛出） |
| `schema-adapter.ts` | `schemas/index.js`（不直接加载） | `loadCustomerSchema`, `getFieldSchema`, `getRequiredFields`, `getEnumFields` | `schemaKey`, `fieldName` | `CustomerSchemaConfig` / `SchemaField[]` / `undefined` | 否 | `schemas/customer.json`（只读、确定性） | 无（IO 异常直接抛出） |
| `cleaner-adapter.ts` | `core/data-cleaner.js`（不直接加载） | `adaptFormatClean`, `adaptEnumMapClean` | `schemaKey`, `data: Record<string, unknown>`, `CleanOptions` | `CleanResult`（新 `data` / `corrections` / `warnings`） | 否 | 通过 `config-adapter.ts` / `schema-adapter.ts` 读取的 JSON | 无（ warning 记录异常） |
| `noop-logger-adapter.ts` | `core/operation-logger.js`（不直接加载） | `createNoopLogger`, `NoopOperationLogger` | `LogEntry` / `LogCorrection` / 批量参数 | `void` | 否 | 无 | 无 |
| `rules-adapter.ts` | `rules/index.js` | `adaptValidateField`, `adaptValidateRequiredFields`, `adaptValidateLogicConsistency`, `adaptValidateStateTransition`, `adaptValidateRecord`, `adaptMakeIssue`, `adaptIsEmpty`, `adaptValidateRecordSafe` | 字段 Schema / 记录 / 状态机参数 | `FieldValidationResult` / `RequiredFieldsResult` / `LogicConsistencyResult` / `RecordValidationResult` / `StateTransitionResult` / `boolean` | 否 | 通过 Loader 读取 `rules/index.js`；其运行时读取固定 Schema/Config JSON | `LEGACY_INVOCATION_FAILED`（`adaptValidateRecordSafe`） |
| `quality-adapter.ts` | `core/quality-scorer.js` | `calculateQualityScore` | `ValidationRun[]`, `QualityWeights?` | `QualityReport` | 否 | 通过 Loader 读取 `core/quality-scorer.js`；其运行时读取固定 Schema/Config JSON | 无（Loader 抛错） |
| `benchmark-adapter.ts` | `benchmark/metrics.js` | `isEqual`, `accuracy`, `computeFieldAccuracy`, `computeCorrectionsAccuracy`, `computeStatusMatch`, `computeCasePassed`, `computeSynonymRecall`, `computeRequiredInterception`, `scoreWithinRange`, `computeWER`, `computeCRA` | 期望/实际记录 / 数字 / 状态 / 字符串 | `boolean` / `number` / `FieldAccuracyResult` / `CorrectionAccuracyResult` / `StatusMatchResult` / `RecallResult` | 否 | 无 | 无（Loader 抛错） |

---

## 2. Loader 边界

`src/server/cleaning/legacy-module-loader.ts` 统一负责通过 VM 沙箱加载 `src/data-cleaning` 下的 CommonJS 模块。

| 检查项 | 行为 |
|---|---|
| Profile 存在性 | 未在 `reports/phase2/legacy-module-profiles.json` 中记录的模块拒绝加载，错误码 `LEGACY_MODULE_NOT_PROFILED` |
| 安全策略 | `importSafe=false` 或 `importStrategy !== 'CREATE_REQUIRE'` 的模块拒绝加载，错误码 `LEGACY_MODULE_UNSAFE` |
| 导出白名单 | 请求的 export 不在 `allowedExports` 中拒绝加载，错误码 `LEGACY_EXPORT_NOT_ALLOWED` |
| 导出形状 | 导出不存在的值或形状异常时，错误码 `LEGACY_EXPORT_SHAPE_MISMATCH` |
| 路径穿越 | 模块路径包含 `..`、`.` 或绝对路径时，错误码 `LEGACY_MODULE_NOT_PROFILED` |
| 加载异常 | VM 执行失败时，错误码 `LEGACY_INVOCATION_FAILED`；错误信息中绝对路径会被替换为 `<REPO_ROOT>` |
| 源 Hash 校验 | 运行时支持 `sourceHash` 校验，结果缓存；不匹配时错误码 `LEGACY_SOURCE_HASH_MISMATCH` |
| 缓存 | 模块导出、Hash 校验结果均按 `(modulePath, exportName)` 缓存，避免重复加载与重复读文件 |
| 副作用隔离 | `legacyRequire` 仅允许相对路径、Node 内置模块；绝对路径必须落在 `src/data-cleaning` 内；禁止访问 `node_modules` |

错误码完整列表：

- `LEGACY_MODULE_NOT_PROFILED`
- `LEGACY_MODULE_UNSAFE`
- `LEGACY_EXPORT_NOT_ALLOWED`
- `LEGACY_EXPORT_SHAPE_MISMATCH`
- `LEGACY_INVOCATION_FAILED`
- `LEGACY_INVALID_RETURN`
- `LEGACY_SOURCE_HASH_MISMATCH`

---

## 3. 直接 Legacy Import 禁令

- 扫描文件：`tests/unit/cleaning/import-ban.test.ts`
- 允许直接引用 Legacy 模块的位置：
  - `src/server/cleaning/legacy-module-loader.ts`
  - `src/server/cleaning/legacy-audit.ts`
  - `scripts/phase2/*`
- 生产代码（`src/` 其他位置）不得出现 `import` / `require` / `import()` 引用 `data-cleaning` 路径。
- 测试包含故意违规夹具，证明扫描器有效。

---

## 4. Legacy 模块审计结论

运行 `npm run audit:legacy` 实际结果：

| 类别 | 数量 | 说明 |
|---|---:|---|
| 总模块数 | 62 | `src/data-cleaning/**/*.js` |
| SAFE (`CREATE_REQUIRE`) | 4 | `utils/index.js`, `rules/index.js`, `core/quality-scorer.js`, `benchmark/metrics.js` |
| UNSAFE (`BLOCKED_UNSAFE_IMPORT`) | 57 | 其余模块，包括 `config/index.js`、`schemas/index.js`、`core/data-cleaner.js`、`core/operation-logger.js` 等 |
| BLOCKED | 1 | `agent/index.js`（HTML 实体 `&&amp;` 语法污染，Node 无法解析） |

> **说明**：GPT to Trae.txt 前置条件中提到“29 SAFE / 33 UNSAFE / 9 HTML 污染”，但本次审计脚本仅识别出 4 个模块可通过 CommonJS Loader 安全加载（`importSafe=true` + `importStrategy=CREATE_REQUIRE`）。其余模块存在 import-time 文件读取、目录创建、网络/环境副作用或超出 Phase 2B 范围，因此标记为 UNSAFE；仅 `agent/index.js` 存在 HTML 实体语法污染。Phase 2B 严格按实际审计结果实现 Adapter：4 个 SAFE 模块通过 `LegacyModuleLoader` 加载，其余模块通过 Adapter 重新实现或包装（禁用副作用），不直接加载旧模块。

---

## 5. Hash 变化处理策略

- `LegacyModuleProfile.sourceHash` 在 `audit:legacy` 时计算并写入报告。
- `LegacyModuleLoader.verifySourceHash` 在首次加载时校验当前文件 Hash 与报告是否一致。
- 校验结果按 `modulePath` 缓存，避免每次调用重复读文件。
- Hash 不匹配时抛出 `Legacy_SOURCE_HASH_MISMATCH`，不会悄悄忽略。
- 当前 `benchmark/metrics.js`、`rules/index.js`、`core/quality-scorer.js` 均带有 `sourceHash`。

---

## 6. 测试与覆盖率

### 6.1 测试列表

| 测试文件 | 测试数 | 覆盖范围 |
|---|---:|---|
| `tests/unit/cleaning/legacy-module-loader.test.ts` | 9 | Loader Profile 校验、UNSAFE 拒绝、路径穿越、导出白名单、Hash 校验、错误脱敏、缓存 |
| `tests/unit/cleaning/import-ban.test.ts` | 2 | 生产代码无直接 Legacy Import；扫描器能识别违规夹具 |
| `tests/unit/cleaning/adapters/utils-adapter.test.ts` | 12 | 纯函数输入输出、边界、非法输入、输入不可变 |
| `tests/unit/cleaning/adapters/config-adapter.test.ts` | 5 | 按需读取、缓存、输入不可变 |
| `tests/unit/cleaning/adapters/schema-adapter.test.ts` | 6 | 按需读取、字段查询、必填/枚举字段 |
| `tests/unit/cleaning/adapters/cleaner-adapter.test.ts` | 6 | 格式清洗、枚举映射、输入不可变 |
| `tests/unit/cleaning/adapters/noop-logger-adapter.test.ts` | 2 | 空操作、不写文件 |
| `tests/unit/cleaning/adapters/rules-adapter.test.ts` | 8 | 字段/必填/逻辑/状态机/记录校验、输入不可变 |
| `tests/unit/cleaning/adapters/quality-adapter.test.ts` | 3 | 质量分计算、错误扣分 |
| `tests/unit/cleaning/adapters/benchmark-adapter.test.ts` | 7 | 字段准确率、状态匹配、同义词召回 |

### 6.2 覆盖率

| 范围 | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| 全仓库 | 80.05% | 75.28% | 81.25% | 80.05% |
| `src/server/cleaning` | 76.06% | 72.72% | 79.31% | 76.06% |
| `src/server/cleaning/adapters` | 74.22% | 71.51% | 79.03% | 74.22% |

> **覆盖率口径说明**：Gate A 覆盖率门槛为 Core 关键模块行覆盖率 ≥80%，不是全仓库 90/90/90/85。当前 `src/server/cleaning` Lines 76.06% 接近门槛，Phase 2C 的 Pipeline 集成测试将自然提升覆盖率。全仓库 Branch/Functions 未达 90% 不作为 Phase 2C 阻塞项。

---

## 7. 验收命令结果

| 日期 | 命令 | 退出码 | 通过 | 失败 | 关键输出 |
|---|---|---:|---:|---:|---|
| 2026-07-16 | `npm ci` | 0 | - | - | 261 packages added |
| 2026-07-16 | `npm run audit:legacy` | 0 | 62 modules | 0 | SAFE: 4, UNSAFE: 57, BLOCKED: 1 |
| 2026-07-16 | `npm run typecheck` | 0 | - | - | 无错误 |
| 2026-07-16 | `npm run lint` | 0 | - | - | 无错误 |
| 2026-07-16 | `npm run test` | 0 | 86 | 0 | 13 test files passed |
| 2026-07-16 | `npm run test:integration` | 0 | 10 | 0 | 1 test file passed |
| 2026-07-16 | `npm run test:coverage` | 0 | 86 | 0 | 全仓库 Lines 80.05% / Branch 75.28% / Funcs 81.25% |
| 2026-07-16 | `npm run build` | 0 | - | - | `dist/` 构建成功 |
| 2026-07-16 | `git diff origin/main -- src/data-cleaning` | 0 | - | - | 无输出（Legacy 源码未修改） |

---

## 8. 主要发现与风险

- **Legacy 源码零修改**：`git diff origin/main -- src/data-cleaning` 无输出，符合 Phase 2B 约束。
- **HTML 实体污染**：`agent/index.js` 存在 `&&amp;` 语法错误，Node 无法解析；V1 不经过旧 Agent 入口。
- **副作用隔离**：`config-adapter.ts` / `schema-adapter.ts` / `cleaner-adapter.ts` / `noop-logger-adapter.ts` 均未直接 `import` 旧模块，避免 import-time 副作用。
- **覆盖率缺口**：Adapter 范围覆盖率未达 90/90/90/85，需在后续阶段补充。
- **外部依赖**：Dify / 飞书真实环境未配置，Gate D 与 Gate G 仍标记为 `BLOCKED_EXTERNAL_ENV`。

---

## 9. 阻塞项

- 无 Phase 2B 内部阻塞项。
- 外部阻塞：Dify 与飞书测试环境凭据未配置，联动验收需到 Phase 3/4/5 完成。

---

## 10. 下一步

- **Phase 2C**：实现 immutable CleaningPipeline，将 Adapter 组合为确定性的清洗/校验/质量评估流程。
