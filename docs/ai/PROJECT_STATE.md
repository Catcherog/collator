# Project State — collator（数据清洗服务）

## Current Stage

Phase 3B（TASK-002 Redaction Invariant Closure fix applied；等待 GPT 基于 new commit 复核；不可启动 TASK-003）

- 状态：`DONE — AWAITING_GPT_RE_REVIEW` — Trae 按用户批准的单批次执行计划 `docs/ai/plans/TASK-002_REDACTION_INVARIANT_CLOSURE_EXECUTION_PLAN.md` 完成 P0-01D（redaction mode 单调敏感度）+ P0-04B（context-aware structural ID 保留）+ 直接反例；targeted TDD red→green 已记录；最终 Gate A + Gate C-Core 一次性全套通过；新 commit 待 push 后交 GPT 复核。P0-02/P0-03 保持 accepted。TASK-003 保持阻塞。
- Planning Review：APPROVED_WITH_REQUIRED_CHANGES（Phase 2 Planning Correction 已完成）
- 当前分支：phase/3-feishu-integration
- 验收基线 Commit：`0ef131c`（Phase 3 preparation commit）
- 上一次 Commit：`976fa6c`（TASK-002 P0-01C + P0-04 fix；GPT re-review verdict: `MVP_FAIL`，P0-01D + P0-04B 阻塞）
- 当前 Commit：待 push（Redaction Invariant Closure: P0-01D + P0-04B fix；等待 GPT re-review）
- 当前版本：v1.0

## Current Milestone

Phase 3 飞书集成 / TASK-002 Redaction Invariant Closure（P0-01D + P0-04B）修复完成，等待 GPT re-review

## In Progress

- Trae 已完成 Redaction Invariant Closure 单批次执行（P0-01D + P0-04B）：targeted TDD red（5 failed | 50 passed）→ green（单元 55/55、集成 22/22、联合 77/77）→ 最终 Gate A + Gate C-Core 一次性全套通过（typecheck/lint/audit:legacy/test:coverage 307 passed/build/evaluate 50/50/Legacy diff empty/git diff --check exit 0）。`server/security/redaction.ts` 实现 Invariant A（`contact > content > default` 单调敏感度，inherited content 下嵌套 contact key 升级）+ Invariant B（7 个可信响应合同 ID 字段集合 + value 形态匹配双条件）。新 commit 待 push 后交 GPT 基于 new commit 复核。TASK-003 保持阻塞。P0-02/P0-03 保持 accepted。

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

## Next Priorities

1. **Push 新 commit 到 `origin/phase/3-feishu-integration`**：Redaction Invariant Closure fix 已完成本地全套验证，push 后交 GPT 基于 new commit 复核。复核通过前 TASK-003 保持阻塞。
2. 配置 Dify 环境与凭据（DEBT-001），解锁 Gate C-LLM 真实 LLM 联调。
3. 启动 TASK-003（写入日志仓库 + 业务主表写入），完成后整体通过 Gate D 飞书集成验收。
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

