# 理解层模块实现计划

## 概述

在 `src/data-cleaning/agent/understanding/` 目录下创建泽怀影像数据摄入Agent的理解层模块，包含5个文件。

## 场景与表映射

| 场景标识 | 场景名称 | 对应 Schema Key | 表名 |
|---------|---------|----------------|------|
| customer_consultation | 客户咨询 | customer | 客户全生命周期管理表 |
| order_creation | 订单/项目创建 | project | 拍摄项目全流程管理表 |
| resource_onboarding | 资源入驻 | resource | 资源总库主表 |
| material_archival | 素材归档 | material | 素材库表 |
| product_publishing | 成品发布 | product | 成品发布表 |
| research | 模特/资源调研 | research | 调研记录表 |
| sop | SOP文档 | sop | 话术/流程库表 |

## 文件清单与实现要点

### 1. scene-classifier.js

**功能**：基于加权关键词匹配识别业务场景

**实现要点**：
- 定义7个场景的关键词权重配置
- 对输入文本进行全角转半角、小写化预处理
- 遍历所有场景，累计匹配关键词权重得分
- 归一化置信度到0-1区间
- 返回最高分场景、置信度及对应tableKeys
- 场景到tableKeys映射：
  - customer_consultation → ['customer']
  - order_creation → ['project', 'customer']
  - resource_onboarding → ['resource']
  - material_archival → ['material', 'project']
  - product_publishing → ['product', 'project']
  - research → ['research']
  - sop → ['sop']

**导出**：`classifyScene(text) → { scene, confidence, tableKeys }`

### 2. field-extractor.js

**功能**：基于schema和同义词从文本中提取结构化字段

**依赖**：
- `../../schemas` - 获取字段schema定义
- `../../utils` - normalizeBudget, findMatchingStyle, findMatchingShootType, parseDate, sanitizePhone, isValidPhone, isValidWechat

**实现要点**：
- 预处理文本：全角转半角
- 遍历schema中每个字段，根据字段类型和description中的关键词提取值
- 识别策略：
  - 文本字段：通过关键词定位（如"姓名"、"手机"）+ 后续内容提取
  - 手机号：正则匹配11位中国手机号
  - 微信：正则匹配微信号或手机号
  - URL：正则匹配http/https链接
  - 日期：调用utils.parseDate
  - 预算区间：调用utils.normalizeBudget
  - 拍摄类型：调用utils.findMatchingShootType（使用config同义词）
  - 意向风格：调用utils.findMatchingStyle（使用config同义词）
  - 枚举字段：通过同义词库匹配
  - 多选字段：支持逗号/顿号/空格分隔的多个值
- 每个提取的字段记录：value, confidence（基于匹配方式）, source（匹配来源关键词）
- 收集缺失的必填字段到missing数组

**导出**：`extractFields(text, schema) → { fields: {fieldName: {value, confidence, source}}, missing }`

### 3. confidence-scorer.js

**功能**：计算提取字段的置信度分数和整体质量

**参考配置**：使用 `config/cleaning-rules.json` 中的 `scoringWeights.confidenceThresholds`

**实现要点**：
- 对每个字段计算置信度分数：
  - 直接精确匹配：0.95-1.0
  - 同义词匹配：0.8-0.9
  - 模糊匹配/正则提取：0.6-0.8
  - 部分匹配/推断：0.4-0.6
- 整体置信度计算：
  - 必填字段平均权重0.6
  - 推荐字段平均权重0.3
  - 可选字段平均权重0.1
- 等级划分（参考cleaning-rules阈值）：
  - high: ≥ 0.9（autoAccept）
  - medium: 0.7-0.9（autoCorrect）
  - low: < 0.7（needsConfirmation）

**导出**：`scoreConfidence(extractedFields) → { fieldScores, overallScore, level: 'high'|'medium'|'low' }`

### 4. ambiguity-detector.js

**功能**：检测歧义、冲突、缺失字段等问题

**参考配置**：使用 `config/cleaning-rules.json` 中的 `validationLevels` 和 `logicConsistencyRules`

**检测项**：
1. 低置信度字段：confidence < 0.7 → warning类型
2. 缺失必填字段：schema中required=true但无值 → error类型
3. 枚举值不匹配：提取值不在enumValues中 → warning类型
4. 重复手机号检测：同一记录中出现多个手机号 → warning类型
5. 逻辑冲突检测：
   - 拍摄日期早于当前日期（已过期）
   - 亲子类型但风格包含"暗调情绪"
   - 预算与拍摄类型不匹配等

**输出格式**：
```javascript
{
  issues: [
    { type: 'low_confidence'|'missing_required'|'enum_mismatch'|'duplicate_phone'|'logic_conflict',
      field: '字段名',
      message: '问题描述',
      suggestions: ['建议1', '建议2']
    }
  ],
  needsUserConfirmation: boolean // 存在error或多个warning时为true
}
```

**导出**：`detectAmbiguities(parsedData, schema) → { issues, needsUserConfirmation }`

### 5. index.js

**功能**：统一导出理解层所有模块

**导出内容**：
- classifyScene
- extractFields
- scoreConfidence
- detectAmbiguities

## 代码规范

- 使用 `require` / `module.exports`（CommonJS）
- 不添加任何注释
- 参考现有代码风格（如 data-cleaner.js, utils/index.js）
- 使用 utils 中的 toHalfWidth 等工具函数
- 从 config 获取同义词和清洗规则配置
