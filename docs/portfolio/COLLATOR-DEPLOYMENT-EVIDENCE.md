# Collator — V1 部署证据与展示材料（Gate G）

> 本文档为 Collator V1 收口阶段的部署证据汇总与求职/官网展示材料。所有命令、状态码、断言数均来自本地真实执行结果。文档中不包含真实 App ID、Base Token、Table ID、record ID、App Secret 或任何飞书凭据。出现于示例中的标识符一律为脱敏占位符。

---

## 1. Product Summary（产品摘要）

**Collator 解决什么问题**

Collator 解决「非结构化业务信息 → 可校验业务主表」的录入可靠性问题。在客户咨询、订单管理、拍摄执行等场景中，业务信息原本散落在聊天文本、截图、语音、文档附件中，人工录入易错、易重复、易丢失字段证据。Collator 在「模型候选字段」与「业务主表」之间插入一层：候选字段生成 → 五重约束校验 → 人工审核 → 状态机 → 幂等写入边界，确保错误数据不进入正式表、同一业务记录不被重复写入、失败结果具备可解释性。

**用户、输入、输出与业务价值**

| 维度 | 说明 |
|------|------|
| 用户 | 客服、运营、复盘人员（通过飞书机器人 + Webhook 触发） |
| 输入 | 客户咨询文本（V1 现网仅启用 plain text pipeline） |
| 输出 | 飞书业务主表中的精确记录 + 写入日志 + 审核任务 |
| 业务价值 | 录入错误率下降、重复客户识别、字段证据可追溯、失败可解释、模型幻觉被边界拦截 |

V1 现网范围：仅处理 `customer_consultation` 纯文本管道；OCR / ASR / 多模态校验为后续能力扩展点，不在 V1 验收范围内。

---

## 2. System Flow（系统流程）

```text
┌──────────────────────────────────────────────────────────────┐
│  Candidate Ingestion（候选摄入）                              │
│  Webhook → IngestionService → CandidateRecord 生成            │
│  状态：pending_review                                          │
└──────────────────────────────┬───────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────┐
│  Cleaning Pipeline（清洗管道）                                │
│  Legacy Module Loader（VM 沙箱） → 字段抽取与规整             │
│  Pipeline 阶段固定、可测、不依赖属性遍历顺序                   │
│  异常统一转换为 PipelineError（带 stage / module 标识）        │
└──────────────────────────────┬───────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────┐
│  Human Review（人工审核）                                     │
│  审核员查看 CandidateRecord + evidence + warnings             │
│  决策：approve / reject / request_changes                     │
└──────────────────────────────┬───────────────────────────────┘
                               ↓ approve
┌──────────────────────────────────────────────────────────────┐
│  Idempotent Feishu Write（幂等飞书写入）                       │
│  CustomerRecordWriter 基于 client_token 去重                  │
│  重复 approve 不重复写入；writer replay 返回相同业务记录       │
└──────────────────────────────┬───────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────┐
│  Audit Log（审计日志）                                        │
│  WriteLogRepository 记录每次写入的 client_token / record_id   │
│  支持回放与幂等校验                                            │
└──────────────────────────────────────────────────────────────┘
```

关键设计：飞书适配层（FeishuTaskRepository / FeishuReviewRepository / FeishuWriteLogRepository / CustomerRecordWriter）隔离业务逻辑与飞书 API 细节；Legacy 源码通过 VM 沙箱加载，hash 校验 + 路径白名单 + 内置模块限制，确保不污染主进程。

---

## 3. Reliability Evidence（可靠性证据）

| 验证项 | 结果 | 说明 |
|--------|------|------|
| Gate D 断言 | 25/25 PASS | 飞书四表集成测试全部通过，exit_code=0 |
| 四表精确 record_id 清理 | PASS | `finally` 阶段按精确 record_id 逐一删除本次创建的合成记录 |
| 重复 approve 不重复写入 | PASS | 同一 client_token 第二次 approve 命中 WriteLog 去重，不发起飞书 createRecord |
| Writer replay 返回相同业务记录 | PASS | 同一 client_token replay 返回首次写入的 record_id，不产生新记录 |
| Gate A 回归 | 446/446 PASS | `npm run test` 全量通过 |
| Gate C-Core | 50/50 PASS | 四项核心指标 100%（precision / recall / f1 / exact-match） |

**飞书文本字段规范化**：FeishuTaskRepository / FeishuReviewRepository / FeishuWriteLogRepository 统一使用共享 `normalizeFeishuText` 函数，支持 `string`、`{text: string}`、`Array<{text: string}>` 三种合法结构；读取接口显式设置 `text_field_as_array=false` 以降低响应结构波动。

**幂等边界**：`client_token` 作为唯一去重键，由摄入阶段生成，贯穿审核 → 写入 → 日志全流程。同一 client_token 在任意阶段失败后重试，不会污染业务主表。

---

## 4. Deployment Evidence（部署证据）

