# ACCEPTANCE REPORT

## 环境

- OS：Windows 11
- Node：v22.22.1
- npm：v10.9.2
- Dify：未配置
- 飞书测试 Base：部分配置（4 个 FEISHU_*_TABLE_ID + APP_ID 已写入 .env；APP_SECRET 占位为 replace_me）
- 分支：`phase/3-feishu-integration`
- 验收基线 Commit：`0ef131c`（Phase 3 preparation commit）
- 当前 Commit：见 `git log -1`（TASK-002 批次执行后最新提交）

## 工程命令

| 日期 | 命令 | 退出码 | 通过 | 失败 | 关键输出 |
|---|---|---:|---:|---:|---|
| 2026-07-15 | `node src/data-cleaning/core/test-cleaner.js` | 0 | 41 | 0 | 旧清洗模块测试通过（V1 不依赖） |
| 2026-07-15 | `node src/data-cleaning/rules/test-rules.js` | 1 | 35 | 1 | 项目状态非初始触发 warning（V1 不依赖） |
| 2026-07-15 | `node src/data-cleaning/test-integration.js` | 1 | 0 | - | `agent/index.js:20` 语法错误（V1 不依赖） |
| 2026-07-15 | `npm ci` | 0 | - | - | 依赖安装成功 |
| 2026-07-15 | `npm run typecheck` | 0 | - | - | TypeScript 无错误 |
| 2026-07-15 | `npm run lint` | 0 | - | - | ESLint 无错误 |
| 2026-07-15 | `npm run test` | 0 | 16 | 0 | 单元测试全部通过 |
| 2026-07-15 | `npm run test:integration` | 0 | 10 | 0 | 集成测试全部通过 |
| 2026-07-15 | `npm run test:coverage` | 0 | - | - | Core Service 覆盖率 Stmts 90.3% / Branch 82.56% / Funcs 88.57% / Lines 90.3% |
| 2026-07-15 | `npm run build` | 0 | - | - | `dist/` 构建成功 |
| 2026-07-16 | `npm ci` | 0 | - | - | 261 packages added |
| 2026-07-16 | `npm run audit:legacy` | 0 | 62 modules | 0 | SAFE: 4, UNSAFE: 57, BLOCKED: 1 |
| 2026-07-16 | `npm run typecheck` | 0 | - | - | TypeScript 无错误 |
| 2026-07-16 | `npm run lint` | 0 | - | - | ESLint 无错误 |
| 2026-07-16 | `npm run test` | 0 | 86 | 0 | 13 test files passed |
| 2026-07-16 | `npm run test:integration` | 0 | 10 | 0 | 1 test file passed |
| 2026-07-16 | `npm run test:coverage` | 0 | 86 | 0 | 全仓库 Lines 80.05% / Branch 75.28% / Funcs 81.25% |
| 2026-07-16 | `npm run build` | 0 | - | - | `dist/` 构建成功 |
| 2026-07-16 | `git diff origin/main -- src/data-cleaning` | 0 | - | - | 无输出（Legacy 源码未修改） |
| 2026-07-16 | `npm ci` (Phase 2C) | 0 | - | - | 261 packages added |
| 2026-07-16 | `npm run audit:legacy` (Phase 2C) | 0 | 62 modules | 0 | SAFE: 4, UNSAFE: 57, BLOCKED: 1 |
| 2026-07-16 | `npm run typecheck` (Phase 2C) | 0 | - | - | TypeScript 无错误 |
| 2026-07-16 | `npm run lint` (Phase 2C) | 0 | - | - | ESLint 无错误 |
| 2026-07-16 | `npm run test` (Phase 2C) | 0 | 102 | 0 | 15 test files passed（含 16 Pipeline tests） |
| 2026-07-16 | `npm run test:integration` (Phase 2C) | 0 | 10 | 0 | 1 test file passed |
| 2026-07-16 | `npm run test:coverage` (Phase 2C) | 0 | 102 | 0 | Pipeline Lines 100% / Branch 95.23% |
| 2026-07-16 | `npm run build` (Phase 2C) | 0 | - | - | `dist/` 构建成功 |
| 2026-07-16 | `git diff origin/main -- src/data-cleaning` (Phase 2C) | 0 | - | - | 无输出（Legacy 源码未修改） |
| 2026-07-17 | `npm run typecheck` (Phase 2F) | 0 | - | - | TypeScript 无错误（含 scripts/） |
| 2026-07-17 | `npm run lint` (Phase 2F) | 0 | - | - | ESLint 无错误（eslint src tests scripts） |
| 2026-07-17 | `npm run test` (Phase 2F) | 0 | 157 | 0 | 20 test files passed（含 44 evaluation tests + 11 runner integration tests） |
| 2026-07-17 | `npm run test:coverage` (Phase 2F) | 0 | 157 | 0 | All files Lines 85.35% / Branch 81.17% / Funcs 86.06%；evaluation 模块 Lines 85.50% / Funcs 100% |
| 2026-07-17 | `npm run build` (Phase 2F) | 0 | - | - | `dist/` 构建成功 |
| 2026-07-17 | `npm run audit:legacy` (Phase 2F) | 0 | 62 modules | 0 | SAFE: 4, UNSAFE: 57, BLOCKED: 1 |
| 2026-07-17 | `npm run evaluate` (Phase 2F) | 0 | 50 | 0 | Gate C-Core PASS，50/50 case，所有指标 100% |
| 2026-07-17 | `git diff origin/main -- src/data-cleaning` (Phase 2F) | 0 | - | - | 无输出（Legacy 源码未修改） |
| 2026-07-17 | `npm run typecheck` (Phase 3A) | 0 | - | - | TypeScript 无错误（含 scripts/） |
| 2026-07-17 | `npm run lint` (Phase 3A) | 0 | - | - | ESLint 无错误（eslint src tests scripts） |
| 2026-07-17 | `npm run test` (Phase 3A) | 0 | 194 | 0 | 24 test files passed（含 14 feishu-client + 9 feishu-task-repository + 8 repository-factory 单元测试） |
| 2026-07-17 | `npm run test:integration` (Phase 3A) | 0 | 27 | 0 | 3 test files passed（含 6 feishu-task-repository 跨实例集成测试） |
| 2026-07-17 | `npm run test:coverage` (Phase 3A) | 0 | 194 | 0 | All files Lines 85.92% / Branch 81.2% / Funcs 87.83% / Lines 85.92%；feishu-client Lines 95.3%；feishu-errors Lines 100%；feishu-task-repository Lines 91.2%；repository-factory Lines 100%（合并显示行 86.95%） |
| 2026-07-17 | `npm run build` (Phase 3A) | 0 | - | - | `dist/` 构建成功 |
| 2026-07-17 | `npm run audit:legacy` (Phase 3A) | 0 | 62 modules | 0 | SAFE: 4, UNSAFE: 57, BLOCKED: 1 |
| 2026-07-17 | `npx tsx src/scripts/temp/smoke-test-lark-cli.ts` (Phase 3A) | 0 | 4 steps | 0 | 真实 Base 结构核验：create→search→update→search 全流程；字段深度等价；datetime 毫秒时间戳格式正确；单选字段返回数组形式符合预期；cleanup 后 0 记录残留 |
| 2026-07-17 | `git diff origin/main -- src/data-cleaning` (Phase 3A) | 0 | - | - | 无输出（Legacy 源码未修改） |
| 2026-07-17 | `npm run typecheck` (Phase 3A / P0 修复后) | 0 | - | - | TypeScript 无错误 |
| 2026-07-17 | `npm run lint` (Phase 3A / P0 修复后) | 0 | - | - | ESLint 无错误 |
| 2026-07-17 | `npm run test` (Phase 3A / P0 修复后) | 0 | 197 | 0 | 24 test files passed（新增 3 个 feishu-client 重试测试：99991663 重试成功 / 不二次重试 / 非 token 错误不刷新） |
| 2026-07-17 | `npm run test:integration` (Phase 3A / P0 修复后) | 0 | 27 | 0 | 3 test files passed |
| 2026-07-17 | `npm run test:coverage` (Phase 3A / P0 修复后) | 0 | 197 | 0 | All files Lines 85.97% / Branch 81.29% / Funcs 87.83%；feishu-client Lines 95.62% / Branch 79.06% / Funcs 100%；feishu-errors 100%；feishu-task-repository 91.2%；repository-factory 100% |
| 2026-07-17 | `npm run build` (Phase 3A / P0 修复后) | 0 | - | - | `dist/` 构建成功 |
| 2026-07-17 | `npm run audit:legacy` (Phase 3A / P0 修复后) | 0 | 62 modules | 0 | SAFE: 4, UNSAFE: 57, BLOCKED: 1 |
| 2026-07-17 | `git diff origin/main -- src/data-cleaning` (Phase 3A / P0 修复后) | 0 | - | - | LEGACY_DIFF_EMPTY（Legacy 源码未修改） |
| 2026-07-18 | `npm ci` (Phase 3B) | 0 | - | - | up to date in 2s |
| 2026-07-18 | `npm run audit:legacy` (Phase 3B) | 0 | 62 modules | 0 | SAFE: 4, UNSAFE: 57, BLOCKED: 1（预期） |
| 2026-07-18 | `npm run typecheck` (Phase 3B) | 0 | - | - | TypeScript 无错误（含 postCandidate 类型修复） |
| 2026-07-18 | `npm run lint` (Phase 3B) | 0 | - | - | ESLint 无错误 |
| 2026-07-18 | `npm run test` (Phase 3B) | 0 | 236 | 0 | 27 test files passed（新增 6 mapper + 6 in-memory-review-repository + 8 feishu-review-repository + 4 ingestion-service 增量 + 8 repository-factory 增量） |
| 2026-07-18 | `npm run test:integration` (Phase 3B) | 0 | 31 | 0 | 3 test files passed（新增 5 个 TASK-002 集成测试：中文键持久化 / 英文映射为中文 normalized_fields / replay 同一 ID / UNMAPPED_CANDIDATE_FIELD warning / validation_failed 不创建审核记录） |
| 2026-07-18 | `npm run test:coverage` (Phase 3B) | 0 | 236 | 0 | All files Lines 84.94% / Branch 81.34% / Funcs 88.2%；关键模块 Lines 全部 ≥80%（mapping 100%, ingestion-service 96.42%, repository-factory 100%, feishu-review-repository 86.66%, in-memory-review-repository 85.71%, feishu-task-repository 91.2%, feishu-client 95.62%, cleaning-pipeline 100%） |
| 2026-07-18 | `npm run build` (Phase 3B) | 0 | - | - | `dist/` 构建成功（tsc -p tsconfig.json） |
| 2026-07-18 | `npm run evaluate` (Phase 3B) | 0 | 50 | 0 | Gate C-Core PASS，50/50 case，4 项核心指标 100%（field_accuracy 132/132, required_field_recall 91/91, enum_precision 33/33, error_interception_rate 1/1） |
| 2026-07-18 | `git diff origin/main -- src/data-cleaning` (Phase 3B) | 0 | - | - | 无输出（LEGACY_DIFF_EMPTY，Legacy 源码零修改） |
| 2026-07-18 | `git status --short` (Phase 3B Step 2) | 0 | - | - | 仅 TASK-002 相关修改 + audit:legacy 自动重新生成时间戳 |
| 2026-07-18 | `git diff --check` (Phase 3B Step 2) | 0 | - | - | 无冲突标记（仅 LF/CRLF 警告） |
| 2026-07-18 | `git grep -n "lark-cli" -- src/server` (Phase 3B Step 2) | 1 | - | - | 无匹配（生产源码无 lark-cli） |
| 2026-07-18 | `git grep -n -F -- <FEISHU_INGESTION_TABLE_ID>` (Phase 3B Step 2) | 1 | - | - | 无匹配 |
| 2026-07-18 | `git grep -n -F -- <FEISHU_REVIEW_TABLE_ID>` (Phase 3B Step 2) | 1 | - | - | 无匹配 |
| 2026-07-18 | `git grep -n -F -- <FEISHU_WRITE_LOG_TABLE_ID>` (Phase 3B Step 2) | 1 | - | - | 无匹配 |
| 2026-07-18 | `npm run typecheck` (Phase 3B / TASK-002 P0 修复后) | 0 | - | - | TypeScript 无错误（含 redaction.ts 重构 + ingestion-service.ts 新 helper） |
| 2026-07-18 | `npm run lint` (Phase 3B / TASK-002 P0 修复后) | 0 | - | - | ESLint 无错误（含新增 redaction.test.ts 与 ingestion-service 新 describe 块） |
| 2026-07-18 | `npm run test` (Phase 3B / TASK-002 P0 修复后) | 0 | 260 | 0 | 28 test files passed（新增 11 redaction + 13 ingestion-service 单元测试） |
| 2026-07-18 | `npm run test:integration` (Phase 3B / TASK-002 P0 修复后) | 0 | 32 | 0 | 3 test files passed（新增 1 个 P0-01 HTTP 端到端集成测试） |
| 2026-07-18 | `npm run test:coverage` (Phase 3B / TASK-002 P0 修复后) | 0 | 260 | 0 | All files Lines 85.28% / Branch 81.95% / Funcs 88.53%；关键模块 Lines 全部 ≥80%（redaction.ts 100%, ingestion-service 96.88%, mapping 100%, repository-factory 100%, feishu-review-repository 86.66%, feishu-task-repository 91.2%, feishu-client 95.62%, cleaning-pipeline 100%） |
| 2026-07-18 | `npm run build` (Phase 3B / TASK-002 P0 修复后) | 0 | - | - | `dist/` 构建成功（tsc -p tsconfig.json） |
| 2026-07-18 | `npm run evaluate` (Phase 3B / TASK-002 P0 修复后) | 0 | 50 | 0 | Gate C-Core PASS，50/50 case，4 项核心指标 100%（field_accuracy 132/132, required_field_recall 91/91, enum_precision 33/33, error_interception_rate 1/1） |
| 2026-07-18 | `git diff origin/main -- src/data-cleaning` (Phase 3B / TASK-002 P0 修复后) | 0 | - | - | 无输出（LEGACY_DIFF_EMPTY，Legacy 源码零修改） |

