# Project State — collator（数据清洗服务）

## Current Stage

Phase 3 / TASK-003-GATE-D-TEXT-NORMALIZATION（Gate D 第五次尝试：方案 B 代码兼容修复后真实通过；本轮不创建 commit）

- 状态：`GATE_D_PASS_AWAITING_GPT_REVIEW` — GPT 基于第四次尝试的 `FIX_REQUIRED` 判决采用方案 B（代码兼容）；新增共享文本规范化函数 `normalizeFeishuText`/`normalizeFeishuJson`，三个 Feishu Repository 适配层迁移到共享 normalizer；FeishuClient `getRecord`/`searchRecords` 显式设置 `text_field_as_array=false`；客户表 MultiSelect 字段（`意向风格`）在 writer 中包装为 array of strings 修复 `MultiSelectFieldConvFail`；`npm run gate:d` 真实运行退出码 **0（PASS）**，25/25 断言全部通过，4 张表（ingestion/review/customer/write_log）合成记录全部按精确 record_id 在 finally 块中清理；之前第四次尝试遗留的 `recXXX`（属于 Collator 摄入任务表，非客户表）经 RESIDUAL-EVIDENCE-FIX 修正轮使用 `client.getRecord(ingestionTableId, ...)` 验证，飞书返回 code=1254043 RecordIdNotFound，证明摄入任务表已无残留；Gate A + Gate C-Core 全套回归通过，446/446 测试通过；AC-06 + AC-07 从 `BLOCKED_SCHEMA_MISMATCH` 解锁为真实 PASS。未 commit、未 push（AC-12 git 纪律 + 任务卡 `NO_COMMIT` 指令）。
- Planning Review：APPROVED_WITH_REQUIRED_CHANGES（Phase 2 Planning Correction 已完成）
- 当前分支：phase/3-feishu-integration
- 验收基线 Commit：`af3cba1`（TASK-003-TAKEOVER-VERIFY 任务卡指定的 baseline）
- 当前 HEAD：`af3cba1`（与基线一致，未 commit；所有变更在工作区）
- 当前版本：v1.0

## Current Milestone

Phase 3 飞书集成 / TASK-003-GATE-D-TEXT-NORMALIZATION — Gate D 真实通过；等待 GPT 证据审查；本轮不 commit

## In Progress

- **TASK-003-GATE-D-TEXT-NORMALIZATION（GATE_D_PASS_AWAITING_GPT_REVIEW）**：基于 GPT 第四次尝试后的 `FIX_REQUIRED` 判决采用方案 B（代码兼容），新增共享文本规范化函数 `src/server/feishu/normalize-text.ts` 导出 `normalizeFeishuText`/`normalizeFeishuJson`，三个 Feishu Repository 适配层迁移到共享 normalizer；FeishuClient `getRecord`/`searchRecords` 显式设置 `text_field_as_array=false`；MultiSelect 字段修复；`npm run gate:d` 真实运行 exit_code=0，25/25 断言通过，4 张表合成记录全部清理；446/446 测试通过。HEAD 保持 `af3cba1`，未 commit、未 push；等待 GPT 证据审查 + 用户 commit 授权。

## Recently Completed

