# ACCEPTANCE REPORT

## 环境

- OS：Windows 11
- Node：v22.22.1
- npm：v10.9.2
- Dify：未配置
- 飞书测试 Base：未配置
- 分支：`phase/2b-legacy-adapters`
- 基线 Commit：`edb68a4`
- 当前 Commit：见 `git log -1`

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
| 总字段准确率 | - | 90% | IN_PROGRESS（Phase 2 构建评测集中） |
| 必填字段召回率 | - | 95% | IN_PROGRESS |
| 枚举映射精确率 | - | 95% | IN_PROGRESS |
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
- **Phase 2B 覆盖率：IN_PROGRESS**（`src/server/cleaning` Lines 76.06% / Branch 72.72% / Funcs 79.31%，未达 90/90/90/85 目标，需在 Phase 2C 前补充）
- **外部联动验收：BLOCKED_EXTERNAL_ENV**（未配置真实 Dify / 飞书环境）

> 整体状态：READY_FOR_PHASE_2

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
