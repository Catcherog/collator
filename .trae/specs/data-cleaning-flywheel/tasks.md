# 数据清洗与数据飞轮 - The Implementation Plan (Decomposed and Prioritized Task List)

## [ ] Task 1: 项目结构搭建与核心配置文件定义
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 在src/下创建data-cleaning模块目录结构
  - 定义7张核心表的schema配置（字段类型、必填项、枚举值、关联关系）
  - 创建初始同义词库配置（从data-parsing-templates.md提取现有风格/类型同义词）
  - 创建清洗规则配置文件
  - 定义统一的模块入口和导出结构
- **Acceptance Criteria Addressed**: [AC-9, AC-10]
- **Test Requirements**:
  - `programmatic` TR-1.1: 目录结构符合src/data-cleaning/{core,rules,schemas,utils}规范
  - `programmatic` TR-1.2: 7张表的schema配置文件存在且JSON格式合法
  - `programmatic` TR-1.3: 同义词库包含至少6种风格的同义词（日系清新、韩系唯美等）
  - `human-judgement` TR-1.4: 配置结构清晰，易于理解和扩展
- **Notes**: 参考business-rules-library.md中的字段定义

## [ ] Task 2: 通用工具函数实现
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 实现手机号格式化（去横杠/空格、校验11位数字）
  - 实现日期解析与标准化（支持"今天"、"明天"、"X号"等自然语言）
  - 实现金额区间归一化（"2000多"、"两三千"等→标准区间）
  - 实现字符串标准化（trim、全角转半角、统一大小写）
  - 实现日志工具（带时间戳、支持级别控制）
- **Acceptance Criteria Addressed**: [AC-1]
- **Test Requirements**:
  - `programmatic` TR-2.1: "137-6666-8888" → "13766668888" 格式化正确
  - `programmatic` TR-2.2: "今天"能正确解析为当前日期（格式YYYY-MM-DD）
  - `programmatic` TR-2.3: "2000多" → "2000-3000元" 归一化正确
  - `programmatic` TR-2.4: 全角字符和多余空格能正确清理
  - `programmatic` TR-2.5: 所有工具函数有单元测试覆盖

## [ ] Task 3: 核心清洗引擎实现
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 实现清洗管道（Pipeline）架构：输入数据→串联执行多个清洗器→输出结果
  - 实现格式清洗器（调用Task2的工具函数）
  - 实现枚举值映射清洗器（支持同义词匹配）
  - 实现去重清洗器（基于手机号/主键判断重复）
  - 实现空值/默认值填充清洗器
  - 支持自动修正记录（记录original→corrected和原因）
- **Acceptance Criteria Addressed**: [AC-1, AC-3]
- **Test Requirements**:
  - `programmatic` TR-3.1: 管道能按顺序执行多个清洗步骤
  - `programmatic` TR-3.2: "小清新" → "日系清新" 同义词映射正确
  - `programmatic` TR-3.3: 清洗结果包含corrections数组记录所有修改
  - `programmatic` TR-3.4: 清洗失败不抛出异常，降级为标记问题
  - `programmatic` TR-3.5: 单条数据处理时间<10ms

## [ ] Task 4: 业务规则校验器实现
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 实现必填字段校验器
  - 实现字段类型校验器（字符串、数字、日期、单选/多选枚举）
  - 实现枚举值合法性校验器
  - 实现跨字段逻辑一致性校验（如拍摄日期≥咨询日期）
  - 实现外键关联校验（关联记录是否存在）
  - 输出标准化的校验结果（passed/warning/failed + 错误列表）
- **Acceptance Criteria Addressed**: [AC-2]
- **Test Requirements**:
  - `programmatic` TR-4.1: 缺失必填字段时返回failed状态和缺失字段列表
  - `programmatic` TR-4.2: 枚举值不在允许列表中返回warning
  - `programmatic` TR-4.3: 日期逻辑矛盾（拍摄日期早于咨询日期）能检测到
  - `programmatic` TR-4.4: 校验结果格式统一（errors/warnings数组结构）

## [ ] Task 5: 数据质量评分系统
- **Priority**: high
- **Depends On**: Task 3, Task 4
- **Description**: 
  - 设计评分规则：必填字段完整度、格式正确性、枚举合法度、置信度加权
  - 实现0-100分质量分计算
  - 实现质量等级划分（≥90优、70-89良、50-69中、<50差）
  - 生成扣分明细（每个问题扣多少分、原因）
  - 给出改进建议
- **Acceptance Criteria Addressed**: [AC-4]
- **Test Requirements**:
  - `programmatic` TR-5.1: 完整合法数据质量分≥90
  - `programmatic` TR-5.2: 包含手机号错误+非法枚举+可选字段缺失的数据得分在50-70区间
  - `programmatic` TR-5.3: 扣分明细能对应到具体字段和问题类型
  - `programmatic` TR-5.4: 每个问题都有对应的改进建议文本