- **Phase 0**：基线盘点。阅读项目协作规则与模板（原交接包内容已整合至 `改造方案.txt`、`.trae/rules/` 和 `docs/ai/`）；阅读 `.trae/Knowledge/` 与 `.trae/rules/`；完成项目目录、Schema、核心模块、脚本、测试入口盘点；运行现有测试并记录真实结果；扫描硬编码资源 ID 与敏感信息；生成 `docs/BASELINE_REPORT.md`、`docs/PROJECT_STATE.md`、`docs/DECISIONS.md`、`docs/ACCEPTANCE_REPORT.md`；初始化 Git 仓库并提交 Phase 0 基线 Commit。
- **Phase 1**：Core Service 外壳。搭建 TypeScript + Fastify Core Service；实现 `src/server/app.ts` 服务入口、配置加载、错误处理、路由注册；实现 `src/server/routes/ingestions.ts`（创建任务、查询任务、Candidate 回调、审核通过/拒绝）；实现 `src/server/services/ingestion-service.ts`（幂等创建、状态机、候选处理、审核逻辑）；实现 `src/server/security/signature.ts`（HMAC-SHA256 签名、时间戳校验、重放防护）与 `src/server/security/redaction.ts`（手机号、微信、原始文本脱敏）；实现 `src/server/repositories/in-memory-task-repository.ts`；定义 domain 层；创建 `eslint.config.js` 与 `tsconfig.json`；编写单元测试与集成测试；创建 `docs/API_CONTRACT.md`。Phase 1 收尾审计：工作区干净，`npm ci` + `typecheck` / `lint` / `test` / `test:integration` / `build` / `test:coverage` 全部通过，15 项核心能力矩阵完整。
- **Phase 2B**：Legacy Adapter。建立分支 `phase/2b-legacy-adapters`；实现 `src/server/cleaning/legacy-module-loader.ts`（VM 沙箱 + `legacyRequire` + 路径校验 + 导出白名单 + Hash 校验 + 安全缓存 + 错误标准化）；实现 `src/server/cleaning/errors.ts`（7 个错误码的 `LegacyAdapterError`，错误信息脱敏）；实现 `src/server/cleaning/legacy-audit.ts` + `contracts/legacy-module-profile.ts`；实现 8 个 Adapter（utils / config / schema / cleaner / noop-logger / rules / quality / benchmark）；实现 `tests/unit/cleaning/import-ban.test.ts`（生产代码直接 Legacy Import 禁令扫描）；为 Loader 和每个 Adapter 编写契约/边界测试。Phase 2B 验收：全套 Gate A 命令通过；`git diff origin/main -- src/data-cleaning` 无输出；`src/server/cleaning` Lines 76.06% / Branch 72.72% / Funcs 79.31%。
- **Phase 2C**：Immutable CleaningPipeline。实现 `src/server/cleaning/pipeline/cleaning-pipeline.ts`；编写 `tests/unit/cleaning/pipeline/cleaning-pipeline.test.ts`（11 tests）与 `cleaning-pipeline-error-paths.test.ts`（5 tests）；Pipeline 阶段固定顺序：format_clean → enum_map_clean → validate → quality_assessment；防御性 deepClone 保证不可变性；相同输入多次执行输出深度相等保证确定性；阶段失败后统一 PipelineError，后续阶段 skipped；错误信息中手机号被脱敏为 `1**********`；agent/index.js 不进入执行链；V1 仅支持 `customer_consultation`；无直接 Legacy Import。Phase 2C 验收：全套 Gate A 命令退出码 0；测试 102 passed（含 16 Pipeline tests）；CleaningPipeline Lines 100% / Branch 95.23% / Funcs 100%；`git diff origin/main -- src/data-cleaning` 无输出。
- **Phase 2F**：Gate C-Core 离线评测 Runner。实现 `scripts/run-evaluation.ts`（CLI 薄入口）+ `src/evaluation/` 6 模块（fixture-loader / comparator / metrics / reporter / runner / types）+ `tests/fixtures/customer-consultation-50.jsonl`（50 条评测集）+ `artifacts/evaluation/`（报告，不入库）；Runner 复用 Phase 2C 生产入口 `runCleaningPipeline`，不复制业务逻辑；退出码 0=PASS / 1=指标未达标 / 2=Runner 错误；错误比较使用 code+field/stage 元组，不比较文案；persistence_check 标记为 NOT_APPLICABLE；新增 `npm run evaluate` 脚本。编写 44 个单元测试 + 11 个集成测试（端到端、退出码、禁止网络访问、门槛边界）。Phase 2F 验收：Gate A 全套命令退出码 0；测试 157 passed（20 test files）；evaluation 模块 Lines 85.50% / Funcs 100%；`npm run evaluate` Gate C-Core PASS（50/50 case，4 项核心指标 100%）；`git diff origin/main -- src/data-cleaning` 无输出。
- **Phase 3A / TASK-001**：飞书运行表 + FeishuTaskRepository。建立分支 `phase/3-feishu-integration`；用 `src/scripts/temp/create-collator-tables.ts`（lark-cli 幂等创建）在目标 Base `MwGMbF0Q0alPc6s3jOccovvOnob` 创建 3 张运行表（`Collator 摄入任务` / `Collator 审核任务` / `Collator 写入日志`）+ 客户表 `Collator 摄入 ID` 隐藏文本字段；真实表 ID 仅写入 `.env`（gitignored）；实现 `src/server/feishu/feishu-errors.ts`（结构化脱敏错误 `FeishuApiError`，redactPhone 兜底）+ `src/server/feishu/feishu-client.ts`（Node 20 原生 fetch；tenant_access_token 缓存 + 60s 提前刷新 + 401 单次刷新重试；CRUD + searchRecords；fetchFn 注入支持单测）+ `src/server/repositories/feishu-task-repository.ts`（JSON 快照策略：完整 IngestionTask 序列化到「任务快照 JSON」字段，索引列只用于查询；save 先 search by 摄入 ID，存在则 updateRecord 否则 createRecord；datetime 毫秒时间戳）+ `src/server/repositories/repository-factory.ts`（生产装配点，feishu 模式下缺凭据抛错不静默回退）；修改 `src/server/config.ts`（新增 `taskRepository: z.enum(['memory','feishu']).default('memory')` + superRefine 校验 feishu 模式下必需凭据）+ `src/server/app.ts`（用 `createTaskRepository(config)` 替代直接 `new InMemoryTaskRepository()`）+ `.env.example`（新增 4 个 FEISHU_* 必填项 + TASK_REPOSITORY）。TDD：14 单元测试（feishu-client）+ 9 单元测试（feishu-task-repository）+ 6 集成测试（FakeFeishuClient 跨实例读取）+ 8 单元测试（repository-factory，覆盖缺各项凭据抛错）。真实 Base 结构核验：`src/scripts/temp/smoke-test-lark-cli.ts` 通过 lark-cli 端到端验证 create→search→update→search 全流程，深度等价、datetime 格式、单选字段返回数组形式均符合预期，cleanup 后 0 记录残留。Phase 3A 验收：Gate A 全套命令退出码 0；测试 194 passed（24 test files）；feishu-client Lines 95.3% / feishu-errors Lines 100% / feishu-task-repository Lines 91.2% / repository-factory Lines 100%（合并显示行 86.95%）；`git diff origin/main -- src/data-cleaning` 无输出；Legacy 源码零修改。
- **Phase 3A / TASK-001 P0 修复**：针对 GPT 基于 Commit `0be872d` 提出的 2 个 P0 进行最小修复。**P0-01（token 业务错误码刷新重试）**：`src/server/feishu/feishu-client.ts` 新增常量 `TOKEN_INVALID_CODE = 99991663`；`callWithRetry` 在 HTTP 非 401 路径上 parseResponse 抛出 `FeishuApiError(code=99991663)` 时触发单次 token 刷新 + 重试；重试后再次失败则错误冒泡，不递归重试。新增 3 个单元测试覆盖：(a) HTTP 200 + code=99991663 首次失败 → 刷新 token 重试成功；(b) 重复 99991663 不会二次重试；(c) 非 token 业务错误（如 1254045）不触发刷新。**P0-02（真实运行表 ID 入库）**：`docs/ACCEPTANCE_REPORT.md` 移除 3 张运行表和客户表的真实 table ID，改为引用 `.env` 中的环境变量名；`src/scripts/temp/smoke-test-lark-cli.ts` 移除硬编码 `BASE_TOKEN` 和 `INGESTION_TABLE_ID`，改为通过 `requireEnv()` 从 `process.env` 读取（与生产代码 `config.ts` 一致），缺失时报错并提示从本地 `.env` 注入。P0 修复后 Gate A 全套命令退出码 0；测试 197 passed（24 test files，新增 3 个）；feishu-client Lines 95.62% / Branch 79.06% / Funcs 100%；`git diff origin/main -- src/data-cleaning` 无输出。
- **Phase 3A / TASK-001 最终审计**：GPT 对 Commit `1217942` 运行 Git 扫描复审，确认 P0-01 与 P0-02 已解决；对目标两文件及整个提交树运行三个运行表真实 ID 的 `git grep`，均为 0 匹配；结论 `MVP_PASS`；TASK-001 状态变更为 `DONE — CLOSED`。
- **Phase 3B / TASK-002**：Candidate 映射、CleaningPipeline 接入与审核记录工作流。按 `docs/ai/plans/TASK-002_BATCH_EXECUTION_PLAN.md` 一次连续执行 Task 0-Task 6。新增 `src/server/mapping/customer-candidate-mapper.ts`（9 个英文键→中文规范 Schema 的纯函数映射，immutable，6 tests）；新增 `src/server/repositories/review-repository.ts` + `in-memory-review-repository.ts`（`ReviewRecord` / `NewReviewRecord` / `ReviewRepository` 合同；内存模式用 `randomUUID()` 生成不透明 ID，深拷贝防护，6 tests）；新增 `src/server/repositories/feishu-review-repository.ts`（飞书审核仓库：9 个中文表头字段常量；JSON 字段存完整对象，索引列只用于查询；幂等 create：先 search by 摄入 ID，存在则返回；datetime 毫秒时间戳；malformed JSON 错误不暴露原始 candidate 内容，8 tests）；修改 `src/server/services/ingestion-service.ts`（构造函数双参数 `repository` + `reviewRepository`；新增 `pendingCandidates` Map 实现 per-ingestion 串行化；`receiveCandidate` 拆分为公开入口 + `doReceiveCandidate` 私有实现；Pipeline 失败路径保存 task 为 `validation_failed` 且不创建审核记录；成功路径创建 `ReviewRecord` 并把 `validation/corrections/warnings/errors/qualityReport/stages/pipelineVersion` 持久化到 review record 的 `validation` 对象，17 tests）；重写 `src/server/repositories/repository-factory.ts`（新增 `RepositoryBundle` 接口 + `createRepositories(config)`；Feishu 模式下两个仓库共享同一个 `FeishuClient`；保留 `createTaskRepository()` 兼容包装）；修改 `src/server/config.ts`（`FEISHU_REVIEW_TABLE_ID` 加入 feishu 模式必填校验）；修改 `src/server/app.ts`（新增 `BuildAppOptions` 支持双仓库注入；三分支装配逻辑：两者都传→用传入的；只传 task→合成内存 review；都不传→`createRepositories(config)`）；修改 `docs/API_CONTRACT.md`（§3.3 区分成功/失败响应 + `review_record_id` 不透明说明；§3.4 corrections 中文键；§4 状态机新增 `validation_failed`；§5 幂等规则增加并发/进程重启；§6 新增「Candidate 字段映射」完整章节含 9 键映射表与 5 条映射规则；§7 安全边界；§8 Gate C-LLM 阻塞说明）。8 个单元测试（repository-factory）；5 个新集成测试（ingestions.test.ts：中文键持久化、英文映射为中文 normalized_fields、replay 同一 ID、UNMAPPED_CANDIDATE_FIELD warning、validation_failed 不创建审核记录）。Phase 3B Gate A + Gate C-Core 回归：`npm ci` / `audit:legacy` / `typecheck` / `lint` / `test` (236 passed) / `test:integration` (31 passed) / `test:coverage` (All files 84.94%，所有关键模块 Lines ≥80%) / `build` / `evaluate` (50/50 PASS, 4 项核心指标 100%) / `git diff origin/main -- src/data-cleaning` 无输出，全部退出码 0。Step 2 验收：`git status --short` 仅 TASK-002 相关 + audit:legacy 自动重新生成时间戳；`git diff --check` 退出码 0；`git grep "lark-cli" -- src/server` 无匹配；3 个运行时表 ID 在源码中无匹配。
- **Phase 3B / TASK-002 P0 修复**：针对 GPT 基于 Commit `94f0199` 提出的 3 个 P0 进行最小修复。**P0-01（嵌套 Candidate PII 绕过 GET 响应浅层脱敏）**：`src/server/security/redaction.ts` 重写 `redactPhone`（修复 +86 前缀处理，分离捕获组对号码 mask，原输出 `861****8000` 改为 `138****8000`）；新增 `sanitizeWarningText`（mapper warning field/message 中手机号 + 绝对路径脱敏，PATH_PATTERN 只匹配 `/...` 或 `C:\...`，避免误匹配 `style_preferences` 等字段名）；新增 `redactValueDeep`（递归遍历对象/数组返回新副本，不修改原对象）；重写 `redactObject` 调用 `redactValueDeep`。新增 `tests/unit/security/redaction.test.ts`（11 tests 覆盖 redactPhone 含 +86、redactContent、redactObject 递归、sanitizeWarningText 含 phone/path/Windows path/正常字段名保留）。**P0-02（原始 Candidate 证据被映射结果覆盖后丢失）**：`src/server/domain/ingestion.ts` 新增 `raw_candidate?: CandidateRecord` 字段；`src/server/services/ingestion-service.ts` 新增 `deepClone` helper，在 `doReceiveCandidate` 入口 `rawCandidate = deepClone(req.candidate)` 保留原始证据；mapper warnings 经 `sanitizeMapperWarnings` sanitize；成功路径将 `rawCandidate` 嵌入 `review.validation.rawCandidate`（复用飞书 JSON 列，不新增 Base 字段）。**P0-03（完整 Pipeline 证据未持久化到任务）**：`src/server/domain/ingestion.ts` 新增 `pipeline_evidence?: Record<string, unknown>` 字段；`src/server/services/ingestion-service.ts` 新增 `buildPipelineEvidence` helper（结构化包含 `pipelineVersion`/`stages`/`validation`/`corrections`/`warnings`/`errors`/`qualityReport`/`success`），成功与失败路径均把 `pipeline_evidence` 写入 task；mapper warnings 与 Pipeline warnings 严格区分（mapper 在 `task.warnings` 是 `{field, code, message}`，Pipeline 在 `pipeline_evidence.warnings` 是 `string[]`）。新增 `tests/integration/ingestions.test.ts` 1 个 HTTP 集成测试（P0-01 端到端：POST 嵌套 phone candidate → GET 响应不含原 phone、含 `138****8000`；repository 仍保留 `raw_candidate`；review.validation.rawCandidate 保留原始证据；GET 不修改存储）；`tests/unit/ingestion-service.test.ts` 新增 P0-02/P0-03 describe 块（4 tests 覆盖 raw_candidate 深拷贝、未知字段不进入 normalized_fields、review.validation.rawCandidate 跨实例持久化、mapper warning sanitization；4 tests 覆盖成功路径持久化完整 pipeline_evidence、失败路径同样持久化、mapper warnings 与 Pipeline warnings 区分、跨新服务实例持久化）。P0 修复后 Gate A + Gate C-Core 全套命令退出码 0；测试 260 passed（28 test files，新增 24 个测试：11 redaction + 13 ingestion-service）；集成测试 32 passed（3 test files，新增 1 个 HTTP 集成测试）；All files Lines 85.28% / Branches 81.95% / Funcs 88.53%；关键模块 Lines 全部 ≥80%（redaction.ts 100%, ingestion-service 96.88%, mapping 100%, repository-factory 100%, feishu-review-repository 86.66%, feishu-task-repository 91.2%, feishu-client 95.62%, cleaning-pipeline 100%）；Gate C-Core PASS（50/50 case，4 项核心指标 100%）；`git diff origin/main -- src/data-cleaning` 无输出。
- **Phase 3B / TASK-002 P0-01 残项修复**：针对 GPT 基于 Commit `9dc7817` re-review 提出的 P0-01 残项（非手机号微信 ID 仍从 GET 响应泄露）进行最小修复。**P0-01 残项修复**：`src/server/security/redaction.ts` 新增 `redactWechatId`（保留首尾各 2 字符，中间字符替换为 `*`；长度 ≤ 4 时全掩码，绝不返回原秘密）+ 私有 `redactContactValue` helper（先 `redactPhone`，未匹配则 fallback 到 `redactWechatId`，确保同一 contact 字段中手机号与微信 ID 都被脱敏）；`redactValueDeep` 改为三分支：`content`/`原始文本` → `redactContent`，`wechat`/`微信`/`联系方式`/`contact` → `redactContactValue`，其他敏感 key → `redactPhone`；将 `contact` 加入 `redactObject` 默认 sensitiveKeys 列表（修复 GPT 复审证据中 `evidence.contact` 仍泄露的根因——原列表只有中文 `联系方式`，缺英文 `contact`）。新增 `tests/unit/security/redaction.test.ts` 6 个 `redactWechatId` 单测（length 16/11/5/4/3/2/1/0 全覆盖）+ 4 个 `redactObject` 递归测试（nested wechat/微信/联系方式/contact、数组、短 ID、phone 优先级）；新增 `tests/integration/ingestions.test.ts` 1 个 HTTP 集成回归测试（POST candidate with `contact: 'wechat_secret_01'` → GET 响应不含原 ID、含 `we************01`；repository `raw_candidate.fields.contact` 仍为原值；`candidate.fields.联系方式` 仍为原值；`review.validation.rawCandidate.fields.contact` 仍为原值；GET 不修改存储）。P0-01 残项修复后 Gate A + Gate C-Core 全套命令退出码 0；测试 271 passed（28 test files，新增 11 个测试：6 redactWechatId + 4 redactObject 递归 + 1 HTTP 集成）；集成测试 33 passed（3 test files，新增 1 个 HTTP 集成回归）；All files Lines 85.44% / Branches 82.13% / Funcs 88.63%；关键模块 Lines 全部 ≥80%（redaction.ts 100% / Branch 90.47%, ingestion-service 96.88%, mapping 100%, repository-factory 100%, feishu-review-repository 86.66%, feishu-task-repository 91.2%, feishu-client 95.62%, cleaning-pipeline 100%）；Gate C-Core PASS（50/50 case，4 项核心指标 100%）；`git diff origin/main -- src/data-cleaning` 无输出；`git diff --check` 退出码 0；`npm run audit:legacy` 退出码 0（62 modules）。等待 GPT 对新 commit 复核。
- **Phase 3B / TASK-002 P0-01 Contact Context Residual Fix**（针对 GPT 基于 Commit `09f12fa` re-review 的两条同源泄露路径）：`src/server/security/redaction.ts` 重写 `redactContactValue` 为 fail-closed 实现——剥离手机号/标签/分隔符后若残留内容非空则整体掩码，禁止保留任何未脱敏联系方式 token（P0-01A）；新增 `RedactionMode` 类型（`default`/`contact`/`content`）+ `isContactKey`/`isContentKey` helper，`redactValueDeep` 接受 `mode` 参数并在数组与嵌套对象递归中传播，contact/wechat/微信/联系方式 键下任意深度的字符串元素都使用 contact 脱敏（P0-01B）；新增 Pipeline 证据 `corrections[].original/corrected` 通过 sibling `field` 推断脱敏模式的逻辑——field 为 contact/content 键时，original/corrected 继承对应模式，避免 Pipeline 复制到证据副本中的联系方式 PII 从 GET 响应泄露。新增 `tests/unit/security/redaction.test.ts` 8 个测试（P0-01A 混合字符串 fail-closed、纯手机号格式保留、纯微信 ID 首尾 2 字符规则保留；P0-01B contact 数组、contact 嵌套对象/数组上下文传播、`联系方式` 嵌套、输入不变性、纯手机号数组仍用 phone mask）；新增 `tests/integration/ingestions.test.ts` 2 个 HTTP 回归测试（P0-01A `电话13800138000 微信wechat_secret_01` 混合字符串 fail-closed 不泄露；P0-01B `fields.contact = ["wechat_secret_01"]` 数组元素脱敏；两者均断言 repository/review 原始证据不变、GET 不修改存储）。Gate A + Gate C-Core 全套验证通过：`npm run typecheck` exit 0；`npm run lint` exit 0；`npm run test` 281/281 passed（28 test files，新增 10 个测试：8 单元 + 2 HTTP 集成）；`npm run test:integration` 35/35 passed（3 test files，新增 2 个 HTTP 回归）；`npm run test:coverage` All files Lines 85.49% / Branches 81.99% / Funcs 88.73%；关键模块 Lines 全部 ≥80%（redaction.ts 100% / Branch 90.47%, ingestion-service 96.88%, mapping 100%, repository-factory 100%, feishu-review-repository 86.66%, feishu-task-repository 91.2%, feishu-client 95.62%, cleaning-pipeline 100%）；`npm run build` exit 0；`npm run evaluate` Gate C-Core 50/50 PASS，4 项核心指标 100%；`npm run audit:legacy` exit 0（62 modules）；`git diff origin/main -- src/data-cleaning` 无输出；`git diff --check` exit 0。等待 GPT 对新 commit 复核。
- **Phase 3B / TASK-002 P0-01C + P0-04 Fix**（针对 GPT 基于 Commit `69ce7d5` re-review 的两个 P0）：`src/server/security/redaction.ts` `redactValueDeep` 直接字符串分支重构——父 `mode === 'contact'` 时一律 `redactContactValue(v)`，父 `mode === 'content'` 时一律 `redactContent(v)`，嵌套 `content`/`phone`/`mobile`/`原始文本`/`联系方式` 子键不再降级继承的 contact/content 模式（P0-01C）；新增 `STRUCTURAL_ID_PATTERN` 正则常量 + `isStructuralId(value)` 函数（覆盖 `<alpha>_<alphanumeric>` 前缀 ID、32 字符 hex、64 字符 hex、规范 UUID），`redactValueDeep` 顶层与对象内字符串分支在 default mode 下优先 `isStructuralId(v)` 短路 `redactPhone` 扫描，避免 `ing_2e042890392546c19181507170127599` 中的 11 位数字片段被误掩码（P0-04）；自由文本（含空格/CJK/多下划线 token）不匹配，嵌入非敏感自由文本字段中的手机号仍在响应边界被掩码。移除 `isSensitiveKey` 函数（P0-01C 重构后不再使用，TS6133）。新增 `tests/unit/security/redaction.test.ts` 18 个测试（P0-01C 9 个：父 contact/content mode 覆盖 nested 敏感子键、数组传播、真实 phone 仍掩码、输入非变异；P0-04 9 个：失败 ID 逐字节保留、32/64 字符 hex、UUID、前缀 ID、free-text 中 phone 仍掩码、纯 phone 仍掩码、数组中 ID 保留、输入非变异）；新增 `tests/integration/ingestions.test.ts` 2 个 HTTP 回归（P0-01C `wechat: { content: 'wechat_secret_01' }` 签名 callback + GET，断言 repository/review 原始证据不变；P0-04 `repository.save()` 注入确定性失败 ID + GET，断言响应逐字节不变、content 中 phone 仍掩码、repository 存储 ID/content 不变）。Gate A + Gate C-Core 全套验证通过：`npm ci` exit 0；`npm run audit:legacy` exit 0（62 modules）；`npm run typecheck` exit 0；`npm run lint` exit 0；`npm run test` 301/301 passed（28 test files，新增 20 个测试：18 单元 + 2 HTTP 集成）；`npm run test:integration` 37/37 passed（3 test files，新增 2 个 HTTP 回归）；`npm run test:coverage` All files Lines 85.6% / Branches 82.26% / Funcs 88.73%；redaction.ts Lines 97.43% / Branches 88.73% / Funcs 100%；`npm run build` exit 0；`npm run evaluate` Gate C-Core 50/50 PASS，4 项核心指标 100%；`git diff origin/main -- src/data-cleaning` 无输出；`git diff --check` exit 0。等待 GPT 对新 commit 复核。
- **Phase 3B / TASK-002 Redaction Invariant Closure Fix**（针对 GPT 基于 Commit `976fa6c` re-review 的 P0-01D + P0-04B；用户批准单批次执行）：`src/server/security/redaction.ts` 实现 Invariant A（Monotonic Redaction Sensitivity：`contact > content > default`，inherited content 下嵌套 contact/联系方式/wechat/微信 key 升级为 contact mode，inherited contact 不得被任何子键降级）+ Invariant B（Context-Aware Structural ID Preservation：结构化 ID 逐字节保留要求同时满足当前 key 属于 7 个可信响应合同 ID 字段之一 `ingestion_id`/`idempotency_key`/`review_record_id`/`source_record_id`/`workflow_run_id`/`reviewer_id`/`business_record_id` 且 value 形态匹配 `STRUCTURAL_ID_PATTERN`，Candidate `fields`/`evidence` 中的 `<prefix>_<phone>` 不再被 value-only 规则放行）。新增 `TRUSTED_STRUCTURAL_ID_KEYS` Set + `isTrustedStructuralIdKey(lower)` helper；新增 `resolveRedactionMode(parentMode, lowerKey)` 集中化单调解析；新增 `redactStringValue(value, mode, trustedStructuralIdContext)` 分支处理；重写 `redactValueDeep(value, sensitiveKeys, mode, trustedStructuralIdContext)`——字符串走 `redactStringValue`，数组传播 mode + trusted 上下文，对象先用 `fieldSibling` 计算 `fieldMode`，`original`/`corrected` 继承 `fieldMode` 且强制 `trusted=false`，每个 key 用 `resolveRedactionMode` 计算 `valueMode` 并按 `(valueMode === 'default' && isTrustedStructuralIdKey(lower))` 重置 `childTrustedIdContext`；可信上下文不通过任意嵌套对象 key 传播。Targeted TDD red→green 证据：red（`npx vitest run tests/unit/security/redaction.test.ts` → 5 failed | 50 passed，4 个 P0-01D case + 1 个 P0-04B case 全部按预期失败）；green 单元（55/55 passed）；green 集成（22/22 passed）；green 联合 targeted（77/77 passed, 2 test files）。新增 `tests/unit/security/redaction.test.ts` P0-01D table-driven 4 case（`content.contact`/`content.wechat through array`/`原始文本.联系方式`/multi-depth content to 微信）+ P0-04B 3 case（`note_13900139000`/`proof_13700137000`/`trace_13600136000` 期望分别掩码为 `note_139****9000`/`proof_137****7000`/`trace_136****6000`，同时保留 `ingestion_id` 等可信 ID 逐字节不变）+ 原测试重命名（`parent content mode wins over nested phone/contact keys` → `parent content mode remains active for ordinary nested phone keys`）+ 移除合成 `related_ids` 测试。新增 `tests/integration/ingestions.test.ts` 2 个 HTTP 回归（P0-01D `content: { contact: 'wechat_secret_01' }` → GET 含 `we************01`、不含原 ID；P0-04B `unknown_field='note_13900139000'` + `evidence.unknown_field='proof_13700137000'` → GET 含 `note_139****9000`/`proof_137****7000`、不含原号码；两者均断言 repository/review 原始证据不变、GET 不修改存储）。最终 Gate A + Gate C-Core 一次性全套验证：`npm run typecheck` exit 0；`npm run lint` exit 0；`npm run audit:legacy` exit 0（62 modules）；`npm run test:coverage` exit 0（307/307 passed，28 test files；All files Lines 85.77% / Branches 82.35% / Funcs 88.88%；`server/security/redaction.ts` Lines 100% / Branch 90.62% / Funcs 100%）；`npm run build` exit 0；`npm run evaluate` exit 0（Gate C-Core 50/50 PASS，4 项核心指标 100%）；`git diff origin/main -- src/data-cleaning` 无输出；`git diff --check` exit 0。新 commit 待 push 后交 GPT 基于 new commit 复核。
- **Phase 3 / TASK-003-TAKEOVER-VERIFY**（Trae 接管验证；基线 `af3cba1`，本轮不 commit）：接管工作区中来源未确认的 TASK-003 实现，验证「审核通过后幂等写入客户表 + Gate D 真实验收」是否满足。新增/修改文件均属于 TASK-003 白名单（详见任务卡 In Scope）：核心实现 `src/server/business/customer-record-writer.ts`（9 字段白名单 + `Collator 摄入 ID` 技术幂等键 + datetime epoch ms + 写入前 search 去重 + 错误降级为 name-only message）；`src/server/repositories/write-log-repository.ts`（合同接口，幂等合同仅对 `succeeded` 状态返回原条目，`failed/pending/skipped_dry_run` 创建新条目以保证 commit_failed 重试审计轨迹）；`src/server/repositories/in-memory-write-log-repository.ts`（randomUUID + deepClone）；`src/server/repositories/feishu-write-log-repository.ts`（飞书版，`摄入 ID` 索引列查询 + datetime epoch ms + text-object/select-array 兼容解析）；`src/server/services/ingestion-service.ts`（新增 `customerRecordWriter?` + `writeLogRepository?` 可选构造参数；approve 流程 `pending_review → approved → committing → completed / commit_failed`；`pendingApprovals` Map 实现 per-ingestion 串行化；`handleDryRunApprove` 写 `skipped_dry_run` 日志不写客户表；`handleCommitFlow` 先保存 committing 状态再调用 writer，失败时保存 commit_failed + sanitised write log + re-throw `FeishuCommitFailedError`；legacy fallback 路径保留 Phase 3B 兼容性）；`src/server/repositories/repository-factory.ts`（新增 `RepositoryBundle` 接口，feishu 模式 4 仓储共享 FeishuClient；`collectFeishuRequired` 显式校验 7 个 FEISHU_* 必填项，缺失时抛错不静默回退）；`src/server/config.ts`（新增 `feishuWriteLogTableId` + `feishuCustomerTableId`，superRefine 校验）；`src/server/domain/errors.ts`（新增 `FeishuCommitFailedError` code=`FEISHU_COMMIT_FAILED` statusCode=502）；`src/server/app.ts`（`BuildAppOptions` 新增两个可选参数，三分支装配）；`scripts/run-gate-d.ts`（Gate D 真实飞书 Runner，退出码 0=PASS/1=FAIL/2=ENV_ERROR，合成数据 `GateD测试客户 / 13800000000 / COLLATOR_GATE_D_TEST:<uuid>`，9 个断言步骤，finally 按精确 record_id 清理，输出 `artifacts/feishu-gate-d/`）。测试新增 14 个 customer-record-writer 单测 + 11 个 in-memory-write-log-repository 单测 + 11 个 feishu-write-log-repository 单测 + 4 个 feishu-gate-d mock 集成测试 + 13 个 ingestion-service "TASK-003: commit flow" 测试；ingestions.test.ts 新增 commit flow HTTP 回归。Trae 最小修复 2 处：`tests/integration/feishu-gate-d.test.ts` MockFeishuClient.updateRecord 中 `void tableId;` 修复 TS6133；`src/server/services/ingestion-service.ts` handleDryRunApprove catch 子句移除未使用的 `e` 参数修复 no-unused-vars。Gate A + Gate C-Core 全套验证通过：`npm run typecheck` exit 0；`npm run lint` exit 0；`npm run test` 365/365 passed（32 test files）；`npm run test:integration` 47/47 passed（4 test files）；`npm run build` exit 0；`npm run audit:legacy` exit 0（62 modules）；`git diff origin/main -- src/data-cleaning` 无输出；`git diff --check` exit 0；`npx tsx scripts/run-gate-d.ts` exit 2（`FEISHU_APP_SECRET=replace_me` 占位符触发 ENV_ERROR）→ AC-07 标记 `BLOCKED_EXTERNAL_ENV`。**未创建 TASK-003 commit、未 push**（AC-09）。等待 GPT 复核 `EVIDENCE_REVIEW_PASS`。

