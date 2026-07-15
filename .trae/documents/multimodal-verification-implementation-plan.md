# 多模态验证实施计划：完成 OCR / ASR / CLIP 验证框架与集成测试

> **计划目标**：基于已有的 `.trae/documents/multimodal-verification-plan.md` 总体规划，补齐剩余实现工作，使 OCR、ASR、CLIP 三大模块具备可运行的验证脚本，并完成端到端集成测试与基准回归验证。
> **适用范围**：`src/data-cleaning/` 数据清洗引擎及其多模态扩展
> **创建日期**：2026-06-26

---

## 一、Summary（计划摘要）

本计划聚焦**实施落地**，完成以下 4 项核心工作：

| 阶段 | 任务 | 核心产出 | 验收标准 |
|------|------|---------|---------|
| Phase C 收尾 | ASR 模块验证框架补全 | 可运行的 `test-asr.js` + 报告 | 脚本可执行，缺失音频时跳过不崩溃 |
| Phase D | CLIP 模块验证框架 | `test-clip.js` + Python bridge + fixtures | 匹配/不匹配分类准确率 ≥ 80%（在有样本时） |
| Phase E | 多模态集成测试 | `test-multimodal-integration.js` | 8 个集成用例全部通过 |
| 回归验证 | 基准测试与集成测试运行 | 报告文件到 `docs/reports/` | 原有 409 项断言无失败，基准指标达标 |

**总体原则**：
1. **不重复造轮子**：复用已有的 `benchmark/metrics.js` 计算指标。
2. **向后兼容**：多模态模块默认不强制启用，失败不阻塞结构化清洗。
3. **可重复运行**：所有脚本支持 `node <script>` 一键执行。
4. **渐进式验证**：先单模块，后集成，最后全量回归。

---

## 二、Current State Analysis（现状分析）

### 2.1 已完成的组件

| 组件 | 文件路径 | 状态 |
|------|---------|------|
| 结构化清洗引擎 | `src/data-cleaning/core/data-cleaner.js` | ✅ 已成熟运行 |
| 质量评分器 | `src/data-cleaning/core/quality-scorer.js` | ✅ 已实现 |
| 规则校验 | `src/data-cleaning/rules/index.js` | ✅ 已实现 |
| 基准指标工具 | `src/data-cleaning/benchmark/metrics.js` | ✅ 已实现（含 WER、CRA、字段准确率） |
| 基准测试运行器 | `src/data-cleaning/benchmark/run-benchmark.js` | ✅ 已实现 |
| 基准测试用例 | `src/data-cleaning/benchmark/fixtures/*.json` | ✅ 6 个文件均已创建 |
| OCR 模块入口 | `src/data-cleaning/multimodal/ocr/index.js` | ✅ 已封装 Tesseract + 飞书 OCR |
| OCR 适配器 | `src/data-cleaning/multimodal/ocr/tesseract-adapter.js` | ✅ 已实现 |
| OCR 适配器 | `src/data-cleaning/multimodal/ocr/feishu-ocr-adapter.js` | ✅ 已实现 |
| OCR 解析器 | `src/data-cleaning/multimodal/ocr/business-card-parser.js` | ✅ 已实现 |
| OCR 验证脚本 | `src/data-cleaning/multimodal/ocr/test-ocr.js` | ✅ 已实现 |
| OCR 真值 | `src/data-cleaning/multimodal/ocr/ground-truth.json` | ✅ 已创建 |
| ASR 模块入口 | `src/data-cleaning/multimodal/asr/index.js` | ✅ 已封装 Whisper + 飞书妙记 |
| ASR 本地适配器 | `src/data-cleaning/multimodal/asr/local-whisper-adapter.js` | ✅ 已实现 |
| ASR 飞书适配器 | `src/data-cleaning/multimodal/asr/feishu-minutes-adapter.js` | ✅ 已实现 |
| 微信语音转换 | `src/data-cleaning/multimodal/asr/wechat-voice-converter.js` | ✅ 已实现 |
| ASR 验证脚本 | `src/data-cleaning/multimodal/asr/test-asr.js` | ✅ 已实现 |
| ASR 真值 | `src/data-cleaning/multimodal/asr/ground-truth.json` | ✅ 已创建 |