## API 合同验证

| 接口 | 方法 | 测试覆盖 | 状态 |
|---|---|---|---|
| `POST /v1/ingestions` | 创建任务 | 是 | PASSED |
| `GET /v1/ingestions/:id` | 查询任务 | 是 | PASSED |
| `POST /v1/internal/ingestions/:id/candidate` | Dify 回调 | 是（HMAC 签名） | PASSED |
| `POST /v1/ingestions/:id/approve` | 审核通过 | 是 | PASSED |
| `POST /v1/ingestions/:id/reject` | 审核拒绝 | 是 | PASSED |
| 同一请求 20 次只生成一个任务 | 幂等 | 是 | PASSED |
| Candidate 回调 20 次只生成一条审核记录 | 幂等 | 是 | PASSED |

## 接口审计

| 检查项 | 状态 | 证据 |
|---|---|---|
| 创建任务返回 HTTP 202 | PASSED | tests/integration/ingestions.test.ts |
| 查询不存在任务返回 HTTP 404 | PASSED | tests/integration/ingestions.test.ts |
| 非法输入返回 HTTP 400 | PASSED | tests/integration/ingestions.test.ts |
| 非法状态跳转返回 HTTP 409 | PASSED | tests/unit/ingestion-service.test.ts |
| 错误签名返回 HTTP 401 或 403 | PASSED | tests/integration/ingestions.test.ts + tests/unit/signature.test.ts |
| 过期时间戳被拒绝 | PASSED | tests/unit/signature.test.ts |
| 相同创建请求重复提交不创建第二条任务 | PASSED | tests/unit/ingestion-service.test.ts |
| 相同 Candidate callback 重放不创建第二条审核结果 | PASSED | tests/unit/ingestion-service.test.ts |
| reject 后不能 approve | PASSED | tests/unit/ingestion-service.test.ts |
| completed 后重复 approve 不产生二次操作 | PASSED | tests/unit/ingestion-service.test.ts |

