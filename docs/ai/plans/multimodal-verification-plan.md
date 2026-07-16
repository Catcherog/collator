# 多模态验证执行计划：OCR + ASR + CLIP

> **计划目标**：为 `src/data-cleaning/` 数据清洗引擎制定可重复、可量化的多模态验证方案，覆盖 OCR（光学字符识别）、ASR（自动语音识别）、CLIP（图文一致性校验）三大模块，以及现有结构化引擎的基准回归验证。
> **适用范围**：collator 项目 `src/data-cleaning/` 模块
> **计划依据**：`docs/ai/plans/multimodal-verification-ocr-asr-clip.md`
> **创建日期**：2026-06-26

---

## 一、Summary（计划摘要）

本计划将验证工作拆分为 **5 个阶段**、**47 个检查点**，与实施计划一一对应：

| 阶段 | 验证对象 | 核心产出 | 验收标准 |
|------|---------|---------|---------|
| Phase A | 现有结构化清洗引擎 | 基准测试集 + 准确率报告 | 字段清洗准确率 ≥ 95%，同义词召回率 ≥ 90%，原有 409 项测试无回归 |
| Phase B | OCR 模块 | OCR 准确率报告 | 名片/合同场景 ≥ 85%，聊天截图 ≥ 70%，集成后清洗流程无异常 |
| Phase C | ASR 模块 | ASR 转写报告（WER） | 中文 WER ≤ 20%，微信 silk 转换成功率 ≥ 90% |
| Phase D | CLIP 模块 | 图文一致性报告（ROC/AUC） | 匹配/不匹配分类准确率 ≥ 80% |
| Phase E | 端到端集成 | 集成测试报告 + 回归测试报告 | 新增测试全部通过，原有 409 项测试全部通过 |

**总体验证原则**：
1. **先基线，后增量**：先量化现有引擎能力，再验证新模块效果。
2. **先单元，后集成**：每个模块独立验证通过后，再接入 `DataCleaner.cleanRecord`。
3. **可重复运行**：所有验证脚本支持 `node <script>` 一键执行，输出 Markdown 报告到 `docs/reports/`。
4. **向后兼容**：任何新模块的失败不得导致原有结构化清洗流程失败。

---

## 二、Current State Analysis（现状分析）

### 2.1 已有能力（基于实际代码）

| 能力 | 文件位置 | 状态 |
|------|---------|------|
| 结构化数据清洗 Pipeline | `src/data-cleaning/core/data-cleaner.js` | 已成熟运行，含 4 个内置清洗器 |
| 字段类型/枚举/逻辑校验 | `src/data-cleaning/rules/index.js` | 已实现 |
| 数据质量评分（0-100 分） | `src/data-cleaning/core/quality-scorer.js` | 已实现，支持 5 个评分维度 |
| 同义词映射与自学习 | `src/data-cleaning/core/rule-learning.js` + `config/synonyms.json` | 已实现 |
| 批量处理与报告 | `src/data-cleaning/core/batch-processor.js` | 已实现 |
| 集成测试 | `src/data-cleaning/test-integration.js` | 已实现，覆盖 API 导出 + 端到端流程 |
| 多模态能力 | 无 | ❌ 未实现 |
| 基准测试集 | 无 | ❌ 未建立 |

### 2.2 关键依赖

```json
{
  "dependencies": {
    "docx": "^9.7.1"
  }
}
```

- 主运行环境：Node.js + Windows
- 计划新增外部依赖（非 npm）：
  - OCR：`tesseract.js`（npm）或本地 Tesseract
  - ASR：`whisper-node` / `node-whisper` 或 Python faster-whisper
  - CLIP：Python `open-clip-torch` + `torch` + `pillow`

### 2.3 与现有架构的集成点

- `DataCleaner.cleanRecord(schemaKey, data, meta)` 是统一入口。
- `data` 中若包含 `imagePath` / `attachments` / `audioPath`，应在 Pipeline 最前端新增 `MultimodalPreprocessor`。
- `QualityScorer.score()` 可扩展新的扣分维度（OCR/ASR confidence、CLIP consistency）。

