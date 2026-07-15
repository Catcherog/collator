# 感知层模块创建实施计划

## 任务概述
在 `src/data-cleaning/agent/perception/` 目录下创建泽怀影像数据摄入 Agent 的感知层模块，包含 4 个文件。

## 代码风格参考
- 使用 Node.js CommonJS (`require`/`module.exports`)
- 异步操作使用 `async/await`
- 参考现有模块模式：`ocr/index.js`、`asr/index.js`
- 无注释（按用户要求）
- 简洁、功能性代码

---

## 文件创建计划

### 1. 创建目录
- 路径：`src/data-cleaning/agent/perception/`

### 2. input-classifier.js
**功能**：自动检测输入类型
- 支持类型：text, image, audio, document, chat_log, batch
- 导出函数：`classifyInput(input)`
- 返回：`{ type, confidence, metadata }`
- 检测逻辑：
  - 文件路径 → 通过扩展名判断（图片/音频/文档）
  - 字符串 → 判断是否为聊天记录格式或纯文本
  - 数组 → 判断为 batch
  - 对象 → 根据属性判断类型

### 3. dispatcher.js
**功能**：多模态调度器，根据类型路由到 OCR/ASR/CLIP
- 导入：`ocr from '../../multimodal/ocr'`、`asr from '../../multimodal/asr'`
- 导出函数：`processInput(input)`
- 返回：`{ text, metadata }`
- 路由逻辑：
  - image → ocr.extractText()
  - audio → asr.transcribe()
  - document → doc-parser.extractText()
  - text/chat_log → 直接返回
  - batch → 递归处理

### 4. doc-parser.js
**功能**：解析 Word (.docx) 和文本文件
- 导出函数：`extractText(filePath)`
- 处理逻辑：
  - .txt 文件：使用 fs.readFileSync 读取
  - .docx 文件：尝试使用 mammoth，如未安装则优雅降级（返回提示信息）
  - 其他扩展名：抛出错误或返回空

### 5. index.js
**功能**：导出所有感知层函数
- 重新导出：classifyInput, processInput, extractText

---

## 依赖说明
- doc-parser.js 中 mammoth 为可选依赖，使用 try/catch 优雅处理
- 不添加任何 package.json 依赖，保持纯原生实现（除 mammoth 可选外）

---

## 验证步骤
1. 确认所有文件已创建在正确位置
2. 确认 module.exports 正确导出所有函数
3. 确认 require 路径正确（相对路径）
4. 运行 Node.js 语法检查