### 2.2 待完成的组件

| 组件 | 文件路径 | 状态 |
|------|---------|------|
| CLIP 模块入口 | `src/data-cleaning/multimodal/clip/index.js` | ❌ 未创建 |
| CLIP Python 桥接 | `src/data-cleaning/multimodal/clip/python-bridge.js` | ❌ 未创建 |
| CLIP Python 服务 | `src/data-cleaning/multimodal/clip/clip_service.py` | ❌ 未创建 |
| CLIP 验证脚本 | `src/data-cleaning/multimodal/clip/test-clip.js` | ❌ 未创建 |
| CLIP 真值 | `src/data-cleaning/multimodal/clip/ground-truth.json` | ❌ 未创建 |
| 多模态集成测试 | `src/data-cleaning/test-multimodal-integration.js` | ❌ 未创建 |
| 多模态清洗示例 | `src/data-cleaning/examples/example-multimodal-clean.js` | ❌ 未创建（可选） |

### 2.3 关键依赖

```json
{
  "dependencies": {
    "docx": "^9.7.1"
  }
}
```

- 主运行环境：Node.js + Windows PowerShell 5
- 计划新增外部依赖：
  - OCR：`tesseract.js` 或本地 Tesseract（已具备适配器）
  - ASR：`faster-whisper` Python 包（已具备适配器）
  - CLIP：`open-clip-torch`、`torch`、`pillow` Python 包

---

## 三、Proposed Changes（实施内容）

### 变更 1：Phase C 收尾 —— 验证 ASR 脚本运行无阻塞

**目标**：确保 `test-asr.js` 在缺失真实音频文件或 Python 环境时仍能优雅跳过并生成报告。

**文件**：`src/data-cleaning/multimodal/asr/test-asr.js`

**操作内容**：
1. 保持现有逻辑不变。
2. 在 `runASRBenchmark` 末尾增加验收标准检查：
   - 若 `validResults.length === 0`，输出提示“未找到可验证音频，请补充 fixtures 后重试”，并以退出码 `0` 结束（环境缺失不等于验证失败）。
   - 若存在有效结果，按 WER ≤ 20%、字段准确率 ≥ 80% 判定是否达标，不达标时退出码 `1`。

**验收标准**：
- 缺失音频时脚本不崩溃。
- 有音频时正常计算 WER 与字段准确率。

---

### 变更 2：Phase D —— 创建 CLIP 模块验证框架

**目标**：实现图文一致性校验能力，支持成品图片与标题/文案的匹配验证。

**新增文件 2.1**：`src/data-cleaning/multimodal/clip/clip_service.py`

**作用**：Python 端 CLIP 推理服务，通过 `open-clip-torch` 计算图片与文本的相似度。

**实现要点**：
- 命令行参数：接收图片路径和文本列表（JSON 格式）。
- 输出：JSON，包含 `similarities`（各文本与图片的相似度分数）、`bestMatch`（最匹配文本索引）、`bestScore`。
- 加载模型：`ViT-B-32` + `openai` 预训练权重，设备优先 CPU。
- 预处理：使用 `clip_transform` 将图片 resize 并 normalize。

**新增文件 2.2**：`src/data-cleaning/multimodal/clip/python-bridge.js`

**作用**：Node.js 调用 Python CLIP 服务的桥接层。

**实现要点**：
- 函数 `checkPythonAvailable()`：检测 `python` 命令及 `open_clip` 是否可导入。
- 函数 `computeSimilarity(imagePath, texts, options)`：
  - 将 `texts` 编码为 JSON 字符串通过 stdin 或命令行参数传递给 Python。
  - 解析 Python 返回的 JSON。
  - 失败时抛出明确错误。