---

## 三、Proposed Changes（验证实施内容）

### 变更 1：建立现有引擎基准测试集（Phase A）

**目标**：量化现有引擎在 7 张核心表上的清洗准确率，作为后续多模态模块的对比基线。

**新增文件**：
- `src/data-cleaning/benchmark/fixtures/customer-cases.json`：客户咨询场景（20 条）
- `src/data-cleaning/benchmark/fixtures/project-cases.json`：拍摄项目场景（15 条）
- `src/data-cleaning/benchmark/fixtures/product-cases.json`：成品发布场景（10 条）
- `src/data-cleaning/benchmark/fixtures/resource-cases.json`：资源/名片场景（15 条）
- `src/data-cleaning/benchmark/fixtures/chat-cases.json`：聊天记录/非结构化文本场景（20 条）
- `src/data-cleaning/benchmark/fixtures/batch-cases.json`：批量导入边界场景（10 条）
- `src/data-cleaning/benchmark/run-benchmark.js`：基准测试运行器
- `src/data-cleaning/benchmark/metrics.js`：指标计算工具（准确率、召回率、F1）

**测试用例结构**（每个 fixture）：
```json
{
  "id": "customer-001",
  "schemaKey": "customer",
  "description": "手机号含横杠，姓名含前后空格",
  "input": {
    "客户姓名": "  李婷  ",
    "联系方式": "138-1234-5678",
    "来源渠道": "小红书",
    "预算区间": "3000-5000元",
    "咨询时间": "2025-06-26"
  },
  "expected": {
    "cleanedData": {
      "客户姓名": "李婷",
      "联系方式": "13812345678",
      "预算区间": "3000-5000元"
    },
    "expectedCorrections": [
      { "field": "客户姓名", "original": "  李婷  ", "corrected": "李婷" },
      { "field": "联系方式", "original": "138-1234-5678", "corrected": "13812345678" }
    ],
    "expectedStatus": "passed",
    "minScore": 90
  }
}
```

**评估指标**：
1. **字段清洗准确率**：`(清洗后值与 expected 一致的字段数) / (总非空字段数) × 100%`
2. **同义词映射召回率**：`(正确映射到标准枚举的用例数) / (含同义词用例总数) × 100%`
3. **必填字段拦截率**：`(缺少必填字段被标记为 failed 的用例数) / (缺少必填字段用例总数) × 100%`
4. **质量分误差**：`|实际得分 - expected.minScore| ≤ 5 分视为通过`
5. **端到端通过率**：`(success 状态符合 expected 的用例数) / (总用例数) × 100%`

**运行命令**：
```bash
node src/data-cleaning/benchmark/run-benchmark.js
```

**输出**：`docs/reports/benchmark_YYYYMMDD_HHmmss.md`

**验收标准**：
- 字段清洗准确率 ≥ 95%
- 同义词映射召回率 ≥ 90%
- 必填字段拦截率 ≥ 95%
- 端到端通过率 ≥ 95%
- 原有 `node src/data-cleaning/test-integration.js` 无失败

---

### 变更 2：OCR 模块验证方案（Phase B）

**目标**：验证图片文字提取的准确率，以及 OCR 结果接入清洗引擎后的字段解析准确率。

**新增文件**：
- `src/data-cleaning/multimodal/ocr/test-ocr.js`：OCR 单元验证脚本
- `src/data-cleaning/multimodal/ocr/fixtures/`：测试图片目录（按场景分类）
  - `business-cards/`：名片图片 10 张（含姓名、手机号、微信、地址、经营范围）
  - `chat-screenshots/`：聊天截图 10 张（含咨询时间、预算、风格、联系方式）
  - `contract-screenshots/`：合同/订单截图 5 张（含金额、日期、项目名称）
- `src/data-cleaning/multimodal/ocr/ground-truth.json`：每张图片的人工标注真值

