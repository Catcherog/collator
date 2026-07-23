# Workstream B — OCR 引擎集成指南（供 Workstream E 使用）

本文件说明如何把 Workstream B 产出的真实 OCR 引擎工厂接入 `src/server/app.ts`，
替换第一阶段的 `new MockOcrEngine()`。**Workstream B 未修改 app.ts**（仅输出集成说明）。

---

## 1. 交付物一览（Workstream B 产出，均位于受保护路径内）

| 文件 | 作用 |
|------|------|
| `src/server/config/ocr-config.ts` | `OcrConfig` + `loadOcrConfig(env)`；fail-closed（amendment 3） |
| `src/ocr/ocr-errors.ts` | `OcrError` + 错误码映射 + 可重试判定 |
| `src/ocr/ocr-logger.ts` | pino 脱敏 logger（AC-B07） |
| `src/ocr/image-validation.ts` | 魔数类型识别 + 尺寸/大小校验（AC-B04） |
| `src/ocr/ocr-result-mapper.ts` | Provider 文本 → OcrResult（复用 `inferTextBlockType`） |
| `src/ocr/tesseract-ocr-engine.ts` | 真实 Tesseract OCR（tesseract.js，Buffer 直传，无需临时文件） |
| `src/ocr/feishu-ocr-engine.ts` | 真实飞书 OCR（lark-cli：Buffer→临时文件→上传→OCR API） |
| `src/ocr/ocr-engine-factory.ts` | `createOcrEngine(engine, config)` + `createOcrEngineFromEnv(env)` |

---

## 2. 关键架构决策：为何不直接 import CJS 适配器

现有 `src/data-cleaning/multimodal/ocr/{tesseract,feishu}-ocr-adapter.js` 为 CJS 模块。
但 `tests/unit/cleaning/import-ban.test.ts` 禁止从 `src/` 直接 import/require/dynamic-import
`data-cleaning`（仅 `src/server/cleaning/legacy-module-loader.ts` 等白名单文件豁免）；
而 legacy-module-loader 又拒绝裸 npm 包（`tesseract.js`）。

为同时满足 **AC-B09（import-ban 必过）** 与 **B3（真实 OCR）**，Workstream B 以既有
CJS 适配器为参考，在 ESM TypeScript 中等价重写，直接调用 `tesseract.js` 与 `lark-cli`，
算法/超时/语言参数与既有实现对齐。**不修改** `src/data-cleaning/**`。

---

## 3. 接入 app.ts（Workstream E 执行）

### 3.1 当前代码（app.ts ~L128，需替换）

```ts
// src/server/app.ts
import { MockOcrEngine } from './services/screenshot-ocr-adapter.js';
// ...
if (!options?.screenshotServiceOptions) {
  screenshotServiceOptions.ocrEngine = screenshotServiceOptions.ocrEngine ?? new MockOcrEngine();
  // ...
}
```

### 3.2 替换为工厂装配

```ts
// src/server/app.ts
import { MockOcrEngine } from './services/screenshot-ocr-adapter.js';
import { createOcrEngineFromEnv } from '../ocr/ocr-engine-factory.js'; // ← 新增 import
// ...
if (!options?.screenshotServiceOptions) {
  screenshotServiceOptions.ocrEngine =
    screenshotServiceOptions.ocrEngine ?? createOcrEngineFromEnv(process.env); // ← 替换
  // ...
}
```

> 注：保留 `MockOcrEngine` import 仅供类型/兼容；生产路径由 `createOcrEngineFromEnv` 决定。
> `createOcrEngineFromEnv` 内部已对 `SCREENSHOT_OCR_ENGINE` 做 fail-closed（amendment 3）。

### 3.3 关键行为

- `SCREENSHOT_OCR_ENGINE` 缺失/非法 → `createOcrEngineFromEnv` 抛 `OcrConfigError`，
  **进程启动失败（fail closed，不退化为 mock）**。生产必须显式设置 `tesseract` 或 `feishu`。