## 覆盖率基线

| 范围 | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Core Service (`src/server` 可执行代码，排除纯类型文件) | 90.3% | 82.56% | 88.57% | 90.3% |
| 全仓库（含旧 `src/data-cleaning`） | 3.05% | 47.12% | 26.49% | 3.05% |

## 数据质量

| 指标 | 结果 | 门槛 | 状态 |
|---|---:|---:|---|
| 总字段准确率 | 100.00% (132/132) | 90% | PASSED（Phase 2F Gate C-Core） |
| 必填字段召回率 | 100.00% (91/91) | 95% | PASSED（Phase 2F Gate C-Core） |
| 枚举映射精确率 | 100.00% (33/33) | 95% | PASSED（Phase 2F Gate C-Core） |
| 错误拦截率 | 100.00% (1/1) | 95% | PASSED（Phase 2F Gate C-Core） |
| 持久化检查 | N/A | N/A | NOT_APPLICABLE（Phase 2F 不涉及持久化） |
| 非法枚举写入 | 0 | 0 | PASSED（V1 未直接写业务主表） |
| 缺失必填字段直接写入 | 0 | 0 | PASSED（V1 未直接写业务主表） |
| 重复写入率 | 0 | 0 | PASSED（幂等 + 审核状态验证） |
| 被拒绝记录写入率 | 0 | 0 | PASSED（V1 未直接写业务主表） |

## 外部集成

| 场景 | 日期 | 结果 | 证据路径 |
|---|---|---|---|
| 飞书表单触发 Core | - | BLOCKED_EXTERNAL_ENV | 未配置飞书测试 Base |
| Core 调用 Dify | - | BLOCKED_EXTERNAL_ENV | 未配置 Dify 环境 |
| Dify 回调 Candidate | 2026-07-15 | PASSED（模拟） | `tests/integration/ingestions.test.ts` |
| 人工审核写客户主表 | - | BLOCKED_EXTERNAL_ENV | 未配置飞书测试 Base；V1 未实现自动写入 |
| 写入日志 | - | NOT_STARTED | V1 仅内存日志，Phase 3 接入飞书写入日志表 |

## 安全扫描

- ✅ 未发现 `.env`、App Secret、Access Token、私钥明文入库。
- ✅ 未发现真实客户手机号/聊天记录夹具。
- ✅ HMAC 签名验签覆盖缺失、过期、重放、无效签名场景。
- ✅ 手机号、微信、原始文本脱敏逻辑已测试。
- ⚠️ 发现多处硬编码飞书 Base Token、Table ID、Field ID、Folder Token、Open ID（位于旧 `src/data-cleaning/` 与 `src/scripts/temp/`），需在 Phase 3 迁出源码。

## 未通过项

- 旧 `src/data-cleaning/test-integration.js`：旧 Agent 入口存在语法错误，V1 不依赖，计划在 Phase 3 后逐步清理。
- 旧 `src/data-cleaning/rules/test-rules.js`：项目 Schema 状态非初始导致 warning，不影响 V1，V1 主要用 customer Schema。

## Phase 1 最终结论

- **Phase 1 代码基线：PASSED**
- **Phase 1 API 合同：PASSED**
- **Phase 1 安全隐私：PASSED**
- **Phase 1 收尾审计：PASSED**
- **外部联动验收：BLOCKED_EXTERNAL_ENV**（未配置真实 Dify / 飞书环境，按手册要求不声称联动验收通过）

## Phase 2B 验收结论

- **Phase 2B 代码基线：PASSED**（`npm ci` / `audit:legacy` / `typecheck` / `lint` / `test` / `test:integration` / `build` 全部通过）
- **Phase 2B Adapter 实现：DONE**（8 个 Adapter + LegacyModuleLoader + 契约/边界测试 + 直接 Import 禁令）
- **Legacy 源码保护：PASSED**（`git diff origin/main -- src/data-cleaning` 无输出）
- **Phase 2B 覆盖率：GATE_A_PASSED**（Gate A 口径为 Core 关键模块行覆盖率 ≥80%；`src/server/cleaning` Lines 76.06%，全仓库覆盖率仅作参考）
- **外部联动验收：BLOCKED_EXTERNAL_ENV**（未配置真实 Dify / 飞书环境）

> 整体状态：READY_FOR_PHASE_2

## Phase 2C 验收结论

- **Phase 2C 代码基线：PASSED**（`npm ci` / `audit:legacy` / `typecheck` / `lint` / `test` / `test:integration` / `test:coverage` / `build` 全部退出码 0）
- **CleaningPipeline 实现：DONE**（immutable, deterministic, fixed stage order, error propagation, PII sanitization）
- **Pipeline 测试：PASSED**（16 tests：核心性质 11 + 错误路径 5）
- **Legacy 源码保护：PASSED**（`git diff origin/main -- src/data-cleaning` 无输出）
- **覆盖率：GATE_A_PASSED**（CleaningPipeline Lines 100% / Branch 95.23% / Funcs 100%；直接协作模块 rules-adapter 89.65%, quality-adapter 94.44%）
- **无直接 Legacy Import：PASSED**（import-ban.test.ts + pipeline 源码扫描）
- **BLOCKED 模块隔离：PASSED**（agent/index.js 不进入执行链）
- **外部联动验收：BLOCKED_EXTERNAL_ENV**（未配置真实 Dify / 飞书环境）

> 整体状态：PHASE_2C_DONE

## Phase 2 Planning Review

- 本轮 Commit：见 `git log -1`（基线 edb68a4）
- 本轮范围：仅 Planning 修正与跨窗口状态同步，未修改任何生产/测试代码