**测试图片准备要求**：
1. 使用真实业务场景图片（需脱敏处理，姓名、手机号做虚构替换）。
2. 每张图片必须配套 `ground-truth.json` 条目：
```json
{
  "image": "business-cards/card-001.png",
  "scene": "business-card",
  "expectedText": "张三 13800138000 微信 zhangsan001 北京朝阳区",
  "expectedFields": {
    "资源名称": "张三",
    "联系方式": "13800138000",
    "备注": "微信 zhangsan001"
  }
}
```

**评估指标**：
1. **字符准确率（CRA）**：`(OCR 结果与真值匹配字符数) / (真值总字符数) × 100%`
2. **字段提取准确率**：`(成功提取到 expectedFields 中关键字段的图片数) / (总图片数) × 100%`
3. **清洗后字段准确率**：OCR 提取文本经 `cleanRecord('resource', parsedData)` 后的字段准确率
4. **引擎可用性**：Tesseract 是否安装、中文语言包是否加载、飞书 API 是否可降级

**运行命令**：
```bash
node src/data-cleaning/multimodal/ocr/test-ocr.js
```

**输出**：`docs/reports/ocr_benchmark_YYYYMMDD_HHmmss.md`

**验收标准**：
| 场景 | 字符准确率 | 字段提取准确率 |
|------|-----------|---------------|
| 名片 | ≥ 85% | ≥ 80% |
| 聊天截图 | ≥ 70% | ≥ 65% |
| 合同/订单截图 | ≥ 80% | ≥ 75% |

**失败回退验证**：
- 当 Tesseract 未安装时，脚本应提示安装指引，不崩溃。
- 当 OCR confidence < 0.7 时，应生成 warning 并尝试飞书 API（若配置）。

---

### 变更 3：ASR 模块验证方案（Phase C）

**目标**：验证语音转文本的准确率，以及 ASR 结果接入清洗引擎后的字段解析准确率。

**新增文件**：
- `src/data-cleaning/multimodal/asr/test-asr.js`：ASR 单元验证脚本
- `src/data-cleaning/multimodal/asr/fixtures/`：测试音频目录
  - `consult-voice/`：客户咨询语音 10 段（每段 10-60 秒）
  - `wechat-silk/`：微信语音 `.silk` 文件 5 段
- `src/data-cleaning/multimodal/asr/ground-truth.json`：人工转写真值

**测试音频准备要求**：
1. 由项目成员录制或收集脱敏后的真实咨询语音。
2. 每段音频配套真值文本，标注关键字段：
```json
{
  "audio": "consult-voice/voice-001.mp3",
  "duration": 23,
  "scene": "consult",
  "expectedText": "喂你好，我想咨询一下亲子照，预算大概三千到五千，喜欢日系清新风格，我手机号是13800138000。",
  "expectedFields": {
    "拍摄类型": "亲子",
    "预算区间": "3000-5000元",
    "意向风格": ["日系清新"],
    "联系方式": "13800138000"
  }
}
```

**评估指标**：
1. **词错误率（WER）**：`(插入 + 删除 + 替换词数) / (真值总词数) × 100%`
2. **关键字段提取准确率**：从 ASR 文本中提取手机号、预算、风格、类型的准确率
3. **清洗后字段准确率**：ASR 文本经 `cleanRecord('customer', parsedData)` 后的字段准确率
4. **silk 转换成功率**：`(成功转换为 wav/mp3 的 silk 文件数) / (总 silk 文件数) × 100%`

**运行命令**：
```bash
node src/data-cleaning/multimodal/asr/test-asr.js
```

**输出**：`docs/reports/asr_benchmark_YYYYMMDD_HHmmss.md`

**验收标准**：
- 中文 WER ≤ 20%
- 关键字段提取准确率 ≥ 80%
- 清洗后字段准确率 ≥ 75%
- 微信 silk 转换成功率 ≥ 90%

**特殊验证点**：
- 验证 ASR 文本中的口语词（"嗯"、"那个"、"啊"）是否被 `sanitizeText` 正确过滤或标记。
- 验证自然语言日期（"下周三"、"下个月"）是否能被 `parseDate` 正确解析。

---

### 变更 4：CLIP 模块验证方案（Phase D）