### 4.1 Docker 镜像构建

| 命令 | 结果 |
|------|------|
| `docker build -t collator:v1-local .` | exit 0，镜像构建成功 |
| 镜像大小 | 317 MB |
| 基础镜像 | `node:20-bookworm-slim`（官方） |
| 构建方式 | multi-stage（builder + runtime） |

### 4.2 容器启动验证

```bash
docker run -d --name collator-v1-test -p 3000:3000 \
  -e PORT=3000 \
  -e TASK_REPOSITORY=memory \
  -e COLLATOR_WEBHOOK_SECRET=gate-f-local-only \
  collator:v1-local
```

| 验证项 | 结果 |
|--------|------|
| 容器状态 | `running`，exit_code=0 |
| 运行用户 | `node`（非 root，uid 1000） |
| 监听地址 | `0.0.0.0:3000`（Fastify 同时日志 127.0.0.1 与容器 IP） |
| `/healthz` | HTTP 200，body=`{"status":"ok"}` |
| `/readyz` | HTTP 200，body=`{"status":"ready"}` |
| 容器日志敏感扫描 | 零匹配（无 App Secret / Bearer / tenant_access_token / 真实 Base ID / 真实 Table ID） |

### 4.3 镜像内容约束

- ✅ 不复制 `.env` / `.env.*`（`.dockerignore` 排除）
- ✅ 不复制 `.git`（`.dockerignore` 排除）
- ✅ 不复制 `node_modules`（builder 阶段 `npm ci` 重新安装）
- ✅ 不复制 `artifacts` / `coverage` / `*.log`（`.dockerignore` 排除）
- ✅ 不复制 `docs` / `.trae` / `tests` / `scripts`（`.dockerignore` 排除）
- ✅ 不复制 `src/scripts/temp` / `src/scripts/*.ps1`（`.dockerignore` 排除）
- ✅ 默认 `TASK_REPOSITORY=memory`，容器健康验证不依赖真实飞书环境
- ✅ `PORT` 可通过环境变量配置（默认 8787，验证时设为 3000）
- ✅ 镜像中无飞书凭据（`FEISHU_APP_SECRET` 仅作为 env var 名称出现在 config.js 字段引用中，非真实值）

### 4.4 已知镜像内标识符（DEBT-002）

镜像中 `src/data-cleaning/` Legacy 源码（AC-13 保护，不可修改）包含历史遗留的 Base app_token 与 Table ID 占位值。这些值经分类确认为 `RESOURCE_IDENTIFIER_ONLY`（不具备认证能力），不构成安全风险。Legacy 源码由 LegacyModuleLoader 在运行时通过 VM 沙箱加载，hash 校验 + 路径白名单确保不可越界。

---

## 5. Product Decisions（产品决策）

### 5.1 为什么采用适配器隔离飞书

飞书 API 的字段结构（尤其文本字段的 `string` / `{text}` / `Array<{text}>` 三态）和错误码会随版本演进。将飞书调用收敛到 `FeishuTaskRepository` / `FeishuReviewRepository` / `FeishuWriteLogRepository` / `CustomerRecordWriter` 四个适配器，业务逻辑只依赖 `TaskRepository` / `ReviewRepository` / `WriteLogRepository` 接口契约。这样：

- 飞书 API 变更只影响适配器层，业务逻辑无感知
- 测试可用 InMemoryTaskRepository 替换，不依赖真实飞书环境
- 未来切换到其他业务系统（如 CRM）只需新增适配器实现

### 5.2 为什么幂等边界依赖稳定 client_token

`client_token` 在摄入阶段生成，贯穿审核 → 写入 → 日志全流程。幂等边界放在 `CustomerRecordWriter` 而非飞书 API 层，因为：

- 飞书 createRecord 没有原生幂等保证，重复调用会创建多条记录
- `client_token` 作为业务级幂等键，由 WriteLogRepository 持久化
- writer replay 时通过 client_token 查 WriteLog，命中则直接返回首次写入的 record_id，不发起飞书请求
- 这保证「同一业务记录不被重复写入」的核心不变量

### 5.3 为什么错误路径 fail closed

V1 的错误处理原则是「宁可拒绝服务，不可污染业务主表」：

- `TASK_REPOSITORY=feishu` 时缺任意 FEISHU_* 配置 → 启动失败（无静默回退到 memory）
- Legacy 模块 hash 校验失败 → 拒绝加载（LEGACY_SOURCE_HASH_MISMATCH）
- 字段校验失败 → CandidateRecord 进入 pending_review 而非自动写入
- 写入失败 → 状态机进入 commit_failed，需人工介入而非自动重试到飞书

fail closed 是「模型不可信」假设下的必然选择：在边界未确认安全时，拒绝向前推进比向前推进更安全。

### 5.4 为什么 C-LLM 被作为外部依赖债务而不阻塞 V1

