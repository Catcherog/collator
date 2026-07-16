# PROJECT STATE

- 当前阶段：Phase 2A（Legacy Contract & Side Effect Audit）
- 状态：PHASE_2A_COMPLETE
- Planning Review：APPROVED_WITH_REQUIRED_CHANGES（已完成全部必需修正）
- Phase 2A 审计：AUDIT_COMPLETE（29 SAFE / 33 UNSAFE，确定性验证通过）
- 最近更新：2026-07-16
- 当前分支：phase/2a-legacy-audit
- 基线 Commit：9d62350
- 当前版本：v1.0

## 已完成

### Phase 0

- 解压并阅读 `Collator_Dify_飞书_Trae实施协作包_v1.0` 全部手册与模板。
- 阅读 `.trae/Knowledge/` 与 `.trae/rules/`。
- 完成项目目录、Schema、核心模块、脚本、测试入口盘点。
- 运行现有测试并记录真实结果。
- 扫描硬编码资源 ID 与敏感信息。
- 生成 `docs/BASELINE_REPORT.md`。
- 生成 `docs/PROJECT_STATE.md`、`docs/DECISIONS.md`、`docs/ACCEPTANCE_REPORT.md`。
- 初始化 Git 仓库并提交 Phase 0 基线 Commit。

### Phase 1

- 搭建 TypeScript + Fastify Core Service 外壳。
- 实现 `src/server/app.ts` 服务入口、配置加载、错误处理、路由注册。
- 实现 `src/server/routes/ingestions.ts`：创建任务、查询任务、Candidate 回调、审核通过/拒绝。
- 实现 `src/server/services/ingestion-service.ts`：幂等创建、状态机、候选处理、审核逻辑。
- 实现 `src/server/security/signature.ts`：HMAC-SHA256 签名、时间戳校验、重放防护。
- 实现 `src/server/security/redaction.ts`：手机号、微信、原始文本脱敏。
- 实现 `src/server/repositories/in-memory-task-repository.ts`：内存仓库（测试/开发用）。
- 定义 `src/server/domain/ingestion.ts` 与 `src/server/domain/errors.ts`。
- 创建 `eslint.config.js` 与 `tsconfig.json`，完善 `package.json` 脚本。
- 编写单元测试（signature、ingestion-service）与集成测试（ingestions HTTP API）。
- 创建 `docs/API_CONTRACT.md` 接口合同。
- **Phase 1 收尾审计**：
  - 工作区干净（仅未跟踪的执行提示词文档）。
  - `npm ci` + `typecheck` / `lint` / `test` / `test:integration` / `build` / `test:coverage` 全部通过。
  - 15 项核心能力矩阵完整，HMAC 与脱敏均有测试。
  - 核心服务可执行代码覆盖率基线：Stmts 90.3% / Branch 82.56% / Funcs 88.57% / Lines 90.3%。

## Phase 1 能力矩阵

