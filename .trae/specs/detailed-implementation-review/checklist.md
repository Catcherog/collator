# collator 项目功能实现与技术原理深度审查 - Verification Checklist

## 架构与设计审查
- [ ] 已读取并理解 src/data-cleaning/index.js 主入口的懒加载机制和API导出
- [ ] 已分析 CleaningPipeline 管道模式实现：cleaner链执行顺序、错误隔离、数据传递
- [ ] 已验证4个内置Cleaner的单一职责划分是否合理
- [ ] 已审查适配器模式在OCR/ASR/CLIP模块中的应用一致性
- [ ] 已绘制模块依赖关系图，确认无循环依赖
- [ ] 已评估工厂函数（createXxx）与类直接导出的API设计一致性

## 核心算法审查
- [ ] 已追踪EnumMappingCleaner.matchEnumValue的5级匹配分支，确认优先级顺序正确
- [ ] 已验证置信度阈值：≥0.85自动修正、0.5-0.85警告、<0.5不映射
- [ ] 已推导QualityScorer完整评分公式并验证权重和为100
- [ ] 已审查评分公式中requiredFillRate=0时分数上限10分的特殊处理逻辑
- [ ] 已检查score方法行271-281是否存在重复计算Bug
- [ ] 已分析calculateStringSimilarity算法局限性（字符集合匹配，无顺序/编辑距离）
- [ ] 已验证去重算法的加权平均计算和阈值判定
- [ ] 已审查预算区间归一化逻辑和30%容差合理性
- [ ] 已验证日期解析和先后顺序校验逻辑

## 多模态模块审查
- [ ] 已读取OCR所有适配器文件（tesseract/feishu/business-card）
- [ ] 已验证OCR降级策略：Tesseract置信度<0.7→飞书OCR
- [ ] 已读取ASR所有适配器文件（whisper/feishu/wechat）
- [ ] 已验证ASR降级策略：Whisper失败→飞书妙记
- [ ] 已读取CLIP模块python-bridge.js和clip_service.py
- [ ] 已分析Python子进程调用的健壮性（错误处理、超时、编码）
- [ ] 已确认mock模式在测试中的覆盖情况
- [ ] 已评估真实后端（Tesseract/Whisper/CLIP）的集成状态

## 数据验证层审查
- [ ] 已读取7张schema JSON文件并统计字段数量
- [ ] 已验证SYSTEM_FIELD_TYPES跳过列表完整性
- [ ] 已审查validateField中所有字段类型的验证分支
- [ ] 已列出validateLogicConsistency中的5类业务规则
- [ ] 已确认validateStateTransition的状态机配置是否存在
- [ ] 已检查rules/index.js中calculateScore是否与QualityScorer重复
- [ ] 已验证手机号/微信号识别逻辑
- [ ] 已审查URL自动补全https://前缀逻辑

## 持久化与配置审查
- [ ] 已分析OperationLogger的JSONL追加写入性能
- [ ] 已验证按日期分文件和独立规则变更日志
- [ ] 已审查_atomicWrite原子写入机制（tmp→bak→rename）
- [ ] 已验证版本备份_createVersionBackup和rollback回滚
- [ ] 已分析反馈聚合算法：≥3次相同反馈触发推荐
- [ ] 已读取cleaning-rules.json确认去重规则配置
- [ ] 已读取synonyms.json评估业务术语覆盖度
- [ ] 已检查DataScanner临时文件创建和清理逻辑

## 批量处理与扫描审查
- [ ] 已验证批量处理分批大小上限200条
- [ ] 已审查飞书API分页拉取逻辑（page_token循环）
- [ ] 已验证增量扫描基于lastModifiedTime
- [ ] 已分析_generateSuggestedFixes自动修复建议生成
- [ ] 已审查generateReport报告格式和统计维度
- [ ] 已验证partitionForWriting输出分块逻辑
- [ ] 已检查DataScanner的TEMP_DIR路径是否正确（向上3层）

## 测试覆盖审查
- [ ] 已列出所有test-*.js文件清单
- [ ] 已运行现有测试套件确认全部通过
- [ ] 已统计测试用例总数和断言总数
- [ ] 已建立功能点→测试用例覆盖矩阵
- [ ] 已识别去重算法缺少测试
- [ ] 已识别多模态真实后端缺少集成测试
- [ ] 已识别错误路径/边界值测试缺口
- [ ] 已审查mock测试是否存在"测试mock本身"的问题

## 错误处理与健壮性审查
- [ ] 已检查所有try/catch块，确认无空catch吞掉错误
- [ ] 已验证管道中单个cleaner异常不影响其他cleaner执行
- [ ] 已审查API调用失败时的降级和用户提示
- [ ] 已检查文件IO操作的错误处理
- [ ] 已验证Python子进程异常时的错误捕获
- [ ] 已审查异步函数的Promise rejection处理

## 性能分析
- [ ] 已识别同步IO（fs.appendFileSync/readFileSync）在批量场景的性能影响
- [ ] 已分析去重算法O(n*m)时间复杂度（n=新记录, m=已有记录）
- [ ] 已评估大数量级下（>1000条）批量处理性能
- [ ] 已检查日志查询（query方法）全文件扫描的性能
- [ ] 已识别schema缓存机制（cachedSchemas）的有效性
- [ ] 已分析枚举匹配中多层循环的性能特征

## 问题清单验证
- [ ] Critical级问题已识别并附带代码位置
- [ ] High级问题已识别并附带代码位置
- [ ] Medium级问题已识别并附带代码位置
- [ ] Low级问题/代码气味已识别
- [ ] 每个问题都有具体修复建议
- [ ] 问题清单中包含至少1个潜在Bug（如评分公式重复计算）
- [ ] 问题清单中包含至少1个设计问题（如重复代码）
- [ ] 问题清单中包含至少1个性能问题（如同步IO）

## 优化建议验证
- [ ] 短期建议（1-2周）具体可执行
- [ ] 中期建议（1-2月）有明确实施路径
- [ ] 长期建议（3月+）不要求大规模重写
- [ ] TypeScript类型化建议已评估投入产出
- [ ] Levenshtein距离算法替换建议已说明收益
- [ ] 异步IO改造建议已说明影响范围
- [ ] 日志轮转机制建议已提出
- [ ] 临时脚本清理建议已提出

## 报告交付验证
- [ ] 审查报告已保存到docs/reports/目录
- [ ] 报告包含执行摘要和健康度评分
- [ ] 报告包含架构分层图
- [ ] 报告包含核心模块算法详解
- [ ] 报告包含完整数据流程分析
- [ ] 报告所有代码引用使用可点击file:///链接
- [ ] 报告包含测试覆盖评估
- [ ] 报告包含技术债务统计
- [ ] 报告包含后续行动建议

## 代码引用规范
- [ ] 所有代码位置引用格式为 [文件名](file:///绝对路径#L起始行-L结束行)
- [ ] Windows路径使用正斜杠/
- [ ] 行号范围准确
- [ ] 不使用反引号包裹链接
