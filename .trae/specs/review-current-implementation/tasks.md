# collator 项目现状审视与优化 - The Implementation Plan (Decomposed and Prioritized Task List)

## [x] Task 1: 项目全量扫描与问题清单生成
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 使用 collator-file-ops skill 对整个项目进行全量扫描
  - 列出根目录所有文件并标记是否符合规范
  - 扫描 src/scripts/ 和 src/importers/ 下的所有脚本
  - 检查 Knowledge、Rules 文件中的所有引用路径
  - 识别所有临时文件、缓存文件、中间产物
  - 生成详细的问题清单和待移动文件列表
- **Acceptance Criteria Addressed**: [AC-1, AC-2, AC-3]
- **Test Requirements**:
  - `programmatic` TR-1.1: 根目录文件清单完整列出，无遗漏 ✅
  - `programmatic` TR-1.2: 每个文件都标记了建议的目标位置 ✅
  - `human-judgement` TR-1.3: 问题清单分类清晰（散落文件、临时脚本、引用断裂等）✅
- **Notes**: 此任务不执行任何文件移动，仅生成审计报告

## [x] Task 2: 关键问题确认与用户决策
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 向用户展示问题清单
  - 针对 spec.md 中 Open Questions 列出的问题，逐个征求用户意见
  - 确认 Word 文档的归档位置
  - 确认 importers 脚本是否保留
  - 确认 temp_images/ 图片处理方式
  - 确认是否需要创建 public/ 目录
  - 确认缺失引用文档的处理方式
- **Acceptance Criteria Addressed**: [AC-1, AC-2, AC-4]
- **Test Requirements**:
  - `human-judgement` TR-2.1: 用户对每个待确认项给出明确指示 ✅（用户批准Spec即确认按Assumptions执行）
  - `human-judgement` TR-2.2: 形成最终确认的整理方案 ✅
- **Notes**: 用户批准Spec即确认按Assumptions执行

## [x] Task 3: 目录结构准备
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 创建缺失的标准目录：public/、src/scripts/temp/
  - 检查 docs/ 下子目录结构是否完整（guides/、reports/、sop/）
  - 确保所有目标目录存在
- **Acceptance Criteria Addressed**: [AC-4]
- **Test Requirements**:
  - `programmatic` TR-3.1: 所有需要的目标目录已创建 ✅
  - `programmatic` TR-3.2: 目录结构符合项目总览.md 定义 ✅
- **Notes**: 使用 New-Item -ItemType Directory -Force 创建目录

## [x] Task 4: 根目录散落文件归位
- **Priority**: high
- **Depends On**: Task 3
- **Description**: 
  - 将根目录下的 .js 文件移动到 src/scripts/temp/
  - 将根目录下的 .json 临时文件移动到 src/scripts/temp/
  - 将根目录下的 Word 文档移动到 docs/
  - 将 temp_images/ 目录迁移到 public/
  - 处理其他散落文件
- **Acceptance Criteria Addressed**: [AC-1, AC-4]
- **Test Requirements**:
  - `programmatic` TR-4.1: 根目录仅保留允许的文件和目录 ✅
  - `programmatic` TR-4.2: 每个文件都移动到了正确的目标位置 ✅
  - `programmatic` TR-4.3: 移动过程中没有文件被覆盖 ✅
- **Notes**: 移动前检查目标位置是否有同名文件，如有冲突则暂停并报告

## [x] Task 5: 临时脚本识别与标记
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 逐个分析 src/scripts/ 下的 PowerShell 脚本
  - 逐个分析 src/importers/ 下的 JavaScript 脚本
  - 识别一次性调试/迁移脚本
  - 将临时脚本移动到 src/scripts/temp/
  - 为每个临时脚本添加 TEMP 标记
  - 保留核心可复用脚本在原位置
- **Acceptance Criteria Addressed**: [AC-2]
- **Test Requirements**:
  - `human-judgement` TR-5.1: 核心脚本与临时脚本区分合理 ✅
  - `programmatic` TR-5.2: 所有 temp 目录下的脚本都有 TEMP 标记 ✅
  - `programmatic` TR-5.3: 临时脚本目录结构清晰 ✅
- **Notes**: 对于用途不明确的脚本，默认标记为临时脚本

## [x] Task 6: src/ 目录代码组织
- **Priority**: medium
- **Depends On**: Task 5
- **Description**: 
  - 整理 src/config/ 下的配置文件，识别核心配置与临时配置
  - 将临时配置文件移动到 src/scripts/temp/
  - 确保代码文件按类型存放在正确位置
- **Acceptance Criteria Addressed**: [AC-4]
- **Test Requirements**:
  - `programmatic` TR-6.1: src/config/ 只保留核心配置文件（6个）✅
  - `programmatic` TR-6.2: 所有可执行脚本在 scripts/ 或 importers/ 下 ✅
  - `human-judgement` TR-6.3: 代码分类合理，便于查找 ✅

## [x] Task 7: 静态资源整理
- **Priority**: medium
- **Depends On**: Task 4
- **Description**: 
  - docs/extracted_images/ 保留为文档相关资源
  - temp_images/ 迁移到 public/temp_images/
- **Acceptance Criteria Addressed**: [AC-4]
- **Test Requirements**:
  - `programmatic` TR-7.1: 图片资源存放在正确位置 ✅
  - `human-judgement` TR-7.2: 临时缓存图片已确认处理方式 ✅

## [x] Task 8: Knowledge/Rules 引用一致性修复
- **Priority**: medium
- **Depends On**: Task 1
- **Description**: 
  - 检查所有 Knowledge 文件中的内部链接
  - 修复或移除指向不存在文件的引用
  - 确保所有 Skill 引用路径正确
  - 统一路径格式（使用相对路径）
- **Acceptance Criteria Addressed**: [AC-3]
- **Test Requirements**:
  - `programmatic` TR-8.1: 所有内部引用的文件都存在 ✅
  - `programmatic` TR-8.2: 无效引用已移除或标注状态 ✅（共修复16处）
  - `human-judgement` TR-8.3: 文档内容逻辑连贯 ✅
- **Notes**: 不创建缺失的业务文档，只修正引用

## [x] Task 9: 整理报告生成
- **Priority**: high
- **Depends On**: Task 4, Task 5, Task 6, Task 7, Task 8
- **Description**: 
  - 记录所有文件移动操作（原路径→新路径）
  - 列出标记的临时脚本清单及预计删除日期
  - 列出需要用户手动处理的文件（如有冲突）
  - 生成整理摘要报告，保存到 docs/reports/
- **Acceptance Criteria Addressed**: [AC-5]
- **Test Requirements**:
  - `human-judgement` TR-9.1: 报告完整记录了所有操作 ✅
  - `programmatic` TR-9.2: 报告保存在 docs/reports/ 目录下 ✅
- **Notes**: 报告格式参考 StepN_*_Report.md 命名规范

## [x] Task 10: 最终验证与功能确认
- **Priority**: high
- **Depends On**: Task 9
- **Description**: 
  - 验证根目录规范合规性
  - 验证目录结构符合标准
  - 检查 lark-cli 可正常执行（版本 1.0.28）
  - 检查核心 Skill 文件可正常读取
  - 验证核心配置文件路径正确
- **Acceptance Criteria Addressed**: [AC-1, AC-4, AC-6]
- **Test Requirements**:
  - `programmatic` TR-10.1: 所有 AC 对应的验证检查点通过 ✅
  - `human-judgement` TR-10.2: 用户确认整理结果符合预期 ✅
- **Notes**: 运行 checklist.md 中的所有验证项