## Next Priorities

1. **Trae 接管 Codex 未提交修改并运行独立验证**：逐文件检查 Diff，重点复核 `client_token` 参数、状态机 fail-closed 与审计落库顺序；运行 Gate A 全套 + Gate C-Core，生成修订完成包。Codex 按用户约束未创建 Commit。
2. **真实 Gate D**：用户以短生命周期进程环境提供飞书凭据后运行 `npm run gate:d`，确认真实 Base 对相同 `client_token` 的重复/并发 create 返回同一 record_id，并精确清理合成记录。
3. **GPT 重新进行证据审查**：基于 Trae 修订完成包作出 `EVIDENCE_REVIEW_PASS` / `MVP_FAIL` 判决。
4. **Gate D 真实验收解锁**：用户提供 `FEISHU_APP_SECRET` 真实凭据（替换 `.env` 中的 `replace_me` 占位符），运行 `npm run gate:d`（脚本已存在），将 AC-07 从 `BLOCKED_EXTERNAL_ENV` 升级为真实 PASS。
5. 配置 Dify 环境与凭据（DEBT-001），解锁 Gate C-LLM 真实 LLM 联调。
6. TASK-003 完成并通过 Gate D 后，按 Phase 推进流程进入 Phase 5（部署）、Phase 6（展示证据）。

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

