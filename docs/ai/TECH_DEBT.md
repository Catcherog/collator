# Tech Debt Registry — collator（数据清洗服务）

## 格式说明

每条技术债使用以下结构登记：

```markdown
## DEBT-xxx: 简短标题

- Status: OPEN / IN_PROGRESS / RESOLVED
- Severity: P1 / P2  <!-- P0 不应进入技术债，应在当前任务解决 -->
- Introduced By: TASK-xxx  <!-- 或具体来源 -->
- Context: 简要背景。
- Risk: 不处理的潜在影响。
- Reason Deferred: 为何延后处理。
- Resolve Before: MVP / Public Beta / 其他里程碑。
- Related Files:
  - 路径/到/相关文件
```

## 当前条目

## DEBT-001: Dify 环境与凭据未配置

- Status: OPEN
- Severity: P1
- Introduced By: Phase 0 基线盘点
- Context: V1 Core Service 需要对接 Dify 进行语义提取与回调，但本地与仓库均未配置 Dify 环境变量（`DIFY_BASE_URL`、`DIFY_WORKFLOW_API_KEY`、`DIFY_WORKFLOW_ID`）。
- Risk: 无法运行端到端 Dify 回调流程；未来 Dify/LLM 真实联调阶段（Gate C-LLM）受阻。不阻塞 Phase 2F Gate C-Core 确定性数据质量验收。
- Reason Deferred: Phase 2F 已明确拆分为 Gate C-Core（确定性 Pipeline 评测，不依赖 Dify）与未来 Gate C-LLM（Dify 真实联调）。Dify 凭据需由用户在外部环境配置后注入 `.env`，不进入仓库。
- Resolve Before: Gate C-LLM（Dify/LLM 真实联调阶段）
- Related Files:
  - .env.example

## DEBT-002: 飞书测试 Base 凭据与表结构未配置

- Status: OPEN
- Severity: P1
- Introduced By: Phase 0 基线盘点
- Context: 生产用 `FeishuTaskRepository` 需要飞书测试 Base 凭据（`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BASE_APP_TOKEN` 及各业务表 ID），当前未配置。
- Risk: Gate D 飞书集成验收无法执行；`FeishuTaskRepository` 集成测试无法跑通。
- Reason Deferred: 凭据属于外部环境配置，需由用户创建测试 Base 并提供；当前阶段使用 `InMemoryTaskRepository` 完成核心逻辑验证。
- Resolve Before: Gate D 验收
- Related Files:
  - src/server/repositories/task-repository.ts
  - .env.example

## DEBT-003: 旧 src/data-cleaning/agent/index.js 存在 `&&amp;` HTML 实体语法错误

- Status: OPEN
- Severity: P1
- Introduced By: Legacy 源码（Phase 0 基线盘点发现）
- Context: 旧 Agent 入口 `src/data-cleaning/agent/index.js` 包含 `&&amp;` HTML 实体语法错误，任何引用该文件的入口无法运行。
- Risk: 若误用旧入口会导致运行时失败；不影响 V1 Core Service（已通过 `src/server/` 新建入口替代）。
- Reason Deferred: V1 采用新建 `src/server/` 替代旧 Agent 入口，遵循 Legacy 源码零修改约束，不修复旧入口。
- Resolve Before: Phase 3（Legacy 清理阶段）
- Related Files:
  - src/data-cleaning/agent/index.js

## DEBT-004: 现有 Schema 使用中文 fieldName，与 Dify Candidate 英文 raw 字段不匹配

- Status: OPEN
- Severity: P1
- Introduced By: Phase 0 基线盘点
- Context: 现有飞书 Schema 使用中文 fieldName，而 Dify Candidate 输出英文 raw 字段，两者之间缺少映射层。
- Risk: Dify 回调写入飞书时字段对不上，导致数据落表失败或字段错位。
- Reason Deferred: Phase 2 需增加中英文字段映射层；当前 Phase 2C 聚焦 CleaningPipeline 确定性逻辑。
- Resolve Before: Phase 2 完成（Gate C 数据质量验收前）
- Related Files:
  - src/data-cleaning/schemas/customer.json
  - src/server/cleaning/pipeline/cleaning-pipeline.ts

## DEBT-005: 硬编码飞书资源 ID 较多

- Status: OPEN
- Severity: P1
- Introduced By: Phase 0 基线盘点
- Context: 旧 `src/data-cleaning` 中硬编码了大量飞书资源 ID（Base Token、表 ID 等），未通过环境变量或配置注入。
- Risk: 资源 ID 变更需修改源码；生产环境切换 Base 困难；存在凭据泄露风险。
- Reason Deferred: Phase 3 逐步将资源 ID 迁出源码，迁入 `.env` 或配置中心；当前阶段不修改 Legacy 源码。
- Resolve Before: Phase 3
- Related Files:
  - src/data-cleaning/config/agent-config.json
  - src/data-cleaning/agent/execution/bitable-writer.js

## DEBT-006: core/data-cleaner.js 导入闭包触发 import-time 文件读取

- Status: OPEN
- Severity: P1
- Introduced By: Phase 2A 审计
- Context: `core/data-cleaner.js` 在导入闭包中触发 `schemas/index.js` 与 `config/index.js` 的 import-time 文件读取，导致模块无法作为纯函数使用。
- Risk: 直接 WRAP 该模块会带入副作用，破坏 Pipeline 的确定性与不可变性；测试隔离困难。
- Reason Deferred: Phase 2A 审计已标记为 `EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY`，不得简单 WRAP；需在后续 Phase 逐步抽取纯函数并迁移。
- Resolve Before: Phase 3
- Related Files:
  - src/data-cleaning/core/data-cleaner.js
  - src/data-cleaning/schemas/index.js
  - src/data-cleaning/config/index.js