## [ ] Task 6: 操作日志与修正记录模块
- **Priority**: medium
- **Depends On**: Task 3
- **Description**: 
  - 定义操作日志结构（时间、操作类型、表名、记录ID、字段、原值、新值、原因、操作人）
  - 实现日志追加写入（本地JSONL文件或飞书表）
  - 实现日志查询接口
  - 支持按表名、记录ID、时间范围筛选日志
- **Acceptance Criteria Addressed**: [AC-8]
- **Test Requirements**:
  - `programmatic` TR-6.1: 每次清洗修正都产生日志条目
  - `programmatic` TR-6.2: 日志包含所有必要字段（原值、新值、原因等）
  - `programmatic` TR-6.3: 能按记录ID查询该条数据的所有历史修改
  - `programmatic` TR-6.4: 日志文件追加写入不破坏历史记录

## [ ] Task 7: 同义词库与规则自学习模块
- **Priority**: medium
- **Depends On**: Task 6
- **Description**: 
  - 实现同义词库的加载和保存（从配置文件读取，支持动态更新）
  - 实现用户反馈接口：接收"原始值→正确值"的修正对
  - 实现同义词推荐逻辑：当某个原始值被多次修正为同一目标值时，自动建议加入同义词库
  - 实现规则版本管理：记录同义词库变更历史
- **Acceptance Criteria Addressed**: [AC-6]
- **Test Requirements**:
  - `programmatic` TR-7.1: 提交"森系"→"日系清新"后，同义词库能持久化保存
  - `programmatic` TR-7.2: 同一修正出现≥3次时标记为"建议自动添加"
  - `programmatic` TR-7.3: 同义词库变更有版本记录可回滚
  - `programmatic` TR-7.4: 下次处理"森系"时能自动映射（需先确认阈值）

## [ ] Task 8: 数据质量扫描与错误回流
- **Priority**: medium
- **Depends On**: Task 4, Task 6
- **Description**: 
  - 实现飞书表数据拉取（支持指定表、指定视图、分页）
  - 实现存量数据扫描：对已入库数据运行清洗校验规则
  - 生成问题清单（记录ID、问题类型、问题描述、建议修正值）
  - 支持批量修正预览和确认
  - 实现增量扫描（只扫描上次扫描后新增/修改的数据）
- **Acceptance Criteria Addressed**: [AC-5]
- **Test Requirements**:
  - `programmatic` TR-8.1: 能正确拉取指定表的数据并分页处理
  - `programmatic` TR-8.2: 手机号带横杠/空格能被检测为格式问题
  - `programmatic` TR-8.3: 问题清单包含建议修正值
  - `programmatic` TR-8.4: 扫描进度有日志输出，避免无限等待

## [ ] Task 9: 批量处理与质量报告生成
- **Priority**: medium
- **Depends On**: Task 5, Task 3, Task 4
- **Description**: 
  - 实现批量数据清洗校验接口（支持数组输入）
  - 实现批次统计：总条数、通过数、警告数、失败数、通过率
  - 实现问题分布统计：按字段、按问题类型聚合
  - 生成可读性好的质量报告文本（用于展示给用户）
  - 与现有批量导入预览格式兼容
- **Acceptance Criteria Addressed**: [AC-7]
- **Test Requirements**:
  - `programmatic` TR-9.1: 20条数据批量处理能正确统计通过率
  - `programmatic` TR-9.2: 报告包含总条数、通过率、问题分布
  - `programmatic` TR-9.3: 批量处理遵循分批原则（≤200条/批）
  - `human-judgement` TR-9.4: 报告格式与现有预览模板风格一致

## [ ] Task 10: 模块集成与示例脚本
- **Priority**: low
- **Depends On**: Task 1-9
- **Description**: 
  - 创建统一的模块入口文件，导出所有公共API
  - 编写使用示例脚本（单条数据清洗、批量清洗、质量扫描）
  - 编写README说明文档（如何使用、如何扩展新表）
  - 清理src/scripts/temp/中过期的临时脚本（可选）
  - 测试与现有lark-cli工作流的兼容性
- **Acceptance Criteria Addressed**: [AC-9, AC-10]
- **Test Requirements**:
  - `programmatic` TR-10.1: 模块能通过require正确导入和使用
  - `programmatic` TR-10.2: 示例脚本可直接运行并输出预期结果
  - `human-judgement` TR-10.3: README文档清晰说明使用方法
  - `human-judgement` TR-10.4: 新增一张测试表只需添加schema配置即可支持
