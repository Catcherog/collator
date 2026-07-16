# Checklist

## 项目进度确认与推进
- [x] `改造方案.txt` 已确认为最新版项目总体框架文档，版本号和内容一致性已验证
- [x] `AGENTS.md` 中的项目当前阶段描述与 `docs/ai/PROJECT_STATE.md` 一致
- [x] `docs/ai/PROJECT_STATE.md` 包含 Phase 2F -> Phase 3 -> Phase 5 -> Phase 6 的统一推进路线图
- [x] 推进路线图中每个 Phase 有明确的里程碑、依赖关系和阻塞项标注

## 文件结构整理 - docs/ 根目录
- [x] `docs/` 根目录下不再有 `.docx` 文件（已移至 `docs/business-docs/`）
- [x] `docs/` 根目录下不再有 `.zip` 文件（已移至 `docs/archive/`）
- [x] `docs/PROJECT_STATE.md` 重定向文件已删除
- [x] `docs/` 根目录下仅保留必要的顶层文档（如 ACCEPTANCE_REPORT.md、API_CONTRACT.md 等需确认归属）

## 文件结构整理 - 临时脚本
- [x] `src/scripts/temp/` 下过期临时脚本已删除
- [x] 有用的临时脚本已迁移至 `src/scripts/` 并移除 TEMP 标记
- [x] `src/scripts/temp/` 目录仅保留仍在使用且未过期的临时脚本（或目录已清空）

## 文件结构整理 - .trae/documents/
- [x] `.trae/documents/` 下的规划文档已迁移至 `docs/ai/plans/` 或对应目录
- [x] 文档引用路径已更新（所有引用 `.trae/documents/` 的地方已改为新路径）

## 协作规则优化
- [x] `AGENTS.md` 明确声明了文档优先级链：`改造方案.txt` > `AGENTS.md` > `docs/ai/*.md` > `.trae/rules/*.md`
- [x] `.trae/rules/项目操作规则.md` 已精简，仅保留项目特有规则，无与 `改造方案.txt` 重复的通用协作规则
- [x] `.trae/rules/collator-handoff-audit.md` 已精简，仅保留 Phase 验收审计输出格式，无重复的角色定义
- [x] `.trae/rules/_core.md` 与 `改造方案.txt` 无矛盾

## 标准化提示词模板
- [x] `docs/ai/PROMPT_TEMPLATES.md` 已创建，包含 6 种提示词模板
- [x] GPT 新窗口启动提示词：能引导 GPT 读取 GitHub 上下文并输出标准化任务包
- [x] Trae 新窗口启动提示词：能引导 Trae 读取 AGENTS.md 并恢复完整上下文
- [x] 任务交接提示词：能引导 Trae 正确解析 GPT 任务包并开始仓库一致性检查
- [x] 审查请求提示词：能引导 GPT 对指定 PR 进行只读验收
- [x] 状态同步提示词：能实现跨窗口状态对齐
- [x] 修复包传递提示词：能引导 Trae 正确处理 GPT 的 FIX_PACKET
- [x] 每个模板有明确的占位符和使用说明
- [x] `AGENTS.md` 中引用了 PROMPT_TEMPLATES.md

## 权限与操作规范
- [x] `AGENTS.md` 中 GPT 权限边界明确（仅 GitHub 只读）
- [x] `AGENTS.md` 中 Trae 权限边界明确（GitHub + 本地文件读写）
- [x] `docs/ai/FILE_OPS_POLICY.md` 已创建，包含修改前备份、版本控制、变更记录要求
- [x] `docs/ai/SECURITY_POLICY.md` 已创建，包含防止误操作检查清单和敏感信息处理准则

## 冲突解决与决策机制
- [x] `docs/ai/REVIEW_POLICY.md` 中补充了冲突解决流程
- [x] `AGENTS.md` 中明确了决策升级路径（何时交由用户裁决）
- [x] 变更提案流程已在决策文档中明确

## 验证与一致性
- [x] 所有文档间无矛盾声明
- [x] `npm run typecheck` 通过（退出码 0）
- [x] `npm run lint` 通过（退出码 0）
- [x] `npm run test` 通过（退出码 0）
- [x] `npm run build` 通过（退出码 0）
- [x] `git diff origin/main -- src/data-cleaning` 无输出（Legacy 源码零修改）
- [x] 所有文档引用的路径在文件移动后仍然有效
