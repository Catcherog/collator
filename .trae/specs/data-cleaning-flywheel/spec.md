# 数据清洗与数据飞轮 - Product Requirement Document

## Overview

* **Summary**: 为collator项目实现模块化的数据清洗引擎和数据飞轮闭环系统，将现有的文档化规则（解析模板、业务约束、歧义消解）转化为可执行代码，建立"数据摄入→清洗验证→写入反馈→规则迭代"的自优化闭环。

* **Purpose**: 解决当前项目中数据处理逻辑分散在临时脚本中、规则无法自动迭代、错误数据无法自动发现和修正的问题，提升数据质量和系统智能化程度。

* **Target Users**: 泽怀影像工作室数据运营人员、AI Agent自身（自动化规则优化）。

## Goals

* 实现可复用的数据清洗模块，支持格式校验、类型转换、去重、枚举值匹配等通用清洗能力

* 建立数据质量评分体系，对每条入库数据进行质量量化评估

* 实现数据飞轮闭环：错误检测→人工/自动修正→规则更新→下次处理更准确

* 沉淀同义词库、歧义映射、清洗规则的可配置化管理

* 提供数据质量报告和规则迭代建议

## Non-Goals (Out of Scope)

* 不实现前端可视化界面（通过日志和飞书表格展示）

* 不替代现有的lark-cli Skills体系，而是在其上层提供清洗和质量保障

* 不实现机器学习模型训练（规则引擎基于规则和统计，不涉及AI模型训练）

* 不修改飞书侧表结构（只读+写入，不改schema）

## Background & Context