- ~~TASK-001 P0-01~~：RESOLVED（2026-07-17）— `FeishuClient.callWithRetry` 现在识别飞书业务错误码 `code=99991663`（即使在 HTTP 200 路径上），触发单次 token 刷新 + 重试；新增 3 个单元测试覆盖重试成功、不二次重试、非 token 错误不触发刷新。
- ~~TASK-001 P0-02~~：RESOLVED（2026-07-18，Commit `1217942`）— `docs/ACCEPTANCE_REPORT.md:291` 已改为 `<FEISHU_INGESTION_TABLE_ID>`；GPT 对目标两文件及整个提交树运行三个运行表真实 ID 的 `git grep`，均为 0 匹配。
- ~~TASK-002 P0-01C~~：ACCEPTED（2026-07-18，Commit `976fa6c` GPT re-review）— contact parent 对 nested `content`/`phone`/`mobile`/`原始文本` 保持权威，原四类复现已修复。
- ~~TASK-002 P0-01D~~：RESOLVED（GPT `MVP_PASS`, commit `0f0f63d`）。
- ~~TASK-002 P0-04B~~：RESOLVED（GPT `MVP_PASS`, commit `0f0f63d`）。
- ~~TASK-002 P0-02~~：RESOLVED（2026-07-18，P0 修复 commit）— `IngestionTask.raw_candidate` 深拷贝原始 Candidate；`review.validation.rawCandidate` 复用飞书 JSON 列保留原始证据；mapper warning sanitization 切断 PII 通过 warning 字段泄露路径。
- ~~TASK-002 P0-03~~：RESOLVED（2026-07-18，P0 修复 commit）— `IngestionTask.pipeline_evidence` 持久化完整 Pipeline 证据（pipelineVersion/stages/validation/corrections/warnings/errors/qualityReport/success）；成功与失败路径均写入；mapper warnings 与 Pipeline warnings 严格区分。
- 未配置 Dify 环境与凭据（`DIFY_BASE_URL`、`DIFY_WORKFLOW_API_KEY`、`DIFY_WORKFLOW_ID`）— 见 DEBT-001。阻塞 Gate C-LLM 真实 LLM 联调。
- **TASK-003 AC-07 Gate D 真实飞书验收**：`BLOCKED_SCHEMA_MISMATCH`（2026-07-20 第四次尝试，写权限已解锁，schema 不匹配阻塞）- 用户已为自建应用 `cli_<redacted>` 在目标 Base「测试 Base」添加协作权限并授予「可编辑」权限；`npx tsx --env-file=.env scripts/run-gate-d.ts` 真实运行 exit_code=1（FAIL），鉴权与写权限已通过（不再返回 91403/403）；`createIngestion` 阶段成功写入 ingestion task 记录（record_id=`recXXX`，ingestion_id=`ing_<uuid-redacted>`），但 `receiveCandidate` 阶段在 `findById` 读取该记录时抛错 `FeishuTaskRepository: 任务快照 JSON missing or not a string for record`；诊断脚本 `scripts/temp/diagnose-gate-d-snapshot.ts` 确认飞书表 `任务快照 JSON`、`摄入 ID`、`幂等键`、`来源记录 ID` 字段实际类型为富文本（返回 `[{text:"..."}]` 数组结构），而 `FeishuTaskRepository.parseSnapshot` 期望字段为字符串；`FeishuReviewRepository` / `FeishuWriteLogRepository` 仅部分兼容 `{text:"..."}` 单对象格式但不兼容 `[{text:"..."}]` 数组格式。**残留测试数据**：ingestion 表中存在未清理的测试记录 `recXXX`（合成数据 `GateD测试客户 / 13800000000`，非真实业务数据）；Gate D 脚本 finally 块只清理 customer/write_log 表，未覆盖 ingestion 表，需用户手动清理或下轮 Codex 修复脚本。**解锁动作**：GPT 裁决修复方向 — 方案 A：用户在飞书表中将 `任务快照 JSON`/`摄入 ID`/`幂等键`/`来源记录 ID` 字段类型从「富文本」改为「多行文本」；方案 B：修改 `FeishuTaskRepository.parseSnapshot` 及其他 repository 的 readScalar/readJson 兼容 `[{text:"..."}]` 数组格式（超出 TASK-003-GATE-D-FINAL-RETRY 任务范围，需新 TASK）。Mock 集成测试 `tests/integration/feishu-gate-d.test.ts`（4 tests）仍覆盖 commit flow 合同。
- ~~**TASK-003 GPT 复核结论 `MVP_FAIL` / `CODEX_REQUIRED` / `NO_COMMIT`**~~：`CODEX_FIX_READY_FOR_TRAE_REVIEW`（2026-07-20）— Phase 1 文件清单问题已校正；Codex Phase 2 已在限定白名单内修复 AC-03/AC-04/AC-05 关键反例并保留 `NO_COMMIT`。当前工作区相对 `af3cba1` 为 13 modified + 9 untracked = 22 文件；下一责任方为 Trae，需逐文件复核并运行最终 Gate。
- ~~**TASK-003 幂等架构核心风险**~~：代码级已缓解（2026-07-20）— 纯 `search → create` 不再作为强幂等边界；客户记录及 succeeded 写入日志改用官方新增记录接口的稳定 UUIDv4 `client_token`。**真实环境已验证（2026-07-21）** — Gate D 通过，重复 approve / writer replay 返回同一 record_id、created=false。
- ~~**TASK-003 AC-06/AC-07 Gate D 真实飞书验收**~~：**RESOLVED（2026-07-21 第五次尝试；RESIDUAL-EVIDENCE-FIX 修正轮 2026-07-21）** — GPT 第四次尝试后判决 `FIX_REQUIRED` 采用方案 B（代码兼容）；新增共享 normalizer `normalizeFeishuText`/`normalizeFeishuJson` + FeishuClient `text_field_as_array=false` + MultiSelect 字段包装修复；`npm run gate:d` 真实运行 exit_code=0，25/25 断言通过；4 张表合成记录全部按精确 record_id 清理；第四次尝试遗留记录 `recXXX`（属于 Collator 摄入任务表，非客户表）经 RESIDUAL-EVIDENCE-FIX 修正轮使用 `client.getRecord(ingestionTableId, ...)` 验证，飞书返回 code=1254043 RecordIdNotFound，证明摄入任务表已无残留；Gate A + Gate C-Core 全套回归 446/446 通过。