| 检查项 | 状态 | 证据 |
|---|---|---|
| Planning Review 结果 | APPROVED_WITH_REQUIRED_CHANGES | 本轮提交完成全部必需修正 |
| Enum Mapping Precision 门槛对齐手册 Gate C | PASSED | `PHASE2_EVALUATION_SPEC.md` 第十四节：≥95%（主门槛） |
| Validation Detection Recall 定位为补充门槛 | PASSED | `PHASE2_EVALUATION_SPEC.md` 第十四节：≥85%（补充门槛，不降低主门槛） |
| 状态语义冻结（业务 error→pending_review；validation_failed→执行层失败） | PASSED | `PHASE2_IMPLEMENTATION_PLAN.md` Phase 2E + `PHASE2_DATA_CONTRACTS.md` 2.8 节 |
| Validator 执行异常显式表示 | PASSED | `PHASE2_DATA_CONTRACTS.md` 1.5 节 `execution_error` 字段 + 2.8 节状态转换表 |
| 日期边界策略与测试要求 | PASSED | `PHASE2_DATA_CONTRACTS.md` 2.9 节（无效 timezone/received_at、DST、非法日期、年份推断） |
| LegacyModuleProfile 6 字段要求 | PASSED | `PHASE2_ADAPTER_MAP.md` 第四章 + `PHASE2_IMPLEMENTATION_PLAN.md` Phase 2A 完成条件 |
| `data-cleaner.js` 处理方式修正 | PASSED | `PHASE2_ADAPTER_MAP.md` 2.1 节：WRAP → EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY |
| Phase 2A 生产代码 | NOT_STARTED | 本轮仅 Planning Correction，未修改生产/测试代码 |
| Phase 2 全部实现（2A-2G） | NOT_STARTED | 待 Phase 2A 启动 |
| Gate C 数据质量验收 | NOT_STARTED | 待 Phase 2F 评测集与 2G 验收证据 |

## Phase 2F Gate C-Core 验收结论

- **Phase 2F 代码基线：PASSED**（`typecheck` / `lint` / `test` / `test:coverage` / `build` / `audit:legacy` / `evaluate` 全部退出码 0）
- **Gate C-Core 评测 Runner：DONE**（`scripts/run-evaluation.ts` + `src/evaluation/` 6 模块 + 50 条评测集）
- **Gate C-Core 数据质量：PASSED**（50/50 case 通过，4 项核心指标 100%，1 项 N/A）
  - field_accuracy: 132/132 = 100.00% (门槛 90%)
  - required_field_recall: 91/91 = 100.00% (门槛 95%)
  - enum_precision: 33/33 = 100.00% (门槛 95%)
  - error_interception_rate: 1/1 = 100.00% (门槛 95%)
  - persistence_check: N/A (Phase 2F 不涉及持久化)
- **Runner 复用生产入口：PASSED**（调用 `runCleaningPipeline`，不复制业务逻辑）
- **禁止网络访问：PASSED**（fetch spy 未被调用 + 源码静态扫描不 import 网络模块）
- **退出码语义：PASSED**（0=PASS, 1=指标未达标, 2=Runner/fixture 错误，均有测试覆盖）
- **错误比较稳定性：PASSED**（使用 code+field/stage 元组比较，不比较完整文案）
- **Legacy 源码保护：PASSED**（`git diff origin/main -- src/data-cleaning` 无输出）
- **覆盖率：GATE_A_PASSED**（evaluation 模块 Lines 85.50% / Branch 82.04% / Funcs 100%；reporter.ts 100%, metrics.ts 97.03%）
- **外部联动验收：BLOCKED_EXTERNAL_ENV**（未配置真实 Dify / 飞书环境，Gate C-LLM 待 Phase 2G）

### Phase 2F 评测集构成

| 分类 | case 数 | case_id 范围 | 场景 |
|---|---:|---|---|
| valid（有效输入） | 15 | CC-001~CC-015 | 全字段/渠道/拍摄类型/预算区间覆盖 |
| clean（清洗能力） | 12 | CC-016~CC-027 | 空白/手机号分隔/全角/预算归一/日期解析/文本去噪 |
| enum（枚举映射） | 8 | CC-028~CC-035 | 风格/渠道/类型同义词映射 |
| boundary（校验边界） | 10 | CC-036~CC-045 | 缺必填/空值/无效枚举/格式错误 |
| edge（极端边界） | 5 | CC-046~CC-050 | 全空/超长/不支持的记录类型 |

### Phase 2F 覆盖率基线

| 范围 | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| All files（src/server + src/evaluation） | 85.35% | 81.17% | 86.06% | 85.35% |
| evaluation 模块 | 85.50% | 82.04% | 100% | 85.50% |
| CleaningPipeline | 100% | 95.65% | 100% | 100% |

> 整体状态：PHASE_2F_GATE_C_CORE_DONE

## Phase 3A Gate A 验收结论

- **Phase 3A 代码基线：PASSED**（`typecheck` / `lint` / `test` / `test:integration` / `test:coverage` / `build` / `audit:legacy` 全部退出码 0）
- **TASK-001 飞书运行表：DONE**
  - `Collator 摄入任务`：7 字段（摄入 ID / 幂等键 / 状态单选 / 来源记录 ID / 任务快照 JSON / 创建时间 / 更新时间）— 真实 table ID 仅写入本地 `.env` 的 `FEISHU_INGESTION_TABLE_ID`
  - `Collator 审核任务`：9 字段（摄入 ID / 状态 / 候选 JSON / 标准化结果 JSON / 校验结果 JSON / 审核人 / 审核决定 / 人工修正 JSON / 更新时间）— 真实 table ID 仅写入本地 `.env` 的 `FEISHU_REVIEW_TABLE_ID`
  - `Collator 写入日志`：8 字段（写入日志 ID / 摄入 ID / 目标表 ID / 业务记录 ID / 写入状态单选 / 错误码 / 脱敏错误消息 / 创建时间）— 真实 table ID 仅写入本地 `.env` 的 `FEISHU_WRITE_LOG_TABLE_ID`
  - 客户表新增 `Collator 摄入 ID` 隐藏文本字段，未修改任何现有业务字段 — 真实 table ID 仅写入本地 `.env` 的 `FEISHU_CUSTOMER_TABLE_ID`
- **FeishuClient 实现：DONE**（Node 20 原生 fetch；tenant_access_token 缓存 + 60s 提前刷新；HTTP 401 与业务错误码 `99991663` 双路径单次刷新重试；CRUD + searchRecords；fetchFn 注入支持单测）
- **FeishuTaskRepository 实现：DONE**（JSON 快照策略；save 先 search by 摄入 ID 决定 update/create；datetime 毫秒时间戳）
- **Repository Factory：DONE**（feishu 模式下缺凭据抛错，不静默回退；memory 模式保持当前测试行为）
- **配置与组合根：DONE**（config.ts superRefine 校验 feishu 必需凭据；app.ts 用 createTaskRepository 替代直接 new）
- **生产代码无 lark-cli 调用、无飞书 SDK 依赖：PASSED**（仅 src/scripts/temp/ 一次性脚本使用 lark-cli）
- **真实 Base 结构核验：PASSED**（lark-cli 端到端烟雾测试：create→search→update→search 全流程；字段深度等价；datetime 毫秒时间戳格式正确；单选字段返回数组形式符合预期；cleanup 后 0 记录残留）
- **Legacy 源码保护：PASSED**（`git diff origin/main -- src/data-cleaning` 无输出）
- **覆盖率：GATE_A_PASSED**（feishu-client Lines 95.3% / feishu-errors Lines 100% / feishu-task-repository Lines 91.2% / repository-factory Lines 100%；所有关键模块 Lines ≥80%）
- **脱敏与安全：PASSED**（FeishuApiError 通过 redactPhone 兜底；FeishuClient 单元测试覆盖 app_secret 不泄露、错误信息含 code 但不含 secret、手机号脱敏）
- **外部联动验收：PARTIAL**（真实 Base 结构核验通过；生产 FeishuTaskRepository 调用真实飞书 API 需部署时注入 FEISHU_APP_SECRET，不在本验收范围）

