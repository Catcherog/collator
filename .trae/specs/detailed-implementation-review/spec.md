# collator 项目功能实现与技术原理深度审查 - Product Requirement Document

## Overview
- **Summary**: 对 collator（泽怀影像数据摄入Agent）项目进行全面的功能实现审查和技术原理深度分析，包括6大核心模块（数据清洗引擎、质量评分系统、操作日志、规则自学习、数据扫描器、批量处理器）和3大多模态模块（OCR、ASR、CLIP）的架构设计、数据流、核心算法、设计模式进行系统性审查，并识别技术债务、潜在问题和优化方向。
- **Purpose**: 建立完整的技术认知基线，识别现有实现中的架构优势、技术风险、代码质量问题，为后续迭代提供技术决策依据。
- **Target Users**: 项目维护者、技术负责人、后续开发人员。

## Goals
- 系统性梳理所有已实现模块的功能边界和技术实现细节
- 分析核心算法原理（清洗管道、枚举映射、质量评分、模糊匹配、去重算法）
- 审查设计模式应用（管道模式、适配器模式、工厂模式、单例缓存）
- 识别技术债务、潜在Bug、性能瓶颈
- 评估测试覆盖完整性
- 提出优化建议和重构方向
- 建立完整的技术文档基线

## Non-Goals (Out of Scope)
- 不进行实际代码重构或功能修改
- 不新增业务功能
- 不进行飞书API的实际调用测试
- 不修改现有的7张业务表结构
- 不部署或上线系统
- 不编写新的测试用例（仅审查现有测试）

## Background & Context

### 项目现状
collator 是泽怀影像工作室的非结构化数据结构化摄入Agent，运行在 Trae IDE 中。经过多轮迭代，已构建了完整的数据处理引擎：

- **版本**: v1.1.0（主入口导出版本）
- **核心依赖**: docx ^9.7.1（Word文档处理），lark-cli（飞书API命令行工具）
- **代码规模**: src/data-cleaning/ 目录下包含 6 个核心模块 + 3 个多模态模块 + 7 个表Schema定义
- **已实现功能**:
  1. 4步数据清洗管道（NullToEmpty → Format → EnumMapping → DefaultValue）
  2. 0-100分数据质量评分系统（5维权重：必填完整性40%、格式25%、枚举20%、逻辑10%、置信度5%）
  3. 枚举值同义词模糊匹配（精确匹配→包含匹配→同义词库→模糊风格匹配→拍摄类型映射）
  4. 规则自学习与反馈闭环（用户反馈记录→同义词自动推荐→版本备份与回滚）
  5. 飞书多维表数据扫描器（分页拉取→增量扫描→问题定位→修复建议生成）
  6. 批量处理引擎（分批处理≤200条/批→进度回调→报告生成→可写记录分区）
  7. 多模态预处理（OCR/ASR/CLIP适配器模式，支持降级和mock）
  8. 去重算法（字段模糊匹配+唯一字段精确匹配，加权相似度计算）
  9. 操作日志JSONL持久化（按日期分文件、规则变更独立日志）
  10. 7张业务表Schema定义（customer/project/product/resource/material/research/sop）

### 技术架构分层
```
┌─────────────────────────────────────────────────────────┐
│  入口层 (index.js)                                       │
│  init() → 懒加载配置/Schema → 导出统一API                 │
├─────────────────────────────────────────────────────────┤
│  核心引擎层 (core/)                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │DataCleaner│ │QualityScorer│ │OperationLogger│ │RuleLearner│  │
│  │(管道模式) │ │(加权扣分) │ │(JSONL日志)│ │(自学习)  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐                              │
│  │DataScanner│ │BatchProcessor│                           │
│  │(飞书扫描) │ │(批量处理) │                              │
│  └──────────┘ └──────────┘                              │
├─────────────────────────────────────────────────────────┤
│  多模态层 (multimodal/)                                 │
│  ┌───────┐  ┌───────┐  ┌───────┐                        │
│  │  OCR  │  │  ASR  │  │ CLIP  │  (适配器模式+降级)      │
│  │Tesseract│ │Whisper│ │Python │                        │
│  │飞书OCR │ │飞书妙记│ │Bridge │                        │
│  └───────┘  └───────┘  └───────┘                        │
├─────────────────────────────────────────────────────────┤
│  规则验证层 (rules/)                                    │
│  validateField → validateRequiredFields →               │
│  validateStateTransition → validateLogicConsistency →   │
│  validateRecord                                         │
├─────────────────────────────────────────────────────────┤
│  Schema层 (schemas/)                                    │
│  7张表JSON定义 → 字段类型/枚举值/必填标记/tableId映射     │
├─────────────────────────────────────────────────────────┤
│  工具层 (utils/)                                        │
│  手机号/URL/日期/预算/字符串标准化 + 模糊匹配函数         │
├─────────────────────────────────────────────────────────┤
│  配置层 (config/)                                       │
│  cleaning-rules.json + synonyms.json + 版本历史          │
└─────────────────────────────────────────────────────────┘
```