* 项目已有完善的文档化规范：[data-parsing-templates.md](file:///d:/360Downloads/Trae%20项目/collator/docs/guides/data-parsing-templates.md)定义了标准化中间结构、置信度体系、6种数据源解析模板

* [business-rules-library.md](file:///d:/360Downloads/Trae%20项目/collator/docs/guides/business-rules-library.md)定义了5大约束体系和7张核心表字段映射

* 现有代码以一次性临时脚本为主（`src/scripts/temp/`下70+个文件），缺少模块化复用

* 飞书API技术坑点已在[飞书API技术要点.md](file:///d:/360Downloads/Trae%20项目/collator/.trae/knowledge/飞书API技术要点.md)中沉淀，但未代码化

* 已有成功的CSV导入经验在[数据摄入实践经验.md](file:///d:/360Downloads/Trae%20项目/collator/.trae/knowledge/数据摄入实践经验.md)中，包含标准化SOP模板

## Functional Requirements

* **FR-1**: 通用数据清洗引擎 - 提供可配置的清洗管道，支持格式标准化、去重、类型转换、空值处理

* **FR-2**: 业务规则校验器 - 基于7张核心表的schema定义，实现字段约束、枚举校验、逻辑一致性检查

* **FR-3**: 数据质量评分 - 对每条待写入数据计算0-100分质量分，标记问题字段和改进建议

* **FR-4**: 错误数据检测与回流 - 自动检测已入库数据中的异常值、格式不一致、逻辑矛盾，生成问题清单

* **FR-5**: 同义词/映射规则自学习 - 从用户修正历史中自动提取新的同义词、枚举映射、格式规则

* **FR-6**: 清洗规则配置化 - 支持通过JSON配置文件定义清洗规则，无需修改代码

* **FR-7**: 数据质量报告 - 生成批次数据质量报告，包含通过率、问题分布、规则命中率统计

* **FR-8**: 飞轮操作日志 - 记录所有清洗、修正、规则更新操作，支持追溯

## Non-Functional Requirements

* **NFR-1**: 性能 - 单条数据清洗+校验<10ms，支持批量处理1000条/分钟

* **NFR-2**: 可靠性 - 清洗失败不阻塞主流程，降级为"仅标记不修正"模式

* **NFR-3**: 可扩展性 - 新增表/字段只需更新配置，无需修改核心代码

* **NFR-4**: 可追溯性 - 所有数据修改（自动修正+人工修正）都留痕，记录修改前后值和原因

* **NFR-5**: 兼容性 - 与现有lark-cli调用方式兼容，输出格式符合现有中间数据结构规范

## Constraints

* **Technical**: Node.js/JavaScript（与现有docx包和脚本生态一致），Windows PowerShell环境，使用相对路径JSON文件传递数据

* **Business**: 严格遵循7张核心表现有字段定义，不自动新增字段；批量删除禁令继续生效

* **Dependencies**: lark-cli（飞书API调用）、现有Skills体系、飞书多维表作为规则和日志的存储

## Assumptions

* 7张核心表的字段ID和枚举值相对稳定，schema变更频率低

* 用户愿意对低置信度数据进行人工确认和修正

* 飞书API限流策略保持不变（电子表格20次/分钟创建，100次/秒操作）

* Node.js环境已安装（npm包可用）

## Acceptance Criteria

### AC-1: 清洗引擎能处理标准输入数据

* **Given**: 一条符合中间JSON结构的客户咨询解析数据

* **When**: 通过清洗引擎处理

* **Then**: 输出标准化后的数据，包含清洗后的字段值、质量分、修正记录

* **Verification**: `programmatic`

* **Notes**: 手机号自动去横杠、日期自动标准化、枚举值自动映射

### AC-2: 业务规则校验能拦截违规数据

* **Given**: 一条缺少必填字段（手机号）的数据

* **When**: 通过校验器

* **Then**: 标记为"不可写入"，列出缺失字段和修复建议

* **Verification**: `programmatic`

### AC-3: 枚举值模糊匹配能识别同义词

* **Given**: 意向风格字段值为"小清新"

* **When**: 同义词匹配

* **Then**: 自动映射为"日系清新"，置信度0.9，记录映射来源

* **Verification**: `programmatic`

### AC-4: 数据质量评分合理反映问题

* **Given**: 一条数据包含手机号格式错误+非标准枚举值+1个可选字段缺失

* **When**: 计算质量分

* **Then**: 质量分在50-70区间，明确列出扣分项

* **Verification**: `programmatic`

### AC-5: 错误数据回流能发现已入库问题

* **Given**: 飞书表中存在格式不一致的手机号（带横杠、空格）

* **When**: 执行数据质量扫描

* **Then**: 生成问题记录清单，包含记录ID、问题类型、建议修正值

* **Verification**: `programmatic`

### AC-6: 用户修正能更新同义词库

* **Given**: 用户将"森系"确认为"日系清新"的同义词

* **When**: 提交修正反馈

* **Then**: 同义词库配置自动更新，下次处理"森系"时能自动映射

* **Verification**: `programmatic`

### AC-7: 批量数据生成质量报告

* **Given**: 20条待批量导入的数据

* **When**: 执行批量清洗校验

* **Then**: 生成报告包含：总条数、通过率、问题分布、各字段错误率

* **Verification**: `programmatic`

### AC-8: 所有操作留痕可追溯

* **Given**: 任意一次清洗或规则更新操作

* **When**: 查询操作日志

* **Then**: 能查到操作时间、操作类型、修改前后值、触发原因

* **Verification**: `programmatic`

### AC-9: 代码结构模块化可复用

* **Given**: 新的表需要接入清洗

* **When**: 新增该表的schema配置

* **Then**: 无需修改核心清洗代码即可支持新表校验

* **Verification**: `human-judgment`

### AC-10: 与现有系统兼容

* **Given**: 现有的数据解析流程

* **When**: 接入清洗引擎

* **Then**: 不破坏现有工作流，可作为可选环节插入

* **Verification**: `human-judgment`

## Open Questions

* [ ] 规则和同义词库存储在哪里？（本地JSON文件 vs 飞书多维表）

* [ ] 自动修正的阈值是多少？（置信度>多少可以自动修正而无需确认）

* [ ] 数据质量扫描的触发方式？（定时任务 vs 手动触发）

* [ ] 是否需要对历史全量数据做一次性清洗？

