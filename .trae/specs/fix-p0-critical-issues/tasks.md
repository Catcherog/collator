# 修复P0高危问题 - Tasks

## 阶段一：核心引擎修复（DC-001 + QS-001）

- [x] Task 1: 修复去重字符串相似度算法（DC-001）
  - [ ] SubTask 1.1: 替换 [data-cleaner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/data-cleaner.js#L618-L627) 中的 `calculateStringSimilarity` 方法
    - 实现相等返回 1.0
    - 实现包含关系返回 0.9
    - 实现 bigram 双字组 Jaccard 相似度作为主算法
    - 短字符串（长度<2）退化为字符级 Jaccard
  - [ ] SubTask 1.2: 在 [test-cleaner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/test-cleaner.js) 中新增去重算法专项测试
    - 测试 'ab' 与 'ba' 相似度 < 0.5
    - 测试 '张三' 与 '三张' 相似度 < 0.5
    - 测试 'hello' 与 'hello' 返回 1.0
    - 测试 'hello' 与 'hell' 返回 0.9
    - 测试短字符串退化逻辑
    - 测试空字符串返回 0
  - [ ] SubTask 1.3: 运行测试套件验证：`node src/data-cleaning/core/test-cleaner.js`

- [x] Task 2: 修复质量评分必填字段折扣机制（QS-001）
  - [ ] SubTask 2.1: 修改 [quality-scorer.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/quality-scorer.js#L271-L281) 的 score 计算
    - 保留行 271 的总分计算（含 fillRate 折扣）
    - 删除行 275-280 的 else 分支重复计算
    - 保留 `requiredFillRate === 0` 时分数上限 10 分的特殊处理（行 273-274）
  - [ ] SubTask 2.2: 在 [test-quality.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/test-quality.js) 中新增折扣机制测试
    - 测试必填字段完整（fillRate=1.0）且无错误时评分为 100
    - 测试必填字段缺失一半（fillRate=0.5）且无其他错误时评分约为 70（不是 80）
    - 测试必填字段全缺失（fillRate=0）时评分上限为 10
  - [ ] SubTask 2.3: 运行测试套件验证：`node src/data-cleaning/core/test-quality.js`

## 阶段二：基础设施修复（INF-001 + INF-002）

- [x] Task 3: 修复飞书 appToken 硬编码泄露（INF-001）
  - [ ] SubTask 3.1: 修改 [data-scanner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/data-scanner.js#L11) 移除硬编码
    - 删除 `const DEFAULT_APP_TOKEN = 'MwGMbF0Q0alPc6s3jOccovvOnob';`
    - 修改构造函数：`this.appToken = options.appToken || process.env.FEISHU_APP_TOKEN || null`
  - [ ] SubTask 3.2: 在 `_callLarkApi` 方法开头添加 token 检查
    - 若 `this.appToken` 为空，抛出错误：`"FEISHU_APP_TOKEN 未配置：请在环境变量或 options.appToken 中设置飞书多维表 appToken"`
  - [ ] SubTask 3.3: 在 [test-scanner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/test-scanner.js) 中新增测试
    - 测试无 token 时调用飞书 API 抛出明确错误
    - 测试 options.appToken 优先级高于环境变量
    - 测试环境变量作为 fallback

- [x] Task 4: 修复 execSync 无超时设置（INF-002）
  - [ ] SubTask 4.1: 修改 [data-scanner.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/core/data-scanner.js#L64-L68) 的 execSync 调用
    - 添加 `timeout: this.options.apiTimeout || 30000`
    - 添加 `killSignal: 'SIGTERM'`
  - [ ] SubTask 4.2: 包装 execSync 调用以捕获超时异常
    - 捕获 `err.code === 'ETIMEDOUT'` 或 err.signal === 'SIGTERM'
    - 转换为明确错误：`"lark-cli 调用超时（{timeout}ms）：{method} {urlPath}"`
    - 清理临时文件后向上抛出
  - [ ] SubTask 4.3: 运行测试套件验证：`node src/data-cleaning/core/test-scanner.js`

## 阶段三：多模态适配器实现（MM-001 + MM-002）

- [x] Task 5: 实现飞书 OCR 适配器（MM-001）
  - [ ] SubTask 5.1: 实现图片上传逻辑
    - 读取图片文件为二进制
    - 通过 `lark-cli api POST /open-apis/drive/v1/medias/upload_all` 上传
    - 使用 multipart/form-data 格式（parent_type=ccm_import_open&parent_node=&size=&file=）
    - 解析返回的 `file_token`
  - [ ] SubTask 5.2: 实现飞书 OCR 调用
    - 调用 `lark-cli api POST /open-apis/drive/v1/medias/{file_token}/ocr` 执行识别
    - 解析返回的 `data.content` 提取每行文本
    - 计算综合 confidence（飞书不返回置信度，使用固定 0.85 或基于文本长度启发式）
  - [ ] SubTask 5.3: 复用 DataScanner 临时文件传参模式
    - 抽取或复制 `_writeTempJsonFile`/`_cleanupTempFile` 逻辑
    - 使用临时文件传递 multipart 边界数据避免 PowerShell 转义
  - [ ] SubTask 5.4: 添加超时和错误处理
    - execSync 设置 timeout（默认 30000ms）
    - 捕获 lark-cli 未安装、网络超时、API 错误
    - 错误信息明确区分原因
  - [ ] SubTask 5.5: 保持接口签名 `extractText(imagePath, options)` 返回 `{ text, confidence, blocks }`
    - text: 全部识别文本拼接
    - confidence: 综合置信度（默认 0.85）
    - blocks: 按行分割的文本块数组
  - [ ] SubTask 5.6: 在 [test-ocr.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/multimodal/ocr/test-ocr.js) 中新增 mock 模式测试
    - mock lark-cli 返回值，验证 extractText 正确解析
    - 测试图片不存在时抛出错误
    - 测试 lark-cli 未安装时抛出错误

- [ ] Task 6: 实现飞书妙记 ASR 适配器（MM-002）
  - [ ] SubTask 6.1: 实现音频文件上传逻辑
    - 通过 `lark-cli api POST /open-apis/drive/v1/files/upload_all` 上传音频
    - 使用 multipart/form-data 格式
    - 解析返回的 `file_token`
  - [ ] SubTask 6.2: 实现创建妙记逻辑
    - 调用 `lark-cli api POST /open-apis/minutes/v1/minutes`
    - body: `{ topic, file_token, ... }`
    - 解析返回的 `minute_id`
  - [ ] SubTask 6.3: 实现转写状态轮询
    - 调用 `GET /open-apis/minutes/v1/minutes/{minute_id}` 查询状态
    - 状态判断：`status === 'completed'` 完成；其他状态继续轮询
    - 轮询间隔：options.pollInterval || 5000（5秒）
    - 轮询超时：options.pollTimeout || 300000（5分钟）
    - 超时抛出 `"飞书妙记转写超时"`
  - [ ] SubTask 6.4: 实现获取转写结果
    - 调用 `GET /open-apis/minutes/v1/minutes/{minute_id}/transcripts`
    - 解析转写文本，按 segments 组织
    - 计算综合 confidence（默认 0.85）
  - [ ] SubTask 6.5: 添加错误处理和接口保持
    - 音频不存在抛出错误
    - lark-cli 未安装抛出错误
    - 各步骤超时处理
    - 保持 `transcribe(audioPath, options)` 返回 `{ text, confidence, segments }`
  - [ ] SubTask 6.6: 在 [test-asr.js](file:///d:/360Downloads/Trae%20项目/collator/src/data-cleaning/multimodal/asr/test-asr.js) 中新增 mock 模式测试
    - mock lark-cli 返回值，验证 transcribe 正确解析
    - 测试音频不存在时抛出错误
    - 测试轮询超时处理

## 阶段四：集成验证

- [x] Task 7: 全量测试运行与回归验证
  - [ ] SubTask 7.1: 运行所有核心模块测试
    - `node src/data-cleaning/core/test-cleaner.js`
    - `node src/data-cleaning/core/test-quality.js`
    - `node src/data-cleaning/core/test-scanner.js`
    - `node src/data-cleaning/core/test-logger.js`
    - `node src/data-cleaning/core/test-learning.js`
    - `node src/data-cleaning/core/test-batch.js`
  - [ ] SubTask 7.2: 运行所有多模态测试
    - `node src/data-cleaning/multimodal/ocr/test-ocr.js`
    - `node src/data-cleaning/multimodal/asr/test-asr.js`
    - `node src/data-cleaning/multimodal/clip/test-clip.js`
    - `node src/data-cleaning/multimodal/test-modules.js`
  - [ ] SubTask 7.3: 运行集成测试
    - `node src/data-cleaning/test-integration.js`
    - `node src/data-cleaning/test-multimodal-integration.js`
  - [ ] SubTask 7.4: 运行规则和工具测试
    - `node src/data-cleaning/rules/test-rules.js`
    - `node src/data-cleaning/utils/test-utils.js`
  - [ ] SubTask 7.5: 修复回归问题（如有）
    - 检查测试失败用例
    - 分析失败原因（是否与本次修复相关）
    - 修复回归或更新测试用例

## Task Dependencies

- Task 1, Task 2 可并行（独立模块）
- Task 3, Task 4 可并行（同文件不同位置，但建议顺序执行避免合并冲突）
- Task 5, Task 6 可并行（独立适配器文件）
- Task 7 依赖 Task 1-6 全部完成