- 函数 `checkImageTextMatch(imagePath, title, copy, options)`：
  - 组合 `title` 和 `copy` 作为文本候选。
  - 返回 `{ matched: boolean, score: number, bestText: string }`。

**新增文件 2.3**：`src/data-cleaning/multimodal/clip/index.js`

**作用**：CLIP 模块入口，统一封装本地 Python CLIP 与 mock 降级。

**实现要点**：
- 导出 `checkImageTextMatch` 函数。
- 支持 `engine: 'mock'`，用于无 Python 环境时的集成测试。
- 当 Python 不可用时，抛出错误并由调用方捕获生成 warning。

**新增文件 2.4**：`src/data-cleaning/multimodal/clip/ground-truth.json`

**作用**：CLIP 测试用例真值。

**结构示例**：
```json
[
  {
    "image": "fixtures/matched/sample-001.jpg",
    "title": "日系清新亲子照 | 阳光下的温馨时刻",
    "copy": "#日系清新 #亲子照 #儿童摄影",
    "trueStyle": "日系清新",
    "matched": true
  },
  {
    "image": "fixtures/mismatched/sample-001.jpg",
    "title": "日系清新亲子照",
    "copy": "#日系清新",
    "trueStyle": "暗调情绪",
    "matched": false
  }
]
```

**新增文件 2.5**：`src/data-cleaning/multimodal/clip/test-clip.js`

**作用**：CLIP 单元验证脚本。

**实现要点**：
1. 读取 `ground-truth.json`。
2. 调用 `checkImageTextMatch` 对每个样本计算匹配分数。
3. 在阈值 0.3-0.9 范围内扫描，选择使 F1 最大的阈值。
4. 使用最佳阈值计算分类准确率、风格 Top-1 / Top-2 准确率。
5. 生成 Markdown 报告到 `docs/reports/clip_benchmark_YYYYMMDD_HHmmss.md`。
6. 无 Python 环境或样本缺失时优雅跳过。

**验收标准**：
- 脚本可运行，缺失环境时不崩溃。
- 有样本时输出准确率、最佳阈值、ROC-AUC。
- 分类准确率 ≥ 80%（样本量足够时）。

---

### 变更 3：Phase E —— 创建多模态集成测试

**目标**：验证 OCR/ASR/CLIP 接入 `DataCleaner.cleanRecord` 后，整个流程稳定且向后兼容。

**新增文件 3.1**：`src/data-cleaning/test-multimodal-integration.js`

**测试用例设计**：

| 用例编号 | 输入类型 | 验证点 |
|---------|---------|--------|
| MM-001 | 仅结构化数据 | 不触发多模态，结果与原有测试一致 |
| MM-002 | 结构化 + `imagePath` + mock OCR | 触发 OCR，`ocr_text` 进入清洗，生成 corrections |
| MM-003 | 结构化 + `audioPath` + mock ASR | 触发 ASR，`asr_text` 进入清洗，生成 corrections |
| MM-004 | 结构化 + `imagePath` + `audioPath` | 同时触发 OCR + ASR |
| MM-005 | product schema + 图片 + 文案 + mock CLIP | 触发 CLIP 一致性校验，生成 warning |
| MM-006 | OCR 失败（无效图片路径） | 流程不崩溃，生成 warning，结构化清洗继续 |
| MM-007 | ASR 失败（无效音频路径） | 流程不崩溃，生成 warning，结构化清洗继续 |
| MM-008 | CLIP 失败（Python 未安装或图片不存在） | 流程不崩溃，生成 warning，结构化清洗继续 |

**实现要点**：
1. 使用 `DataCleaner` 的 `mock` 引擎选项，避免依赖真实 OCR/ASR/CLIP 环境。
2. 通过 `meta` 或 `options` 传入 `imagePath` / `audioPath`。
3. 验证返回结果包含 `multimodal` 字段，记录 OCR/ASR/CLIP 的处理状态。
4. 验证原有结构化字段清洗结果不受影响。
5. 每个用例断言清洗成功、状态正确、warning 符合预期。
6. 测试结束时运行原有 `src/data-cleaning/test-integration.js` 的入口函数或子进程，确保无回归。