C-LLM（Dify 联调）依赖外部 Dify 实例的可用性与凭据，这些不在本仓库控制范围内。V1 的核心价值是「清洗管道 + 人工审核 + 幂等写入」的可靠性边界，与 C-LLM 是否接入无关。将 C-LLM 标记为 `DEFERRED`（DEBT-001）而非阻塞 V1，使得：

- V1 可以独立交付并验证核心可靠性
- C-LLM 接入可在后续迭代中独立验证，不影响已锁定的核心边界
- 外部环境不可用时（`BLOCKED_EXTERNAL_ENV`）不伪造通过

---

## 6. Sanitized Evidence Table（脱敏证据表）

| 命令 | 结果 | 对应 Gate |
|------|------|-----------|
| `npm run typecheck` | exit 0 | Gate A |
| `npm run lint` | exit 0 | Gate A |
| `npm run build` | exit 0 | Gate A |
| `npm run test` | 446/446 PASS | Gate A regression |
| `git diff --check` | exit 0（仅 CRLF 警告） | Gate A |
| `git diff origin/main -- src/data-cleaning` | 无输出 | AC-13 Legacy 零修改 |
| `npm run test:integration` | Gate D 25/25 PASS，exit_code=0 | Gate D |
| `docker build -t collator:v1-local .` | exit 0，镜像 317 MB | Gate F |
| `docker run ... collator:v1-local` | 容器 running，exit_code=0 | Gate F |
| `GET /healthz` | HTTP 200 `{"status":"ok"}` | Gate F |
| `GET /readyz` | HTTP 200 `{"status":"ready"}` | Gate F |
| 容器运行用户 | `node`（非 root） | Gate F |
| 容器日志敏感扫描 | 零匹配 | Gate F AC-10 |
| `git push origin phase/3-feishu-integration` | 正常 push 成功（非 force） | 收口 |
| `git push --force` / `--force-with-lease` | 未执行（禁止） | 收口约束 |

> 上表中所有标识符均为命令字面量或脱敏占位符；无真实 App ID、Base Token、Table ID、record ID、App Secret 出现。

---

## 7. Website Copy（官网文案）

### 7.1 项目摘要（60–90 字中文）

Collator 是一个 Agent 数据清洗与业务写入系统，把聊天文本、截图、语音中的非结构化业务信息转换为可校验、可人工确认、可幂等写入飞书的结构化记录，在模型候选字段与业务主表之间建立可靠性边界。

### 7.2 项目亮点（3 条）

1. **幂等写入边界**：基于稳定 `client_token` 的去重机制，重复 approve 不重复写入，writer replay 返回相同业务记录，从源头杜绝业务主表污染。
2. **Legacy 沙箱隔离**：历史 JS 源码通过 VM 沙箱加载，hash 校验 + 路径白名单 + 内置模块限制，业务主流程与遗留代码解耦，hash 不一致即拒绝加载。
3. **飞书适配层 + fail closed**：四表适配器隔离 API 细节，文本字段三态规范化；缺配置即启动失败，无静默回退，错误路径拒绝向前推进。

### 7.3 技术挑战（1 条）

飞书多维表文本字段在 API 响应中存在 `string` / `{text: string}` / `Array<{text: string}>` 三种合法结构，初始适配层假设过窄导致 Gate D 集成测试失败。解决方案是抽取共享 `normalizeFeishuText` 函数统一处理三态，并在读取接口显式设置 `text_field_as_array=false` 降低响应结构波动，同时增强 Gate D 测试数据清理为按精确 record_id 在 `finally` 阶段逐一删除。

### 7.4 结果指标（1 条）

V1 收口阶段 Gate A 回归 446/446、Gate C-Core 50/50（四项指标 100%）、Gate D 飞书四表集成 25/25 断言全部通过、Gate F Docker 容器 `/healthz` 与 `/readyz` 均返回 HTTP 200。

### 7.5 我的职责（1 段）

独立负责 Collator 的架构设计、核心代码实现、飞书适配层开发、Legacy 沙箱集成、Gate A-F 全套验证用例编写与执行、Docker 容器化与部署证据产出。从需求拆解、ADR 决策记录、Phase 推进到最终收口交付全流程主导，包括跨窗口协作的状态文档维护与敏感信息脱敏审计。

---

## 附录：文档边界声明

- 本文档不包含真实飞书 App ID、Base Token、Table ID、record ID、App Secret 或任何凭据。
- 本文档不新增真实飞书截图或标识符；如需截图证据，参见 `docs/ACCEPTANCE_REPORT.md`（内部文档，含脱敏处理后的执行记录）。
- V1 现网范围限定为 `customer_consultation` 纯文本管道；OCR / ASR / 多模态校验 / C-LLM 为后续能力扩展点，不在 V1 验收范围内。
- C-LLM（Dify 联调）状态为 `DEFERRED`（DEBT-001），不阻塞 V1。
- Legacy 源码遗留标识符为 `DEBT-002`，受 AC-13 保护不在本次收口范围内修改。
