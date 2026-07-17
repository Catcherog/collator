# Project State — collator（数据清洗服务）

## Current Stage

Phase 2F（Gate C-Core 离线评测 Runner 已实现并通过，确定性数据质量验收完成）

- 状态：DONE（Phase 2F 代码与测试已完成，Gate C-Core PASS）
- Planning Review：APPROVED_WITH_REQUIRED_CHANGES（Phase 2 Planning Correction 已完成）
- 当前分支：phase/2c-cleaning-pipeline
- 验收基线 Commit：`91813a4`（Phase 2C implementation commit）
- 当前版本：v1.0

## Current Milestone

V1 Core Service 验收 / Gate C-Core 数据质量验收完成

## In Progress

- 无（Phase 2F Gate C-Core 已完成，等待 Phase 3 启动）

## Recently Completed

- **Phase 0**：基线盘点。阅读项目协作规则与模板（原交接包内容已整合至 `改造方案.txt`、`.trae/rules/` 和 `docs/ai/`）；阅读 `.trae/Knowledge/` 与 `.trae/rules/`；完成项目目录、Schema、核心模块、脚本、测试入口盘点；运行现有测试并记录真实结果；扫描硬编码资源 ID 与敏感信息；生成 `docs/BASELINE_REPORT.md`、`docs/PROJECT_STATE.md`、`docs/DECISIONS.md`、`docs/ACCEPTANCE_REPORT.md`；初始化 Git 仓库并提交 Phase 0 基线 Commit。
- **Phase 1**：Core Service 外壳。搭建 TypeScript + Fastify Core Service；实现 `src/server/app.ts` 服务入口、配置加载、错误处理、路由注册；实现 `src/server/routes/ingestions.ts`（创建任务、查询任务、Candidate 回调、审核通过/拒绝）；实现 `src/server/services/ingestion-service.ts`（幂等创建、状态机、候选处理、审核逻辑）；实现 `src/server/security/signature.ts`（HMAC-SHA256 签名、时间戳校验、重放防护）与 `src/server/security/redaction.ts`（手机号、微信、原始文本脱敏）；实现 `src/server/repositories/in-memory-task-repository.ts`；定义 domain 层；创建 `eslint.config.js` 与 `tsconfig.json`；编写单元测试与集成测试；创建 `docs/API_CONTRACT.md`。Phase 1 收尾审计：工作区干净，`npm ci` + `typecheck` / `lint` / `test` / `test:integration` / `build` / `test:coverage` 全部通过，15 项核心能力矩阵完整。
- **Phase 2B**：Legacy Adapter。建立分支 `phase/2b-legacy-adapters`；实现 `src/server/cleaning/legacy-module-loader.ts`（VM 沙箱 + `legacyRequire` + 路径校验 + 导出白名单 + Hash 校验 + 安全缓存 + 错误标准化）；实现 `src/server/cleaning/errors.ts`（7 个错误码的 `LegacyAdapterError`，错误信息脱敏）；实现 `src/server/cleaning/legacy-audit.ts` + `contracts/legacy-module-profile.ts`；实现 8 个 Adapter（utils / config / schema / cleaner / noop-logger / rules / quality / benchmark）；实现 `tests/unit/cleaning/import-ban.test.ts`（生产代码直接 Legacy Import 禁令扫描）；为 Loader 和每个 Adapter 编写契约/边界测试。Phase 2B 验收：全套 Gate A 命令通过；`git diff origin/main -- src/data-cleaning` 无输出；`src/server/cleaning` Lines 76.06% / Branch 72.72% / Funcs 79.31%。
- **Phase 2C**：Immutable CleaningPipeline。实现 `src/server/cleaning/pipeline/cleaning-pipeline.ts`；编写 `tests/unit/cleaning/pipeline/cleaning-pipeline.test.ts`（11 tests）与 `cleaning-pipeline-error-paths.test.ts`（5 tests）；Pipeline 阶段固定顺序：format_clean → enum_map_clean → validate → quality_assessment；防御性 deepClone 保证不可变性；相同输入多次执行输出深度相等保证确定性；阶段失败后统一 PipelineError，后续阶段 skipped；错误信息中手机号被脱敏为 `1**********`；agent/index.js 不进入执行链；V1 仅支持 `customer_consultation`；无直接 Legacy Import。Phase 2C 验收：全套 Gate A 命令退出码 0；测试 102 passed（含 16 Pipeline tests）；CleaningPipeline Lines 100% / Branch 95.23% / Funcs 100%；`git diff origin/main -- src/data-cleaning` 无输出。
- **Phase 2F**：Gate C-Core 离线评测 Runner。实现 `scripts/run-evaluation.ts`（CLI 薄入口）+ `src/evaluation/` 6 模块（fixture-loader / comparator / metrics / reporter / runner / types）+ `tests/fixtures/customer-consultation-50.jsonl`（50 条评测集）+ `artifacts/evaluation/`（报告，不入库）；Runner 复用 Phase 2C 生产入口 `runCleaningPipeline`，不复制业务逻辑；退出码 0=PASS / 1=指标未达标 / 2=Runner 错误；错误比较使用 code+field/stage 元组，不比较文案；persistence_check 标记为 NOT_APPLICABLE；新增 `npm run evaluate` 脚本。编写 44 个单元测试 + 11 个集成测试（端到端、退出码、禁止网络访问、门槛边界）。Phase 2F 验收：Gate A 全套命令退出码 0；测试 157 passed（20 test files）；evaluation 模块 Lines 85.50% / Funcs 100%；`npm run evaluate` Gate C-Core PASS（50/50 case，4 项核心指标 100%）；`git diff origin/main -- src/data-cleaning` 无输出。