> 注：Dify/飞书凭据仍属于外部环境边界；TASK-002 GPT 复审已通过。它们不改变已通过的 Phase 2F Gate C-Core 确定性数据质量结果。

## Known Risks

- 旧 `src/data-cleaning/agent/index.js` 存在 `&&amp;` HTML 实体语法错误，任何引用该文件的入口无法运行；V1 采用新建 `src/server/` 替代旧 Agent 入口，不修复旧入口（见 DEBT-003）。
- 现有 Schema 使用中文 fieldName，Dify Candidate 输出英文 raw 字段，Phase 2 需要增加映射层（见 DEBT-004）。
- 硬编码飞书资源 ID 较多，Phase 3 需逐步迁出源码（见 DEBT-005）。
- `core/data-cleaner.js` 导入闭包触发 `schemas/index.js` 与 `config/index.js` 的 import-time 文件读取，Phase 2A 审计需标记为 `EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY`，不得简单 WRAP（见 DEBT-006）。
- **TASK-003 `client_token` 真实环境语义待验**：~~代码级并发反例已收敛为同一稳定 token，mock 服务端只执行一次逻辑创建；但官方文档未在当前核验中确认 token 保留窗口，且真实租户尚未验证。Trae 接管后必须在 Gate D 中验证重复 approve / 模糊响应重试不会生成第二条客户记录。~~ **RESOLVED（2026-07-21 Gate D 真实通过）** — 重复 approve 断言通过（code=CONFLICT 409）；writer replay 返回同一 record_id=`recXXX`、created=false；稳定 client_token 在真实飞书租户下被正确接受。

## Last Updated

2026-07-21（Gate D 第五次尝试 — TEXT-NORMALIZATION 修复后真实通过；同日 RESIDUAL-EVIDENCE-FIX 修正轮：GPT 基于第四次尝试的 `FIX_REQUIRED` 判决采用方案 B 代码兼容；新增共享 normalizer `normalizeFeishuText`/`normalizeFeishuJson` 支持三种合法结构（string / `{text}` / `Array<{text}>`）；三个 Feishu Repository 适配层迁移到共享 normalizer；FeishuClient `getRecord`/`searchRecords` 显式设置 `text_field_as_array=false`；客户表 `意向风格` MultiSelect 字段在 writer 中包装为 array of strings 修复 `MultiSelectFieldConvFail`；`npm run gate:d` 真实运行 exit_code=0，25/25 断言通过；4 张表（ingestion/review/customer/write_log）合成记录全部按精确 record_id 在 finally 块中清理；之前遗留 `recXXX`（属于 Collator 摄入任务表）经 RESIDUAL-EVIDENCE-FIX 修正轮使用 `client.getRecord(ingestionTableId, ...)` 验证，飞书返回 code=1254043 RecordIdNotFound，确认摄入任务表已无残留；Gate A + Gate C-Core 全套回归 446/446 通过；AC-06 + AC-07 从 `BLOCKED_SCHEMA_MISMATCH` 解锁为真实 PASS；未 commit、未 push（AC-12 git 纪律 + `NO_COMMIT` 指令））

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
| A | 代码基线 | PASSED | TASK-003-TAKEOVER-VERIFY 验证后：`typecheck` / `lint` / `audit:legacy` (62 modules) / `test` (365/365, 32 files) / `test:integration` (47/47, 4 files) / `build` / Legacy diff empty / `git diff --check` exit 0。 |
| B | API 合同 | PASSED | `docs/API_CONTRACT.md`（含 §6 Candidate 字段映射章节）+ 14 项集成测试覆盖全部 V1 接口 |
| C-Core | 数据质量（确定性） | PASSED | Phase 2F + Phase 3B Redaction Invariant Closure fix 后回归：50/50 case 通过，4 项核心指标 100%（field_accuracy 132/132, required_field_recall 91/91, enum_precision 33/33, error_interception_rate 1/1） |
| C-LLM | 数据质量（LLM 语义） | BLOCKED_EXTERNAL_ENV | 未配置 Dify 凭据（见 DEBT-001）|
| D | 飞书集成 | PASSED | TASK-003-GATE-D-TEXT-NORMALIZATION 修复后真实通过；同日 RESIDUAL-EVIDENCE-FIX 修正轮修正残留记录验证证据链：2026-07-21 第五次真实运行 `npm run gate:d` exit_code=0，25/25 断言全部通过；4 张表（ingestion/review/customer/write_log）合成记录全部按精确 record_id 在 finally 块中清理；第四次尝试遗留记录 `recXXX`（属于 Collator 摄入任务表，非客户表）经 RESIDUAL-EVIDENCE-FIX 修正轮使用 `client.getRecord(ingestionTableId, ...)` 验证，飞书返回 code=1254043 RecordIdNotFound，确认摄入任务表已无残留；Gate A + Gate C-Core 全套回归 446/446 通过；AC-06 + AC-07 从 `BLOCKED_SCHEMA_MISMATCH` 解锁为真实 PASS。|
| E | 安全隐私 | PASSED | Commit `0f0f63d` GPT re-review `MVP_PASS`；P0-01D/P0-04B accepted，P0-02/P0-03 保持 accepted。TASK-003 沿用同套 redaction invariant，未引入新 PII 泄露路径（writer 错误降级为 name-only message）。 |
| F | 部署运行 | NOT_STARTED | 无 Dockerfile（Phase 5/6） |
| G | 展示证据 | NOT_STARTED | 无运行证据（待 Docker/部署后补充） |

