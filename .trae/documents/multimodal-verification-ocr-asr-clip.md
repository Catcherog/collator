# 多模态验证能力扩展计划：OCR + ASR + CLIP

## 一、Summary（摘要）

本计划目标是在现有 `src/data-cleaning/` 结构化数据清洗引擎的基础上，扩展**多模态输入验证能力**：

1. **验证现有引擎**：建立覆盖 7 张核心表、典型业务场景的基准测试集，量化评估清洗准确率。
2. **OCR（光学字符识别）**：处理客户沟通截图、名片、合同、订单截图等图片，提取文字后进入现有清洗流程。
3. **ASR（自动语音识别）**：处理微信/聊天语音消息，转写为文本后进入现有清洗流程。
4. **CLIP（图文一致性校验）**：对成品发布时的素材图片与标题/文案做匹配度校验。

所有新增能力将以**可插拔模块**形式集成到现有 `src/data-cleaning/` 中，不破坏当前工作流。

---

## 二、Current State Analysis（当前状态分析）

### 2.1 已有能力（基于实际代码）

| 能力 | 位置 | 状态 |
|------|------|------|
| 结构化数据清洗引擎 | `src/data-cleaning/core/` | ✅ 已成熟运行，409 项测试全部通过 |
| 字段类型/枚举/逻辑校验 | `src/data-cleaning/rules/index.js` | ✅ 已实现 |
| 数据质量评分 | `src/data-cleaning/core/quality-scorer.js` | ✅ 已实现 |
| 同义词映射与自学习 | `src/data-cleaning/core/rule-learning.js` | ✅ 已实现 |
| 批量处理与报告 | `src/data-cleaning/core/batch-processor.js` | ✅ 已实现 |
| 存量数据扫描 | `src/data-cleaning/core/data-scanner.js` | ✅ 已实现 |
| 图片元数据提取（fileToken/下载/上传） | `src/scripts/temp/extract_images.js` 等 | ⚠️ 仅限飞书表格内嵌图片处理，不做文字识别 |
| OCR 实现 | 无 | ❌ 仅在文档层规划 |
| ASR 实现 | 无 | ❌ 仅在文档层规划 |
| CLIP 实现 | 无 | ❌ 未规划 |

### 2.2 当前依赖栈

```json
{
  "dependencies": {
    "docx": "^9.7.1"
  }
}
```

- 主运行环境：Node.js + Windows PowerShell
- 飞书 API：`lark-cli.exe`
- 无 Python/ML/CV 依赖

### 2.3 现有痛点

1. 非结构化输入（图片、语音）无法直接进入数据摄入流程。
2. 现有 409 项测试多为单元/集成测试，缺少针对真实业务语料的**准确率评估**。
3. 无法验证素材图片与文案是否一致（例如"日系清新"标题配图是否是暗调情绪风格）。

---

## 三、Proposed Changes（计划变更）

### 变更 1：现有引擎验证基准测试集（高优先级）

**目标**：建立可重复运行的基准测试，量化现有引擎准确率。

**新增文件**：
- `src/data-cleaning/benchmark/fixtures/customer-cases.json`：客户咨询场景测试用例
- `src/data-cleaning/benchmark/fixtures/chat-cases.json`：聊天记录场景测试用例
- `src/data-cleaning/benchmark/fixtures/ocr-cases.json`：OCR 名片/合同场景测试用例
- `src/data-cleaning/benchmark/fixtures/batch-cases.json`：批量导入场景测试用例
- `src/data-cleaning/benchmark/run-benchmark.js`：基准测试运行器
- `src/data-cleaning/benchmark/README.md`：测试集说明（可选，若用户不要求则不创建）

**每个测试用例结构**：
```json
{
  "id": "customer-001",
  "input": { "客户姓名": "李婷", "联系方式": "138-1234-5678", ... },
  "expected": {
    "cleanedData": { "联系方式": "13812345678" },
    "expectedCorrections": [{"field": "联系方式", "corrected": "13812345678"}],
    "expectedStatus": "passed",
    "minScore": 90
  }
}
```

**评估指标**：
- 字段清洗准确率（清洗后值与 expected 一致的比例）
- 同义词映射召回率（如"小清新"是否被正确映射到"日系清新"）
- 必填字段拦截率（缺少手机号的用例是否被正确标记 failed）
- 质量分误差（实际得分与 expected 范围是否匹配）
- 端到端通过率（整个流程无报错的比例）