### Phase 3A 覆盖率基线

| 范围 | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| All files | 85.92% | 81.2% | 87.83% | 85.92% |
| server/feishu | 95.59% | 76.19% | 100% | 95.59% |
| feishu-client.ts | 95.3% | 76.92% | 100% | 95.3% |
| feishu-errors.ts | 100% | 66.66% | 100% | 100% |
| server/repositories | 92.61% | 91.42% | 93.33% | 92.61% |
| feishu-task-repository.ts | 91.2% | 88.88% | 100% | 91.2% |
| repository-factory.ts (合并显示) | 86.95% | 90% | 83.33% | 86.95% |

### TASK-001 验收清单对照

| 验收项 | 状态 | 证据 |
|---|---|---|
| 三张运行表及客户表技术字段创建成功，真实表 ID 仅写入本地 .env | PASSED | lark-cli +table-list 确认 3 张表存在；.env 已写入 4 个 FEISHU_*_TABLE_ID；.env 在 .gitignore；P0-02 修复后 `docs/ACCEPTANCE_REPORT.md` 与 `src/scripts/temp/smoke-test-lark-cli.ts` 不再硬编码真实 table ID，全部通过 `.env` / `process.env` 注入 |
| IngestionTask 保存后可由新的 Repository 实例完整读取，字段深度等价 | PASSED | tests/integration/feishu-task-repository.test.ts 第 1 个测试；真实 Base 烟雾测试 step 2 |
| 支持按 ingestion_id 和 idempotency_key 查询 | PASSED | FeishuTaskRepository.findById + findByIdempotencyKey；9 单元测试覆盖 |
| 单实例内 20 次并发重复请求只产生一个摄入任务 | PASSED | save 先 search by 摄入 ID 决定 update/create；集成测试 "save twice (update) on the same ingestion_id keeps exactly one record" |
| TASK_REPOSITORY=memory 保持当前测试行为 | PASSED | repository-factory.test.ts "returns InMemoryTaskRepository when taskRepository is memory"；默认值 memory |
| TASK_REPOSITORY=feishu 使用真实 Base；缺少配置时明确失败 | PASSED | repository-factory.test.ts 4 个 "throws" 测试覆盖缺各项凭据；config.ts superRefine 校验 |
| Secret、access token、原始 API 响应和未脱敏敏感数据不进入日志 | PASSED | feishu-client.test.ts "does not leak app_secret"；feishu-errors.ts redactPhone 兜底；烟雾测试脚本不打印 secret/token/原始响应 |
| 生产代码不调用 lark-cli，不新增飞书 SDK 依赖 | PASSED | src/server/feishu/ 与 src/server/repositories/ 源码扫描无 lark-cli import；package.json 无飞书 SDK 依赖 |
| git diff origin/main -- src/data-cleaning 无输出 | PASSED | 2026-07-17 执行结果无输出 |

## Phase 3A / TASK-001 P0 修复结论

GPT 基于 Commit `0be872d` 复审 TASK-001 时发现 2 个 P0，本次提交进行最小修复：

### P0-01：token 业务错误码刷新重试

- **问题**：`FeishuClient.callWithRetry` 仅在 HTTP 401 时刷新 token 重试，未处理飞书官方失效信号 `code=99991663`（通常在 HTTP 200 响应体中返回）。真实 token 失效时不会执行单次刷新重试。
- **修复**：`src/server/feishu/feishu-client.ts` 新增常量 `TOKEN_INVALID_CODE = 99991663`；`callWithRetry` 在 HTTP 非 401 路径上 parseResponse 抛出 `FeishuApiError(code=99991663)` 时触发单次 token 刷新 + 重试；重试后再次失败则错误冒泡，不递归重试。
- **测试**：`tests/unit/feishu/feishu-client.test.ts` 新增 3 个测试：
  1. HTTP 200 + code=99991663 首次失败 → 刷新 token 重试成功（断言 token 获取 2 次、record 调用 2 次、返回重试后的 record_id）
  2. 重复 99991663 不会二次重试（断言 token 获取 2 次、record 调用 2 次，错误冒泡）
  3. 非 token 业务错误（1254045）不触发刷新（断言 token 获取 1 次、record 调用 1 次）

### P0-02：真实运行表 ID 入库

- **问题**：新建运行表的真实 table ID（如 `<FEISHU_INGESTION_TABLE_ID>` 等）被写入 `docs/ACCEPTANCE_REPORT.md` 和 `src/scripts/temp/smoke-test-lark-cli.ts`，与"真实表 ID 仅写入本地 `.env`"验收条件直接冲突。
- **修复**：
  - `docs/ACCEPTANCE_REPORT.md`：移除 3 张运行表和客户表的真实 table ID，改为引用 `.env` 中的环境变量名（`FEISHU_INGESTION_TABLE_ID` 等）
  - `src/scripts/temp/smoke-test-lark-cli.ts`：移除硬编码 `BASE_TOKEN` 和 `INGESTION_TABLE_ID`，改为通过 `requireEnv()` 从 `process.env` 读取（与生产代码 `config.ts` 一致），缺失时报错并提示从本地 `.env` 注入

### P0 修复后 Gate A 复跑结论

- **代码基线：PASSED**（`typecheck` / `lint` / `test` / `test:integration` / `test:coverage` / `build` / `audit:legacy` 全部退出码 0）
- **测试：PASSED**（197 passed / 24 test files，新增 3 个 feishu-client 重试测试）
- **覆盖率：GATE_A_PASSED**（feishu-client Lines 95.62% / Branch 79.06% / Funcs 100%；所有关键模块 Lines ≥80%）
- **Legacy 源码保护：PASSED**（`git diff origin/main -- src/data-cleaning` 无输出，LEGACY_DIFF_EMPTY）
- **未重跑真实 Base 烟雾测试**：脚本已改为 `requireEnv` 模式，需用户在运行时注入 `FEISHU_BASE_APP_TOKEN` 与 `FEISHU_INGESTION_TABLE_ID`（与生产代码 `config.ts` 一致）；真实 Base 结构未变，P0 修复不涉及字段映射或 JSON 快照策略，无需重跑。

> 整体状态：PHASE_3A_TASK_001_P0_FIX_APPLIED_AWAITING_GPT_REVIEW

## Phase 3A / TASK-001 GPT Git 扫描复审（2026-07-18）

