# Task 3: 基础设施模块深度审查报告

## 审查概述
- **审查文件**: operation-logger.js(165行), rule-learning.js(350行), data-scanner.js(401行), batch-processor.js(353行)
- **审查日期**: 2026-03-18
- **审查状态**: 已完成

## TR测试点验证
| 测试点 | 结果 | 说明 |
|--------|------|------|
| TR-3.1 (_atomicWrite流程) | ✅ 通过 | 位于rule-learning.js第32-56行：copy bak→write tmp→delete original→rename tmp。但存在缺陷：备份文件每次都覆盖(.bak固定文件名)，崩溃恢复只能回退到上一版本而非任意历史版本 |
| TR-3.2 (反馈推荐阈值) | ✅ 通过 | 位于rule-learning.js第225-265行：minCount默认3，置信度=0.5+count*0.1，最大0.95（第252行） |
| TR-3.3 (TEMP_DIR路径) | ❌ **路径错误** | data-scanner.js第14行：`path.join(__dirname, '..', '..', '..')`，从src/data-cleaning/core/向上3层 → 项目根目录的**父目录**！应该是向上2层到项目根目录。临时文件会写到项目外，且清理不可靠 |

## 🔴 严重/高危问题

| 编号 | 严重度 | 文件 | 行号 | 问题描述 | 影响 |
|------|--------|------|------|----------|------|
| INF-001 | 🔴 高危 | data-scanner.js | 11 | **硬编码appToken泄露**：`DEFAULT_APP_TOKEN = 'MwGMbF0Q0alPc6s3jOccovvOnob'` | 飞书应用Token硬编码在源码中，任何能访问代码的人都能获取，存在越权访问风险。应从环境变量读取 |
| INF-002 | 🔴 高危 | data-scanner.js | 64-68 | **execSync无超时设置**：调用lark-cli API时未设置timeout，网络问题可能导致进程无限挂起 | 批量扫描时一个API请求挂起会阻塞整个流程，无超时恢复机制 |
| INF-003 | ⚠️ 中危 | data-scanner.js | 14 | **TEMP_DIR路径错误**：向上3层指向项目根目录父级而非根目录 | 临时JSON文件写到项目外，且与cwd参数混用可能导致找不到文件。正确路径应为`path.join(__dirname, '..', '..')`向上2层 |
| INF-004 | ⚠️ 中危 | data-scanner.js | 254-259 | **增量扫描在客户端过滤**：incremental模式先拉取全表数据再在内存中按lastModifiedTime过滤 | 每次增量扫描仍拉取全表数据，完全违背增量扫描减少API调用的设计目的。应在API请求中传filter参数实现服务端过滤 |

## 🟠 中等问题

| 编号 | 严重度 | 文件 | 行号 | 问题描述 |
|------|--------|------|------|----------|
| INF-005 | ⚠️ 中 | operation-logger.js | 125-158 | **query方法全量加载到内存**：读取所有JSONL文件到allEntries数组再过滤，日志量大时内存溢出 |
| INF-006 | ⚠️ 中 | rule-learning.js | 38 | **备份文件固定为.bak**：每次save都覆盖同一个.bak文件，无法保留多版本历史（版本备份在versions/目录，但_atomicWrite的bak只是原子写入保护） |
| INF-007 | ⚠️ 中 | rule-learning.js | 58-70 | **版本备份无自动清理**：每次save都创建新的versions/synonyms-{timestamp}.json，无TTL/上限，长期运行会堆积大量备份文件 |
| INF-008 | ⚠️ 中 | batch-processor.js | 25 | **processBatch是async函数但内部全是同步操作**：声明为async但没有任何await，批处理是阻塞式的 |
| INF-009 | ⚠️ 中 | data-scanner.js | 34 | **Windows下lark-cli.cmd调用可能失败**：`npx lark-cli.cmd`依赖npx能找到.cmd文件，实际应使用`lark-cli.cmd`直接调用（如果全局安装）或更可靠的路径解析 |
| INF-010 | ⚠️ 中 | batch-processor.js | 51-149 | **分批逻辑实际未分批**：for循环按actualBatchSize切片，但内层循环立即处理整个batch，没有真正分批处理（批次间无间隔/IO释放），batchSize参数实际上无效 |