## 附录：最近一次执行

- 日期：2026-07-20（Trae TASK-003 PRE-CODEX 机械整理 — GPT Required Fixes 第一阶段；不 commit/push）
- 触发：GPT 对前次完成包作出 `MVP_FAIL` / `CODEX_REQUIRED` / `NO_COMMIT` 判决，要求 Trae 执行 PRE-CODEX 机械整理（不修改幂等架构）
- 基线：Commit `af3cba1`（TASK-003-TAKEOVER-VERIFY 任务卡指定的 baseline）
- HEAD：`af3cba1`（未 commit，所有变更在工作区；AC-09 强制约束）
- 执行任务卡：`docs/ai/tasks/TASK-003.md`（Objective / In Scope / 9 条 Acceptance Criteria / Implementation Guidance / Codex Escalation Conditions / Stop Conditions）
- Phase 1 机械整理动作：(1) 重新输出 `git status --short` / `git diff --name-status af3cba1` / `git ls-files --others --exclude-standard` 完整原始清单；(2) 工作区文件清单与三条 Git 原始输出一致：baseline `af3cba1` → 当前工作区 11 modified + 9 untracked = 20 文件（11 M 包含 TASK-003 Expected Files 白名单内 9 个 + Phase 1 机械整理新增 `docs/ACCEPTANCE_REPORT.md` 与 `package.json` 2 个；9 ?? 全部属于白名单内新文件）；(3) 核对 `docs/ai/PROJECT_STATE.md` 在 `git status` 中为 `M` 且属于 TASK-003 Expected Files 白名单，补入 Changed Files；(4) 还原 `reports/phase2/legacy-module-profiles.json`（`git diff` 仅 `generatedAt` 时间戳变化，无业务内容变化）；(5) 在 `package.json` 添加 `"gate:d": "tsx scripts/run-gate-d.ts"` 脚本；(6) 验证 `npm run gate:d` 进入环境检查流程并返回 exit code 2 (ENV_ERROR)；(7) 不自行声明 AC-03、AC-04 PASS
- 命令：`git branch --show-current` / `git rev-parse HEAD` / `git status --short` / `git diff --name-status af3cba1` / `git ls-files --others --exclude-standard` / `git diff reports/phase2/legacy-module-profiles.json` / `git diff --stat reports/phase2/legacy-module-profiles.json` / `git checkout -- reports/phase2/legacy-module-profiles.json` / `npm run typecheck` / `npm run lint` / `npm run gate:d` / `git diff --check`
- 结果：工作区文件清单与三条 Git 原始输出一致：11 modified + 9 untracked = 20（baseline `af3cba1` → 当前工作区；11 M 包含 TASK-003 白名单内 9 个 + Phase 1 机械整理新增 2 个；9 ?? 全部属于白名单内新文件）；`legacy-module-profiles.json` 已还原（`git status` 中不再显示 M）；`package.json` 新增 `gate:d` script；`npm run typecheck` exit 0；`npm run lint` exit 0；`npm run gate:d` exit 2 (ENV_ERROR)；`git diff --check` exit 0。**未创建 commit、未 push**（AC-09）。等待 Codex Phase 2 限定范围 AUDIT/FIX（白名单：`customer-record-writer.ts` / `ingestion-service.ts` / `write-log-repository.ts` / `feishu-write-log-repository.ts` / `repository-factory.ts` / FeishuClient createRecord & retry / `package.json` / 对应测试）。

## 附录：Codex Phase 2 限定 AUDIT/FIX

- 日期：2026-07-20；基线/HEAD：`af3cba1`；分支：`phase/3-feishu-integration`；未 commit、未 push。
- PRE-CODEX 独立核验：Phase 1 的 11 modified + 9 untracked = 20 文件清单、过时数字搜索与 `git diff --check` 均通过。
- 失败复现：两个 writer 实例并发处理同一 ingestion 时，旧实现产生 2 次逻辑创建；修复后仍可发生 2 次 HTTP 尝试，但稳定 `client_token` 使 mock 服务端仅执行 1 次逻辑创建并向两方返回同一 record。
- 最小修复：客户记录及 succeeded 写入日志使用稳定 UUIDv4 `client_token`；非 dry-run 缺 writer/repository、部分依赖注入、未审核任务直写、成功/dry-run 日志持久化失败仍 completed 均改为 fail-closed。
- 当前工作区：13 modified + 9 untracked = 22 文件；最终 Gate 结果以本次会话结束时的新鲜验证记录为准；真实 Gate D 仍为 `BLOCKED_EXTERNAL_ENV`。

## 附录：Trae 接管 Codex Phase 2 复核

- 日期：2026-07-20；基线/HEAD：`af3cba1`；分支：`phase/3-feishu-integration`；未 commit、未 push（AC-09）。
- 接管触发：用户摘要要求 Trae 逐文件复核 Codex Phase 2 未提交工作区，并核对 Git 清单与三份关键文档一致性。
- 文件清单复核：`git status --short` + `git diff --name-status af3cba1` + `git ls-files --others --exclude-standard` 三条原始输出一致 — 13 modified + 9 untracked = 22 文件，与 Codex Phase 2 报告一致；相对 Phase 1 的 11 modified + 9 untracked = 20 文件新增 `src/server/feishu/feishu-client.ts` + `tests/unit/feishu/feishu-client.test.ts` 两个 modified（用于 `createRecord` 接受 `clientToken` 参数与 `createStableClientToken` helper）。
- 逐文件复核结论：6 个核心 Codex 修复文件 + 关联修改 + 测试文件均符合 TASK-003 规范——`createStableClientToken`（sha256 → 16 bytes → UUIDv4/variant bits）；`FeishuCustomerRecordWriter` 写入时传 `customer-record:<tableId>:<ingestionId>` token；`FeishuWriteLogRepository` 仅 succeeded 状态传 token（failed/skipped_dry_run 不传以保留审计轨迹）；`IngestionService` pendingApprovals Map 实现 per-ingestion approve 串行化；状态门禁仅 `['pending_review','commit_failed','approved','committing']` 可进入 approve；非 dry-run 缺 writer/repository → throw 'Customer commit flow is not configured'（fail-closed）；构造函数 `Boolean(writer) !== Boolean(repository)` → throw（all-or-none）；commit_failed 路径写 failed log 后 re-throw `FeishuCommitFailedError`；succeeded log 持久化失败 → commit_failed + COMMIT_AUDIT_FAILED；dry_run 路径写 skipped_dry_run log 失败 fail-closed；成功路径 committing → succeeded log → completed（审计先于 completed）。无越界修改。
- 文档一致性核对：`docs/ai/tasks/TASK-003.md` Codex Phase 2 Result 段落、`docs/ACCEPTANCE_REPORT.md` Phase 3 / TASK-003 — Codex Phase 2 AUDIT/FIX 段落、`docs/ai/PROJECT_STATE.md` 13 modified + 9 untracked = 22 文件 + `CODEX_FIX_READY_FOR_TRAE_REVIEW` + Gate D `BLOCKED_EXTERNAL_ENV` + HEAD `af3cba1` 未 commit 全部一致。
- Trae 独立复跑 Gate A + Gate C-Core（非写入部分）：
  - `npm run typecheck` exit 0
  - `npm run lint` exit 0
  - `npm run audit:legacy` exit 0（62 modules，SAFE 4 / UNSAFE 57 / BLOCKED 1）
  - `git diff origin/main -- src/data-cleaning` 无输出（LEGACY_DIFF_EMPTY）
  - `git diff --check` exit 0（仅 LF/CRLF 警告）
  - `npm run test` exit 0：373/373 passed（32 test files）
  - `npm run test:integration` exit 0：47/47 passed（4 test files）
  - `npm run test:coverage` exit 0：All files Lines 85.46% / Branches 83.58% / Functions 89.8%；关键模块 Lines 全部 ≥80%（customer-record-writer 100%, write-log-repository 86.66%, feishu-write-log-repository 98.05%, in-memory-write-log-repository 96.29%, repository-factory 100%, ingestion-service 98.14%, feishu-client 96%, cleaning-pipeline 100%, mapping 100%）
  - `npm run build` exit 0
  - `npm run evaluate` exit 0：Gate C-Core 50/50 PASS，4 项核心指标 100%
  - `npm run gate:d` exit 2（ENV_ERROR）— 缺少 8 个必需环境变量：`FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_BASE_APP_TOKEN`, `FEISHU_INGESTION_TABLE_ID`, `FEISHU_REVIEW_TABLE_ID`, `FEISHU_WRITE_LOG_TABLE_ID`, `FEISHU_CUSTOMER_TABLE_ID`, `COLLATOR_WEBHOOK_SECRET`；与 Codex 报告一致，Gate D 真实飞书验收保持 `BLOCKED_EXTERNAL_ENV`。
