# 修复P0高危问题 Spec

## Why

detailed-implementation-review 审查发现 collator 项目存在 6 个 P0 高危问题，涉及数据正确性、安全性和功能完整性。这些问题会导致：去重误判丢弃有效数据、飞书 appToken 泄露、网络异常时进程永久挂起、数据质量评分虚高、OCR/ASR 降级策略名存实亡。必须立即修复以保证系统可信赖运行。

## What Changes

### DC-001: 去重字符串相似度算法严重缺陷
- **文件**: [data-cleaner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/data-cleaner.js#L618-L627)
- **变更**: 将 `calculateStringSimilarity` 从「字符集合匹配（Jaccard of chars）」替换为「bigram 双字组 Jaccard 相似度 + 包含关系保留」
- **原因**: 现算法 `[...s1].filter(c => s2.includes(c)).length / max` 忽略字符顺序，导致 `'ab'` 与 `'ba'` 100% 相似、`'张三'` 与 `'三张'` 无法区分
- **修复方案**:
  - 相等返回 1.0
  - 包含关系返回 0.9（保留原逻辑）
  - 否则使用 bigram（双字组）Jaccard 相似度：`|∩bigrams| / |∪bigrams|`
  - 短字符串（长度<2）退化为字符级 Jaccard

### INF-001: 飞书 appToken 硬编码泄露
- **文件**: [data-scanner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/data-scanner.js#L11)
- **变更**: 删除 `DEFAULT_APP_TOKEN = 'MwGMbF0Q0alPc6s3jOccovvOnob'` 硬编码，改为从环境变量读取
- **修复方案**:
  - 移除硬编码常量
  - 构造函数中 `this.appToken = options.appToken || process.env.FEISHU_APP_TOKEN`
  - 若两者均无，在调用飞书 API 时抛出明确错误提示用户配置环境变量
- **BREAKING**: 不再提供默认 token，必须在环境变量或 options 中显式传入

### INF-002: execSync 调用 lark-cli 无超时设置
- **文件**: [data-scanner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/data-scanner.js#L64-L68)
- **变更**: 为 `_callLarkApi` 中的 `execSync` 添加 `timeout: 30000`（30秒）和 `killSignal: 'SIGTERM'`
- **原因**: 网络异常或 lark-cli 卡死时，execSync 会永久阻塞，批量扫描整个流程挂起
- **修复方案**:
  - 添加 timeout 选项（30秒，可由 options.apiTimeout 配置）
  - 捕获超时异常并向上抛出明确错误信息

### QS-001: 质量评分必填字段折扣机制失效
- **文件**: [quality-scorer.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/quality-scorer.js#L271-L281)
- **变更**: 删除 else 分支（行 275-280）中重复的无折扣版本计算，恢复 `requiredFillRate` 折扣逻辑
- **原因**: 行 271 已计算 `score = requiredScore + formatScore + enumScore + logicScore + confidenceScore - otherDeduction`（各维度已乘 fillRate），但 else 分支又用未乘 fillRate 的版本覆盖，导致必填字段缺失时评分虚高（必填缺一半本应得约50分，实际得80分）
- **修复方案**:
  - 保留行 271 的总分计算（含 fillRate 折扣）
  - 删除行 275-280 的 else 分支重复计算
  - 保留 `requiredFillRate === 0` 时分数上限 10 分的特殊处理

### MM-001: 飞书 OCR 适配器未实现（仅 stub throw Error）
- **文件**: [feishu-ocr-adapter.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/multimodal/ocr/feishu-ocr-adapter.js#L36)
- **变更**: 实现飞书 OCR API 调用流程
- **修复方案**:
  - 通过 `lark-cli api POST /open-apis/drive/v1/medias/upload_all` 上传图片获取 `file_token`
  - 调用 `lark-cli api POST /open-apis/drive/v1/medias/{file_token}/ocr` 执行文字识别
  - 解析返回结果提取 text 和 confidence
  - 复用 DataScanner 的临时文件传参模式（避免 PowerShell JSON 转义问题）
  - 添加超时和错误处理
  - 保持 `extractText(imagePath, options)` 接口签名不变
  - 返回格式与 tesseract-adapter 一致：`{ text, confidence, blocks }`

### MM-002: 飞书妙记 ASR 适配器未实现（仅 stub throw Error）
- **文件**: [feishu-minutes-adapter.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/multimodal/asr/feishu-minutes-adapter.js#L16)
- **变更**: 实现飞书妙记 API 调用流程
- **修复方案**:
  - 通过 `lark-cli api POST /open-apis/drive/v1/files/upload_all` 上传音频文件获取 `file_token`
  - 调用 `lark-cli api POST /open-apis/minutes/v1/minutes` 创建妙记（关联 file_token）
  - 轮询 `GET /open-apis/minutes/v1/minutes/{minute_id}` 直到转写完成
  - 调用 `GET /open-apis/minutes/v1/minutes/{minute_id}/transcripts` 获取转写文本
  - 添加轮询超时（默认 5 分钟，可配置）和间隔（默认 5 秒）
  - 保持 `transcribe(audioPath, options)` 接口签名不变
  - 返回格式与 local-whisper-adapter 一致：`{ text, confidence, segments }`

## Impact

- **Affected specs**: detailed-implementation-review（审查报告，修复后需更新状态）
- **Affected code**:
  - [src/data-cleaning/core/data-cleaner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/data-cleaner.js) — calculateStringSimilarity 算法替换
  - [src/data-cleaning/core/data-scanner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/data-scanner.js) — appToken 环境变量化 + execSync 超时
  - [src/data-cleaning/core/quality-scorer.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/quality-scorer.js) — 评分公式修复
  - [src/data-cleaning/multimodal/ocr/feishu-ocr-adapter.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/multimodal/ocr/feishu-ocr-adapter.js) — 完整实现
  - [src/data-cleaning/multimodal/asr/feishu-minutes-adapter.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/multimodal/asr/feishu-minutes-adapter.js) — 完整实现
- **测试影响**:
  - [core/test-cleaner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/test-cleaner.js) — 需新增去重算法测试用例（验证 'ab'≠'ba'）
  - [core/test-quality.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/test-quality.js) — 需新增必填字段缺失场景评分测试
  - [core/test-scanner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/test-scanner.js) — 需验证无 token 时的错误提示
  - [multimodal/ocr/test-ocr.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/multimodal/ocr/test-ocr.js) — 需新增飞书 OCR 适配器测试（mock 模式）
  - [multimodal/asr/test-asr.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/multimodal/asr/test-asr.js) — 需新增飞书妙记适配器测试（mock 模式）
- **运行时影响**: 用户必须配置 `FEISHU_APP_TOKEN` 环境变量才能使用 DataScanner 的飞书 API 功能

## ADDED Requirements

### Requirement: 去重字符串相似度算法正确性

系统 SHALL 使用保留字符顺序的相似度算法计算两个字符串的相似度，对于任意两个字符相同但顺序不同的字符串（如 `'ab'` 与 `'ba'`、`'张三'` 与 `'三张'`），相似度 SHALL 严格小于 1.0。

#### Scenario: 相同字符串
- **WHEN** 计算 `'hello'` 与 `'hello'` 的相似度
- **THEN** 返回 `1.0`

#### Scenario: 包含关系
- **WHEN** 计算 `'hello'` 与 `'hell'` 的相似度
- **THEN** 返回 `0.9`（保留包含关系快速路径）

#### Scenario: 字符相同顺序不同
- **WHEN** 计算 `'ab'` 与 `'ba'` 的相似度
- **THEN** 返回值 SHALL 严格小于 `0.5`（bigram 集合无交集）

#### Scenario: 中文姓名顺序颠倒
- **WHEN** 计算 `'张三'` 与 `'三张'` 的相似度
- **THEN** 返回值 SHALL 严格小于 `0.5`

#### Scenario: 短字符串退化处理
- **WHEN** 计算长度小于 2 的字符串相似度
- **THEN** 退化为字符级 Jaccard，避免 bigram 为空集

### Requirement: 飞书 appToken 安全存储

系统 SHALL NOT 在源代码中硬编码飞书 appToken，SHALL 从环境变量 `FEISHU_APP_TOKEN` 或构造函数 options 中读取。

#### Scenario: 环境变量已配置
- **WHEN** `process.env.FEISHU_APP_TOKEN` 已设置且 options.appToken 未传
- **THEN** 使用环境变量的值

#### Scenario: options 显式传入
- **WHEN** options.appToken 显式传入
- **THEN** 使用 options 中的值（优先级高于环境变量）

#### Scenario: 未配置 token 时调用飞书 API
- **WHEN** 既未设置环境变量也未在 options 中传入 appToken，且调用飞书 API
- **THEN** 抛出明确错误：`"FEISHU_APP_TOKEN 未配置：请在环境变量或 options.appToken 中设置飞书多维表 appToken"`

### Requirement: execSync 超时保护

系统 SHALL 为所有 `execSync` 调用 lark-cli 的操作设置超时，避免网络异常导致进程永久挂起。

#### Scenario: 正常调用
- **WHEN** lark-cli 在 30 秒内返回
- **THEN** 正常处理返回结果

#### Scenario: 调用超时
- **WHEN** lark-cli 在 30 秒（默认）内未返回
- **THEN** 抛出错误，错误信息包含 `"lark-cli 调用超时"` 和具体超时时间

#### Scenario: 自定义超时
- **WHEN** options.apiTimeout 设置为 60000
- **THEN** 使用 60 秒作为超时阈值

### Requirement: 质量评分必填字段折扣机制

系统 SHALL 按必填字段填充率（`requiredFillRate`）对格式、枚举、逻辑、置信度四个维度进行折扣，确保必填字段缺失时评分准确反映数据质量。

#### Scenario: 必填字段完整
- **WHEN** `requiredFillRate = 1.0` 且无其他错误
- **THEN** 评分为 100

#### Scenario: 必填字段缺失一半
- **WHEN** `requiredFillRate = 0.5` 且无其他错误
- **THEN** 评分 SHALL 约为 70（requiredScore=20 + formatScore=12.5 + enumScore=10 + logicScore=5 + confidenceScore=2.5）

#### Scenario: 必填字段全缺失
- **WHEN** `requiredFillRate = 0`
- **THEN** 评分上限为 10 分

### Requirement: 飞书 OCR 适配器可用

系统 SHALL 提供可用的飞书 OCR 适配器，当 Tesseract OCR 失败或置信度低于阈值时，SHALL 能降级到飞书 OCR 完成图片文字识别。

#### Scenario: 成功识别
- **WHEN** 传入有效图片路径且飞书 OCR 返回正常
- **THEN** 返回 `{ text, confidence, blocks }` 格式结果

#### Scenario: 图片不存在
- **WHEN** 传入不存在的图片路径
- **THEN** 抛出 `"图片文件不存在：{path}"` 错误

#### Scenario: lark-cli 未安装
- **WHEN** lark-cli 不在 PATH 中
- **THEN** 抛出 `"lark-cli 未安装或不在 PATH 中"` 错误

#### Scenario: 网络超时
- **WHEN** 飞书 OCR 调用超过 30 秒
- **THEN** 抛出超时错误

### Requirement: 飞书妙记 ASR 适配器可用

系统 SHALL 提供可用的飞书妙记 ASR 适配器，当本地 Whisper 失败时，SHALL 能降级到飞书妙记完成音频转写。

#### Scenario: 成功转写
- **WHEN** 传入有效音频路径且飞书妙记转写完成
- **THEN** 返回 `{ text, confidence, segments }` 格式结果

#### Scenario: 音频不存在
- **WHEN** 传入不存在的音频路径
- **THEN** 抛出 `"音频文件不存在：{path}"` 错误

#### Scenario: 转写超时
- **WHEN** 妙记转写超过 5 分钟（默认）未完成
- **THEN** 抛出 `"飞书妙记转写超时"` 错误

#### Scenario: 自定义轮询参数
- **WHEN** options.pollTimeout = 600000 且 options.pollInterval = 10000
- **THEN** 使用 10 分钟超时和 10 秒间隔

## MODIFIED Requirements

### Requirement: DataScanner 飞书 API 调用

DataScanner 通过 lark-cli 调用飞书开放平台 API 完成多维表数据扫描。修改后：

1. appToken 来源优先级：`options.appToken` > `process.env.FEISHU_APP_TOKEN` > 抛出错误
2. 所有 `execSync` 调用必须设置 `timeout`（默认 30000ms）和 `killSignal: 'SIGTERM'`
3. 超时异常必须捕获并转换为明确的业务错误信息
4. 临时文件传参机制保持不变

## REMOVED Requirements

### Requirement: 硬编码默认 appToken

**Reason**: 安全风险，token 泄露可被越权访问飞书多维表数据
**Migration**:
1. 用户需在运行环境中设置 `FEISHU_APP_TOKEN` 环境变量
2. 或在创建 DataScanner 实例时通过 `options.appToken` 传入
3. 建议将 token 添加到 `.env` 文件（已在 .gitignore 中）或操作系统环境变量