### 关键设计决策回顾
1. **管道模式（CleaningPipeline）**: 将清洗步骤拆分为独立Cleaner类，支持灵活组合
2. **适配器模式（OCR/ASR/CLIP）**: 统一接口封装多种后端，支持自动降级和mock测试
3. **加权扣分制（QualityScorer）**: 不同错误类型扣不同分数，必填字段按比例扣分
4. **原子写入（RuleLearner）**: 配置更新使用tmp→bak→rename保证一致性
5. **置信度分级（EnumMappingCleaner）**: ≥0.85自动修正，0.5-0.85警告建议，<0.5忽略
6. **JSONL日志**: 追加写入性能好，按日期分文件便于归档
7. **临时文件API调用**: PowerShell下通过临时文件传递JSON数据避免参数转义问题

## Functional Requirements

- **FR-1**: 核心模块架构审查 - 审查6大核心模块的类设计、职责划分、依赖关系
- **FR-2**: 数据清洗管道审查 - 分析4步清洗流程（NullToEmpty/Format/EnumMapping/DefaultValue）的算法正确性
- **FR-3**: 枚举匹配算法审查 - 分析同义词映射、模糊匹配、置信度计算逻辑
- **FR-4**: 质量评分系统审查 - 分析5维权重计算、扣分规则、分级建议逻辑
- **FR-5**: 去重算法审查 - 分析字段相似度计算、加权平均、阈值判定逻辑
- **FR-6**: 规则自学习机制审查 - 分析反馈收集、同义词推荐、版本备份与回滚机制
- **FR-7**: 多模态模块审查 - 分析OCR/ASR/CLIP适配器模式、降级策略、Python桥接实现
- **FR-8**: Schema与验证层审查 - 分析7张表定义、字段验证规则、逻辑一致性校验
- **FR-9**: 批量处理器审查 - 分析分批策略、进度回调、报告生成、分区输出逻辑
- **FR-10**: 数据扫描器审查 - 分析飞书API分页、增量扫描、修复建议生成逻辑
- **FR-11**: 工具函数审查 - 分析手机号/日期/URL/预算标准化、字符串处理函数
- **FR-12**: 测试覆盖审查 - 分析所有test-*.js文件的测试场景、断言覆盖、边界情况
- **FR-13**: 错误处理与健壮性审查 - 分析异常捕获、降级策略、边界情况处理
- **FR-14**: 性能分析 - 识别潜在性能瓶颈（循环嵌套、大数组操作、同步IO）
- **FR-15**: 技术债务识别 - 识别代码重复、魔法数字、未完成功能、临时目录残留

## Non-Functional Requirements

- **NFR-1**: 审查深度 - 每个核心函数需分析输入输出、核心算法、时间复杂度、边界情况
- **NFR-2**: 代码引用 - 所有审查结论必须附带具体代码位置引用（文件+行号）
- **NFR-3**: 可操作性 - 发现的问题需按严重程度分级（Critical/High/Medium/Low）并给出具体修复建议
- **NFR-4**: 完整性 - 覆盖src/data-cleaning/目录下所有.js文件（不含node_modules和temp）
- **NFR-5**: 客观性 - 基于代码事实分析，不主观臆断；对设计权衡需明确说明Pros/Cons

## Constraints

- **Technical**:
  - 运行环境: Windows + PowerShell 5 + Node.js + Python 3（CLIP需要）
  - 仅使用原生Node.js模块（fs/path/child_process），除docx外无第三方npm依赖
  - lark-cli通过bin/lark-cli.exe调用，飞书API需用户认证
  - PowerShell 5 不支持 `&&`，JSON传递需用临时文件
- **Business**:
  - 必须严格兼容现有7张飞书多维表结构
  - 业务规则基于docs/guides/business-rules-library.md的5大约束体系
  - 摄影工作室业务场景（客户咨询/订单/拍摄/模特/作品发布）