**实现方式**：
- 在 `run-benchmark.js` 中读取 fixtures，调用 `createCleaner().cleanRecord()`、`validateRecord()`、`createQualityScorer().score()`。
- 输出 Markdown 报告到 `docs/reports/benchmark_YYYYMMDD_HHmmss.md`。

---

### 变更 2：OCR 模块（高优先级）

**目标**：将图片中的文字提取为结构化文本，再送入现有清洗引擎。

**新增目录与文件**：
- `src/data-cleaning/multimodal/ocr/index.js`：OCR 模块入口
- `src/data-cleaning/multimodal/ocr/tesseract-adapter.js`：本地 Tesseract OCR 适配器
- `src/data-cleaning/multimodal/ocr/feishu-ocr-adapter.js`：飞书图片识别 API 适配器（云端备选）
- `src/data-cleaning/multimodal/ocr/business-card-parser.js`：名片解析器（基于 OCR 文本 + 正则）
- `src/data-cleaning/multimodal/ocr/contract-parser.js`：合同/订单解析器
- `src/data-cleaning/multimodal/ocr/test-ocr.js`：OCR 模块测试

**OCR 引擎选型**：

| 引擎 | 优势 | 劣势 | 推荐场景 |
|------|------|------|---------|
| Tesseract OCR（本地） | 免费、离线、可控 | 中文准确率一般，需安装中文语言包 | 默认本地处理 |
| 飞书图片识别 API | 中文准确率高，无需本地环境 | 需联网、API 限频、可能有成本 | 高准确率要求时 |

**默认策略**：
- 优先尝试 Tesseract（本地）。
- 若 Tesseract 未安装或置信度 < 0.7，降级为仅提取文件名 + 飞书 API 备选。

**关键接口**：
```js
async function extractText(imagePath, options = { engine: 'tesseract' })
// 返回 { text: string, confidence: number, engine: string, words: [] }
```

**名片解析流程**：
```
图片 → OCR 提取文本 → 正则匹配姓名/电话/地址/经营范围
    → 映射到 resource.json schema（资源总库主表）
    → 调用 cleaner.cleanRecord('resource', parsedData)
```

**与现有流程集成**：
- 在 `src/data-cleaning/core/data-cleaner.js` 的 `cleanRecord` 中，若输入包含 `imagePath` 或 `attachments`，先调用 OCR 模块提取 `ocr_text`。
- 将 `ocr_text` 与原始文本合并后进入常规清洗。

**验证方式**：
- 准备 10-20 张测试图片（名片、聊天截图、合同截图），对比 OCR 结果与人工标注。
- 目标：中文准确率 ≥ 85%（名片场景），≥ 70%（聊天截图）。

---

### 变更 3：ASR 模块（高优先级）

**目标**：将微信/聊天语音转写为文本，再送入现有清洗引擎。

**新增目录与文件**：
- `src/data-cleaning/multimodal/asr/index.js`：ASR 模块入口
- `src/data-cleaning/multimodal/asr/local-whisper-adapter.js`：本地 Whisper 适配器（OpenAI Whisper / faster-whisper）
- `src/data-cleaning/multimodal/asr/feishu-minutes-adapter.js`：飞书妙记 API 适配器
- `src/data-cleaning/multimodal/asr/wechat-voice-converter.js`：微信语音格式转换（silk → wav/mp3）
- `src/data-cleaning/multimodal/asr/test-asr.js`：ASR 模块测试

**ASR 引擎选型**：

| 引擎 | 优势 | 劣势 | 推荐场景 |
|------|------|------|---------|
| 飞书妙记 API | 中文效果好，与现有飞书生态集成 | 异步、耗时、需上传文件 | 云端长语音 |
| Whisper（本地） | 开源、多语言、可控 | 需 Python 环境和模型下载 | 本地短语音、批量 |

**微信语音特殊处理**：
- 微信语音常见格式为 `.silk`（Silk V3 编码）。
- 需要先用 `silk-v3-decoder` 或 FFmpeg 转换为 `.wav` 或 `.mp3`。
- 转换失败时记录错误，不阻塞流程。

