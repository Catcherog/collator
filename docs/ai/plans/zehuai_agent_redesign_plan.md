# 泽怀影像数据入库智能体（zehuai-image-data-ingestion）重构设计方案

&gt; **版本**: v2.0  
&gt; **日期**: 2026-06-27  
&gt; **状态**: 待审核  
&gt; **基于**: 现有数据清洗引擎v1.1.0 + 多模态模块 + 7张核心表 + 5大约束体系

---

## 一、现状分析

### 1.1 已有基础设施（可复用率 85%）

| 模块 | 位置 | 成熟度 | 说明 |
|------|------|--------|------|
| 数据清洗引擎 | [src/data-cleaning/](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/) | ✅ 生产就绪 | 6核心模块、4步清洗管线、质量评分、规则学习 |
| 多模态处理 | [src/data-cleaning/multimodal/](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/multimodal/) | ✅ 可用 | OCR（Tesseract+飞书）、ASR（妙记+Whisper）、CLIP |
| 表结构Schema | [src/data-cleaning/schemas/](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/schemas/) | ✅ 完整 | 7张核心表153字段定义 |
| 业务规则库 | [docs/guides/business-rules-library.md](file:///d:/360Downloads/Trae%20项目/collator/docs/guides/business-rules-library.md) | ✅ 详细 | 5大约束、枚举映射、跨表联动、状态机 |
| 数据解析模板 | [docs/guides/data-parsing-templates.md](file:///d:/360Downloads/Trae%20项目/collator/docs/guides/data-parsing-templates.md) | ✅ 完备 | 6种数据源、4种场景、歧义消解 |
| 飞书Skill体系 | [.trae/skills/](file:///d:/360Downloads/Trae%20项目/collator/.trae/skills/) | ✅ 可用 | lark-base/lark-sheets/lark-doc/lark-wiki等 |

### 1.2 核心问题

1. **缺少统一编排层**：各模块独立存在，没有Agent入口串联全流程
2. **智能体定义过于简单**：现有工具描述未充分利用已有代码能力
3. **多模态→结构化→清洗→写入链路未打通**：用户需要手动切换工具
4. **缺少Bitable写入适配器**：清洗后的数据没有统一写入飞书多维表的接口
5. **知识库联动缺失**：表格数据变化未自动同步到Wiki
6. **交互流程硬编码在文档**：确认/澄清流程没有程序化实现
7. **70+临时脚本堆积**：说明缺少标准API，每次操作都要写新脚本

---

## 二、重构目标

### 2.1 核心目标

构建一个**七步流水线智能体**，实现从任意非结构化数据到飞书多维表的端到端自动化，用户只需说一句话或上传文件，Agent自动完成：

```
多模态感知 → 语义理解 → 字段提取 → 数据清洗 → 规则校验 → 确认交互 → 写入联动
```

### 2.2 设计原则

1. **复用优先**：最大化利用现有data-cleaning模块，不重复造轮子
2. **分层架构**：感知层→理解层→执行层清晰分离，便于维护
3. **渐进式确认**：置信度驱动的交互，高置信度自动执行，低置信度请求确认
4. **全链路留痕**：每一步操作都有日志，支持追溯和回滚
5. **知识闭环**：用户反馈自动更新同义词库和清洗规则

---

## 三、新智能体架构设计

### 3.1 三层流水线架构

```
┌─────────────────────────────────────────────────────────────┐
│                    泽怀影像数据入库 Agent v2.0                 │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 感知层 (Perception)                                │
│  ├─ 输入类型自动识别 (text/chat/image/audio/docx/file)      │
│  ├─ OCR引擎选择与降级 (飞书OCR优先, Tesseract兜底)           │
│  ├─ ASR语音转写 (飞书妙记/本地Whisper)                      │
│  ├─ CLIP图像理解 (辅助判断图片内容类型)                      │
│  └─ 文档解析 (Word/PDF/Excel文本提取)                       │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 理解层 (Understanding)                             │
│  ├─ 场景分类器 (客户咨询/订单/拍摄/资源/素材/成品/爆款/SOP) │
│  ├─ 字段提取器 (基于Schema+同义词库+NLP)                    │
│  ├─ 置信度评估 (每个字段0-1分, 整体质量分0-100)              │
│  ├─ 数据清洗管线 (4步标准化: Null→Format→Enum→Default)      │
│  ├─ 五重约束校验 (字段/操作/联动/输出/安全)                  │
│  └─ 歧义检测 (低置信度/枚举不匹配/逻辑矛盾)                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 执行层 (Execution)                                 │
│  ├─ 交互式确认 (展示提取结果, 请求修正/确认)                 │
│  ├─ Bitable写入适配器 (原生API, 分批≤50条, 文件传参)         │
│  ├─ 跨表联动引擎 (自动补全关联记录)                         │
│  ├─ Wiki知识库同步 (表格→Wiki双向同步)                      │
│  ├─ SOP日志记录 (自动写入SOP迭代表)                         │
│  ├─ 操作留痕与快照 (支持回滚)                               │
│  └─ 结果报告输出 (状态/详情/链接/修复建议)                   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心文件结构（新增/修改）

```
src/data-cleaning/
├── agent/                           ← 新增：Agent编排层
│   ├── index.js                     ← Agent主入口
│   ├── perception/                  ← 感知层
│   │   ├── index.js
│   │   ├── input-classifier.js      ← 输入类型自动识别
│   │   ├── dispatcher.js            ← 多模态调度器
│   │   └── doc-parser.js            ← Word/PDF/Excel解析
│   ├── understanding/               ← 理解层
│   │   ├── index.js
│   │   ├── scene-classifier.js      ← 业务场景识别
│   │   ├── field-extractor.js       ← 字段提取（LLM辅助）
│   │   ├── confidence-scorer.js     ← 字段置信度评估
│   │   └── ambiguity-detector.js    ← 歧义/冲突检测
│   ├── execution/                   ← 执行层
│   │   ├── index.js
│   │   ├── bitable-writer.js        ← 飞书多维表写入适配器
│   │   ├── linkage-engine.js        ← 跨表联动引擎
│   │   ├── wiki-sync.js             ← Wiki知识库同步
│   │   ├── confirmation-ui.js       ← 交互确认模板生成
│   │   └── rollback-manager.js      ← 回滚与快照管理
│   └── workflows/                   ← 预置工作流
│       ├── customer-consultation.js ← 客户咨询入库流程
│       ├── order-creation.js        ← 订单创建流程
│       ├── resource-onboarding.js   ← 资源入库流程（含OCR名片）
│       ├── material-archival.js     ← 素材归档流程
│       ├── product-publishing.js    ← 成品发布流程
│       └── batch-import.js          ← 批量导入流程
├── core/                            ← 已有，保持不变
├── multimodal/                      ← 已有，微调接口
├── schemas/                         ← 已有，保持不变
├── config/                          ← 已有，补充Agent配置
│   └── agent-config.json            ← 新增：Agent运行配置
└── index.js                         ← 修改：导出Agent入口

.trae/skills/
└── zehuai-image-data-ingestion/     ← 重构：Skill定义
    └── SKILL.md                     ← 重写为完整Agent使用指南
```

---

## 四、各模块详细设计

### 4.1 感知层 (Perception Layer)

**职责**：接收用户任意输入，统一转换为纯文本+元数据格式

#### 4.1.1 输入分类器 (input-classifier.js)

自动识别输入类型：

| 输入特征 | 分类结果 | 处理方式 |
|---------|---------|---------|
| 包含图片路径/URL/附件 | `image` | 调用OCR，CLIP辅助理解 |
| 包含音频文件路径 | `audio` | 调用ASR转写 |
| 包含.docx/.pdf/.xlsx路径 | `document` | 调用doc-parser |
| 包含时间戳+说话人标记 | `chat_log` | 聊天记录解析模式 |
| 包含CSV/JSON批量数据 | `batch` | 批量导入模式 |
| 纯文本 | `text` | 直接进入理解层 |

#### 4.1.2 多模态调度器 (dispatcher.js)

```javascript
// 伪代码
async function processMultimodal(input) {
  const type = classifyInput(input);
  
  switch(type) {
    case 'image':
      const ocrResult = await ocr.extractText(imagePath, { 
        engine: 'feishu',  // 优先飞书OCR，准确率更高
        fallback: true,
        confidenceThreshold: 0.7
      });
      const clipResult = await clip.analyze(imagePath); // 获取图像内容标签
      return { text: ocrResult.text, metadata: { ocr: ocrResult, clip: clipResult, type } };
    
    case 'audio':
      const asrResult = await asr.transcribe(audioPath);
      return { text: asrResult.text, metadata: { asr: asrResult, type } };
    
    case 'document':
      const docText = await docParser.extract(docPath);
      return { text: docText, metadata: { docPath, type } };
    
    // ...其他类型
  }
}
```

### 4.2 理解层 (Understanding Layer)

**职责**：从文本中提取结构化字段，应用清洗和校验规则

#### 4.2.1 场景分类器 (scene-classifier.js)

识别当前业务场景，路由到对应工作流：

| 关键词/特征 | 目标场景 | 目标表 |
|------------|---------|--------|
| 咨询/加微信/想拍/预算/风格 | 客户咨询 | 客户表+项目表 |
| 下单/签约/合同/付款 | 订单创建 | 项目表更新 |
| 名片/化妆师/模特/场地/报价 | 资源入库 | 资源总库 |
| 拍摄完/原片/素材/归档 | 素材归档 | 素材库 |
| 发布/小红书/抖音/文案/数据 | 成品发布 | 成品发布表 |
| 爆款/参考/链接/点赞 | 爆款调研 | 爆款库 |

#### 4.2.2 字段提取器 (field-extractor.js)

结合Schema定义和同义词库，从文本中提取字段：

1. 加载目标表Schema（从schemas/）
2. 对每个字段，使用同义词库进行匹配
3. 对模糊匹配的字段，结合业务规则推断
4. 计算每个字段的置信度

**示例**：
- 文本"预算大概2000左右" → 匹配"预算区间"字段 → 通过normalizeBudget()映射到"1000-2000元" → 置信度0.9
- 文本"喜欢小清新的感觉" → 匹配"意向风格" → 通过findMatchingStyle()映射到"日系清新" → 置信度0.95

#### 4.2.3 数据清洗管线（复用已有DataCleaner）

直接调用现有4步清洗管线：
```javascript
const cleaner = createCleaner(schema);
const cleaned = cleaner.clean(extractedFields);
// 自动执行: NullToEmpty → FormatCleaner → EnumMappingCleaner → DefaultValueCleaner
```

#### 4.2.4 五重约束校验（复用已有rules模块）

```javascript
const validation = validateRecord(cleanedData, schema, {
  checkRequired: true,      // 约束2：必填项校验
  checkEnum: true,          // 约束1：枚举值校验
  checkDuplicate: true,     // 约束2：去重校验
  checkLogic: true,         // 逻辑一致性
  checkFormat: true         // 格式校验
});
```

#### 4.2.5 歧义检测器 (ambiguity-detector.js)

标记需要用户确认的情况：

| 检测条件 | 处理方式 |
|---------|---------|
| 字段置信度 &lt; 0.7 | 请求用户确认该字段值 |
| 检测到重复记录（同手机号/同主键） | 提供"更新/跳过/强制创建"选项 |
| 枚举值无法匹配 | 推荐最接近的选项，请求确认 |
| 缺少必填字段 | 列出缺失字段，请求补充 |
| 逻辑矛盾（如发布时间早于拍摄时间） | 报告矛盾，请求修正 |

### 4.3 执行层 (Execution Layer)

**职责**：与飞书API交互，执行写入、联动、同步操作

#### 4.3.1 Bitable写入适配器 (bitable-writer.js) ⭐核心新增

封装飞书多维表原生API，解决PowerShell/JSON传参问题：

**关键特性**：
- 使用**原生API**而非CLI封装命令（避免PowerShell坑点）
- 使用**相对路径文件传参**（`--data @data.json`）
- **分批写入**（每批≤50条，串行执行，避免限流）
- 自动处理**关联字段**（双向链接）
- 写入前**快照备份**，支持回滚
- 完整的**错误处理**和重试机制

**API封装**：
```javascript
class BitableWriter {
  constructor(appToken) {
    this.appToken = appToken; // MwGMbF0Q0alPc6s3jOccovvOnob
  }

  // 创建单条记录
  async createRecord(tableId, fields) { ... }
  
  // 批量创建记录（自动分批）
  async batchCreateRecords(tableId, recordsList, options) { ... }
  
  // 更新记录
  async updateRecord(tableId, recordId, fields) { ... }
  
  // 查询记录（用于去重校验）
  async findRecords(tableId, filter) { ... }
  
  // 创建双向关联
  async createBidirectionalLink(tableId1, recordId1, fieldId1, 
                                 tableId2, recordId2, fieldId2) { ... }
}
```

**技术实现要点**（基于飞书API技术要点.md）：
- 通过Node.js child_process调用`npx lark-cli api POST ...`
- 使用临时JSON文件传参，执行后自动清理
- Windows环境下使用`shell: true`
- 输出日志使用ASCII字符避免GBK编码问题
- 动态计算API参数，不硬编码范围

#### 4.3.2 跨表联动引擎 (linkage-engine.js)

根据业务规则库中的联动规则，自动执行关联操作：

| 触发事件 | 自动联动动作 |
|---------|-------------|
| 创建客户后 | 检查重复，无则创建，有则提示更新 |
| 创建项目后 | 验证客户存在，建立客户↔项目双向链接 |
| 项目分配资源 | 建立项目↔资源双向链接 |
| 项目状态→拍摄完成 | 提示创建素材记录 |
| 创建成品后 | 关联所属项目，可选关联爆款参考 |
| 创建资源后 | 触发Wiki页面创建 |
| SOP表新增记录 | 同步更新Wiki页面更新日志 |

#### 4.3.3 Wiki知识库同步 (wiki-sync.js)

实现表格→知识库的自动同步（基于业务规则库V2.0同步规则）：

- SOP迭代记录 → Wiki页面追加更新日志
- 资源新增 → 创建资源说明子页面
- 项目状态变更 → 更新案例Wiki时间线
- 爆款新增 → 创建调研分析页面

#### 4.3.4 交互确认模板 (confirmation-ui.js)

生成标准化的确认信息，展示给用户：

```
📋 数据解析结果确认
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 识别场景: 客户咨询（新客户+新拍摄需求）
📊 数据质量评分: 92/100 (良好)

👤 客户信息
  ✅ 姓名: 李婷 (置信度: 99%)
  ✅ 手机: 138******78 (置信度: 99%)
  ✅ 来源: 小红书 (置信度: 95%)
  ✅ 类型: 亲子（周岁照）(置信度: 98%)
  ✅ 预算: 1000-2000元 (置信度: 90%)
  ✅ 风格: 日系清新 (置信度: 95%)
  ⚠️  咨询时间: 2026-06-27 (推断为今天，置信度: 85%)

📅 拍摄安排
  ⚠️  期望时间: 这周六或周日 (需确认具体日期)
  💡 建议项目名: 李婷-亲子周岁照-20260627

📝 操作计划
  1️⃣ 创建客户记录（客户全生命周期管理表）
  2️⃣ 创建项目记录（拍摄项目全流程管理表）
  3️⃣ 建立客户↔项目双向关联
  4️⃣ 记录操作日志到SOP表

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
请选择:
  A. 信息无误，执行入库（拍摄日期先填"待确认"）
  B. 我需要修改某些信息
  C. 只创建客户记录，项目稍后再说
  D. 取消本次操作
```

### 4.4 预置工作流 (workflows/)

为最常用的场景提供预置工作流，简化LLM调用路径：

| 工作流 | 触发方式 | 步骤 |
|-------|---------|------|
| 客户咨询 | 用户描述新客户咨询 | 提取客户信息→提取需求→确认→创建客户+项目 |
| 资源入库（名片OCR） | 用户上传名片图片 | OCR识别→解析名片信息→确认→创建资源记录+Wiki |
| 批量导入 | 用户提供Excel/CSV | 逐行解析→批量预览→确认→分批写入 |
| 素材归档 | 拍摄完成后 | 关联项目→填写素材信息→确认→创建素材记录 |
| 成品发布 | 准备发布内容 | 提取发布信息→关联项目→确认→创建成品记录 |

---

## 五、SKILL.md 重设计

将`.trae/skills/zehuai-image-data-ingestion/SKILL.md`重写为完整的Agent使用指南，包含：

1. **Agent概述**：能力范围、适用场景
2. **快速开始**：3个典型使用示例
3. **工作流程详解**：七步流水线
4. **支持的数据源**：文本/聊天/OCR/ASR/文档/批量
5. **7张核心表参考**：字段映射、枚举值、必填项
6. **交互确认规范**：用户如何回应确认请求
7. **错误处理指南**：常见问题和解决方案
8. **配置说明**：如何调整置信度阈值、批大小等

---

## 六、实施步骤

### Phase 1: 基础设施搭建（Agent骨架）
1. 创建`src/data-cleaning/agent/`目录结构
2. 实现Bitable写入适配器（bitable-writer.js）— 最核心
3. 单元测试：单条记录写入、批量写入、关联字段写入
4. 配置文件：agent-config.json（表ID、阈值、批大小等）

### Phase 2: 感知层实现
1. 输入分类器（input-classifier.js）
2. 多模态调度器（dispatcher.js）
3. 文档解析器（doc-parser.js，支持.docx/.txt）
4. 整合现有OCR/ASR/CLIP模块，统一接口

### Phase 3: 理解层实现
1. 场景分类器（scene-classifier.js）
2. 字段提取器（field-extractor.js）— 基于已有schema+同义词
3. 置信度评估（confidence-scorer.js）
4. 歧义检测器（ambiguity-detector.js）
5. 整合现有DataCleaner和rules校验模块

### Phase 4: 执行层实现
1. 交互确认模板生成（confirmation-ui.js）
2. 跨表联动引擎（linkage-engine.js）
3. Wiki同步模块（wiki-sync.js）
4. 回滚管理器（rollback-manager.js）
5. SOP日志自动记录

### Phase 5: 预置工作流
1. 客户咨询工作流（最常用）
2. 名片OCR资源入库工作流
3. 批量导入工作流
4. 其他3个工作流

### Phase 6: 集成测试与Skill更新
1. 端到端测试：从文本输入到飞书写入全流程
2. 测试场景：纯文本、聊天记录、图片OCR、批量CSV
3. 重写SKILL.md
4. 更新data-cleaning/index.js导出Agent入口
5. 清理temp目录中的旧脚本（归档到scripts/legacy/）

---

## 七、关键技术决策

| 决策项 | 选择 | 原因 |
|-------|------|------|
| API调用方式 | Node.js child_process + npx lark-cli api | 避免PowerShell语法陷阱，统一跨平台 |
| JSON传递方式 | 临时文件相对路径（`--data @file.json`） | 100%解决PowerShell双引号拆分问题 |
| 批量写入大小 | 50条/批，串行，间隔200ms | 平衡效率与限流风险（基于实践经验） |
| OCR引擎优先级 | 飞书OCR → Tesseract兜底 | 飞书OCR对中文名片识别准确率更高 |
| 置信度阈值 | 自动执行&gt;0.9，建议确认0.7-0.9，必须确认&lt;0.7 | 平衡自动化率与准确率 |
| 写入前备份 | 批量操作前全量快照，单条操作记录旧值 | 支持回滚，满足安全约束 |
| 日志编码 | ASCII字符写入文件，emoji仅用于用户界面 | 避免Windows GBK编码错误 |

---

## 八、风险与应对

| 风险 | 影响 | 应对措施 |
|-----|------|---------|
| 飞书API权限问题 | 写入失败 | 集成lark-shared认证检查，自动提示重新登录 |
| 字段提取准确率不足 | 错误数据入库 | 置信度门控+用户确认+质量评分，低质量数据不自动写入 |
| 批量写入部分失败 | 数据不一致 | 分批独立事务，失败批次可单独重试，不影响已成功批次 |
| 跨表联动死循环 | 无限递归 | 联动深度限制（最多3层），操作去重标记 |
| Wiki同步失败 | 数据与知识不一致 | 同步失败不阻塞主流程，记录失败日志，可手动重试 |

---

## 九、成功标准

1. ✅ **单条客户咨询**：用户输入一段话，Agent自动完成客户+项目创建，无需人工干预（置信度&gt;90%时）
2. ✅ **名片OCR入库**：用户上传名片图片，自动识别→解析→创建资源记录+Wiki页面
3. ✅ **批量导入**：支持CSV/Excel批量导入，预览→确认→分批写入→报告，全流程标准化
4. ✅ **零临时脚本**：常见场景无需写临时脚本，通过Agent API直接完成
5. ✅ **全链路留痕**：所有操作自动记录到SOP表，可追溯可回滚
6. ✅ **测试覆盖**：核心模块单元测试覆盖率&gt;80%，端到端测试覆盖5个主要工作流

---

## 十、文件修改清单

### 新增文件
- `src/data-cleaning/agent/index.js`
- `src/data-cleaning/agent/perception/input-classifier.js`
- `src/data-cleaning/agent/perception/dispatcher.js`
- `src/data-cleaning/agent/perception/doc-parser.js`
- `src/data-cleaning/agent/perception/index.js`
- `src/data-cleaning/agent/understanding/scene-classifier.js`
- `src/data-cleaning/agent/understanding/field-extractor.js`
- `src/data-cleaning/agent/understanding/confidence-scorer.js`
- `src/data-cleaning/agent/understanding/ambiguity-detector.js`
- `src/data-cleaning/agent/understanding/index.js`
- `src/data-cleaning/agent/execution/bitable-writer.js`
- `src/data-cleaning/agent/execution/linkage-engine.js`
- `src/data-cleaning/agent/execution/wiki-sync.js`
- `src/data-cleaning/agent/execution/confirmation-ui.js`
- `src/data-cleaning/agent/execution/rollback-manager.js`
- `src/data-cleaning/agent/execution/index.js`
- `src/data-cleaning/agent/workflows/customer-consultation.js`
- `src/data-cleaning/agent/workflows/resource-onboarding.js`
- `src/data-cleaning/agent/workflows/batch-import.js`
- `src/data-cleaning/agent/workflows/material-archival.js`
- `src/data-cleaning/agent/workflows/product-publishing.js`
- `src/data-cleaning/agent/workflows/order-creation.js`
- `src/data-cleaning/config/agent-config.json`
- `src/data-cleaning/agent/test/` (测试文件)

### 修改文件
- `src/data-cleaning/index.js`（导出Agent入口）
- `.trae/skills/zehuai-image-data-ingestion/SKILL.md`（完整重写）

### 清理（Phase 6执行）
- `src/scripts/temp/` 中70+临时脚本归档/删除

---

**文档结束**  
*本方案基于现有代码资产最大化复用设计，预计可将数据入库操作效率提升80%以上，彻底告别临时脚本时代。*
