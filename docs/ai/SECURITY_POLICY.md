# 安全操作准则 - collator（数据清洗服务）

## 安全原则

1. **最小权限**：只执行任务明确要求的操作，不扩大权限范围。
2. **可追溯**：所有重要操作必须有 Git commit 记录或任务文件记录。
3. **可回滚**：重大变更前创建备份，确保可回滚。
4. **敏感信息隔离**：.env、Token、Secret 不入 Git，不进入回复。

## 防止误操作检查清单

### 修改前检查

- [ ] 已读取 AGENTS.md 和改造方案.txt，理解当前任务范围
- [ ] 已检查 Git 状态（`git status`、`git branch --show-current`、`git log -1 --oneline`）
- [ ] 确认当前分支正确，不在主分支上直接修改
- [ ] 确认工作区无不属于当前任务的未提交修改
- [ ] 确认修改对应明确的验收标准

### 提交前检查

- [ ] `git diff --staged` 中无敏感信息（.env、Token、密钥、客户数据）
- [ ] `git diff --staged` 中无无关文件
- [ ] `git diff origin/main -- src/data-cleaning` 无输出（Legacy 零修改）
- [ ] commit message 格式正确（`TASK-xxx: 简短描述`）
- [ ] 已运行相关验证命令（typecheck / lint / test / build）

### 删除前检查

- [ ] 确认文件不再被任何代码或文档引用
- [ ] 确认文件不是其他任务正在使用的资源
- [ ] 对于关键文件，已创建备份或可通过 Git 历史恢复

### 文件移动前检查

- [ ] 已搜索项目中对被移动文件的路径引用
- [ ] 已更新所有引用路径
- [ ] 移动后引用路径有效

## 敏感信息处理

### 禁止入库的敏感信息

| 类型 | 示例 | 处理方式 |
|------|------|---------|
| 环境变量文件 | `.env` | 通过 `.gitignore` 排除 |
| API 密钥 | `FEISHU_APP_SECRET`、`DIFY_WORKFLOW_API_KEY` | 通过 `.env` 注入，不入源码 |
| 飞书凭据 | `APP_ID`、`APP_TOKEN`、Table ID | 通过 `.env` 注入，迁出源码 |
| 客户数据 | 手机号、聊天记录 | 测试中使用合成/脱敏数据 |
| Token | `Access Token`、`Refresh Token` | 不入库，不进入日志 |

### 日志脱敏

- 手机号在日志中脱敏为 `1**********` 格式。
- 微信号在日志中脱敏。
- 原始聊天记录不进入普通应用日志。
- 错误信息中不暴露绝对路径或环境变量值。

### 硬编码资源 ID 处理

项目中旧 `src/data-cleaning/` 存在硬编码飞书资源 ID（Base Token、Table ID、Field ID 等），属于已知技术债（DEBT-005）。处理策略：
- V1 阶段不修改 Legacy 源码。
- Phase 3 逐步将资源 ID 迁出源码，迁入 `.env` 或配置中心。
- 新代码（`src/server/`）不得引入新的硬编码资源 ID。

## Git 安全规则

### 分支保护

- `main` 分支：不直接修改，通过 PR 合并。
- `phase/*` 分支：Phase 推进任务使用，完成后合并到 main。
- `feature/*` 分支：功能开发使用，完成后合并到 main。
- `backup/*` 分支：备份用途，不合并。

### 提交安全

- 提交前必须检查 `git diff --staged`。
- 不得在提交中包含 `.env`、密钥或客户数据。
- 不得将构建产物（`dist/`）提交到仓库。
- 不得将临时日志或编辑器缓存提交到仓库。

### Push 安全

- 不得 `git push --force` 到 `main` 分支。
- 不得 `git push --force` 到他人正在使用的分支。
- Push 前确认本地测试通过。
- Push 后确认远程分支状态正确。

## 外部凭据管理

### Dify 凭据（DEBT-001）

- `DIFY_BASE_URL`、`DIFY_WORKFLOW_API_KEY`、`DIFY_WORKFLOW_ID` 通过 `.env` 注入。
- `.env.example` 提供占位符，不含真实值。
- 真实凭据由用户在外部环境配置，不进入仓库。

### 飞书凭据（DEBT-002）

- `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BASE_APP_TOKEN` 及各表 ID 通过 `.env` 注入。
- 测试 Base 与生产 Base 分离。
- 真实凭据由用户创建测试 Base 后提供，不进入仓库。