**目标**：验证成品图片与标题/文案的语义一致性，以及风格分类的准确率。

**新增文件**：
- `src/data-cleaning/multimodal/clip/test-clip.js`：CLIP 单元验证脚本
- `src/data-cleaning/multimodal/clip/fixtures/`：测试图片目录
  - `matched/`：图文匹配图片 10 张（如标题"日系清新亲子照"配明亮清新图片）
  - `mismatched/`：图文不匹配图片 10 张（如标题"日系清新"配暗调情绪图片）
- `src/data-cleaning/multimodal/clip/ground-truth.json`：人工标注真值

**测试图片准备要求**：
1. 从项目成品库中选取 20 组样本，人工判定是否匹配。
2. 每组样本包含：图片路径、标题、文案、真实风格标签、是否匹配标签。
```json
{
  "image": "matched/sample-001.jpg",
  "title": "日系清新亲子照 | 阳光下的温馨时刻",
  "copy": "#日系清新 #亲子照 #儿童摄影",
  "trueStyle": "日系清新",
  "matched": true
}
```

**评估指标**：
1. **图文匹配分类准确率**：`(CLIP 判断与真值一致的样本数) / (总样本数) × 100%`
2. **风格分类 Top-1 准确率**：`(Top-1 风格与真值一致的样本数) / (总样本数) × 100%`
3. **风格分类 Top-2 召回率**：`(真值风格出现在 Top-2 的样本数) / (总样本数) × 100%`
4. **ROC/AUC**：通过调整阈值绘制 ROC 曲线，选择最佳阈值

**运行命令**：
```bash
# 先安装 Python 依赖
pip install open-clip-torch torch pillow
# 再运行 Node.js 测试
node src/data-cleaning/multimodal/clip/test-clip.js
```

**输出**：`docs/reports/clip_benchmark_YYYYMMDD_HHmmss.md`

**验收标准**：
- 图文匹配分类准确率 ≥ 80%
- 风格分类 Top-1 准确率 ≥ 70%
- 风格分类 Top-2 召回率 ≥ 85%
- ROC-AUC ≥ 0.80

**阈值选择方法**：
- 在验证脚本中计算 0.3-0.9 之间多个阈值的准确率，选择使 F1 最大的阈值。
- 将最佳阈值写入 `src/data-cleaning/config/cleaning-rules.json` 的 `clipThreshold`。

---

### 变更 5：多模态 Pipeline 集成验证（Phase E）

**目标**：验证 OCR/ASR/CLIP 接入 `DataCleaner.cleanRecord` 后，整个流程仍稳定、向后兼容。

**新增文件**：
- `src/data-cleaning/test-multimodal-integration.js`：多模态集成测试
- `src/data-cleaning/examples/example-multimodal-clean.js`：多模态清洗示例

**测试用例设计**：

| 用例编号 | 输入类型 | 验证点 |
|---------|---------|--------|
| MM-001 | 仅结构化数据 | 不触发多模态，结果与原有测试一致 |
| MM-002 | 结构化 + imagePath | 触发 OCR，ocr_text 进入清洗，生成 corrections |
| MM-003 | 结构化 + audioPath | 触发 ASR，asr_text 进入清洗，生成 corrections |
| MM-004 | 结构化 + imagePath + audioPath | 同时触发 OCR + ASR |
| MM-005 | product schema + 图片 + 文案 | 触发 CLIP 一致性校验 |
| MM-006 | OCR 失败（无效图片路径） | 流程不崩溃，生成 warning，结构化清洗继续 |
| MM-007 | ASR 失败（无效音频路径） | 流程不崩溃，生成 warning，结构化清洗继续 |
| MM-008 | CLIP 失败（Python 未安装） | 流程不崩溃，生成 warning，结构化清洗继续 |

**运行命令**：
```bash
node src/data-cleaning/test-multimodal-integration.js
```

**验收标准**：
- 8 个集成用例全部通过
- 原有 `node src/data-cleaning/test-integration.js` 无失败
- 原有 9 个单元测试文件无失败

---

### 变更 6：质量评分扩展验证

