# collator 项目现状审视与优化 - Product Requirement Document

## Overview
- **Summary**: 对 collator（泽怀影像数据摄入 Agent）项目当前的功能实现、技术架构、文件结构和规则体系进行全面审视，识别存在的问题和风险点，制定系统性的优化方案，使项目符合已定义的目录规范、规则体系和最佳实践。
- **Purpose**: 当前项目在文件管理、代码组织、规则一致性、临时脚本管理等方面存在多处不符合自身规范的问题，需要通过一次系统性的整理和优化，使项目结构清晰、代码可维护、规则一致，为后续的数据摄入和业务自动化工作奠定良好基础。
- **Target Users**: 泽怀影像数据团队、使用 Trae IDE 进行数据处理的 AI Agent

## Goals
- 清理根目录散落文件，使所有文件归位到标准目录结构
- 识别并标记临时脚本，建立临时脚本的生命周期管理机制
- 检查并修复 Knowledge、Rules、Skills 之间的引用一致性问题
- 规范 src/ 目录下的代码组织（scripts/importers 分类与清理）
- 整理 public/ 目录下的静态资源（图片等）
- 验证现有 Skills 的完整性和可用性
- 确保所有文档和配置文件引用路径正确

## Non-Goals (Out of Scope)
- 不修改飞书 API 集成逻辑或业务数据处理逻辑
- 不重构核心业务代码（如数据解析、字段映射等算法）
- 不新增业务功能或表结构
- 不对历史数据进行迁移或修改
- 不升级 lark-cli 或其他依赖版本
- 不创建新的业务 SOP 文档

## Background & Context
collator 是运行在 Trae IDE 中的非结构化数据结构化摄入 Agent，采用三层知识架构：Knowledge（是什么）、Rules（怎么做）、Skills（用什么做）。项目定义了严格的文件管理规范、目录结构和操作流程。

经过多轮数据迁移、模特招募、策划案生成等任务后，项目积累了大量临时脚本、配置文件、图片资源和中间产物，部分文件散落在根目录，违反了项目自身定义的规范。同时，Knowledge 文件中引用的部分文档（如数据结构.md、数据操作规则.md）实际不存在，存在引用断裂问题。

## Functional Requirements
- **FR-1**: 根目录文件清理与归位
  - 识别根目录所有非允许文件，按类型移动到对应标准目录
  - 根目录仅保留 README.md、package.json、bin/ 等允许的构建配置
  - 处理 temp_images/ 目录，迁移至 public/ 或其他合适位置

- **FR-2**: 临时脚本识别与标记
  - 扫描 src/scripts/ 和 src/importers/ 目录
  - 识别一次性调试/迁移脚本，添加 TEMP 标记
  - 建立 src/scripts/temp/ 目录存放临时脚本
  - 区分核心可复用脚本与一次性脚本

- **FR-3**: Knowledge/Rules/Skills 一致性检查与修复
  - 检查 Knowledge 文件中引用的文档是否存在
  - 检查 Rules 文件中提及的 Skills 是否存在
  - 补全缺失的引用或更新文档移除无效引用
  - 统一文件路径引用格式（使用相对路径）

- **FR-4**: src/ 目录代码组织优化
  - 整理 src/config/ 下的配置文件，识别临时配置与核心配置
  - 清理 src/scripts/ 下的冗余脚本
  - 整理 src/importers/ 下的导入脚本
  - 检查根目录下的 .js 脚本（generate-proposal.js 等），归类到正确位置

- **FR-5**: 静态资源管理
  - 整理 docs/extracted_images/ 下的图片
  - 处理根目录 temp_images/ 下的图片
  - 确保 public/ 目录结构正确（如需要则创建）

- **FR-6**: 生成整理报告
  - 输出文件移动清单
  - 识别需要用户确认的冲突或不确定文件
  - 记录已识别的过期临时脚本，提示清理

