# Tasks

## Task 1: 项目进度确认与推进路线图制定
- [x] 1.1 确认 `改造方案.txt` 为最新版项目总体框架文档，对比 `AGENTS.md` 与 `docs/ai/` 下各文档消除不一致
- [x] 1.2 在 `docs/ai/PROJECT_STATE.md` 中补充 Phase 2F -> Phase 3 -> Phase 5 -> Phase 6 的统一推进路线图，包含里程碑、依赖关系和阻塞项
- [x] 1.3 在 `AGENTS.md` 中更新项目当前阶段描述，确保与 PROJECT_STATE.md 一致

## Task 2: 项目文件结构整理 - docs/ 根目录清理
- [x] 2.1 创建 `docs/business-docs/` 目录，将 `docs/` 根目录下的 `.docx` 文件（策划案、清单等）移入
- [x] 2.2 创建 `docs/archive/` 目录，将 `docs/Collator_Dify_飞书_Trae实施协作包_v1.0.zip` 移入
- [x] 2.3 删除 `docs/PROJECT_STATE.md`（已迁移到 `docs/ai/PROJECT_STATE.md`，仅剩重定向说明）
- [x] 2.4 审查 `docs/` 根目录下其他 `.md` 文件（DECISIONS.md、ACCEPTANCE_REPORT.md 等），确认是否需要迁移到 `docs/ai/` 或保留原位

## Task 3: 项目文件结构整理 - 临时脚本清理
- [x] 3.1 审查 `src/scripts/temp/` 下所有脚本，标记为"删除"、"保留迁移"、"待确认"三类
- [x] 3.2 删除确认过期的临时脚本
- [x] 3.3 将有用脚本迁移至 `src/scripts/` 并移除 TEMP 标记
- [x] 3.4 清理 `src/scripts/` 下的非临时脚本（check_encoding.ps1 等），确认归属

## Task 4: 项目文件结构整理 - .trae/documents/ 归类
- [x] 4.1 审查 `.trae/documents/` 下所有规划文档（execution_layer_plan.md、multimodal-verification-*.md 等）
- [x] 4.2 将规划文档迁移至 `docs/ai/plans/` 或对应 Phase 目录
- [x] 4.3 清理 `.trae/documents/` 目录（迁空后删除或保留为空索引）

## Task 5: 协作规则优化 - 消除规则重叠
- [x] 5.1 在 `AGENTS.md` 中明确文档优先级链：`改造方案.txt` > `AGENTS.md` > `docs/ai/*.md` > `.trae/rules/*.md`
- [x] 5.2 精简 `.trae/rules/项目操作规则.md`，去除与 `改造方案.txt` 重复的通用协作规则，保留项目特有规则（飞书操作、文件映射、Skill 选择）
- [x] 5.3 精简 `.trae/rules/collator-handoff-audit.md`，去除与 `改造方案.txt` 重复的角色定义和事实来源声明，保留 Phase 验收审计输出格式
- [x] 5.4 检查 `.trae/rules/_core.md` 与 `改造方案.txt` 的一致性，消除冲突

## Task 6: 标准化提示词模板设计
- [x] 6.1 创建 `docs/ai/PROMPT_TEMPLATES.md`，设计以下提示词模板：
  - GPT 新窗口启动提示词（读取 GitHub 上下文 + 输出任务包）
  - Trae 新窗口启动提示词（读取 AGENTS.md + 恢复上下文 + Git 状态检查）
  - 任务交接提示词（GPT->Trae 任务包传递）
  - 审查请求提示词（Trae->GPT PR 审查请求）
  - 状态同步提示词（跨窗口状态对齐）
  - 修复包传递提示词（GPT->Trae FIX_PACKET 传递）
- [x] 6.2 在每个模板中明确占位符（如 `{{TASK_ID}}`、`{{PR_NUMBER}}`、`{{COMMIT_HASH}}`）和使用说明
- [x] 6.3 在 `AGENTS.md` 中引用 PROMPT_TEMPLATES.md

## Task 7: 权限与操作规范制定
- [x] 7.1 在 `AGENTS.md` 中强化 GPT（只读 GitHub）与 Trae（读写 GitHub + 本地文件）的权限声明
- [x] 7.2 创建 `docs/ai/FILE_OPS_POLICY.md`，定义文件操作规范（修改前备份、版本控制、变更记录）
- [x] 7.3 创建 `docs/ai/SECURITY_POLICY.md`，定义安全操作准则（防止误操作检查清单、敏感信息处理、Git 安全规则）

## Task 8: 冲突解决流程与决策机制明确化
- [x] 8.1 在 `docs/ai/REVIEW_POLICY.md` 中补充冲突解决流程（GPT 任务包与仓库冲突、GPT 与 Trae 理解差异、范围争议）
- [x] 8.2 在 `AGENTS.md` 中明确决策升级路径（何时交由用户裁决）
- [x] 8.3 在 `docs/ai/DECISIONS.md`（或 `docs/DECISIONS.md` 统一后）中补充变更提案流程

## Task 9: 验证与一致性检查
- [x] 9.1 确认所有文档间无矛盾声明（AGENTS.md、改造方案.txt、docs/ai/*.md、.trae/rules/*.md）
- [x] 9.2 确认文件结构整理后 `npm run typecheck`、`npm run lint`、`npm run test`、`npm run build` 仍然通过
- [x] 9.3 确认 `git diff origin/main -- src/data-cleaning` 无输出（Legacy 源码零修改约束）
- [x] 9.4 验证所有文档引用的路径在文件移动后仍然有效

# Task Dependencies
- Task 2, 3, 4 可并行执行（文件整理类任务互不依赖）
- Task 5 依赖 Task 1（需要先确认文档优先级后再精简规则）
- Task 6 依赖 Task 1（需要确认协作规范后再设计提示词模板）
- Task 7 依赖 Task 1（需要确认权限边界后再制定操作规范）
- Task 8 依赖 Task 5、Task 7（需要规则优化和权限规范完成后补充冲突流程）
- Task 9 依赖所有前置任务完成