**目标**：验证 OCR/ASR/CLIP 置信度是否被正确纳入质量评分。

**修改文件**：
- `src/data-cleaning/core/quality-scorer.js`：新增多模态扣分逻辑
- `src/data-cleaning/config/cleaning-rules.json`：新增 `multimodalScoring` 配置

**新增配置结构**：
```json
{
  "scoringWeights": {
    "multimodalScoring": {
      "ocrConfidence": {
        "enabled": true,
        "thresholds": {
          "high": 0.7,
          "low": 0.5
        },
        "deductions": {
          "high": 0,
          "medium": 5,
          "low": 10
        }
      },
      "asrConfidence": {
        "enabled": true,
        "thresholds": { "high": 0.7, "low": 0.5 },
        "deductions": { "high": 0, "medium": 5, "low": 10 }
      },
      "clipConsistency": {
        "enabled": true,
        "threshold": 0.6,
        "deduction": 5
      }
    }
  }
}
```

**验证指标**：
1. OCR confidence < 0.5 时，质量分比基础分低 10 分。
2. ASR confidence 0.5-0.7 时，质量分比基础分低 5 分。
3. CLIP 图文不匹配（score < threshold）时，质量分低 5 分。
4. 未启用多模态时，评分逻辑与原有实现一致。

---

## 四、Assumptions & Decisions（假设与决策）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| "SAR" 语义 | 按 ASR（自动语音识别）理解 | 上下文及现有文档均指向 ASR，属用户笔误 |
| OCR 验证引擎 | Tesseract 为主，飞书 API 为备选 | 与实施计划一致，优先本地离线方案 |
| ASR 验证引擎 | Whisper / faster-whisper 为主 | 开源可控，中文场景表现良好 |
| CLIP 验证引擎 | open-clip-torch | 中文图文匹配效果优于原版 CLIP |
| 测试数据脱敏 | 必须脱敏 | 涉及客户手机号、微信等敏感信息 |
| 报告输出位置 | `docs/reports/` | 与项目现有报告格式一致 |
| 失败判定 | 多模态模块失败不阻塞结构化清洗 | 保证向后兼容，符合现有引擎设计 |
| 验证顺序 | A → B → C → D → E | 先基线、后模块、再集成，降低定位成本 |

---

## 五、Verification Steps（详细验证步骤）

### Step 1：环境准备

1. 确认 Node.js 版本 ≥ 18。
2. 安装 Tesseract OCR（含中文语言包 `chi_sim`）。
3. 安装 Python 3.10+，并安装：
   ```bash
   pip install open-clip-torch torch pillow faster-whisper
   ```
4. 安装 FFmpeg（用于微信 silk 格式转换）。
5. 确认 `lark-cli` 已认证（用于飞书 OCR/妙记 API 降级验证）。

### Step 2：运行现有引擎回归测试

```bash
node src/data-cleaning/test-integration.js
```

- 期望输出：所有测试通过（≥ 409 项断言通过）。
- 若失败，先修复再进入 Phase A。

### Step 3：执行 Phase A 基准测试

```bash
node src/data-cleaning/benchmark/run-benchmark.js
```

- 检查 `docs/reports/benchmark_YYYYMMDD_HHmmss.md`。
- 确认字段清洗准确率、同义词召回率、必填字段拦截率达到验收标准。

### Step 4：执行 Phase B OCR 验证

```bash
node src/data-cleaning/multimodal/ocr/test-ocr.js
```

- 检查 `docs/reports/ocr_benchmark_YYYYMMDD_HHmmss.md`。
- 确认名片、聊天截图、合同截图三类场景达标。

### Step 5：执行 Phase C ASR 验证

```bash
node src/data-cleaning/multimodal/asr/test-asr.js
```

- 检查 `docs/reports/asr_benchmark_YYYYMMDD_HHmmss.md`。
- 确认 WER ≤ 20%，关键字段提取准确率 ≥ 80%。

### Step 6：执行 Phase D CLIP 验证

```bash
node src/data-cleaning/multimodal/clip/test-clip.js
```