## Non-Functional Requirements
- **NFR-1**: 安全性：所有文件移动操作前必须确认目标位置，禁止覆盖已有同名文件
- **NFR-2**: 可追溯性：生成完整的操作日志，记录每个文件的原位置和新位置
- **NFR-3**: 最小影响：整理过程不破坏任何现有功能，可通过 Git 回滚
- **NFR-4**: 规范性：整理后的目录结构严格符合 [项目总览.md](file:///d:/360Downloads/Trae%20项目/collator/.trae/Knowledge/项目总览.md) 中定义的标准
- **NFR-5**: 可验证性：整理完成后提供验证清单，用户可逐项检查

## Constraints
- **Technical**: 运行在 Windows PowerShell 环境，使用 lark-cli 作为飞书 API 工具；文件移动使用 PowerShell 命令或 Node.js/Python 脚本；必须兼容现有项目的代码风格
- **Business**: 不能影响正在进行或即将进行的业务数据处理任务；所有核心配置（Base Token、Space ID 等）必须保持不变
- **Dependencies**: 依赖项目现有的 collator-file-ops skill；依赖 Git 进行版本控制和回滚

## Assumptions
- 项目已使用 Git 进行版本控制，整理前可以提交一次备份
- 用户可以接受临时脚本统一标记并管理生命周期
- 部分缺失的引用文档（如数据结构.md）暂时不需要创建，只需在文档中注明状态
- 根目录下的 Word 文档（策划案相关）属于业务文档，应移动到 docs/ 下对应目录

## Acceptance Criteria

### AC-1: 根目录规范合规
- **Given**: 项目根目录存在散落文件
- **When**: 执行文件整理后
- **Then**: 根目录仅包含 .trae/、bin/、docs/、src/、public/、README.md、package.json 等允许项，无其他散落文件
- **Verification**: `programmatic`
- **Notes**: 使用 `Get-ChildItem` 列出根目录文件并验证

### AC-2: 临时脚本正确标记和存放
- **Given**: src/scripts/ 和 src/importers/ 下存在一次性脚本
- **When**: 完成临时脚本识别和整理后
- **Then**: 所有临时脚本都带有 TEMP 标记并存放在 src/scripts/temp/ 目录下，核心可复用脚本保留在原位置并清晰分类
- **Verification**: `human-judgment`
- **Notes**: 需人工判断哪些是核心脚本哪些是临时脚本

### AC-3: Knowledge/Rules/Skills 引用一致
- **Given**: Knowledge 和 Rules 文件中存在文档引用
- **When**: 完成一致性检查后
- **Then**: 所有内部文档引用路径正确，不存在指向不存在文件的链接；对于确实缺失的文件，在文档中明确标注状态
- **Verification**: `programmatic`
- **Notes**: 通过检查文件存在性验证

### AC-4: 目录结构符合标准
- **Given**: 完成所有文件移动后
- **When**: 检查项目目录结构
- **Then**: 文件严格按 [项目总览.md](file:///d:/360Downloads/Trae%20项目/collator/.trae/Knowledge/项目总览.md) 的映射规则存放：代码→src/、文档→docs/、资源→public/、配置→.trae/
- **Verification**: `programmatic` + `human-judgment`

### AC-5: 操作日志完整可追溯
- **Given**: 文件整理操作执行
- **When**: 整理完成后
- **Then**: 生成一份完整的整理报告，包含每个移动文件的原路径、新路径、移动原因，以及需要用户手动处理的文件清单
- **Verification**: `human-judgment`

### AC-6: 现有功能不受影响
- **Given**: 完成文件整理
- **When**: 检查核心 Skills 和配置文件
- **Then**: 所有 Skill 文件路径正确，核心配置文件（如 Base Token）可正常访问，lark-cli 可正常调用
- **Verification**: `programmatic`

## Open Questions
- [ ] 根目录下的 Word 文档（策划案.docx、策划案一.docx、策划案二.docx、策划案模板.docx、摄影拍摄前全流程核对清单.docx 等）是保留为业务文档归档到 docs/，还是属于临时产物可以清理？
- [ ] src/importers/ 下的脚本（import_models.js、import_studios.js 等）是历史一次性脚本还是需要保留为可复用工具？
- [ ] temp_images/ 下的小红书图片是临时缓存还是需要保留归档？
- [ ] 是否需要创建 public/ 目录来存放图片资源？
- [ ] Knowledge 中提到但不存在的文件（数据结构.md、数据操作规则.md、飞书操作规则.md）是需要补全还是更新引用？