**关键接口**：
```js
async function transcribe(audioPath, options = { engine: 'whisper' })
// 返回 { text: string, confidence: number, engine: string, duration: number }
```

**与现有流程集成**：
- 在 `cleanRecord` 中，若输入包含 `audioPath`，先调用 ASR 模块。
- ASR 结果进入 `cleanRecord` 的 `input` 中作为文本字段处理。
- 由于 ASR 文本口语化严重，需增强 `sanitizeText` 和 `parseDate` 对口语表达的识别（如"那个"、"嗯"过滤）。

**验证方式**：
- 准备 10 段测试语音（包含客户咨询常见表达）。
- 对比 ASR 文本与人工转写，计算 WER（词错误率）。
- 目标：中文 WER ≤ 20%。

---

### 变更 4：CLIP 模块（中优先级）

**目标**：验证成品发布的图片与标题/文案是否语义一致。

**新增目录与文件**：
- `src/data-cleaning/multimodal/clip/index.js`：CLIP 模块入口
- `src/data-cleaning/multimodal/clip/python-bridge.js`：Node.js 调用 Python CLIP 脚本的桥接
- `src/data-cleaning/multimodal/clip/clip_service.py`：Python CLIP 推理服务（基于 `open-clip` 或 `transformers`）
- `src/data-cleaning/multimodal/clip/style-classifier.js`：图片风格分类器（将图片映射到"日系清新"等风格标签）
- `src/data-cleaning/multimodal/clip/test-clip.js`：CLIP 模块测试

**技术选型**：
- 使用 Python 运行 CLIP 模型（Node.js 生态无成熟 CLIP 实现）。
- 方案 A：`open-clip` + `PyTorch`，支持多语言图文匹配。
- 方案 B：调用 Hugging Face `transformers` 的 CLIP 模型。
- 推荐方案 A，因为 open-clip 对中文支持更好。

**架构设计**：
```
Node.js 清洗引擎
    ↓ 调用 python-bridge.js
Python CLIP 服务（clip_service.py）
    ↓ 返回图文相似度 + 风格标签
Node.js 接收结果并写入校验报告
```

**关键接口**：
```js
async function checkImageTextConsistency(imagePath, text)
// 返回 { score: 0-1, matched: boolean, styleTags: [...], confidence: number }
```

**风格分类实现**：
- 对每个风格标签（日系清新、韩系唯美等）生成提示词：
  - `"日系清新风格的摄影作品"`
  - `"韩系唯美风格的写真照片"`
- 计算图片与各提示词的相似度，取 Top-1 和 Top-2 作为风格推断结果。

**与现有流程集成**：
- 在 `validateRecord` 对 `product.json`（成品发布与运营数据表）校验时：
  - 若存在图片附件 + 文案/标题，调用 CLIP 检查一致性。
  - 不一致时生成 warning，建议人工复核。

**验证方式**：
- 准备 20 组测试图片-文案对（10 组匹配，10 组不匹配）。
- 计算 ROC 曲线，选择最佳阈值。
- 目标：匹配/不匹配分类准确率 ≥ 80%。

---

### 变更 5：多模态清洗 Pipeline 集成

**目标**：让 `cleanRecord` 自动感知并调用 OCR/ASR/CLIP。

**修改文件**：
- `src/data-cleaning/core/data-cleaner.js`

**修改内容**：
1. 在 `cleanRecord` 前增加 `preprocessMultimodal` 步骤：
   ```js
   async function preprocessMultimodal(input, schemaKey) {
     const enriched = { ...input };
     if (input.imagePath || input.attachments?.some(isImage)) {
       const ocr = await extractText(input.imagePath);
       enriched.ocr_text = ocr.text;
       enriched.ocr_confidence = ocr.confidence;
     }
     if (input.audioPath) {
       const asr = await transcribe(input.audioPath);
       enriched.asr_text = asr.text;
       enriched.asr_confidence = asr.confidence;
     }
     return enriched;
   }
   ```
2. 对 `product.json` 增加 CLIP 一致性校验调用。

---

### 变更 6：质量评分扩展

**目标**：将多模态置信度纳入质量评分。

**修改文件**：
- `src/data-cleaning/core/quality-scorer.js`
- `src/data-cleaning/config/cleaning-rules.json`

