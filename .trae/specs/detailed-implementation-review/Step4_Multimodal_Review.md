# Task 4: 多模态模块深度审查报告

## 审查概述
- **审查目录**: src/data-cleaning/multimodal/ (ocr/asr/clip三个子模块)
- **审查日期**: 2026-03-18
- **审查状态**: 已完成

## TR测试点验证
| 测试点 | 结果 | 说明 |
|--------|------|------|
| TR-4.1 (OCR降级逻辑) | ⚠️ 部分通过 | ocr/index.js行38-55实现了Tesseract置信度<0.7或异常→飞书OCR降级，但飞书OCR适配器未实现 |
| TR-4.2 (图片扩展名) | ✅ 通过 | ocr/index.js行58-62支持png/jpg/jpeg/gif/bmp/webp/tiff |
| TR-4.3 (Python桥接健壮性) | ⚠️ 存在问题 | python-bridge.js使用spawn调用Python，无超时设置；路径参数通过命令行传递，含空格或特殊字符可能失败 |

## 🔴 严重/高危问题

| 编号 | 严重度 | 模块 | 行号 | 问题描述 |
|------|--------|------|------|----------|
| MM-001 | 🔴 高危 | ocr/feishu-ocr-adapter.js | 36 | **飞书OCR适配器未实现**：直接throw Error，降级方案实际不可用。Tesseract失败时降级到飞书OCR会直接报错 |
| MM-002 | 🔴 高危 | asr/feishu-minutes-adapter.js | 16 | **飞书妙记ASR适配器未实现**：直接throw Error，Whisper失败时降级会直接报错 |
| MM-003 | ⚠️ 中危 | clip/python-bridge.js、asr/local-whisper-adapter.js | 多处 | **spawn子进程无超时**：CLIP和Whisper通过spawn调用Python，无timeout设置，模型加载或推理挂起会导致整个流程阻塞 |

## 🟠 中等问题

| 编号 | 严重度 | 模块 | 行号 | 问题描述 |
|------|--------|------|------|----------|
| MM-004 | ⚠️ 中 | asr/local-whisper-adapter.js | 38 | **路径注入风险**：absPath直接插入Python代码字符串(`"${absPath.replace...}"`)，如果路径含引号或特殊字符可能破坏Python代码 |
| MM-005 | ⚠️ 中 | clip/python-bridge.js | 24 | **JSON命令行参数风险**：texts通过JSON.stringify作为命令行参数传递，Windows命令行长度限制(8191字符)可能导致长文本失败 |
| MM-006 | ⚠️ 中 | ocr/index.js | 43 | **降级失败未记录到结构化日志**：飞书OCR降级失败只用console.warn输出，未通过logger记录 |
| MM-007 | ⚠️ 中 | clip/clip_service.py | 35 | **每次调用都重新加载模型**：ViT-B-32模型每次调用都create_model_and_transforms，无模型缓存/服务化，批量处理时性能极差 |
| MM-008 | ⚠️ 中 | asr/local-whisper-adapter.js | 37 | **每次调用都重新加载Whisper模型**：同CLIP问题，没有模型常驻 |

## 🟡 低危/建议

| 编号 | 严重度 | 模块 | 行号 | 建议 |
|------|--------|------|------|------|
| MM-009 | 💡 建议 | asr/local-whisper-adapter.js | 59 | Whisper置信度硬编码为0.85，实际应从模型输出获取 |
| MM-010 | 💡 建议 | ocr/feishu-ocr-adapter.js | 12 | checkFeishuAvailable用execSync同步调用，应改为异步 |
| MM-011 | 💡 建议 | 所有适配器 | - | 缺少统一的Adapter基类/接口定义，三个模块的接口契约是隐式的 |

## 适配器模式分析

### 统一接口契约
| 模块 | 方法 | 返回格式 |
|------|------|----------|
| OCR | `extractText(imagePath, options)` | `{text, confidence, engine, words?}` |
| ASR | `transcribe(audioPath, options)` | `{text, confidence, engine, duration?, language?}` |
| CLIP | `checkImageTextMatch(imagePath, title, copy, options)` | `{matched, score, bestText, similarities, texts, engine}` |

### 降级策略
| 模块 | 主引擎 | 降级引擎 | 降级触发条件 |
|------|--------|----------|-------------|
| OCR | Tesseract.js (本地) | 飞书OCR (云端) | 置信度<0.7或异常 |
| ASR | faster-whisper (本地Python) | 飞书妙记 (云端) | 异常 |
| CLIP | open-clip (本地Python) | 无 | 失败则throw |

### Mock模式支持
三个模块都支持mock模式（engine='mock'），允许测试时传入mockText/mockConfidence，无需真实后端。

## 适配器实现状态

| 适配器 | 状态 | 可用性 |
|--------|------|--------|
| Tesseract OCR | ✅ 已实现 | 需要npm install tesseract.js |
| 飞书 OCR | ❌ 未实现 | 只有stub，throw Error |
| Local Whisper ASR | ✅ 已实现 | 需要pip install faster-whisper |
| 飞书妙记 ASR | ❌ 未实现 | 只有stub，throw Error |
| CLIP (Python) | ✅ 已实现 | 需要pip install open-clip-torch torch pillow |
| 名片解析器 | 未审查 | business-card-parser.js未在主流程中使用 |

## Python桥接协议

### Whisper桥接 (local-whisper-adapter.js)
```
spawn('python', ['-c', '<inline python code>'])
Python内联代码：加载faster-whisper → transcribe → print JSON
stdout最后一行解析为JSON
问题：路径含特殊字符时注入风险；无超时
```

### CLIP桥接 (python-bridge.js + clip_service.py)
```
spawn('python', [clip_service.py, image_path, json_texts])
Python脚本：加载ViT-B-32 → 编码图片/文本 → 计算余弦相似度 → print JSON
stdout最后一行解析为JSON
问题：每次重载模型；命令行参数长度限制；无超时
```
