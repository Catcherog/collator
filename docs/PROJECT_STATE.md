# PROJECT STATE

- 当前阶段：Phase 1
- 状态：DONE
- 最近更新：2026-07-15 18:55
- 当前分支：main
- 当前 Commit：待 Phase 1 提交
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

## 验收状态

| Gate | 状态 | 证据 |
|---|---|---|
| A 代码基线 | PASSED | `npm ci` / `typecheck` / `lint` / `test` / `test:integration` / `build` 全部通过 |
| B API 合同 | PASSED | `docs/API_CONTRACT.md` + 10 项集成测试覆盖全部 V1 接口 |
| C 数据质量 | NOT_STARTED | 无 50 条固定评测集与评测脚本（Phase 2 引入 Dify 后构建） |
| D 飞书集成 | BLOCKED_EXTERNAL_ENV | 未配置测试 Base 凭据 |
| E 安全隐私 | PASSED | 无 .env/Secret 入库；签名验签、脱敏、幂等均已测试 |
| F 部署运行 | NOT_STARTED | 无 Dockerfile（Phase 5/6） |
| G 展示证据 | NOT_STARTED | 无运行证据（待 Docker/部署后补充） |

## 阻塞项

- 未配置 Dify 环境与凭据（`DIFY_BASE_URL`、`DIFY_WORKFLOW_API_KEY`、`DIFY_WORKFLOW_ID`）。
- 未配置飞书测试 Base 凭据与表结构（`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BASE_APP_TOKEN` 及各表 ID）。

## 风险

- 旧 `src/data-cleaning/agent/index.js` 存在 `&&amp;&amp;` HTML 实体语法错误，任何引用该文件的入口无法运行；V1 采用新建 `src/server/` 替代旧 Agent 入口，不修复旧入口。
- 现有 Schema 使用中文 fieldName，Dify Candidate 输出英文 raw 字段，Phase 2 需要增加映射层。
- 硬编码飞书资源 ID 较多，Phase 3 需逐步迁出源码。

## 下一步唯一动作

1. 提交 Phase 1 代码到 Git。
2. 进入 Phase 2：Dify Workflow 接入与结构化提取映射。

## 最近一次执行

- 命令：`npm ci; npm run typecheck; npm run lint; npm run test; npm run test:integration; npm run build`
- 结果：全部通过；单元测试 16 项，集成测试 10 项，共 26 项通过。