**新增评分维度**：
- OCR 置信度扣分：confidence < 0.7 扣 5 分，< 0.5 扣 10 分。
- ASR 置信度扣分：confidence < 0.7 扣 5 分，< 0.5 扣 10 分。
- CLIP 一致性扣分：图文不匹配扣 5 分。

---

## 四、Assumptions & Decisions（假设与决策）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| OCR 默认引擎 | Tesseract（本地） | 免费离线，Trae 端可直接安装运行 |
| OCR 云端备选 | 飞书图片识别 API | 与现有飞书生态一致，中文准确率高 |
| ASR 默认引擎 | Whisper（本地） | 开源可控，支持中文，适合批量语音 |
| ASR 云端备选 | 飞书妙记 API | 中文场景效果好，适合长语音 |
| CLIP 运行方式 | Python 子进程桥接 | Node.js 无成熟 CLIP 实现，Python 生态完善 |
| 微信语音格式 | 先 silk → wav 再 ASR | 微信语音为 silk 编码，必须转换 |
| 模块位置 | `src/data-cleaning/multimodal/` | 与现有清洗引擎同层，便于集成 |
| 是否修改表结构 | 否 | 仅在现有字段上工作（如 ocr_text 已在 schema 中规划） |
| 批量删除禁令 | 继续生效 | 本项目安全约束 P0 最高优先级 |

---

## 五、Verification Steps（验证步骤）

### 5.1 现有引擎验证

1. 运行 `node src/data-cleaning/benchmark/run-benchmark.js`
2. 检查输出报告中的字段清洗准确率、同义词映射召回率、必填字段拦截率。
3. 目标：清洗准确率 ≥ 95%，同义词召回率 ≥ 90%。

### 5.2 OCR 验证

1. 安装 Tesseract 中文语言包。
2. 运行 `node src/data-cleaning/multimodal/ocr/test-ocr.js`。
3. 检查 10-20 张测试图片的 OCR 准确率。
4. 目标：名片场景 ≥ 85%，聊天截图 ≥ 70%。

### 5.3 ASR 验证

1. 安装 Whisper 或 faster-whisper。
2. 运行 `node src/data-cleaning/multimodal/asr/test-asr.js`。
3. 检查 10 段测试语音的 WER。
4. 目标：中文 WER ≤ 20%。

### 5.4 CLIP 验证

1. 安装 Python 依赖：`pip install open-clip-torch torch pillow`。
2. 运行 `node src/data-cleaning/multimodal/clip/test-clip.js`。
3. 检查 20 组图文对的匹配准确率。
4. 目标：分类准确率 ≥ 80%。

### 5.5 集成验证

1. 运行所有现有测试：`node src/data-cleaning/test-integration.js`
2. 确保原有 409 项测试无回归失败。
3. 运行端到端多模态示例脚本（新增）。

---

## 六、风险与依赖

| 风险 | 影响 | 应对 |
|------|------|------|
| Tesseract 中文识别准确率低 | OCR 整体效果差 | 提供飞书 OCR API 降级方案 |
| Whisper 模型下载大/慢 | 首次部署慢 | 使用 faster-whisper 或 tiny 模型 |
| 微信 silk 格式转换失败 | ASR 无法处理微信语音 | 提供 FFmpeg 降级方案 |
| Python 环境缺失 | CLIP/ASR 无法运行 | 在 README 中明确 Python 3.10+ 依赖 |
| 飞书 API 限频 | OCR/ASR 批量处理慢 | 内置限频 + 分批处理 |
| 现有测试回归 | 新模块破坏旧逻辑 | 所有修改保持向后兼容，CI 跑全量测试 |

---

## 七、实施顺序建议

1. **Phase A（1-2 天）**：现有引擎基准测试集 + 准确率评估报告。
2. **Phase B（2-3 天）**：OCR 模块 + 名片/合同解析 + 与清洗引擎集成。
3. **Phase C（2-3 天）**：ASR 模块 + 微信语音转换 + 与清洗引擎集成。
4. **Phase D（2-3 天）**：CLIP 模块 + 风格分类 + 成品一致性校验。
5. **Phase E（1 天）**：端到端集成测试 + 多模态示例脚本 + 文档。

**总预估工作量**：8-12 天（取决于本地 ML 环境准备时间）。