- ~~TASK-001 P0-01~~：RESOLVED（2026-07-17）— `FeishuClient.callWithRetry` 现在识别飞书业务错误码 `code=99991663`（即使在 HTTP 200 路径上），触发单次 token 刷新 + 重试；新增 3 个单元测试覆盖重试成功、不二次重试、非 token 错误不触发刷新。
- ~~TASK-001 P0-02~~：RESOLVED（2026-07-18，Commit `1217942`）— `docs/ACCEPTANCE_REPORT.md:291` 已改为 `<FEISHU_INGESTION_TABLE_ID>`；GPT 对目标两文件及整个提交树运行三个运行表真实 ID 的 `git grep`，均为 0 匹配。
- ~~TASK-002 P0-01C~~：ACCEPTED（2026-07-18，Commit `976fa6c` GPT re-review）— contact parent 对 nested `content`/`phone`/`mobile`/`原始文本` 保持权威，原四类复现已修复。
- **TASK-002 P0-01D**：FIX_APPLIED_AWAITING_RE_REVIEW（2026-07-18，Redaction Invariant Closure fix）— `resolveRedactionMode` 实现单调敏感度 `contact > content > default`，inherited content 下嵌套 contact/联系方式/wechat/微信 key 升级为 contact mode；targeted TDD red→green + HTTP 回归证明 `content: { contact: 'wechat_secret_01' }` 在 GET 响应中被脱敏为 `we************01`。等待 GPT 基于 new commit 复核。
- **TASK-002 P0-04B**：FIX_APPLIED_AWAITING_RE_REVIEW（2026-07-18，Redaction Invariant Closure fix）— `TRUSTED_STRUCTURAL_ID_KEYS` Set + `isTrustedStructuralIdKey(lower)` + `trustedStructuralIdContext` 双条件保留；Candidate `fields`/`evidence` 中的 `<prefix>_<phone>` 不再被 value-only 规则放行；targeted TDD red→green + HTTP 回归证明 `note_13900139000`/`proof_13700137000` 被掩码为 `note_139****9000`/`proof_137****7000`，可信合同 ID 仍逐字节保留。等待 GPT 基于 new commit 复核。
- ~~TASK-002 P0-02~~：RESOLVED（2026-07-18，P0 修复 commit）— `IngestionTask.raw_candidate` 深拷贝原始 Candidate；`review.validation.rawCandidate` 复用飞书 JSON 列保留原始证据；mapper warning sanitization 切断 PII 通过 warning 字段泄露路径。
- ~~TASK-002 P0-03~~：RESOLVED（2026-07-18，P0 修复 commit）— `IngestionTask.pipeline_evidence` 持久化完整 Pipeline 证据（pipelineVersion/stages/validation/corrections/warnings/errors/qualityReport/success）；成功与失败路径均写入；mapper warnings 与 Pipeline warnings 严格区分。
- 未配置 Dify 环境与凭据（`DIFY_BASE_URL`、`DIFY_WORKFLOW_API_KEY`、`DIFY_WORKFLOW_ID`）— 见 DEBT-001。阻塞 Gate C-LLM 真实 LLM 联调。
- 飞书测试 Base 凭据与表结构 **部分已配置**（TASK-001 + TASK-002）：`FEISHU_APP_ID` / `FEISHU_BASE_APP_TOKEN` / `FEISHU_INGESTION_TABLE_ID` / `FEISHU_REVIEW_TABLE_ID` / `FEISHU_WRITE_LOG_TABLE_ID` / `FEISHU_CUSTOMER_TABLE_ID` 已写入 `.env`；`FEISHU_APP_SECRET` 占位为 `replace_me`，生产部署时需通过环境变量或密钥管理器注入，不写入文件。Gate D 飞书集成验收仍需 TASK-003（写入日志仓库 + 业务主表写入）完成。
- **TASK-002 GPT 复核**：Commit `976fa6c` 结论 `MVP_FAIL`（P0-01D + P0-04B）。Trae 已按 Redaction Invariant Closure 单批次执行计划完成修复 + 直接反例 + 最终 Gate A + Gate C-Core；新 commit 待 push 后交 GPT 基于 new commit 复核。复核通过前不得启动 TASK-003。

> 注：Dify/飞书凭据属于外部环境阻塞；TASK-002 的 GPT 复审属于当前流程阻塞，必须通过后才能合并或启动 TASK-003。它们不改变已通过的 Phase 2F Gate C-Core 确定性数据质量结果。

## Known Risks

- 旧 `src/data-cleaning/agent/index.js` 存在 `&&amp;` HTML 实体语法错误，任何引用该文件的入口无法运行；V1 采用新建 `src/server/` 替代旧 Agent 入口，不修复旧入口（见 DEBT-003）。
- 现有 Schema 使用中文 fieldName，Dify Candidate 输出英文 raw 字段，Phase 2 需要增加映射层（见 DEBT-004）。
- 硬编码飞书资源 ID 较多，Phase 3 需逐步迁出源码（见 DEBT-005）。
- `core/data-cleaner.js` 导入闭包触发 `schemas/index.js` 与 `config/index.js` 的 import-time 文件读取，Phase 2A 审计需标记为 `EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY`，不得简单 WRAP（见 DEBT-006）。