- **Dependencies**:
  - 外部: 飞书开放平台API、lark-cli、Tesseract OCR、Whisper ASR、Python CLIP
  - 内部: .trae/Knowledge/、.trae/skills/、docs/guides/下的文档

## Assumptions

- 现有代码已通过基本功能测试（根据历史记录9个测试套件409个断言全部通过）
- 多模态模块的mock模式是主要测试路径，真实后端（Tesseract/Whisper/CLIP）可能未完整集成
- synonyms.json 和 cleaning-rules.json 已包含业务初始化数据
- src/scripts/temp/下70+临时脚本为历史操作遗留，不影响核心模块
- logs-test/、example-learning/目录为测试产生的临时数据

## Acceptance Criteria

### AC-1: 核心模块架构文档化
- **Given**: 已读取所有core/目录下的模块文件
- **When**: 完成架构审查
- **Then**: 每个模块输出包含：类图、核心方法列表、依赖关系图、设计模式分析
- **Verification**: `programmatic` + `human-judgment`
- **Notes**: 需说明每个Cleaner类的单一职责是否满足

### AC-2: 清洗管道算法正确性验证
- **Given**: 已读取data-cleaner.js完整代码
- **When**: 分析管道执行流程
- **Then**: 输出4步清洗的执行顺序、数据传递方式、错误隔离机制、每步的输入输出示例
- **Verification**: `human-judgment`

### AC-3: 枚举匹配分级逻辑准确性
- **Given**: 已读取EnumMappingCleaner.matchEnumValue代码
- **When**: 追踪匹配逻辑分支
- **Then**: 明确列出5级匹配优先级（精确→包含→同义词→风格映射→拍摄类型映射）及其置信度阈值
- **Verification**: `programmatic`

### AC-4: 质量评分公式可复现
- **Given**: 已读取quality-scorer.js完整代码
- **When**: 推导评分公式
- **Then**: 输出完整评分公式、权重表、错误扣分映射表、等级划分阈值（90/70/50）
- **Verification**: `programmatic`

### AC-5: 去重算法分析
- **Given**: 已读取deduplicate和calculateStringSimilarity代码
- **When**: 分析相似度计算
- **Then**: 输出字符匹配算法原理、阈值含义、去重判定流程、潜在误判/漏判场景
- **Verification**: `human-judgment`

### AC-6: 规则学习闭环完整性
- **Given**: 已读取rule-learning.js完整代码
- **When**: 追踪反馈→推荐→应用→回滚全流程
- **Then**: 输出闭环流程图、原子写入机制分析、版本备份策略、反馈聚合算法
- **Verification**: `human-judgment`

### AC-7: 多模态适配器审查
- **Given**: 已读取ocr/、asr/、clip/目录下所有适配器代码
- **When**: 分析适配器模式实现
- **Then**: 输出每个模态的接口定义、适配器列表、降级策略、Python桥接实现方式
- **Verification**: `human-judgment`

### AC-8: Schema与验证规则完整性
- **Given**: 已读取schemas/下7个JSON和rules/index.js
- **When**: 审查字段定义和验证逻辑
- **Then**: 输出7张表的字段统计、支持的字段类型列表、逻辑一致性校验规则清单
- **Verification**: `programmatic`

### AC-9: 问题清单分级
- **Given**: 完成所有代码审查
- **When**: 汇总发现的问题
- **Then**: 按Critical/High/Medium/Low四级输出问题清单，每个问题包含：位置、描述、影响、修复建议
- **Verification**: `human-judgment`

### AC-10: 优化建议可执行
- **Given**: 完成性能和架构分析
- **When**: 提出优化方向
- **Then**: 每条建议包含：现状、问题、改进方案、预期收益、实施难度评估
- **Verification**: `human-judgment`

### AC-11: 测试覆盖缺口分析
- **Given**: 已读取所有test-*.js文件
- **When**: 对比功能点与测试用例
- **Then**: 输出测试覆盖矩阵，标识未覆盖的功能点和边界场景
- **Verification**: `programmatic`

## Open Questions

- [ ] Tesseract OCR和Whisper ASR的真实适配器是否已实际安装测试？还是仅有mock实现？
- [ ] Python CLIP桥接的依赖环境（torch/transformers/PIL）是否已配置？
- [ ] cleaning-rules.json中是否已配置完整的去重规则（deduplicationRules）？
- [ ] DataScanner的飞书API写入功能是否已实现？还是仅有扫描能力？
- [ ] 状态机验证（validateStateTransition）是否有对应的状态机配置数据？
- [ ] 70+个临时脚本是否有归档计划？是否有需要保留的实用脚本？