**修改文件 3.2**：`src/data-cleaning/core/data-cleaner.js`

**操作内容**：
1. 在 `cleanRecord` 中增加可选的 `preprocessMultimodal` 步骤。
2. 仅当 `options.enableMultimodal === true` 且输入包含 `imagePath` / `audioPath` / 需要 CLIP 校验时才触发。
3. 多模态失败时记录 warning，不抛出错误。
4. 将 `ocr_text` / `asr_text` / `clip_score` 等中间结果附加到返回对象的 `multimodal` 字段。

**验收标准**：
- 8 个集成用例全部通过。
- 原有 `node src/data-cleaning/test-integration.js` 无失败。

---

### 变更 4：运行基准测试与全量回归

**目标**：量化现有引擎能力，并验证多模态扩展不破坏原有功能。

**操作内容**：
1. 执行：
   ```bash
   node src/data-cleaning/test-integration.js
   ```
   确认原有 409 项断言全部通过。
2. 执行：
   ```bash
   node src/data-cleaning/benchmark/run-benchmark.js
   ```
   确认字段清洗准确率 ≥ 95%、同义词召回率 ≥ 90%、必填字段拦截率 ≥ 95%、端到端通过率 ≥ 95%。
3. 执行：
   ```bash
   node src/data-cleaning/multimodal/ocr/test-ocr.js
   ```
   确认脚本可运行（样本缺失时跳过）。
4. 执行：
   ```bash
   node src/data-cleaning/multimodal/asr/test-asr.js
   ```
   确认脚本可运行（样本缺失时跳过）。
5. 执行：
   ```bash
   node src/data-cleaning/multimodal/clip/test-clip.js
   ```
   确认脚本可运行（环境缺失时跳过）。
6. 执行：
   ```bash
   node src/data-cleaning/test-multimodal-integration.js
   ```
   确认 8 个集成用例全部通过。

**输出报告**：
- `docs/reports/benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/ocr_benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/asr_benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/clip_benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/multimodal-integration_YYYYMMDD_HHmmss.md`

---

## 四、Assumptions & Decisions（假设与决策）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| "SAR" 语义 | 按 ASR（自动语音识别）理解 | 上下文及现有文档均指向 ASR，属用户笔误 |
| CLIP 引擎 | Python `open-clip-torch` | 中文图文匹配效果优于原版 CLIP，与总体规划一致 |
| CLIP 桥接方式 | Node.js 子进程调用 Python 脚本 | 与 ASR Whisper 适配器保持一致，避免引入复杂 RPC |
| 集成测试策略 | 使用 mock 引擎 | 不依赖真实 Tesseract / Whisper / Python 环境，保证 CI 可运行 |
| 多模态触发条件 | `options.enableMultimodal === true` + 存在多媒体路径 | 默认关闭，保证向后兼容 |
| 失败处理 | 多模态失败不阻塞结构化清洗 | 符合总体规划的向后兼容原则 |
| 样本缺失处理 | 跳过并标记，退出码 0 | 环境/样本缺失不等于验证失败，避免误报 |

---

## 五、Verification Steps（验证步骤）

### Step 1：环境准备

1. 确认 Node.js 版本 ≥ 18。
2. （可选）安装 Tesseract OCR 与中文语言包 `chi_sim`，用于真实 OCR 验证。
3. （可选）安装 Python 3.10+ 并执行：
   ```bash
   pip install faster-whisper open-clip-torch torch pillow
   ```
4. 确认 `lark-cli` 已认证（用于飞书 OCR/妙记 API 降级验证，可选）。

### Step 2：原有引擎回归测试

```bash
node src/data-cleaning/test-integration.js
```

- 期望：所有断言通过（≥ 409 项）。
- 若失败，先修复再进入下一步。

### Step 3：基准测试

```bash
node src/data-cleaning/benchmark/run-benchmark.js
```