## Last Updated

2026-07-18（Trae Redaction Invariant Closure fix applied for P0-01D + P0-04B; targeted TDD red→green recorded; final Gate A + Gate C-Core all exit 0; new commit awaiting push + GPT re-review; TASK-003 blocked）

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
| A | 代码基线 | PASSED | Trae Redaction Invariant Closure fix 后最终验证：`typecheck` / `lint` / `audit:legacy` (62 modules) / `test:coverage` (307/307 passed, Lines 85.77%, Branches 82.35%, Funcs 88.88%, redaction.ts Lines 100%) / `build` / `evaluate` (50/50, 4 metrics 100%) / Legacy diff empty / `git diff --check` exit 0。 |
| B | API 合同 | PASSED | `docs/API_CONTRACT.md`（含 §6 Candidate 字段映射章节）+ 14 项集成测试覆盖全部 V1 接口 |
| C-Core | 数据质量（确定性） | PASSED | Phase 2F + Phase 3B Redaction Invariant Closure fix 后回归：50/50 case 通过，4 项核心指标 100%（field_accuracy 132/132, required_field_recall 91/91, enum_precision 33/33, error_interception_rate 1/1） |
| C-LLM | 数据质量（LLM 语义） | BLOCKED_EXTERNAL_ENV | 未配置 Dify 凭据（见 DEBT-001）|
| D | 飞书集成 | IN_PROGRESS | TASK-001 已完成；TASK-002 Redaction Invariant Closure fix 已应用，等待 GPT 基于 new commit 复核；TASK-003 未启动。|
| E | 安全隐私 | FIX_APPLIED_AWAITING_RE_REVIEW | Trae 已按 Redaction Invariant Closure 单批次修复 P0-01D + P0-04B；targeted TDD red→green + 2 个 HTTP 回归证明 `content.contact` 微信 ID 与未知字段 `<prefix>_<phone>` 不再泄露，可信合同 ID 仍逐字节保留。等待 GPT 基于 new commit 复核。 |
| F | 部署运行 | NOT_STARTED | 无 Dockerfile（Phase 5/6） |
| G | 展示证据 | NOT_STARTED | 无运行证据（待 Docker/部署后补充） |

## 附录：最近一次执行

- 日期：2026-07-18（Trae Redaction Invariant Closure fix applied for P0-01D + P0-04B，最终 Gate A + Gate C-Core 一次性全套验证）
- 基线：Commit `976fa6c`（GPT re-review `MVP_FAIL`，P0-01D + P0-04B 阻塞）
- 执行计划：`docs/ai/plans/TASK-002_REDACTION_INVARIANT_CLOSURE_EXECUTION_PLAN.md`（用户批准单批次）
- 命令：`npm run typecheck` / `npm run lint` / `npm run audit:legacy` / `npm run test:coverage` / `npm run build` / `npm run evaluate` / `git diff origin/main -- src/data-cleaning` / `git diff --check`
- 结果：全部退出码 0。`typecheck` 无错误；`lint` 无错误；`audit:legacy` 62 modules（SAFE 4 / UNSAFE 57 / BLOCKED 1，预期）；`test:coverage` 307/307 passed（28 test files；All files Lines 85.77% / Branches 82.35% / Funcs 88.88%；`server/security/redaction.ts` Lines 100% / Branch 90.62% / Funcs 100%）；`build` 成功；`evaluate` Gate C-Core 50/50 PASS，4 项核心指标 100%（field_accuracy 132/132, required_field_recall 91/91, enum_precision 33/33, error_interception_rate 1/1）；`git diff origin/main -- src/data-cleaning` 无输出；`git diff --check` exit 0。Targeted TDD red→green 证据：red 5 failed | 50 passed（4 个 P0-01D case + 1 个 P0-04B case）；green 单元 55/55、集成 22/22、联合 77/77。新 commit 待 push 后交 GPT 基于 new commit 复核。
