# PROJECT STATE

- 当前阶段：Phase 2B
- 状态：DONE（覆盖率未完全达标，缺口需在 Phase 2C 前补充）
- Planning Review：APPROVED_WITH_REQUIRED_CHANGES（Phase 2 Planning Correction 已完成）
- 最近更新：2026-07-16
- 当前分支：phase/2b-legacy-adapters
- 当前 Commit：见 `git log -1`
- 基线 Commit：`edb68a4`
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

### Phase 2B

- 建立分支 `phase/2b-legacy-adapters`，基于最新 `origin/main`。
- 实现 `src/server/cleaning/legacy-module-loader.ts`：统一 Legacy 模块加载，VM 沙箱 + `legacyRequire`，支持路径校验、导出白名单、Hash 校验、安全缓存、错误标准化。
- 实现 `src/server/cleaning/errors.ts`：7 个错误码的 `LegacyAdapterError`，错误信息脱敏。
- 实现 `src/server/cleaning/legacy-audit.ts` + `contracts/legacy-module-profile.ts`：加载并校验审计报告，提供查询接口。
- 实现 8 个 Adapter：
  - `utils-adapter.ts`
  - `config-adapter.ts`
  - `schema-adapter.ts`
  - `cleaner-adapter.ts`
  - `noop-logger-adapter.ts`
  - `rules-adapter.ts`
  - `quality-adapter.ts`
  - `benchmark-adapter.ts`
- 实现 `tests/unit/cleaning/import-ban.test.ts`：生产代码直接 Legacy Import 禁令扫描。
- 为 Loader 和每个 Adapter 编写契约/边界测试。
- 更新 `docs/PHASE2B_ADAPTER_CONTRACTS.md`、`docs/PHASE2_ADAPTER_MAP.md`、`docs/PROJECT_STATE.md`、`docs/ACCEPTANCE_REPORT.md`。
- **Phase 2B 验收**：
  - `npm ci` / `audit:legacy` / `typecheck` / `lint` / `test` / `test:integration` / `test:coverage` / `build` 全部通过。
  - `git diff origin/main -- src/data-cleaning` 无输出（Legacy 源码未修改）。
  - 覆盖率：`src/server/cleaning` Lines 76.06% / Branch 72.72% / Funcs 79.31%，未达 90/90/90/85 目标。

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
| C 数据质量 | IN_PROGRESS | Phase 2B 完成 Legacy Adapter；50 条评测集与 CleaningPipeline 在 Phase 2C/2F |
| D 飞书集成 | BLOCKED_EXTERNAL_ENV | 未配置测试 Base 凭据 |
| E 安全隐私 | PASSED | 无 .env/Secret 入库；签名验签、脱敏、幂等、Legacy Import 禁令均已测试 |
| F 部署运行 | NOT_STARTED | 无 Dockerfile（Phase 5/6） |
| G 展示证据 | NOT_STARTED | 无运行证据（待 Docker/部署后补充） |

## 阻塞项

- 未配置 Dify 环境与凭据（`DIFY_BASE_URL`、`DIFY_WORKFLOW_API_KEY`、`DIFY_WORKFLOW_ID`）。
- 未配置飞书测试 Base 凭据与表结构（`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BASE_APP_TOKEN` 及各表 ID）。

## 风险

- 旧 `src/data-cleaning/agent/index.js` 存在 `&&amp;` HTML 实体语法错误，任何引用该文件的入口无法运行；V1 采用新建 `src/server/` 替代旧 Agent 入口，不修复旧入口。
- 现有 Schema 使用中文 fieldName，Dify Candidate 输出英文 raw 字段，Phase 2 需要增加映射层。
- 硬编码飞书资源 ID 较多，Phase 3 需逐步迁出源码。
- `core/data-cleaner.js` 导入闭包触发 `schemas/index.js` 与 `config/index.js` 的 import-time 文件读取，Phase 2A 审计需标记为 `EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY`，不得简单 WRAP。

## Phase 2B 完成说明

- **范围**：LegacyModuleLoader、8 个 Adapter、Adapter 合同与契约测试、直接 Legacy Import 禁令、错误标准化、Phase 2B 文档。
- **未修改 Legacy 源码**：`git diff origin/main -- src/data-cleaning` 无输出。
- **覆盖率缺口**：`src/server/cleaning` Lines 76.06% / Branch 72.72% / Funcs 79.31%，未达 90/90/90/85 目标，需在 Phase 2C 前补充测试。

## 下一步唯一动作

1. Phase 2C：实现 immutable CleaningPipeline，将 Adapter 组合为确定性的清洗/校验/质量评估流程。

## 最近一次执行

- 命令：`npm ci; npm run audit:legacy; npm run typecheck; npm run lint; npm run test; npm run test:integration; npm run test:coverage; npm run build; git diff origin/main -- src/data-cleaning`
- 结果：全部命令退出码 0；`git diff src/data-cleaning` 无输出；测试 86 passed + 10 integration passed；覆盖率见 `docs/PHASE2B_ADAPTER_CONTRACTS.md`。