- 检查 `docs/reports/benchmark_YYYYMMDD_HHmmss.md`。
- 确认字段清洗准确率、同义词召回率、必填字段拦截率、端到端通过率达到验收标准。

### Step 4：OCR 验证

```bash
node src/data-cleaning/multimodal/ocr/test-ocr.js
```

- 无真实图片时，脚本应跳过并提示补充 fixtures。
- 有图片时，检查字符准确率与字段提取准确率。

### Step 5：ASR 验证

```bash
node src/data-cleaning/multimodal/asr/test-asr.js
```

- 无真实音频时，脚本应跳过并提示补充 fixtures。
- 有音频时，检查 WER 与字段提取准确率。

### Step 6：CLIP 验证

```bash
# 安装 Python 依赖（如未安装）
pip install open-clip-torch torch pillow

# 运行验证
node src/data-cleaning/multimodal/clip/test-clip.js
```

- 无 Python 环境或样本时，脚本应跳过。
- 有样本时，检查图文匹配分类准确率与最佳阈值。

### Step 7：多模态集成测试

```bash
node src/data-cleaning/test-multimodal-integration.js
```

- 确认 8 个集成用例全部通过。
- 再次运行回归测试：
  ```bash
  node src/data-cleaning/test-integration.js
  ```

### Step 8：汇总报告

将所有报告汇总到：
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
| Python 环境缺失 | CLIP/ASR 无法运行 | 验证脚本标记为跳过，集成测试使用 mock 引擎 |
| open-clip-torch 模型下载失败/过大 | CLIP 无法本地运行 | 提供 tiny 模型选项或纯 mock 降级 |
| 测试样本不足 | 验证结果置信度低 | 明确标注样本量，建议补充后复测 |
| 新模块破坏旧流程 | 回归测试失败 | 启用 `enableMultimodal` feature flag，默认关闭 |
| DataCleaner 改造引入循环依赖 | 集成测试失败 | 保持 `preprocessMultimodal` 作为独立函数，不改动核心 Pipeline 顺序 |

---

## 七、实施顺序与工作量

| 阶段 | 主要任务 | 预估工作量 | 前置依赖 |
|------|---------|-----------|---------|
| Phase C 收尾 | 确认 ASR 脚本健壮性 | 0.5 天 | ASR 模块已实现 |
| Phase D | CLIP 模块入口 + Python bridge + 服务 + 验证脚本 | 1-2 天 | metrics.js、DataCleaner API |
| Phase E | 多模态集成测试 + DataCleaner 扩展 | 1 天 | OCR/ASR/CLIP 模块入口 |
| 回归验证 | 运行所有测试并生成报告 | 0.5 天 | 以上全部完成 |
| **合计** | — | **3-4 天** | — |

---

## 八、文件清单（新增与修改）

### 新增文件
- `src/data-cleaning/multimodal/clip/index.js`
- `src/data-cleaning/multimodal/clip/python-bridge.js`
- `src/data-cleaning/multimodal/clip/clip_service.py`
- `src/data-cleaning/multimodal/clip/ground-truth.json`
- `src/data-cleaning/multimodal/clip/test-clip.js`
- `src/data-cleaning/test-multimodal-integration.js`
- `src/data-cleaning/examples/example-multimodal-clean.js`（可选）

### 修改文件
- `src/data-cleaning/multimodal/asr/test-asr.js`（增加验收标准检查）
- `src/data-cleaning/core/data-cleaner.js`（增加 `preprocessMultimodal` 步骤）
- `src/data-cleaning/core/quality-scorer.js`（可选：新增多模态扣分逻辑）
- `src/data-cleaning/config/cleaning-rules.json`（可选：新增 `clipThreshold` 配置）

### 输出报告
- `docs/reports/benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/ocr_benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/asr_benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/clip_benchmark_YYYYMMDD_HHmmss.md`
- `docs/reports/multimodal-integration_YYYYMMDD_HHmmss.md`
- `docs/reports/multimodal-verification-summary_YYYYMMDD.md`
