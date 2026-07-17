# Review Policy — collator（数据清洗服务）

## 阶段定义

本项目的审查规则按阶段区分（见改造方案第 12 节、第 21 节）：

- **MVP 阶段**：优先完成核心用户流程可运行、关键数据正确、无明确安全漏洞、无严重回归、构建和关键测试通过、验收条件满足。不追求完美架构、完整扩展性、全量自动化测试或所有边界条件一次解决。
- **稳定化阶段**：在 MVP 通过后，补齐边界条件、错误处理、关键测试覆盖，处理 MVP 阶段登记的 P1 技术债。
- **生产强化阶段**：面向公开发布，处理性能、安全加固、可观测性、容量规划等。

当前阶段：Phase 2C 完成，准备 Gate C 数据质量验收（属于 V1 Core Service MVP 验收范围内）

## P0 阻塞问题定义

P0 必须在当前任务中解决。通常包括：

- 核心验收条件没有实现。
- 核心用户流程无法运行。
- 构建失败。
- 关键测试失败。
- 数据丢失或损坏。
- 明确安全漏洞。
- 权限绕过。
- 修改引入严重回归。
- 实现与任务要求直接矛盾。

## P1 重要技术债定义

P1 应记录到 `TECH_DEBT.md`，通常不阻塞 MVP。通常包括：

- 边界条件覆盖不足。
- 可维护性明显较差。
- 错误处理不完整。
- 缺少部分测试。
- 非核心性能问题。
- 内部 MVP 可以接受，但公开发布前应处理的问题。

## P2 优化建议定义

P2 不应阻塞当前任务，也不应由 Trae 默认执行。通常包括：

- 命名偏好。
- 代码风格偏好。
- 非必要抽象。
- 文件组织建议。
- UI 微调。
- 推测性扩展设计。
- 与当前任务无关的重构。

## 阻塞合并规则

- **P0**：必须解决才能合并。
- **P1**：记录到 `docs/ai/TECH_DEBT.md`，不阻塞当前 MVP 合并。
- **P2**：不阻塞合并，Trae 不默认执行。

## GPT 复审范围

GPT 可直接读取本地项目文件进行审计，遇到难度大的问题可直接修改本地文件。Git 提交（commit/push）仍由 Trae 负责。GPT 审查结论只能为以下三种之一：

- `MVP_PASS`：验收标准已满足、无 P0 阻塞问题、当前任务可以合并。
- `MVP_PASS_WITH_DEBT`：验收标准已满足、无 P0 阻塞问题、存在 P1 技术债但不阻塞当前 MVP。
- `MVP_FAIL`：存在明确 P0 问题，当前任务不能通过验收。GPT 通常会附带 `FIX_PACKET`。

## 当前任务停止条件

当满足以下两个条件时，应结束当前任务：

1. 验收条件已满足。
2. 不存在 P0 问题。

其他改进应进入技术债或后续任务，而不是继续无限修改。

## 冲突解决流程

### 冲突类型与处理方式

#### 类型 1：GPT 任务包与仓库事实冲突
- **场景**：GPT 引用的文件/模块/接口不存在，或任务与已接受 ADR 冲突。
- **处理**：Trae 按改造方案第 6.2 节处理。轻微措辞差异可修正并记录；重大冲突记录 Execution Conflict（GPT Instruction / Repository Evidence / Impact / Decision Required），停止扩大修改范围，交由用户裁决。

#### 类型 2：GPT 与 Trae 对需求范围理解不同
- **场景**：GPT 任务包的范围描述与 Trae 对仓库的理解不一致。
- **处理**：Trae 记录差异点，附上仓库证据，提交用户裁决。不得自行选择方案。

#### 类型 3：GPT 审查证据与实际代码不符
- **场景**：GPT 返回 MVP_FAIL 但引用的证据在当前代码中不存在或已修复。
- **处理**：Trae 按改造方案第 11 节记录 Disputed Finding（Finding / GPT Evidence / Repository Evidence / Assessment / Requested Action），不迎合审查结论修改正确代码，请求 GPT 基于最新 commit 重新审查。