## Next Priorities

1. 配置 Dify 环境与凭据（DEBT-001），解锁 Gate C-LLM 真实 LLM 联调。
2. 配置飞书测试 Base 凭据与表结构（DEBT-002），解锁 Gate D 飞书集成验收。
3. 进入 Phase 3（飞书集成）：FeishuTaskRepository 实现 + 字段映射层 + 硬编码资源 ID 迁出。
4. 后续按 Phase 推进流程进入 Phase 5（部署）、Phase 6（展示证据）。

## Roadmap

### Phase 2F: 固定评测集与 Gate C-Core 数据质量验收
- 里程碑：50 条人工合成评测集与离线 Evaluation Runner 跑通 ✅ DONE
- 依赖：Phase 2C 已完成 ✅
- 阻塞项：无（不依赖 Dify/LLM，DEBT-001 不阻塞本阶段）
- 范围边界：仅评测确定性 CleaningPipeline（CandidateRecord → 清洗/校验 → NormalizedRecord），不调用 Dify、LLM、飞书、数据库或任何外部网络
- 验收标准（Gate C-Core）：字段准确率≥90%，必填字段召回率≥95%，枚举映射精确率≥95%，错误拦截率≥95% ✅ 全部 100% PASS
- 实施位置：`scripts/run-evaluation.ts`（CLI）+ `src/evaluation/`（核心模块）+ `tests/fixtures/customer-consultation-50.jsonl`（评测集）+ `artifacts/evaluation/`（报告，不入库）
- 验收结果：50/50 case 通过；测试 157 passed；evaluation 模块 Lines 85.50% / Funcs 100%；Gate C-Core PASS

### Phase 3: 飞书集成
- 里程碑：FeishuTaskRepository 实现 + 凭据配置 + 字段映射层 + 硬编码资源 ID 迁出
- 依赖：Phase 2F 完成（Gate C 通过）；外部阻塞：需用户提供飞书测试 Base 凭据（DEBT-002）和 Dify 凭据（DEBT-001）
- 阻塞项：DEBT-001（Dify 凭据）、DEBT-002（飞书 Base 凭据）、DEBT-004（中英文字段映射）、DEBT-005（硬编码资源 ID）
- 验收标准：Gate D 飞书集成验收通过

### Phase 5: 部署
- 里程碑：Dockerfile + 容器化构建与启动验证
- 依赖：Phase 3 完成
- 阻塞项：无
- 验收标准：Gate F 部署运行验收通过

### Phase 6: 展示证据
- 里程碑：端到端运行证据（截图/日志）
- 依赖：Phase 5 完成
- 阻塞项：无
- 验收标准：Gate G 展示证据验收通过

## Active Blockers

