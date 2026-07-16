# Trae Collaboration Guide — collator（数据清洗服务）

## 新窗口启动流程（6 步）

每次开启新窗口或重新接手任务时，必须按以下顺序恢复上下文（见改造方案第 5 节）：

1. **读取入口文件**：`AGENTS.md` — 项目当前阶段、角色、必须读取的文件、当前任务位置、事实来源、基本执行规则。
2. **读取项目当前状态**：`docs/ai/PROJECT_STATE.md` — 当前阶段、里程碑、进行中任务、已完成内容、下一优先级、已知风险、阻塞项。
3. **读取审查规则**：`docs/ai/REVIEW_POLICY.md` — 当前阶段、P0/P1/P2 定义、阻塞合并规则、GPT 复审范围、停止条件、Gate A-G 验收体系。
4. **读取相关决策**：`docs/ai/decisions/` — 只读取与当前任务相关的 ADR，无需每次读取全部。
5. **读取当前任务**：`docs/ai/tasks/TASK-xxx.md` — 确认 Objective / In Scope / Out of Scope / Acceptance Criteria / Implementation Constraints / 当前状态 / 已有实现记录 / 已有审查结果。
6. **检查 Git 状态**：
   ```bash
   git status
   git branch --show-current
   git log -1 --oneline
   ```
   确认分支、未提交修改、当前代码与任务包基线一致。不得在不了解 Git 状态的情况下直接修改文件。

## GPT 任务包处理方式

收到 GPT 任务包后，Trae 不得立即盲目执行，必须先完成以下三步（见改造方案第 6 节）：

### 1. 仓库一致性检查
- `task_id` 是否与现有任务重复。
- GPT 引用的文件、模块和接口是否存在。
- GPT 对当前架构的理解是否正确。
- 任务是否与已接受 ADR 冲突。
- 验收条件是否可以客观验证。
- 任务范围是否明显大于一个合理的独立交付单元。
- 是否存在明显缺失但会导致无法执行的信息。

### 2. 冲突处理
- 轻微措辞差异但目标明确：根据仓库事实修正，并在任务文件中记录修正。
- 重大冲突：不得自行选择方案。记录 Execution Conflict（GPT Instruction / Repository Evidence / Impact / Decision Required），然后停止扩大修改范围，交由用户裁决。

### 3. 将任务包正式落库
确认可执行后，由 Trae 创建或更新 `docs/ai/tasks/TASK-xxx.md`，包含：Status / Stage / Objective / Context / In Scope / Out of Scope / Acceptance Criteria / Implementation Constraints / Planned Approach / Changed Files / Verification / Known Limitations / Review History / Final Result。

## 实现原则

### 最小满足原则
优先选择能够满足验收标准的最小实现。不得因「代码可以更优雅」「可以顺便重构」「未来可能需要」「可以增加更多功能」「可以统一整个项目的写法」「当前模块看起来不够完美」等理由自行扩大任务。

除非不处理相关问题就无法满足验收标准，否则应避免：大范围重命名、大范围目录迁移、更换框架或核心库、重写已有模块、修改无关页面、重构无关公共组件、添加没有被任务要求的配置系统、为假设中的未来场景设计复杂抽象。

### 范围控制
每次修改前应明确回答：
1. 该修改对应哪条验收标准？
2. 不修改它会导致什么具体失败？
3. 它是否属于当前任务范围？
4. 它是否会影响无关模块？

无法回答时暂停该修改。

### 不隐式改变产品行为
以下改变必须明确记录，必要时请求用户决定：API 请求或响应格式改变、数据库结构改变、用户流程改变、默认配置改变、权限规则改变、错误处理语义改变、数据兼容性改变、部署要求改变、外部依赖增加、运行成本明显增加。

### 不覆盖用户未提交内容
发现工作区存在不属于当前任务的未提交修改时：不得直接覆盖、不得擅自丢弃、不得执行破坏性 reset、不得把无关修改混入当前 commit。应先识别修改来源并隔离当前任务。

## Git 工作方式

### 分支命名
每个独立任务使用独立分支：
- `feature/task-xxx-<short-desc>`
- `fix/task-xxx-<short-desc>`
- `phase/<phase-id>-<short-desc>`（本项目 Phase 推进任务）

除非用户明确允许，不应直接在主分支修改。

### 提交原则
提交应具备：单一目的、可理解的提交信息、不包含无关文件、不包含密钥和本地配置、不包含无必要的大型生成文件、尽量保持可回滚。

建议格式：
```text
TASK-xxx: 简短描述
```

必要时在提交正文中记录主要修改点。提交前应检查 `git status` 与 `git diff --staged`。

### 禁止提交的内容
结合项目 `.gitignore` 处理，通常包括：`.env`、API 密钥、私钥、Token、本地数据库、临时日志、编辑器缓存、用户个人配置、构建缓存、未要求提交的大型产物。