- 现有截图路由测试（`tests/unit/server/routes/screenshot-routes.test.ts`）通过
  `screenshotServiceOptions.ocrEngine` 显式注入 `MockOcrEngine`，**不受工厂影响**，无需改动。
- 因此本接入**不会回归**既有 mock 测试（AC-B09 既有部分）。

---

## 4. 环境变量

| 变量 | 必需 | 默认 | 说明 |
|------|------|------|------|
| `SCREENSHOT_OCR_ENGINE` | 是 | 无（fail closed） | `mock` \| `tesseract` \| `feishu`。复用 config.ts 既有变量名 |
| `OCR_TIMEOUT_MS` | 否 | `60000` | 单次 OCR 超时（ms） |
| `OCR_MAX_RETRIES` | 否 | `2` | 可重试错误最大重试次数（不含首次） |
| `OCR_MAX_FILE_SIZE_BYTES` | 否 | `10485760` | 图片字节上限 |
| `OCR_MAX_DIMENSION` | 否 | `10000` | 图片最大边长（px） |
| `OCR_TESSERACT_LANG` | 否 | `chi_sim+eng` | Tesseract 语言（与既有 adapter 一致） |
| `OCR_FEISHU_TIMEOUT_MS` | 否 | `30000` | 单次 lark-cli 调用超时 |
| `OCR_LOG_LEVEL` | 否 | 继承 `LOG_LEVEL` | OCR 专用 logger 级别 |

> 飞书 OCR 经 lark-cli 调用，**lark-cli 自管鉴权**，故 OcrConfig 无需飞书凭据字段。

---

## 5. Provider 选择（amendment 4：优先 Tesseract，避免凭据阻塞）

- **默认/推荐：`tesseract`** — 本地 WASM，无需凭据，离线可用（首次需下载 lang 数据）。
  实测 `tests/ocr/tesseract-ocr-engine.spec.ts` 的 AC-B08 用例：识别手绘 "T" PNG 成功（~1.2s）。
- **`feishu`** — 需 lark-cli 已鉴权（`lark-cli auth login`），适合云端/中文识别更强的场景。
- **`mock`** — 仅测试用；生产不得使用。

---

## 6. 错误处理契约（供上层路由/治理决策）

`OcrError`（`src/ocr/ocr-errors.ts`）统一错误码：

| code | retryable | 含义 |
|------|-----------|------|
| `OCR_INVALID_IMAGE` | 否 | 空/损坏图片（AC-B04 fail closed） |
| `OCR_IMAGE_TOO_LARGE` | 否 | 字节或尺寸超限 |
| `OCR_UNSUPPORTED_IMAGE_TYPE` | 否 | 非 PNG/JPEG/WEBP |
| `OCR_TIMEOUT` | 是 | 单次调用超时 |
| `OCR_PROVIDER_UNAVAILABLE` | 是 | 网络/DNS/模块缺失/lang 下载失败 |
| `OCR_PROVIDER_ERROR` | 否 | Provider 业务错误 |
| `OCR_RETRY_EXHAUSTED` | — | 可重试错误重试耗尽（最终抛出） |

`ScreenshotService` 现有逻辑：OCR 失败不阻止创建（状态保持 `received`/`ocr_processing`，
可后续重试）。真实引擎抛出 `OcrError`，行为与 mock 抛错一致，**无需改动 ScreenshotService**。

---

## 7. 验证状态

- `src/ocr/**` + `src/server/config/ocr-config.ts` + `tests/ocr/**`：scoped typecheck 通过（exit 0）。
- `tests/ocr/**`：37 通过 / 2 跳过（真实 feishu 受门控跳过；真实 tesseract 已通过 AC-B08）。
- **注意（跨 Workstream 阻塞）**：全量 `npm run typecheck` 与 `npm test` 当前被 **Workstream C**
  的未跟踪 WIP 文件阻塞（`src/server/business/guarded-batch-writer.ts` 的 TS1010、
  `tests/unit/feishu/feishu-write-config.test.ts` 的未闭合模板字符串 TS1002），均不在 Workstream B
  所有权内，且在我开始前已损坏。Workstream B 文件本身 0 类型错误。