#### 类型 4：任务范围争议
- **场景**：执行中发现需要增加大量额外功能。
- **处理**：按改造方案第 18.1 节处理。完成可独立交付的当前部分，记录新增需求，建议拆分新 TASK，由 GPT 重新定义范围或用户裁决。

#### 类型 5：GPT 反复提出新细节
- **场景**：GPT 在审查中反复提出新意见。
- **处理**：按改造方案第 18.3 节处理。只有新发现的真实 P0 或原 P0 修复导致的直接回归可以继续阻塞当前任务。其他归为 P1/P2 或无关问题。

### 冲突升级路径

```
Trae 发现冲突
  ↓
轻微差异 -> Trae 修正并记录
  ↓
重大冲突 -> 记录 Execution Conflict / Disputed Finding
  ↓
提交用户裁决
  ↓
用户决定 -> Trae 执行 / GPT 重新审查 / 任务拆分
```

## 项目特定补充规则

### Gate A-G 验收体系

本项目在改造方案 P0/P1/P2 分级基础上，叠加 Gate A-G 验收体系。Gate 未通过对应 P0 阻塞，必须在当前阶段解决；Gate 已通过但存在遗留问题，按 P1 登记到 `docs/ai/TECH_DEBT.md`。

| Gate | 名称 | 通过标准 | 当前状态 |
|---|---|---|---|
| A | 代码基线 | `npm ci` / `audit:legacy` / `typecheck` / `lint` / `test` / `test:integration` / `build` / `test:coverage` 全部退出码 0；`git diff origin/main -- src/data-cleaning` 无输出（Legacy 源码零修改） | PASSED |
| B | API 合同 | `docs/API_CONTRACT.md` 完整；集成测试覆盖全部 V1 接口 | PASSED |
| C-Core | 数据质量（确定性） | 50 条评测集与 CleaningPipeline 跑通（不依赖 Dify/LLM）；字段准确率≥90%、必填字段召回率≥95%、枚举映射精确率≥95%、错误拦截率≥95% | IN_PROGRESS |
| C-LLM | 数据质量（LLM 语义） | Dify 真实 LLM 调用链路评测通过（CandidateRecord 语义提取准确率达标） | BLOCKED_EXTERNAL_ENV（DEBT-001）|
| D | 飞书集成 | 配置测试 Base 凭据（`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_BASE_APP_TOKEN` 及各表 ID）；`FeishuTaskRepository` 集成测试通过 | BLOCKED_EXTERNAL_ENV |
| E | 安全隐私 | 无 `.env` / Secret 入库；签名验签、脱敏、幂等、Legacy Import 禁令、Legacy Import 禁令均测试通过 | PASSED |
| F | 部署运行 | 提供 Dockerfile；容器化构建与启动验证通过 | NOT_STARTED |
| G | 展示证据 | 提供运行证据（Docker/部署后补充端到端运行截图/日志） | NOT_STARTED |

### Gate 与 P0/P1/P2 的对应关系

- Gate A/B/E 未通过 → P0 阻塞，必须在当前任务解决。
- Gate C-Core 未通过 → P0 阻塞数据质量验收，但不阻塞已完成的 Phase 2C 代码合并。
- Gate C-LLM 未通过因外部环境（Dify 凭据未配置，DEBT-001）→ 登记为 P1 技术债，不阻塞 Gate C-Core 与 V1 Core Service 代码合并。
- Gate D 未通过因外部环境（凭据未配置）→ 登记为 P1 技术债（DEBT-001、DEBT-002），不阻塞 V1 Core Service 代码合并，但阻塞飞书集成验收。
- Gate F/G 未通过 → 属于 Phase 5/6 范围，当前阶段不阻塞。

> 重要边界声明：Gate C-Core 通过仅证明确定性清洗/校验管道达标，**不得**用于宣称端到端语义提取（含 Dify/LLM）已通过。LLM 语义提取验收属于 Gate C-LLM 范围。

### 覆盖率 Gate A 口径

Gate A 覆盖率口径为 **Core 关键模块行覆盖率 ≥ 80%**（`src/server` 可执行代码，排除纯类型文件）。全仓库覆盖率（含旧 `src/data-cleaning`）仅作参考，不作为阻塞项。