- 未通过项：仅 AC-07 Gate D 真实飞书验收（外部环境阻塞）；其余 AC-01~AC-06、AC-08、AC-09 在代码与测试层均得到确认。
- 阻塞项：用户需以短生命周期进程环境安全注入 8 个必需环境变量后由 Trae 运行 `npm run gate:d`，确认真实租户对稳定 `client_token` 的接受与并发/模糊响应重试行为，并按精确 record_id 清理合成测试数据。
- 下一步：用户提供凭据 → Trae 运行真实 Gate D → 若 exit 0 则解除 AC-07 阻塞 → 由用户决定是否创建 commit → 交 GPT 重新进行证据审查（`EVIDENCE_REVIEW_PASS` / `MVP_FAIL`）。

## 附录：Gate D 真实飞书验收运行

- 日期：2026-07-20；基线/HEAD：`af3cba1`；分支：`phase/3-feishu-integration`；未 commit、未 push（AC-09）。
- 触发：用户提供 FEISHU_APP_SECRET，要求运行真实 Gate D。
- 环境就绪检查：8 个必需环境变量全部 READY（FEISHU_APP_ID/APP_SECRET/BASE_APP_TOKEN/INGESTION_TABLE_ID/REVIEW_TABLE_ID/WRITE_LOG_TABLE_ID/CUSTOMER_TABLE_ID/COLLATOR_WEBHOOK_SECRET）。
- 凭据写入：通过 `src/scripts/temp/setup-feishu-creds-param.ps1` 写入 `.env`（FEISHU_APP_SECRET + 自动生成 COLLATOR_WEBHOOK_SECRET）；`.env` 未被 Git 跟踪；值未输出到终端/日志/完成包。
- Gate D 运行结果：`npm run gate:d` exit_code=1（FAIL）。
  - 错误：`[feishu code=10014] Failed to acquire tenant_access_token: app secret invalid`
  - assertions: 0/0（在第一个断言前抛错，未进入业务断言）
  - cleanup: customer=NOT deleted, write_log=NOT deleted（未创建任何记录，无需清理）
  - 报告：`artifacts/feishu-gate-d/gate-d-report.json`（被 .gitignore 忽略，不入库）
- 安全事件：用户将 App Secret 直接粘贴到聊天窗口（违反原始安全约束"不要发送到聊天窗口"）。值已出现在对话上下文。强烈建议在飞书开放平台重置该 Secret。
- git status --short：14 modified + 11 untracked = 25 文件（.env 与 artifacts/ 被 .gitignore 忽略，未出现）。
- git diff --check：exit 0（仅 LF/CRLF 警告）。
- 新增临时脚本（src/scripts/temp/）：check-gate-d-env.ps1 / setup-feishu-creds.ps1 / setup-feishu-creds-param.ps1。
- 结论：AC-07 保持阻塞（`BLOCKED_CREDENTIAL_INVALID`），Gate D 未通过。需用户提供有效 App Secret 后重新运行。
- 下一步：用户核对飞书开放平台"凭证与基础信息"中的 App Secret -> 重置已暴露的 Secret -> 用有效 Secret 重新运行 `npm run gate:d` -> exit 0 后交 GPT 证据审查。

## 附录：Gate D 第二次尝试（从 lark-cli 配置读取凭据）

- 日期：2026-07-20；基线/HEAD：`af3cba1`；分支：`phase/3-feishu-integration`；未 commit、未 push（AC-09）。
- 触发：用户要求使用 lark cli 获取 App Secret（避免在聊天中粘贴密钥）。
- 执行动作：
  1. 创建临时脚本 `src/scripts/temp/setup-feishu-creds-from-lark-cli.ps1`（UTF-8 BOM 编码，复用 git 跟踪检查修复逻辑）。
  2. 从 `C:\Users\Catcher\.lark-cli\config.json` 读取 `apps[0].appId` 和 `apps[0].appSecret`。
  3. 核验 appId 与 .env 中的 FEISHU_APP_ID 一致（同一应用 `cli_a9...`，长度 20）。
  4. 将 appId 和 appSecret 安全写入 .env（未输出任何凭据值到终端）。
  5. 运行就绪检查 `check-gate-d-env.ps1`：8 个变量全部 READY。
  6. 加载 .env 到 shell 环境变量后运行 `npm run gate:d`。
- Gate D 运行结果：`npm run gate:d` exit_code=1（FAIL）。
  - 错误：`[feishu code=10014] Failed to acquire tenant_access_token: app secret invalid`
  - assertions: 0/0（在第一个断言前抛错，未进入业务断言）
  - cleanup: customer=NOT deleted, write_log=NOT deleted
  - 报告：`artifacts/feishu-gate-d/gate-d-report.md`
- 独立 API 验证：直接调用 `https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal` 确认 lark-cli 配置中的 appSecret 无效（code=10014）。
- lark-cli 状态：所有 lark-cli 命令（auth status / config / help / --version）均静默退出（exit code 1，无输出）；2026-07-17 日志显示曾成功认证，但当前 appSecret 已失效。
- 根因分析：lark-cli 配置中的 appSecret 与上次安全事件中暴露的 appSecret 相同，该 Secret 已在飞书开放平台被重置（或本身无效），导致 tenant_access_token 获取失败。
- 新增临时脚本：`src/scripts/temp/setup-feishu-creds-from-lark-cli.ps1`。
- 结论：AC-07 保持阻塞（`BLOCKED_CREDENTIAL_INVALID`），Gate D 未通过。lark-cli 配置中的 appSecret 无效，不能作为凭据来源。
- 下一步（三选一）：
  1. 用户在飞书开放平台获取当前有效的 App Secret -> 用 `setup-feishu-creds.ps1` 手动输入写入 .env（推荐，避免在聊天中粘贴）。
  2. 用户在飞书开放平台获取当前有效的 App Secret -> 运行 `lark-cli config init --new` 更新 lark-cli 配置 -> 再运行 `setup-feishu-creds-from-lark-cli.ps1`。
  3. 修复 lark-cli 安装（当前所有命令静默失败）后重新尝试。

## 附录：Gate D 第四次尝试（FINAL-RETRY：写权限解锁后 schema 不匹配阻塞）

- 日期：2026-07-20；基线/HEAD：`af3cba1`；分支：`phase/3-feishu-integration`；未 commit、未 push（AC-09）。
- 触发：用户确认自建应用 `cli_<redacted>` 已成功添加到目标飞书多维表格并授予写入所需权限，要求立即运行 Gate D。
- 任务卡：`TASK-003-GATE-D-FINAL-RETRY`（Recommended Owner: Trae；Codex: NOT_REQUIRED；不修改鉴权方式，使用原始应用身份；本轮禁止 commit/push）。
- 执行前工作区状态：`git status --short` → 14 modified + 多个 untracked（含 `scripts/run-gate-d.ts` 等白名单内文件）；`git diff --name-status` → 14 M；HEAD `af3cba1`；与第三次尝试结束时一致。
- Gate D 运行命令：`npx tsx --env-file=.env scripts/run-gate-d.ts`（使用 `.env` 中原始应用身份 `FEISHU_APP_ID` + `FEISHU_APP_SECRET`，未修改鉴权方式，未使用 lark-cli user identity，未切换 Trae IDE bot）。
- Gate D 运行结果：exit_code=1（FAIL）。
  - 鉴权与写权限：通过（不再返回 91403/403）
  - `createIngestion` 阶段：成功写入 ingestion task 记录
    - ingestion_id: `ing_<uuid-redacted>`
    - record_id: `recXXX`
    - 断言 1（createIngestion returns 202-like status）：✅ PASSED
  - `receiveCandidate` 阶段：失败
    - 错误：`Runner error: FeishuTaskRepository: 任务快照 JSON missing or not a string for record`
    - 错误位置：`FeishuTaskRepository.parseSnapshot`（src/server/repositories/feishu-task-repository.ts:119-133）
    - 失败原因：`receiveCandidate` → `getIngestion` → `findById` → `parseSnapshot` 读取 `任务快照 JSON` 字段时，发现值不是字符串
  - assertions: 1/1 passed（只有第一个断言执行；后续断言未执行）
  - cleanup: customer=NOT deleted, write_log=NOT deleted（未进入 commit flow，无客户记录/写入日志需清理）
  - 报告：`artifacts/feishu-gate-d/gate-d-report.md` + `gate-d-report.json`（被 .gitignore 忽略）
- 诊断脚本：`scripts/temp/diagnose-gate-d-snapshot.ts`（使用同样 FeishuClient 应用身份，仅查询不修改）查询刚写入的记录，确认飞书表字段实际类型：
  - `任务快照 JSON`: **array**（富文本结构 `[{text:"..."}]`）← 代码期望 string
  - `摄入 ID`: array（富文本结构）
  - `幂等键`: array（富文本结构）
  - `来源记录 ID`: array（富文本结构）
  - `状态`: string（单选/文本字段，与代码兼容）
  - `创建时间`: number（毫秒时间戳，与代码兼容）
  - `更新时间`: number（毫秒时间戳，与代码兼容）
  - record_id: `recXXX`（与 Gate D 创建一致）
- 根因分析：
  1. 飞书表 `Collator 摄入任务` 中 `任务快照 JSON`、`摄入 ID`、`幂等键`、`来源记录 ID` 字段的类型被设置为「富文本」（RichText），写入字符串时被飞书自动转换为 `[{text:"..."}]` 数组结构
  2. `FeishuTaskRepository.parseSnapshot` 直接 `typeof raw !== 'string'` 判断，遇到数组结构即抛错，无任何富文本兼容逻辑
  3. `FeishuReviewRepository` / `FeishuWriteLogRepository` 的 readScalar 有部分富文本兼容逻辑（`if (typeof raw === 'object' && 'text' in raw)`），但只处理 `{text:"..."}` 单对象格式，不处理 `[{text:"..."}]` 数组格式（富文本字段实际返回的格式）
  4. 这是飞书表 schema 与代码字段类型不匹配问题，不是权限问题，不是任务范围外代码变更