- 未配置 Dify 环境与凭据（`DIFY_BASE_URL`、`DIFY_WORKFLOW_API_KEY`、`DIFY_WORKFLOW_ID`）— 见 DEBT-001。仅阻塞未来 Gate C-LLM 真实 LLM 联调与 Gate D 飞书集成，**不阻塞 Phase 2F Gate C-Core**。
- 未配置飞书测试 Base 凭据与表结构（`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BASE_APP_TOKEN` 及各表 ID）— 见 DEBT-002。

> 注：以上阻塞项均属于外部环境配置，不阻塞 V1 Core Service 代码合并与 Phase 2F Gate C-Core 确定性数据质量验收，但阻塞 Gate C-LLM、Gate D 飞书集成验收与端到端真实链路。

## Known Risks

- 旧 `src/data-cleaning/agent/index.js` 存在 `&&amp;` HTML 实体语法错误，任何引用该文件的入口无法运行；V1 采用新建 `src/server/` 替代旧 Agent 入口，不修复旧入口（见 DEBT-003）。
- 现有 Schema 使用中文 fieldName，Dify Candidate 输出英文 raw 字段，Phase 2 需要增加映射层（见 DEBT-004）。
- 硬编码飞书资源 ID 较多，Phase 3 需逐步迁出源码（见 DEBT-005）。
- `core/data-cleaner.js` 导入闭包触发 `schemas/index.js` 与 `config/index.js` 的 import-time 文件读取，Phase 2A 审计需标记为 `EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY`，不得简单 WRAP（见 DEBT-006）。

## Last Updated

2026-07-17

---

## 附录：Phase 1 能力矩阵

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

## 附录：接口审计

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

## 附录：覆盖率基线

| 范围 | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Core Service (`src/server` 可执行代码，排除纯类型文件) | 90.3% | 82.56% | 88.57% | 90.3% |
| 全仓库（含旧 `src/data-cleaning`） | 3.05% | 47.12% | 26.49% | 3.05% |

> 旧 `src/data-cleaning/**/*.js` 模块不在 V1 Core Service 范围内，未纳入核心覆盖率口径；将在 Phase 3 后逐步清理或替换。

> Gate A 口径为 Core 关键模块行覆盖率 ≥ 80%。Phase 2C 时 CleaningPipeline Lines 100% / Branch 95.23% / Funcs 100%。

## 附录：验收状态（Gate A-G）

| Gate | 名称 | 状态 | 证据 |
|---|---|---|---|
| A | 代码基线 | PASSED | `npm ci` / `audit:legacy` / `typecheck` / `lint` / `test` / `test:integration` / `build` / `test:coverage` 全部通过；`git diff origin/main -- src/data-cleaning` 无输出 |
| B | API 合同 | PASSED | `docs/API_CONTRACT.md` + 10 项集成测试覆盖全部 V1 接口 |
| C-Core | 数据质量（确定性） | PASSED | Phase 2F：50/50 case 通过，4 项核心指标 100%（field_accuracy 132/132, required_field_recall 91/91, enum_precision 33/33, error_interception_rate 1/1） |
| C-LLM | 数据质量（LLM 语义） | BLOCKED_EXTERNAL_ENV | 未配置 Dify 凭据（见 DEBT-001）|
| D | 飞书集成 | BLOCKED_EXTERNAL_ENV | 未配置测试 Base 凭据（见 DEBT-001、DEBT-002） |
| E | 安全隐私 | PASSED | 无 .env/Secret 入库；签名验签、脱敏、幂等、Legacy Import 禁令均已测试 |
| F | 部署运行 | NOT_STARTED | 无 Dockerfile（Phase 5/6） |
| G | 展示证据 | NOT_STARTED | 无运行证据（待 Docker/部署后补充） |

## 附录：最近一次执行

- 命令：`npm run typecheck; npm run lint; npm run test; npm run test:coverage; npm run build; npm run audit:legacy; npm run evaluate; git diff origin/main -- src/data-cleaning`
- 结果：全部命令退出码 0；`git diff src/data-cleaning` 无输出；测试 157 passed（含 44 evaluation tests + 11 runner integration tests）；evaluation 模块 Lines 85.50%；`npm run evaluate` Gate C-Core PASS（50/50 case，4 项核心指标 100%）。