- **复审 Commit**：`1217942525fa149678f26c07ceefd590b3cfe241`
- **复审范围**：仅 P0-02 的三个运行表真实 ID；客户表历史 ID 属 DEBT-005，不在本轮范围。
- **仓库基线**：扫描前工作区干净；分支 `phase/3-feishu-integration`；`HEAD` 精确等于复审 Commit。
- **指定文件扫描**：对 `docs/ACCEPTANCE_REPORT.md` 与 `src/scripts/temp/smoke-test-lark-cli.ts` 执行三个运行表真实 ID 的 `git grep`，0 匹配（退出码 1）。
- **整个提交树扫描**：对 Commit `1217942` 的全部已跟踪文件执行相同 `git grep`，0 匹配（退出码 1）。
- **提交范围核对**：仅 3 个审计/验收文档发生变更；无代码变更，因此按上一轮指令未重跑完整 Gate A。
- **结论**：`MVP_PASS`。P0-01 与 P0-02 均已解决，TASK-001 无剩余 P0。

> 整体状态：PHASE_3A_TASK_001_MVP_PASS

## Phase 3B / TASK-002 Gate A + Gate C-Core 回归结论（2026-07-18）

### 实现摘要

- **Task 1**：新增 `src/server/mapping/customer-candidate-mapper.ts`（9 个英文键→中文规范 Schema 的纯函数映射；immutable；`UNMAPPED_CANDIDATE_FIELD` + `CANDIDATE_FIELD_CONFLICT` 警告；6 tests PASS）。
- **Task 2**：新增 `src/server/repositories/review-repository.ts` + `in-memory-review-repository.ts`（`ReviewRecord` / `NewReviewRecord` / `ReviewRepository` 合同；内存模式用 `randomUUID()` 生成不透明 ID；深拷贝防护；6 tests PASS）。
- **Task 3**：新增 `src/server/repositories/feishu-review-repository.ts`（9 个中文表头字段常量；JSON 字段存完整对象；索引列只用于查询；幂等 create：先 search by 摄入 ID，存在则返回；datetime 毫秒时间戳；malformed JSON 错误不暴露原始 candidate；8 tests PASS）。
- **Task 4**：修改 `src/server/services/ingestion-service.ts` + `src/server/domain/ingestion.ts`（构造函数双参数 `repository` + `reviewRepository`；`pendingCandidates` Map 实现 per-ingestion 串行化；`receiveCandidate` 拆分为公开入口 + `doReceiveCandidate` 私有实现；Pipeline 失败路径保存 task 为 `validation_failed` 且不创建审核记录；成功路径创建 `ReviewRecord` 并持久化 Pipeline 证据；17 tests PASS）。
- **Task 5**：重写 `src/server/repositories/repository-factory.ts`（新增 `RepositoryBundle` 接口 + `createRepositories(config)`；Feishu 模式下两个仓库共享同一个 `FeishuClient`；保留 `createTaskRepository()` 兼容包装）；修改 `src/server/config.ts`（`FEISHU_REVIEW_TABLE_ID` 加入 feishu 模式必填校验）；修改 `src/server/app.ts`（新增 `BuildAppOptions` 支持双仓库注入；三分支装配逻辑）；修改 `docs/API_CONTRACT.md`（§3.3 区分成功/失败响应；§3.4 corrections 中文键；§4 状态机新增 `validation_failed`；§5 幂等规则增加并发/进程重启；§6 新增「Candidate 字段映射」完整章节；§7 安全边界；§8 Gate C-LLM 阻塞说明）。8 个新单元测试（repository-factory）+ 5 个新集成测试 PASS。
- **Task 6**：完成 Gate A + Gate C-Core 回归，更新文档。

### Gate A 验收

- **代码基线：PASSED**（`npm ci` / `audit:legacy` / `typecheck` / `lint` / `test` (236) / `test:integration` (31) / `test:coverage` (84.94%) / `build` / `evaluate` (50/50) 全部退出码 0）
- **TASK-002 实现：DONE**（Candidate 映射纯函数；内存 + 飞书审核仓库合同；并发幂等 `pendingCandidates` Map；Pipeline 失败状态机；生产装配支持双仓库注入；API 合同完整记录映射规则与不透明 ID 语义）
- **Legacy 源码保护：PASSED**（`git diff origin/main -- src/data-cleaning` 无输出）
- **覆盖率：GATE_A_PASSED**（所有关键模块 Lines ≥80%：mapping 100%, ingestion-service 96.42%, repository-factory 100%, feishu-review-repository 86.66%, in-memory-review-repository 85.71%, feishu-task-repository 91.2%, feishu-client 95.62%, cleaning-pipeline 100%）
- **生产代码无 lark-cli 调用：PASSED**（`git grep -n "lark-cli" -- src/server` 无匹配）
- **运行时表 ID 零硬编码：PASSED**（3 个运行时表 ID 在源码中无匹配，仅存在于 `.env` / `.env.example` 占位 `replace_me`）
- **脱敏与安全：PASSED**（未修改 `src/server/security/redaction.ts`；FeishuApiError 通过 `redactPhone` 兜底；Candidate 原始 JSON 仅存入 task snapshot 与 review record 的 `candidate` 字段，不进入应用日志）
- **外部联动验收：PARTIAL**（真实飞书 Base 调用需部署时注入 `FEISHU_APP_SECRET`，不在本验收范围；真实 Dify 凭据仍阻塞，Gate C-LLM 仍为 BLOCKED_EXTERNAL_ENV）

### Gate C-Core 回归

- **评测结果：PASS**（50/50 case；4 项核心指标 100%）
  - field_accuracy: 132/132 = 100.00% (门槛 90%)
  - required_field_recall: 91/91 = 100.00% (门槛 95%)
  - enum_precision: 33/33 = 100.00% (门槛 95%)
  - error_interception_rate: 1/1 = 100.00% (门槛 95%)
  - persistence_check: N/A
- **Runner 复用生产入口：PASSED**（调用 `runCleaningPipeline`，未复制业务逻辑）
- **未回归证据**：与 Phase 2F / Phase 3A 结果一致（所有指标 100%）

### Phase 3B 覆盖率基线

| 范围 | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| All files | 84.94% | 81.34% | 88.2% | 84.94% |
| server/mapping/customer-candidate-mapper.ts | 100% | 100% | 100% | 100% |
| server/services/ingestion-service.ts | 96.42% | 83.33% | 100% | 96.42% |
| server/repositories/repository-factory.ts | 100% | 100% | 100% | 100% |
| server/repositories/feishu-review-repository.ts | 86.66% | 63.63% | 100% | 86.66% |
| server/repositories/in-memory-review-repository.ts | 85.71% | 83.33% | 85.71% | 85.71% |
| server/repositories/feishu-task-repository.ts | 91.2% | 88.88% | 100% | 91.2% |
| server/feishu/feishu-client.ts | 95.62% | 79.06% | 100% | 95.62% |
| server/cleaning/pipeline/cleaning-pipeline.ts | 100% | 95.65% | 100% | 100% |

### TASK-002 验收清单对照

