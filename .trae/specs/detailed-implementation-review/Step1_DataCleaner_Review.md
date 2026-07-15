# Task 1: DataCleaner核心引擎层深度审查报告

## 审查概述
- **审查文件**: src/data-cleaning/core/data-cleaner.js (642行)
- **审查日期**: 2026-03-18
- **审查状态**: 已完成

## 管道执行流程
```
cleanRecord/Async
    ↓
_cleanRecordInternal:
  1. Schema校验 → 2. 字段过滤 → 3. 多模态合并 → 4. Pipeline.run()
     ↓
  NullToEmptyCleaner → FormatCleaner → EnumMappingCleaner → DefaultValueCleaner
     ↓
  5. 逐字段校验 → 6. 必填检查 → 7. 逻辑检查 → 8. 修正日志 → 9. 返回结果
```

## 发现的问题

### 🔴 高危问题
| 编号 | 位置 | 问题 | 影响 |
|------|------|------|------|
| DC-001 | 行618-627 | calculateStringSimilarity基于字符集合匹配，完全忽略字符顺序 | 'ab'与'ba'被判为100%相似，'张三'与'三张'无法区分，去重误判风险极高 |

### ⚠️ 中危问题
| 编号 | 位置 | 问题 | 影响 |
|------|------|------|------|
| DC-002 | 行131-156 | EnumMappingCleaner for循环中前4级匹配一旦命中立即return，不检查后续枚举值是否有更高置信度匹配 | 枚举列表顺序直接影响匹配结果，如['古风摄影','古风']时输入'古风'会先匹配到'古风摄影'的包含关系(0.9)而非'古风'的精确匹配(1.0) |
| DC-003 | 行135 | 双向包含匹配enumValue.includes(lowerInput)过于宽松，短枚举值误匹配长输入 | 单字枚举值(如'风')会匹配所有含该字的输入，置信度0.9过高 |
| DC-004 | 行595-596 | 去重算法中fuzzyMatchFields与uniqueFields权重相同，简单算术平均 | 电话等强标识符精确匹配(应权重更高)与姓名模糊匹配权重一致 |

### 💡 建议优化
| 编号 | 位置 | 建议 |
|------|------|------|
| DC-005 | 行552-555 | matchEnumValue每次new EnumMappingCleaner实例，建议复用或改为静态方法 |
| DC-006 | 行606 | 去重找到第一个匹配就break，建议找置信度最高的匹配 |
| DC-007 | 行340-341 | OCR合并使用data[textField]而非extractedData，单独使用没问题但扩展性差 |

## TR测试点验证
| 测试点 | 结果 | 说明 |
|--------|------|------|
| TR-1.1 (5级匹配顺序) | ⚠️ 部分通过 | 前4级在for循环内顺序执行，但存在提前return问题；第5级在循环外正确 |
| TR-1.2 (置信度阈值) | ✅ 通过 | ≥0.85自动修正，0.5-0.85警告，逻辑正确 |
| TR-1.3 (相似度算法分析) | ✅ 通过 | 已详细分析字符集合匹配的5个局限性 |

## 各Cleaner输入输出示例
见完整审查记录。

## 算法时间复杂度
| 模块 | 复杂度 |
|------|--------|
| Pipeline整体 | O(n×E×S) (n字段数, E枚举值数, S同义词数) |
| deduplicate | O(N×M×K×L) (N新记录, M旧记录, K模糊字段, L字符串长度) |
| calculateStringSimilarity | O(L) |
