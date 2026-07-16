# 文件操作规范 - collator（数据清洗服务）

## 适用范围

本规范适用于 Trae 在 collator 项目中执行的所有文件操作。GPT 不直接操作文件，不受本规范约束，但 GPT 的任务包中可以包含文件操作建议。

## 文件修改前备份

### 关键文件修改

修改以下关键文件前，必须确认工作区状态干净或创建备份分支：

- `src/server/` 下的所有 TypeScript 源文件
- `tests/` 下的所有测试文件
- `docs/API_CONTRACT.md`（接口合同）
- `package.json`、`tsconfig.json`、`eslint.config.js`（构建配置）
- `.trae/rules/` 下的规则文件
- `AGENTS.md`、`改造方案.txt`（协作规范）

### 备份方式

1. **Git stash 备份**：修改前执行 `git stash` 保存当前未提交的修改。
2. **备份分支**：重大修改前创建备份分支 `backup/pre-<task-id>-<timestamp>`。
3. **提交前检查**：提交前执行 `git diff --staged` 确认变更内容。

### Legacy 源码保护

`src/data-cleaning/` 下的 Legacy 源码实行零修改约束：
- 不得修改 `src/data-cleaning/` 下的任何文件。
- 每个 Phase 完成后必须验证：`git diff origin/main -- src/data-cleaning` 无输出。
- 发现 Legacy 行为错误时记录为 BLOCKED 或 DEFERRED，不直接修复。

## 版本控制规范

### 分支命名

- 功能任务：`feature/task-xxx-<short-desc>`
- 修复任务：`fix/task-xxx-<short-desc>`
- Phase 推进：`phase/<phase-id>-<short-desc>`
- 备份分支：`backup/pre-<task-id>-<timestamp>`

### 提交原则

- 单一目的：每个 commit 只包含一个逻辑变更。
- 可理解的信息：`TASK-xxx: 简短描述` 格式。
- 不包含无关文件：提交前检查 `git status`。
- 不包含敏感信息：提交前检查 `git diff --staged` 中无 `.env`、Token、密钥。
- 可回滚：避免单次提交过大，保持原子性。

### 禁止提交的内容

- `.env` 文件及包含环境变量的文件
- API 密钥、App Secret、Access Token
- 真实客户数据（手机号、聊天记录等）
- 构建产物（`dist/` 目录）
- 临时日志和编辑器缓存
- 未要求提交的大型生成文件

## 变更记录要求

### 必须记录变更的场景

1. 修改 `docs/API_CONTRACT.md`（接口合同变更）
2. 修改 `src/server/` 下的核心逻辑（行为变更）
3. 修改构建配置（`package.json`、`tsconfig.json` 等）
4. 修改 `.trae/rules/` 下的规则文件（规则变更）
5. 修改 `AGENTS.md` 或 `改造方案.txt`（协作规范变更）

### 记录方式

1. 在对应任务文件 `docs/ai/tasks/TASK-xxx.md` 的 "## Changed Files" 部分记录。
2. 在 `docs/ai/PROJECT_STATE.md` 的 "## Recently Completed" 部分更新。
3. 在 Git commit message 中写明变更原因。
4. 涉及架构决策变更时，在 `docs/ai/decisions/` 下创建或更新 ADR。

### 变更记录格式

```markdown
### 变更项：<文件路径>
- 变更类型：新增 / 修改 / 删除 / 移动
- 变更原因：<对应验收标准或任务需求>
- 影响范围：<受影响的模块或文档>
- 验证方式：<如何确认变更正确>
```

## 文件移动与删除

### 移动前检查

1. 确认目标目录存在或创建。
2. 搜索项目中是否有其他文件引用被移动文件的路径。
3. 如果有引用，先更新引用再移动文件。
4. 移动后验证引用路径有效。

### 删除前检查

1. 确认文件不再被任何代码或文档引用。
2. 对于临时文件，确认已完成用途。
3. 对于配置文件，确认有替代方案。
4. 删除后搜索确认无残留引用。

## 禁止操作

1. **禁止** 在不了解 Git 状态的情况下直接修改文件。
2. **禁止** 覆盖、丢弃或混入用户或其他任务的未提交修改。
3. **禁止** 执行 `git push --force` 到主分支。
4. **禁止** 执行 `git reset --hard` 除非用户明确要求。
5. **禁止** 在未运行验证命令的情况下声称修改完成。
6. **禁止** 修改 `src/data-cleaning/` 下的 Legacy 源码。
7. **禁止** 提交 `.env`、密钥或真实客户数据。