- 检查 `docs/reports/clip_benchmark_YYYYMMDD_HHmmss.md`。
- 确认分类准确率 ≥ 80%，并记录最佳阈值。

### Step 7：执行 Phase E 集成验证

```bash
node src/data-cleaning/test-multimodal-integration.js
```

- 确认 8 个集成用例全部通过。
- 再次运行回归测试：
  ```bash
  node src/data-cleaning/test-integration.js
  ```

### Step 8：质量评分扩展验证

1. 构造包含低 confidence OCR/ASR 的测试数据。
2. 调用 `createQualityScorer().score()`。
3. 确认扣分逻辑与配置一致。

### Step 9：生成总体验证报告

汇总以上所有报告，生成：
- `docs/reports/multimodal-verification-summary_YYYYMMDD.md`

报告结构：
1. 执行摘要
2. 各阶段测试结果与达标情况
3. 未达标项及改进建议
4. 风险评估
5. 下一步行动计划

---

## 六、风险与回退策略

| 风险 | 影响 | 回退策略 |
|------|------|---------|
| Tesseract 中文识别准确率低 | OCR 验收不达标 | 切换为飞书 OCR API 或商业 OCR 服务 |
| Whisper 模型下载失败/过大 | ASR 无法本地运行 | 使用 tiny 模型或切换为飞书妙记 API |
| 微信 silk 转换失败 | ASR 无法处理微信语音 | 提供 FFmpeg 备选方案，或要求用户先转换格式 |
| Python 环境缺失 | CLIP/ASR 无法运行 | 在验证报告中标记为环境阻塞，提供一键安装脚本 |
| 测试样本不足 | 验证结果置信度低 | 明确标注样本量，建议补充后复测 |
| 新模块破坏旧流程 | 回归测试失败 | 启用 feature flag，默认关闭多模态 |

---

## 七、实施顺序与工作量

| 阶段 | 主要任务 | 预估工作量 | 前置依赖 |
|------|---------|-----------|---------|
| Phase A | 创建基准测试集 + 运行器 + 报告 | 1-2 天 | 无 |
| Phase B | OCR 测试图片 + 验证脚本 + 报告 | 1-2 天 | Phase A |
| Phase C | ASR 测试音频 + 验证脚本 + 报告 | 1-2 天 | Phase A |
| Phase D | CLIP 测试样本 + 验证脚本 + 报告 | 1-2 天 | Phase A |
| Phase E | 集成测试 + 回归验证 + 总报告 | 1 天 | Phase B/C/D |
| **合计** | — | **5-9 天** | — |

---

## 八、文件清单（新增与修改）

### 新增文件
- `src/data-cleaning/benchmark/fixtures/*.json`（6 个 fixture 文件）
- `src/data-cleaning/benchmark/run-benchmark.js`
- `src/data-cleaning/benchmark/metrics.js`
- `src/data-cleaning/multimodal/ocr/test-ocr.js`
- `src/data-cleaning/multimodal/ocr/fixtures/*`
- `src/data-cleaning/multimodal/ocr/ground-truth.json`
- `src/data-cleaning/multimodal/asr/test-asr.js`
- `src/data-cleaning/multimodal/asr/fixtures/*`
- `src/data-cleaning/multimodal/asr/ground-truth.json`
- `src/data-cleaning/multimodal/clip/test-clip.js`
- `src/data-cleaning/multimodal/clip/fixtures/*`
- `src/data-cleaning/multimodal/clip/ground-truth.json`
- `src/data-cleaning/test-multimodal-integration.js`
- `src/data-cleaning/examples/example-multimodal-clean.js`

### 修改文件
- `src/data-cleaning/core/data-cleaner.js`（新增 `preprocessMultimodal`）
- `src/data-cleaning/core/quality-scorer.js`（新增多模态扣分）
- `src/data-cleaning/config/cleaning-rules.json`（新增多模态评分配置）

### 输出报告
- `docs/reports/benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/ocr_benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/asr_benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/clip_benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/multimodal-verification-summary_YYYYMMDD.md`