### Push 和 PR 流程
任务实现并验证后：
1. 更新任务文件。
2. 提交代码。
3. Push 到远程分支。
4. 创建或更新 PR。
5. 在 PR 说明中引用任务 ID。
6. 写明测试结果和已知限制。

PR 说明建议包含：Task / Objective / Changes / Verification / Known Debt / Out of Scope。

## 验证规则

### 只能报告实际执行的验证
Trae 不得声称「测试通过」「构建正常」「没有问题」「应该可以工作」，除非相关命令实际运行并获得结果。

验证记录应包含：Command / Result / Evidence（具体测试数量或输出）。

### 无法执行验证时
如果因环境、权限、依赖或外部服务导致无法验证，必须明确写出：Not Executed / Reason / Alternative Verification / Remaining Risk。不得用替代验证冒充完整验证。

### 推荐验证顺序
1. 格式检查。
2. Lint。
3. 类型检查。
4. 相关单元测试。
5. 相关集成测试。
6. 构建。
7. 必要的手工流程验证。

不要为了一个小任务默认运行耗时极高且无关的全量测试，除非项目规则或风险要求。

## GPT 审查结论处理

GPT 审查结果分为三种（见改造方案第 10 节）：

### MVP_PASS
含义：验收标准已满足、无 P0 阻塞问题、当前任务可以合并。
Trae 应：
1. 将审查结论记录到任务文件。
2. 确认 CI 状态。
3. 按项目流程合并或等待用户合并。
4. 更新 `PROJECT_STATE.md`。
5. 将任务状态改为 `DONE`。

### MVP_PASS_WITH_DEBT
含义：验收标准已满足、无 P0 阻塞问题、存在 P1 技术债但不阻塞当前 MVP。
Trae 应：
1. 将审查结论记录到任务文件。
2. 把有效技术债写入 `TECH_DEBT.md`。
3. 不在当前任务中顺手修复技术债。
4. 按正常流程完成当前任务。

### MVP_FAIL
含义：存在明确 P0 问题，当前任务不能通过验收。GPT 通常会提供 `FIX_PACKET`。
Trae 应：只修复明确列出的 P0 问题及其直接回归，不主动处理 P1 和 P2。

## 项目特定补充工作流

### Phase 推进流程

本项目采用 Phase 推进流程，阶段定义如下：

- **Phase 0**：基线盘点（已完成）— 解压协作包、阅读 Knowledge/rules、目录与 Schema 盘点、运行现有测试、扫描硬编码资源 ID、生成 BASELINE_REPORT。
- **Phase 1**：Core Service 外壳（已完成）— TypeScript + Fastify 服务入口、路由、服务、安全（签名/脱敏）、内存仓库、单元/集成测试、API_CONTRACT。
- **Phase 2A**：Legacy 审计（已完成）— 标记 `EXTRACT_PURE_FUNCTION / MIGRATE_INCREMENTALLY` 等处理策略。
- **Phase 2B**：Legacy Adapter（已完成）— LegacyModuleLoader + 8 个 Adapter + 契约测试 + Legacy Import 禁令。
- **Phase 2C**：CleaningPipeline（已完成）— Immutable Pipeline + 16 个核心性质/错误路径测试。
- **Phase 2F**：固定评测集（待开始）— 50 条评测集与 Pipeline 跑通。
- **Phase 3**：飞书集成 — `FeishuTaskRepository`、凭据配置、字段映射层、硬编码资源 ID 迁出。
- **Phase 5**：部署 — Dockerfile、容器化。
- **Phase 6**：展示证据 — 端到端运行证据。

### 每个 Phase 完成后的 Gate A 全套验证命令

每个 Phase 完成后，必须运行以下全套命令并确认全部退出码 0：

```bash
npm ci
npm run audit:legacy
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:coverage
npm run build
```

### Legacy 源码零修改约束

本项目严格遵守 Legacy 源码零修改约束。每个 Phase 完成后必须验证：

```bash
git diff origin/main -- src/data-cleaning
```

该命令应无输出。若存在输出，说明 Legacy 源码被修改，属于 P0 阻塞，必须回滚。

### 覆盖率 Gate A 口径

Gate A 覆盖率口径为 **Core 关键模块行覆盖率 ≥ 80%**（`src/server` 可执行代码，排除纯类型文件）。全仓库覆盖率（含旧 `src/data-cleaning`）仅作参考，不作为阻塞项。

### Gate A-G 与 P0/P1/P2 的对应关系

Gate A-G 验收体系与改造方案 P0/P1/P2 分级并存：

- Gate 未通过 → 对应 P0 阻塞（除 Gate D 因外部环境阻塞登记为 P1、Gate F/G 属于后续 Phase）。
- Gate 已通过但存在遗留问题 → 按 P1 登记到 `docs/ai/TECH_DEBT.md`。

详细 Gate 定义见 `docs/ai/REVIEW_POLICY.md`。