| 能力 | 实现文件 | 测试文件 | 测试数量 | 状态 |
|---|---|---|---:|---|
| Fastify 应用入口 | src/server/app.ts | tests/integration/ingestions.test.ts | 10 | DONE |
| 配置模块 | src/server/config.ts | tests/integration/ingestions.test.ts | 10 | DONE |
| .env.example | .env.example | - | - | DONE |
| GET /healthz | src/server/routes/health.ts | tests/integration/ingestions.test.ts | 10 | DONE |
| GET /readyz | src/server/routes/health.ts | tests/integration/ingestions.test.ts | 10 | DONE |
| POST /v1/ingestions | src/server/routes/ingestions.ts | tests/integration/ingestions.test.ts + tests/unit/ingestion-service.test.ts | 14 | DONE |
| GET /v1/ingestions/:id | src/server/routes/ingestions.ts | tests/integration/ingestions.test.ts + tests/unit/ingestion-service.test.ts | 14 | DONE |
| Candidate callback | src/server/routes/ingestions.ts + src/server/services/ingestion-service.ts | tests/integration/ingestions.test.ts + tests/unit/ingestion-service.test.ts | 14 | DONE |
| approve | src/server/routes/ingestions.ts + src/server/services/ingestion-service.ts | tests/integration/ingestions.test.ts + tests/unit/ingestion-service.test.ts | 14 | DONE |
| reject | src/server/routes/ingestions.ts + src/server/services/ingestion-service.ts | tests/integration/ingestions.test.ts + tests/unit/ingestion-service.test.ts | 14 | DONE |
| InMemoryTaskRepository | src/server/repositories/in-memory-task-repository.ts | tests/unit/ingestion-service.test.ts | 10 | DONE |
| Ingestion 状态机 | src/server/domain/ingestion.ts + src/server/services/ingestion-service.ts | tests/unit/ingestion-service.test.ts | 10 | DONE |
| HMAC 时间戳验签 | src/server/security/signature.ts | tests/unit/signature.test.ts | 6 | DONE |
| 日志脱敏 | src/server/security/redaction.ts | tests/integration/ingestions.test.ts | 10 | DONE |
| 统一错误模型 | src/server/domain/errors.ts + src/server/app.ts | tests/integration/ingestions.test.ts + tests/unit/ingestion-service.test.ts | 16 | DONE |

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

> 旧 `src/data-cleaning/**/*.js` 模块不在 V1 Core Service 范围内，未纳入核心覆盖率口径；将在 Phase 3 后逐步清理或替换。

## 验收状态

| Gate | 状态 | 证据 |
|---|---|---|
| A 代码基线 | PASSED | `npm ci` / `typecheck` / `lint` / `test` / `test:integration` / `build` / `test:coverage` 全部通过 |
| B API 合同 | PASSED | `docs/API_CONTRACT.md` + 10 项集成测试覆盖全部 V1 接口 |
| C 数据质量 | IN_PROGRESS | Phase 2 正在构建 50 条固定评测集与评测脚本 |
| D 飞书集成 | BLOCKED_EXTERNAL_ENV | 未配置测试 Base 凭据 |
| E 安全隐私 | PASSED | 无 .env/Secret 入库；签名验签、脱敏、幂等均已测试 |
| F 部署运行 | NOT_STARTED | 无 Dockerfile（Phase 5/6） |
| G 展示证据 | NOT_STARTED | 无运行证据（待 Docker/部署后补充） |

## 阻塞项

- 未配置 Dify 环境与凭据（`DIFY_BASE_URL`、`DIFY_WORKFLOW_API_KEY`、`DIFY_WORKFLOW_ID`）。
- 未配置飞书测试 Base 凭据与表结构（`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BASE_APP_TOKEN` 及各表 ID）。

## 风险

- 旧 `src/data-cleaning/agent/index.js` 存在 `&&amp;` HTML 实体语法错误，任何引用该文件的入口无法运行；V1 采用新建 `src/server/` 替代旧 Agent 入口，不修复旧入口。
- 现有 Schema 使用中文 fieldName，Dify Candidate 输出英文 raw 字段，Phase 2 需要增加映射层。
- 硬编码飞书资源 ID 较多，Phase 3 需逐步迁出源码。
- 旧 `src/data-cleaning/**/*.js` 中 9 个模块存在 HTML 实体损坏（`&&` → `&amp;&amp;` 等），Phase 2A 审计已确认为 BLOCKED_UNSAFE_IMPORT，Phase 2B 不得 import；待 Phase 3 后逐步清理或重写。

## Phase 2A 完成（Legacy Contract & Side Effect Audit）

### 审计工具实现

- `src/server/cleaning/contracts/legacy-module-profile.ts`：冻结 LegacyModuleProfile 契约（TypeScript 类型 + Zod Runtime Schema）
- `scripts/phase2/audit-worker.cjs`：隔离子进程 worker，安装 fs-observer、env Proxy、global snapshot
- `scripts/phase2/audit-legacy-modules.ts`：审计器编排，child_process 隔离 + temp CWD
- `tests/unit/cleaning/fixtures/fs-observer.cjs`：fs 调用观测钩子
- `tests/unit/cleaning/legacy-audit.test.ts`：17 项契约测试（真实子进程，无 mock）
- `npm run audit:legacy` 脚本

