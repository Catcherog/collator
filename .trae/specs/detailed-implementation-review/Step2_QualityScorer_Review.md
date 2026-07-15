# Task 2: QualityScorer质量评分系统深度审查报告

## 审查概述
- **审查文件**: src/data-cleaning/core/quality-scorer.js (317行)
- **审查日期**: 2026-03-18
- **审查状态**: 已完成

## TR测试点验证
| 测试点 | 结果 | 说明 |
|--------|------|------|
| TR-2.1 (权重和=100) | ✅ 通过 | 40+25+20+10+5=100 |
| TR-2.2 (等级阈值位置) | ✅ 通过 | _getGrade位于第81-86行，阈值正确 |
| TR-2.3 (行271-281重复计算) | ❌ 确认Bug | 必填填充率折扣机制完全失效 |

## 权重配置
| 维度 | 权重 | 说明 |
|------|------|------|
| requiredFieldsComplete | 40 | 必填字段完整性 |
| formatValid | 25 | 格式有效性 |
| enumValid | 20 | 枚举有效性 |
| logicConsistent | 10 | 逻辑一致性 |
| confidenceWeighted | 5 | 置信度加权 |

## 扣分映射表
### ERROR_POINTS
| 错误类型 | 扣分 |
|----------|------|
| TYPE_ERROR | 10 |
| FORMAT_ERROR | 8 |
| ENUM_MISMATCH | 5 |
| RANGE_ERROR/INVALID_DATE/DATE_CONFLICT | 10 |
| MISSING_RELATION | 8 |
| BUDGET_MISMATCH(error) | 5 |
| STYLE_WARNING(error) | 3 |
| LOW_CONFIDENCE(error) | 3 |
| VALIDATION_EXCEPTION(error) | 5 |
| 未知错误 | 7 |

### WARNING_POINTS
| 警告类型 | 扣分 |
|----------|------|
| STYLE_WARNING | 2 |
| LOW_CONFIDENCE | 3 |
| LENGTH_WARNING | 2 |
| BUDGET_MISMATCH(warn) | 2 |
| VALIDATION_EXCEPTION(warn) | 3 |
| 未知警告 | 2 |

## 🔴 核心Bug确认

### QS-001: 必填字段填充率折扣机制失效（高危）
- **位置**: 第271-281行
- **问题**: score方法先计算各维度×requiredFillRate的折扣分数，然后在requiredFillRate>0时（绝大多数场景），又用不带折扣的formatScore2/enumScore2等覆盖计算结果
- **后果**: 必填字段缺失一半（r=0.5）但其他全对时，按设计意图应得50分（中等），实际得80分（良好），数据质量评分虚高
- **修复方案**: 二选一：
  - **方案A（推荐）**: 删除else分支重复计算，恢复折扣机制；同时修复r=0时10分上限无法达到的问题
  - **方案B**: 删除formatScore/enumScore等×requiredFillRate的冗余计算，保留当前实际生效逻辑但清理死代码

## 其他问题
| 编号 | 严重度 | 位置 | 问题 |
|------|--------|------|------|
| QS-002 | ⚠️ 中 | _getWeights() | 自定义配置读取时requiredFieldsComplete和formatValid会×100，其他权重不变，可能导致总和≠100 |
| QS-003 | ⚠️ 低 | 第273-274行 | requiredFillRate=0时注释称分数上限10分，但实际计算恒为0分（因为各维度×0后减otherDeduction≤0） |

## 实际生效评分公式
当requiredFillRate > 0时：
```
score = 40×r + max(0,25-fd) + max(0,20-ed) + max(0,10-ld) + max(0,5-cd) - od
其中：r=requiredFillRate, fd=formatDeduction, ed=enumDeduction, ld=logicDeduction, cd=confidenceDeduction, od=otherDeduction
```

## 等级划分
| 分数 | 等级 |
|------|------|
| ≥90 | 优秀 |
| ≥70 | 良好 |
| ≥50 | 中等 |
| <50 | 较差 |