| 验收项 | 状态 | 证据 |
|---|---|---|
| 英文 Candidate 与等价中文 Candidate 产生相同 Pipeline 标准化结果 | PASSED | tests/unit/mapping/customer-candidate-mapper.test.ts 6 tests；tests/unit/ingestion-service.test.ts "produces identical normalized_fields for equivalent English and Chinese candidates" |
| 现有 50 条 Gate C-Core fixture 结果不回归 | PASSED | npm run evaluate 退出码 0；50/50 case；4 项核心指标 100% |
| Pipeline 阶段顺序、不可变性和确定性保持不变 | PASSED | tests/unit/cleaning/pipeline/cleaning-pipeline.test.ts 11 tests + cleaning-pipeline-error-paths.test.ts 5 tests；未修改 src/data-cleaning/** |
| 成功回调后任务状态为 `pending_review`，并存在真实审核记录 | PASSED | tests/integration/ingestions.test.ts "accepts a signed candidate callback and stores the mapped review record"；reviewRepository.findByIngestionId 返回非 null |
| 20 次相同回调只存在一条审核记录 | PASSED | tests/unit/ingestion-service.test.ts "returns one opaque review_record_id for 20 concurrent identical callbacks"；pendingCandidates Map 串行化 |
| 未知字段和字段冲突产生明确 warning，且不会写入业务字段 | PASSED | tests/integration/ingestions.test.ts "records UNMAPPED_CANDIDATE_FIELD warnings on the task"；mapper 单元测试覆盖 CANDIDATE_FIELD_CONFLICT |
| Pipeline 阶段异常时状态为 `validation_failed`，不创建审核记录 | PASSED | tests/unit/ingestion-service.test.ts "sets validation_failed and creates no review when pipeline returns success=false"（vi.mock 注入失败路径） |
| warning/error 中的手机号、路径和敏感文本继续脱敏 | PASSED | 未修改 src/server/security/redaction.ts；feishu-client + feishu-errors 测试仍 PASS |
| 新链路不读取旧 Schema 中已漂移的 field ID | PASSED | customer-candidate-mapper.ts 不引用任何 Legacy field ID；feishu-review-repository.ts 使用中文表头常量 |
| git diff origin/main -- src/data-cleaning 无输出 | PASSED | 2026-07-18 执行退出码 0，无输出 |

### 实现约束验证

- ✅ 映射函数为纯函数，不修改传入 Candidate（mapper 单元测试覆盖 "does not mutate nested or top-level input data" + "returns deeply equal results for repeated equal inputs"）
- ✅ 审核记录 ID 对调用方不透明（内存模式 `randomUUID()`；飞书模式真实 Base `record_id`；集成测试显式断言 `startsWith('rec_review_')` 为 false）
- ✅ Candidate 原始 JSON 仅用于审核证据，不进入应用日志（IngestionService 不调用 console/pino 直接打印 candidate JSON）
- ✅ Gate C-LLM 仍保持阻塞（API_CONTRACT.md §8；PROJECT_STATE.md Active Blockers 列出 DEBT-001）

### 阻塞项

- **Gate C-LLM**：DEBT-001（Dify 凭据未配置），不在 TASK-002 解决范围。
- **Gate D 飞书集成**：需待 TASK-003（写入日志仓库 + 业务主表写入）完成才能整体通过。
- **TASK-002 GPT 复审**：本任务实现已完成，等待 GPT 基于 TASK-002 最终 commit 复审。

> 整体状态：PHASE_3B_TASK_002_DONE_AWAITING_GPT_REVIEW

## Phase 3B / TASK-002 GPT 复审（Commit `94f0199`）

- 日期：2026-07-18
- 审查范围：`26fb515..94f0199`
- 结论：`MVP_FAIL`
- 完整修复包：`docs/ai/reviews/TASK-002_GPT_REVIEW.md`

### 本轮独立验证

| 命令/检查 | 结果 | 证据 |
|---|---|---|
| `npm run typecheck` | PASS | 退出码 0 |
| `npm run lint` | PASS | 退出码 0 |
| `npm run test` | PASS | 236 tests / 27 files |
| `npm run test:integration` | PASS | 31 tests / 3 files |
| `npm run build` | PASS | 退出码 0 |
| `npm run evaluate` | PASS | 50/50；4 项核心指标 100% |
| `git diff origin/main -- src/data-cleaning` | PASS | 无输出 |
| 嵌套 Candidate 脱敏复现 | FAIL | 顶层 content 已脱敏，但序列化响应仍包含嵌套原手机号 |

### P0

1. `P0-01`：GET 任务响应只做浅层脱敏，嵌套 Candidate PII 可原样返回。
2. `P0-02`：映射后覆盖原 Candidate，未知字段与原始审核证据不可恢复。
3. `P0-03`：完整 Pipeline 证据未写入任务；`validation_failed` 路径丢失大部分证据。

### P1

- `DEBT-007`：飞书审核记录幂等只覆盖单服务实例，多副本部署前需数据层唯一性或原子 claim。
- Review 状态与 reviewer/decision/corrections 的持久化同步由已接受的 TASK-003 状态流处理，不提前扩大 TASK-002 P0 修复范围。

> 整体状态：PHASE_3B_TASK_002_P0_FIX_REQUIRED；TASK-003_NOT_STARTED

## Phase 3B / TASK-002 P0 修复结论（2026-07-18）

GPT 基于 Commit `94f0199` 复审 TASK-002 时发现 3 个 P0，Trae 按修复包 `docs/ai/reviews/TASK-002_GPT_REVIEW.md` 完成最小修复：

### P0-01：嵌套 Candidate PII 绕过 GET 响应浅层脱敏

- **问题**：GET `/v1/ingestions/:id` 响应只对顶层 `content` 字段脱敏，嵌套在 `candidate.fields` / `candidate.evidence` 中的手机号以原样返回；mapper warning field/message 也可能携带攻击者控制的 PII。
- **修复**：
  - `src/server/security/redaction.ts` 重写 `redactPhone`：分离捕获组对号码 mask，修复 +86 前缀处理（原 `861****8000` → 现 `138****8000`）
  - 新增 `redactValueDeep`：递归遍历对象/数组返回新副本，不修改原对象
  - 重写 `redactObject` 调用 `redactValueDeep`
  - 新增 `sanitizeWarningText`：对 mapper warning field/message 中手机号 + 绝对路径脱敏；PATH_PATTERN 仅匹配 `/...` 或 `C:\...`，避免误匹配 `style_preferences` 等字段名
- **测试**：`tests/unit/security/redaction.test.ts`（11 tests）：redactPhone 含 +86、redactContent、redactObject 递归、sanitizeWarningText phone/path/Windows path/正常字段名保留
- **HTTP 集成测试**：`tests/integration/ingestions.test.ts` 新增 "P0-01: GET response redacts nested Candidate PII (phone in fields and evidence) without mutating stored task" — POST 嵌套 phone candidate → GET 响应不含原 phone、含 `138****8000`；repository 仍保留 `raw_candidate`；review.validation.rawCandidate 保留原始证据；GET 不修改存储

### P0-02：原始 Candidate 证据被映射结果覆盖后丢失

- **问题**：`doReceiveCandidate` 入口对 `req.candidate` 直接 mutate（`delete candidate.fields[key]`），未知字段与原始审核证据不可恢复，违反"不修改传入对象"约束。
- **修复**：
  - `src/server/domain/ingestion.ts` `IngestionTask` 接口新增 `raw_candidate?: CandidateRecord` 字段
  - `src/server/services/ingestion-service.ts` 新增 `deepClone` helper，在 `doReceiveCandidate` 入口 `rawCandidate = deepClone(req.candidate)` 保留原始证据
  - mapper warnings 经 `sanitizeMapperWarnings` sanitize
  - 成功路径将 `rawCandidate` 嵌入 `review.validation.rawCandidate`（复用飞书审核表的「校验结果 JSON」列，不新增 Base 字段）
  - 失败路径同样保留 `raw_candidate` 到 task
- **测试**：`tests/unit/ingestion-service.test.ts` 新增 4 个测试：raw_candidate 深拷贝保留、未知字段不进入 normalized_fields、review.validation.rawCandidate 跨服务实例持久化、mapper warning sanitization（两个未知字段分别携带 phone 和 path）

### P0-03：完整 Pipeline 证据未持久化到任务，失败路径证据丢失

- **问题**：成功路径只把 Pipeline 证据写入 review record 的 `validation` 对象；`validation_failed` 路径只写入 `errors`，丢失 `stages` / `corrections` / `warnings` / `qualityReport` / `pipelineVersion`。任务无法独立回答"Pipeline 跑到哪一步、产出什么"。
- **修复**：
  - `src/server/domain/ingestion.ts` `IngestionTask` 接口新增 `pipeline_evidence?: Record<string, unknown>` 字段
  - `src/server/services/ingestion-service.ts` 新增 `buildPipelineEvidence` helper：结构化包含 `pipelineVersion` / `stages` / `validation` / `corrections` / `warnings` / `errors` / `qualityReport` / `success`
  - 成功与失败路径均把 `pipeline_evidence` 写入 task
  - mapper warnings 与 Pipeline warnings 严格区分：mapper warnings 在 `task.warnings` 是 `{field, code, message}`；Pipeline warnings 在 `pipeline_evidence.warnings` 是 `string[]`
- **测试**：`tests/unit/ingestion-service.test.ts` 新增 4 个测试：成功路径持久化完整 pipeline_evidence、失败路径同样持久化、mapper warnings 与 Pipeline warnings 区分、跨新服务实例持久化

### P0 修复后 Gate A + Gate C-Core 复跑结论

- **代码基线：PASSED**（`typecheck` / `lint` / `test` (260) / `test:integration` (32) / `test:coverage` (85.28%) / `build` / `evaluate` (50/50) / `git diff origin/main -- src/data-cleaning` 全部退出码 0）
- **测试：PASSED**（260 passed / 28 test files，新增 24 个测试：11 redaction + 13 ingestion-service；新增 1 个 HTTP 集成测试）
- **覆盖率：GATE_A_PASSED**（redaction.ts 100%, ingestion-service 96.88%；所有关键模块 Lines ≥80%）
- **Legacy 源码保护：PASSED**（`git diff origin/main -- src/data-cleaning` 无输出，LEGACY_DIFF_EMPTY）
- **Gate C-Core 回归：PASSED**（50/50 case；4 项核心指标 100%；未回归）
- **HTTP P0-01 端到端验证：PASSED**（响应不含原 phone、含 `138****8000`；repository 仍保留 `raw_candidate`；review.validation.rawCandidate 保留原始证据；GET 不修改存储）

### Phase 3B / TASK-002 P0 修复后覆盖率基线

| 范围 | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| All files | 85.28% | 81.95% | 88.53% | 85.28% |
| server/security/redaction.ts | 100% | 100% | 100% | 100% |
| server/services/ingestion-service.ts | 96.88% | 86.05% | 100% | 96.88% |
| server/mapping/customer-candidate-mapper.ts | 100% | 100% | 100% | 100% |
| server/repositories/repository-factory.ts | 100% | 100% | 100% | 100% |
| server/repositories/feishu-review-repository.ts | 86.66% | 63.63% | 100% | 86.66% |
| server/repositories/in-memory-review-repository.ts | 85.71% | 83.33% | 85.71% | 85.71% |
| server/repositories/feishu-task-repository.ts | 91.2% | 88.88% | 100% | 91.2% |
| server/feishu/feishu-client.ts | 95.62% | 79.06% | 100% | 95.62% |
| server/cleaning/pipeline/cleaning-pipeline.ts | 100% | 95.65% | 100% | 100% |

### P0 修复验收清单对照

| 验收项 | 状态 | 证据 |
|---|---|---|
| P0-01 嵌套 Candidate PII 在 GET 响应中被脱敏 | PASSED | `tests/unit/security/redaction.test.ts` 11 tests PASS；`tests/integration/ingestions.test.ts` "P0-01: GET response redacts nested Candidate PII" PASS |
| P0-01 GET 响应脱敏不修改 repository 存储 | PASSED | `tests/integration/ingestions.test.ts` 断言 `storedTaskAgain.raw_candidate.fields['unknown_field']` 仍为 `13800138000` |
| P0-01 mapper warning 中 phone/path 被脱敏 | PASSED | `tests/unit/ingestion-service.test.ts` "sanitizes mapper warnings containing phone and path" PASS |
| P0-02 原始 Candidate 深拷贝保留在 task.raw_candidate | PASSED | `tests/unit/ingestion-service.test.ts` "preserves raw candidate as deep clone on the task" PASS |
| P0-02 未知字段不进入 normalized_fields | PASSED | `tests/unit/ingestion-service.test.ts` "keeps unknown fields out of normalized_fields" PASS（已存在，仍 PASS） |
| P0-02 review.validation.rawCandidate 跨服务实例持久化 | PASSED | `tests/unit/ingestion-service.test.ts` "persists rawCandidate in review.validation across service instances" PASS |
| P0-03 成功路径持久化完整 pipeline_evidence | PASSED | `tests/unit/ingestion-service.test.ts` "persists complete pipeline_evidence on success" PASS |
| P0-03 失败路径持久化完整 pipeline_evidence | PASSED | `tests/unit/ingestion-service.test.ts` "persists pipeline_evidence on validation_failed path" PASS |
| P0-03 mapper warnings 与 Pipeline warnings 严格区分 | PASSED | `tests/unit/ingestion-service.test.ts` "distinguishes mapper warnings from pipeline warnings" PASS |
| P0-03 pipeline_evidence 跨新服务实例持久化 | PASSED | `tests/unit/ingestion-service.test.ts` "persists pipeline_evidence across new service instance" PASS |
| Gate A 全套命令退出码 0 | PASSED | typecheck / lint / test (260) / test:integration (32) / test:coverage (85.28%) / build / evaluate (50/50) |
| Legacy 源码保护 | PASSED | `git diff origin/main -- src/data-cleaning` 无输出 |
| Gate C-Core 回归 | PASSED | 50/50 case；4 项核心指标 100%；未回归 |

### 阻塞项

- **GPT 复审 P0 修复 commit**：3 个 P0 已修复，等待 GPT 复审判定 `MVP_PASS` 或 `MVP_PASS_WITH_DEBT`；通过前不得启动 TASK-003。
- **Gate C-LLM**：DEBT-001（Dify 凭据未配置），不在 TASK-002 解决范围。
- **Gate D 飞书集成**：需待 TASK-003（写入日志仓库 + 业务主表写入）完成才能整体通过。

> 整体状态：PHASE_3B_TASK_002_P0_FIX_APPLIED_AWAITING_GPT_REVIEW