## 🟡 低危/建议

| 编号 | 严重度 | 文件 | 行号 | 建议 |
|------|--------|------|------|------|
| INF-011 | 💡 建议 | operation-logger.js | 6 | logDir默认指向src/data-cleaning/logs而非项目根目录logs |
| INF-012 | 💡 建议 | data-scanner.js | 40-43 | 临时文件名含Math.random()可能冲突，建议用UUID或更可靠的唯一ID |
| INF-013 | 💡 建议 | batch-processor.js | 139-147 | onProgress每条记录都回调，大批量时回调频率过高，建议每N条回调一次 |
| INF-014 | 💡 建议 | batch-processor.js | 206 | previewCount固定为5条，建议可配置 |
| INF-015 | 💡 建议 | batch-processor.js | 188-281 | generateReport仅支持text格式，建议支持JSON/Markdown |

## 核心方法清单

### OperationLogger (operation-logger.js)
| 方法 | 行号 | 功能 |
|------|------|------|
| constructor | 5-8 | 初始化logDir为src/data-cleaning/logs |
| log | 43-58 | 写入JSONL日志条目 |
| logCorrection | 60-72 | 记录字段修正日志 |
| logBatchStart | 74-86 | 记录批量导入开始 |
| logRuleUpdate | 88-103 | 记录规则变更到rule-changes.jsonl |
| query | 125-159 | 多维度过滤查询日志 |

### RuleLearner (rule-learning.js)
| 方法 | 行号 | 功能 |
|------|------|------|
| _atomicWrite | 32-56 | 原子写入（tmp→bak→rename） |
| addSynonym | 143-204 | 添加同义词支持5种类别 |
| recordFeedback | 122-141 | 记录用户反馈到feedback.jsonl |
| getSuggestedRules | 225-265 | 聚合反馈推荐规则（≥3次触发，置信度0.5+0.1*n） |
| rollback | 311-340 | 回滚到指定版本 |

### DataScanner (data-scanner.js)
| 方法 | 行号 | 功能 |
|------|------|------|
| _callLarkApi | 56-99 | 通过临时文件传参调用lark-cli（execSync，无超时） |
| fetchRecords | 101-149 | 分页拉取飞书表记录（page_size=100） |
| _generateSuggestedFixes | 166-233 | 自动生成修复建议（电话/URL/日期/枚举） |
| scanTable | 235-391 | 完整扫描流程（拉取→清洗→验证→评分→聚合） |

### BatchProcessor (batch-processor.js)
| 方法 | 行号 | 功能 |
|------|------|------|
| processBatch | 25-186 | 批量处理（实际batchSize=min(batchSize,200)，但未真正分批） |
| generateReport | 188-281 | 生成文本报告（质量分布、问题Top5） |
| getWritableRecords | 304-313 | 过滤可写入记录（passed或含warning） |
| partitionForWriting | 329-343 | 按chunkSize分区输出 |

## 关键机制分析

### _atomicWrite原子写入流程
```
1. 如原文件存在 → copyFileSync到.bak备份
2. writeFileSync写入.tmp临时文件
3. 如原文件存在 → unlinkSync删除原文件
4. renameSync将.tmp重命名为目标文件
5. 失败时清理.tmp文件
缺陷：.bak每次覆盖；崩溃时.tmp可能残留
```

### 增量扫描实际流程
```
当前实现（客户端过滤）：
1. fetchRecords拉取全表所有记录（无filter参数）
2. 在内存中按lastModifiedTime > lastScanTime过滤
问题：每次仍拉取全量数据，无法减少API调用

期望实现（服务端过滤）：
1. API请求中传入filter: {last_modified_time: {gt: lastScanTime}}
2. 只拉取变更记录
```