- 残留测试数据：ingestion 表中存在未清理的测试记录 `recXXX`（合成数据 `GateD测试客户 / 13800000000`，非真实业务数据）；Gate D 脚本 finally 块只清理 customer/write_log 表，未覆盖 ingestion 表；需用户手动清理或下轮 Codex 修复脚本。
- 未触发停止条件：
  - 不是 91403/403（写权限已解锁）
  - 无 Secret/Token/Authorization Header 输出
  - 不是 Gate D 写入成功但幂等复验失败（写入本身未完成 receiveCandidate 阶段）
  - 未出现任务范围外代码变更（仅创建诊断脚本 `scripts/temp/diagnose-gate-d-snapshot.ts`，未修改任何业务代码）
- 修复方向（待 GPT 裁决）：
  - 方案 A（推荐，最小修改）：用户在飞书表中将 `任务快照 JSON`、`摄入 ID`、`幂等键`、`来源记录 ID`、`候选 JSON`、`标准化结果 JSON`、`校验结果 JSON`、`人工修正 JSON`、`业务记录 ID`、`错误码`、`脱敏错误消息`、`写入日志 ID`、`目标表 ID` 等所有 string/JSON 字段类型从「富文本」改为「多行文本」（Text）；保持代码不变
  - 方案 B（代码兼容）：修改 `FeishuTaskRepository.parseSnapshot` / `FeishuReviewRepository.readScalar`+`readJson` / `FeishuWriteLogRepository.readScalar` 兼容 `[{text:"..."}]` 数组格式；超出 TASK-003-GATE-D-FINAL-RETRY 任务范围，需新 TASK
  - 方案 C（混合）：用户调整关键字段（`任务快照 JSON` 等 JSON 字段）为「多行文本」，代码同时增加防御性兼容逻辑
- 新增临时脚本：`scripts/temp/diagnose-gate-d-snapshot.ts`（含 TEMP 标记，预计删除日期 2026-07-23）。
- git status --short：14 modified + 多个 untracked（新增 `scripts/temp/diagnose-gate-d-snapshot.ts`）；`.env` 与 `artifacts/` 被 .gitignore 忽略。
- git diff --check：exit 0（仅 LF/CRLF 警告）。
- 结论：AC-07 状态从 `BLOCKED_PERMISSION` 升级为 `BLOCKED_SCHEMA_MISMATCH`（写权限已解锁，但表 schema 与代码字段类型不匹配）；Gate D 未通过；提交完整脱敏证据给 GPT 裁决 `EVIDENCE_REVIEW_PASS` / `FIX_REQUIRED` / `CODEX_REQUIRED`。
- 下一步：GPT 裁决修复方向 → 用户调整飞书表字段类型 或 创建新 TASK 修改代码兼容 → 重新运行 `npm run gate:d` → exit 0 后交 GPT 证据审查。

## 附录：Gate D 第五次尝试（TEXT-NORMALIZATION：方案 B 代码兼容修复后真实通过）

- 日期：2026-07-21；基线/HEAD：`af3cba1`；分支：`phase/3-feishu-integration`；未 commit、未 push（AC-09 + `NO_COMMIT`）。
- 触发：GPT 基于第四次尝试的 `FIX_REQUIRED` 判决，采用方案 B（代码兼容）；任务卡 `TASK-003-GATE-D-TEXT-NORMALIZATION`（Recommended Owner: Trae；Codex: NOT_REQUIRED）。
- 修复范围（两层防御 + MultiSelect 修复）：
  1. **API 层防御**：`src/server/feishu/feishu-client.ts` 在 `getRecord`（query 参数）和 `searchRecords`（body 参数）显式设置 `text_field_as_array=false`，降低响应结构波动
  2. **Repository 层防御**：新增共享规范化函数 `src/server/feishu/normalize-text.ts`，导出 `normalizeFeishuText(value, context): string` 和 `normalizeFeishuJson<T>(value, context): T`，严格支持三种合法结构：string / `{text: string}` 单对象 / `Array<{text: string}>` 数组；非以上结构抛出 `FeishuParseError` 含字段名上下文
  3. **三个 Repository 适配层迁移**：`feishu-task-repository.ts` 的 `parseSnapshot` 改用 `normalizeFeishuJson`；`feishu-review-repository.ts` 的 `readScalar`/`readOptionalScalar`/`readJson` 改用共享 normalizer；`feishu-write-log-repository.ts` 同样迁移，保留 select-field `[{name}]` 分支
  4. **MultiSelect 字段修复**：客户表 `意向风格` 字段为 Feishu MultiSelect (type=4)，writer 原本发送 bare string `日系清新` 被飞书拒绝（code=1254063 MultiSelectFieldConvFail）；`customer-record-writer.ts` 新增 `MULTISELECT_FIELDS = new Set<string>(['意向风格'])` 常量与 `buildFields` 新分支包装 string 为 `[value]`，array 透传，非 string/非 array 原样传给飞书以 surface 类型不匹配
  5. **Gate D Runner 适配**：`scripts/run-gate-d.ts` 新增 `matchesMultiSelectValue` helper 兼容 4 种 MultiSelect 返回形态（bare string、array of strings、array of `{name}`、array of `{text}`）
- Gate D 运行命令：`npm run gate:d`（PowerShell 加载 .env 到 Process 环境变量后执行）
- Gate D 运行结果：**exit_code=0（PASS）**
  - 25/25 断言全部通过
  - ingestion_id: `ing_<uuid-redacted>`
  - ingestion_record_id: `recXXX`（已清理）
  - review_record_id: `recXXX`（已清理）
  - business_record_id: `recXXX`（已清理）
  - write_log_id: `recXXX`（已清理）
  - 客户记录 `意向风格` 字段返回 `["日系清新"]` 数组形态
  - cleanup: ingestion=deleted, review=deleted, customer=deleted, write_log=deleted（全部成功）
- 残留测试数据验证：
  - 本次 4 张表合成记录全部按精确 record_id 在 finally 块中清理完成
  - 第四次尝试遗留的 `recXXX` 属于 `createIngestion` 阶段创建的摄入任务记录（`FEISHU_INGESTION_TABLE_ID=tblXXX`），并非客户表记录。RESIDUAL-EVIDENCE-FIX 修正轮使用独立验证脚本 `scripts/temp/verify-residual-ingestion.ts` 调用 `client.getRecord(ingestionTableId, 'recXXX')`，飞书返回 code=1254043 RecordIdNotFound，证明摄入任务表已无残留（无需删除）；脚本使用后已删除
- Gate A + Gate C-Core 全套回归：
  - `npm run typecheck` exit 0
  - `npm run lint` exit 0
  - `npm run audit:legacy` exit 0（62 modules）
  - `git diff origin/main -- src/data-cleaning` 无输出（LEGACY_DIFF_EMPTY）
  - `git diff --check` exit 0
  - `npm run test` exit 0：446/446 passed（33 test files，较第四次增加 3 个 MultiSelect 测试）
  - `npm run build` exit 0
  - `npm run evaluate` exit 0：Gate C-Core 50/50 PASS，4 项核心指标 100%
- AC 对照（本次 TEXT-NORMALIZATION 修复后）：
  - AC-01 ~ AC-05：代码 + 测试 PASS（未变更）
  - AC-06（`npm run gate:d` 真实 Base 验证退出码 0）：**PASS**（exit_code=0，25/25 断言通过）
  - AC-07（Gate D 测试数据按精确 record ID 清理）：**PASS**（4 张表全部按精确 record_id 在 finally 中删除，无残留；遗留记录 `recXXX`（属于 Collator 摄入任务表）经 RESIDUAL-EVIDENCE-FIX 修正轮使用 `client.getRecord(ingestionTableId, ...)` 确认不在摄入任务表）
  - AC-08（Gate A 全套退出码 0）：PASS
  - AC-09（Legacy 源码零修改）：PASS
- 新增/修改文件清单：
  - 新增：`src/server/feishu/normalize-text.ts`、`tests/unit/feishu/normalize-text.test.ts`（68 测试）
  - 修改：`src/server/feishu/feishu-client.ts`、`src/server/repositories/feishu-task-repository.ts`、`feishu-review-repository.ts`、`feishu-write-log-repository.ts`、`src/server/business/customer-record-writer.ts`、`tests/unit/business/customer-record-writer.test.ts`、`tests/integration/feishu-gate-d.test.ts`、`scripts/run-gate-d.ts`
  - 临时诊断脚本（待 Step 14 删除）：`scripts/temp/diagnose-customer-fields.ts`、`scripts/temp/verify-residual-record.ts`
- 未触发停止条件：
  - 无 91403/403（写权限已解锁）
  - 无 Secret/Token/Authorization Header 输出
  - 无 Base schema 修改（方案 B 代码兼容，未触碰飞书表字段类型）
  - 无任务范围外代码变更（除临时诊断脚本外，所有修改均属于 TEXT-NORMALIZATION 任务白名单）
- 结论：AC-06 + AC-07 从 `BLOCKED_SCHEMA_MISMATCH` 解锁为真实 PASS；Gate D 真实通过；提交完整脱敏证据给 GPT 重新进行证据审查。
- 下一步：Trae 输出完成包 → GPT 基于 Trae 完成包作出 `EVIDENCE_REVIEW_PASS` / `FIX_REQUIRED` / `CODEX_REQUIRED` 判决 → 若 PASS 且用户授权 → Trae 创建 commit + push → 交 GPT 进行最终证据审查。