### 真实审计结果

- **审计范围**：`src/data-cleaning/**/*.js`（62 个模块）
- **SAFE（CREATE_REQUIRE）**：29 个模块
- **UNSAFE（BLOCKED_UNSAFE_IMPORT）**：33 个模块
  - 9 个直接 HTML 实体损坏（`&&` → `&amp;&amp;` 等）
  - 12 个传递性损坏（require 链引用损坏文件）
  - 7 个 import-time stdout 污染（测试脚本在 import 时执行）
  - 2 个子进程超时（测试脚本 hang）
  - 1 个依赖缺失
  - 2 个其他 SyntaxError
- **确定性验证**：连续两次运行结果一致（仅 `generated_at`/`duration_ms` 不同）
- **报告文件**：
  - `reports/phase2/legacy-module-profiles.json`（机器可读）
  - `reports/phase2/legacy-module-profiles.md`（人类可读）
- **Adapter Map**：`docs/PHASE2_ADAPTER_MAP.md` 已基于真实审计结果重写

### 关键发现（推翻 Planning 预判）

1. `schemas/index.js` 和 `config/index.js` 是 SAFE（Planning 误判为有 import-time fs.readFileSync 副作用）
2. `core/data-cleaner.js` 是 SAFE（Planning 误判为有传递性副作用）
3. 9 个模块有 HTML 实体损坏（源码中 `&&` 被替换为 `&amp;&amp;`）
4. Phase 2B 需实现 8 个 Adapter（全部使用 CREATE_REQUIRE 策略）

## Phase 2 Planning Correction（本轮完成）

- **Planning Review 结果**：APPROVED_WITH_REQUIRED_CHANGES
- **本轮修正内容**（未修改任何生产/测试代码）：
  1. `PHASE2_EVALUATION_SPEC.md`：Enum Mapping Precision 门槛 85% → 95%（与手册 Gate C 一致）；Validation Detection Recall 保留为补充门槛 ≥85%，不得降低主门槛；同步示例报告。
  2. `PHASE2_IMPLEMENTATION_PLAN.md` Phase 2E：冻结状态语义——业务校验 error 进入 `pending_review`；`validation_failed` 仅用于 Schema/配置/Adapter/Pipeline/Validator 执行异常；同步测试与完成条件。Phase 2A 完成条件新增 `LegacyModuleProfile` 6 字段要求；`data-cleaner.js` 处理方式改为 `EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY`。
  3. `PHASE2_DATA_CONTRACTS.md`：新增 `ValidatorExecutionError` 与 `execution_error` 字段；新增 2.8 节 Validator 执行异常表示与状态转换；新增 2.9 节日期边界策略与测试要求（无效 timezone/received_at、DST 边界、非法日期、年份推断）。
  4. `PHASE2_ADAPTER_MAP.md`：`data-cleaner.js` 处理方式 WRAP → `EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY`；新增第四章 `LegacyModuleProfile` 结构要求（importSafe/importStrategy/transitiveSideEffects/runtimeInterop/allowedExports/sideEffectTest）。
- **未开始**：Phase 2A 生产代码、Phase 2 全部实现、Gate C 验收。

## 下一步唯一动作

1. Phase 2B：基于已冻结的 `docs/PHASE2_ADAPTER_MAP.md`（AUDIT_COMPLETE 状态）实现 8 个 Adapter（cleaner / quality / noop-logger / rules / schema / config / utils / benchmark），全部使用 CREATE_REQUIRE 策略；33 个 UNSAFE 模块保持 BLOCKED_UNSAFE_IMPORT，Phase 2B 不得 import。

## 最近一次执行

- 命令：`npm ci; npm run typecheck; npm run lint; npm run test; npm run test:integration; npm run build`
- 结果：见下方"执行命令与结果"（本轮为 Planning Correction，未修改生产代码，工程命令用于回归验证基线不变）。
