# Collator V1 基线盘点报告

> 生成日期：2026-07-15  
> 执行环境：Windows + PowerShell  
> Node.js：v22.22.1（满足 ≥20 要求）  
> 对应阶段：Phase 0

---

## 1. 项目现状概览

当前仓库为泽怀影像数据摄入 Agent 的历史代码基线，主要模块以 JavaScript 实现，尚未引入 TypeScript、Fastify、Vitest、Zod 等 V1 锁定技术栈。

### 1.1 关键发现

| 项 | 状态 | 说明 |
|---|---|---|
| Git 仓库 | ❌ 不存在 | 工作区未初始化 `.git` |
| package.json | ⚠️ 极简 | 仅依赖 `docx`，无 scripts、无 TS/Fastify/Vitest/Zod |
| TypeScript 配置 | ❌ 不存在 | 无 `tsconfig.json` |
| 入口服务 | ❌ 不存在 | 无 Fastify HTTP 服务 |
| 现有测试 | ⚠️ 部分可运行 | `test-cleaner.js` 通过；`test-rules.js` 1 处失败；`test-integration.js` 因语法错误无法运行 |
| 环境变量配置 | ⚠️ 不存在 | 无 `.env.example`，多处硬编码飞书资源 ID |
| Docker | ❌ 不存在 | 无 Dockerfile / docker-compose.yml |

### 1.2 目录结构（一级）

```text
collator/
├── .trae/              # AI 规则、知识与 Skill（按规则保留）
├── bin/                # lark-cli.exe
├── docs/               # 文档、报告、SOP、策划案
├── public/             # 临时图片资源
├── src/                # 全部源码
│   ├── config/         # JSON 配置（含硬编码资源 ID）
│   ├── data-cleaning/  # 核心清洗、校验、Schema、规则学习
│   ├── importers/      # 云盘文件列表工具
│   └── scripts/        # 历史脚本与临时脚本
├── package.json        # 仅 docx 依赖
└── package-lock.json
```

---

## 2. 现有入口与运行结果

### 2.1 可独立运行的测试入口

| 入口 | 命令 | 结果 | 备注 |
|---|---|---|---|
| 清洗引擎测试 | `node src/data-cleaning/core/test-cleaner.js` | ✅ 41 通过 / 0 失败 | 四步清洗 pipeline 基本可用 |
| 校验规则测试 | `node src/data-cleaning/rules/test-rules.js` | ⚠️ 35 通过 / 1 失败 | 失败原因：项目状态非初始态触发 warning |
| 集成测试 | `node src/data-cleaning/test-integration.js` | ❌ 无法运行 | `src/data-cleaning/agent/index.js:20` 存在 `&amp;&amp;` HTML 实体语法错误 |

### 2.2 其他入口

- `src/data-cleaning/core/test-*.js`：测试 Scanner、Quality、Logger、Learning、Batch
- `src/data-cleaning/multimodal/*/test-*.js`：OCR / ASR / CLIP 模块测试
- `src/data-cleaning/benchmark/run-benchmark.js`：评测运行器
- `src/scripts/temp/`：大量一次性历史脚本，多数含 TEMP 标记但已过期

---

## 3. Schema 清单

现有 7 个业务 Schema 均位于 `src/data-cleaning/schemas/`：

| Schema | 文件 | 用途 | V1 相关性 |
|---|---|---|---|
| customer | `customer.json` | 客户主表 | ⭐ V1 核心目标 |
| project | `project.json` | 拍摄项目 | V1 不做 |
| resource | `resource.json` | 资源/合作方 | V1 不做 |
| material | `material.json` | 素材归档 | V1 不做 |
| product | `product.json` | 成品发布 | V1 不做 |
| research | `research.json` | 市场调研 | V1 不做 |
| sop | `sop.json` | 话术库/SOP | V1 不做 |

### 3.1 customer Schema 关键字段

| 字段名 | 类型 | 必填 | 枚举值 |
|---|---|---|---|
| 客户姓名 | text | ✅ | - |
| 联系方式 | text(phone) | ✅ | - |
| 来源渠道 | select | - | 小红书、抖音、视频号、朋友圈、老客转介绍、线下、其他 |
| 咨询时间 | datetime | - | - |
| 拍摄类型 | select | - | 亲子、商业拍摄、创作片 |
| 预算区间 | select | - | 1000元以下、1000-2000元、2000-3000元、3000-5000元、5000元以上 |
| 意向风格 | multi-select | - | 日系清新、韩系唯美、复古胶片、暗调情绪、法式浪漫、国潮古风 |
| 跟进记录 | text | - | - |

> 注意：现有 Schema 使用中文 `fieldName`，V1 需要与 Dify 输出的英文 `source_channel_raw` 等字段建立映射。

---

## 4. 核心模块盘点

### 4.1 必须保留并适配的模块

| 模块 | 路径 | 适配方式 |
|---|---|---|
| 四步清洗 Pipeline | `src/data-cleaning/core/data-cleaner.js` | 提取为 TypeScript Adapter，保留 Null/Format/Enum/Default 顺序 |
| 校验规则 | `src/data-cleaning/rules/index.js` | 复用字段校验、必填校验、逻辑一致性校验 |
| Schema 加载器 | `src/data-cleaning/schemas/index.js` | 扩展字段映射与英文 Candidate 字段适配 |
| 同义词/枚举映射 | `src/data-cleaning/config/synonyms.json` | 保留并版本化 |
| BitableWriter | `src/data-cleaning/agent/execution/bitable-writer.js` | 重构为 FeishuWriter Adapter，移除硬编码 token |

### 4.2 需要废弃或 V1 不启用的模块

| 模块 | 路径 | 原因 |
|---|---|---|
| Agent 工作流调度 | `src/data-cleaning/agent/workflows/` | V1 不用 ReAct / 多工作流自动路由 |
| 感知层多模态 | `src/data-cleaning/multimodal/` | V1 不做 OCR/ASR/CLIP |
| 规则自学习 | `src/data-cleaning/core/rule-learning.js` | V1 不自动发布新规则 |
| 联动引擎 | `src/data-cleaning/agent/execution/linkage-engine.js` | V1 只写客户主表，不做跨表联动 |
| 确认 UI | `src/data-cleaning/agent/execution/confirmation-ui.js` | V1 用飞书审核表替代 |

### 4.3 已知缺陷

| 缺陷 | 位置 | 影响 | 处理建议 |
|---|---|---|---|
| HTML 实体 `&amp;&amp;` 导致语法错误 | `src/data-cleaning/agent/index.js:20`、`src/data-cleaning/agent/index.js:126-127` | 任何引用 `agent/index.js` 的入口无法运行 | Phase 1 前作为基线修复或废弃该文件 |
| `package.json` 缺少所有工程脚本 | 根目录 | 无法运行 `npm test` / `npm run build` | Phase 1 初始化 |
| 硬编码飞书 Base Token / Table ID | `src/data-cleaning/config/agent-config.json` 等 | 安全风险、无法在不同环境运行 | 移入 `.env` / 私有映射 |

---

## 5. 硬编码资源与敏感信息扫描

### 5.1 扫描方法

使用 Grep 扫描 `src/` 下包含 `tbl`、`fld`、`MwGMbF0`、`K9QEfQ`、`7633338901909785795`、`ou_` 等模式的文件。

### 5.2 发现清单

> 以下资源标识已做脱敏/类型标注，具体值见源码，V1 必须移出公开代码。

| 资源类型 | 出现位置 | 数量 | 风险等级 |
|---|---|---|---|
| 飞书 Base App Token | `src/data-cleaning/config/agent-config.json`、PowerShell 脚本、JSON 报告 | 多处 | 🔴 高 |
| 飞书 Table ID | `src/data-cleaning/config/agent-config.json`（7 张业务表） | 7 处 | 🔴 高 |
| 飞书 Field ID | `src/data-cleaning/schemas/customer.json` 等 | 多处 | 🟡 中 |
| 飞书云盘 Folder Token | `src/scripts/temp/analyze_missing.js`、`src/config/cloud_drive_asset_report*.json` | 多处 | 🟡 中 |
| 飞书用户 Open ID | `src/config/cloud_drive_asset_report*.json` | 多处 | 🟡 中 |
| Space ID | `src/data-cleaning/config/agent-config.json` | 1 处 | 🟡 中 |
| App Secret / Access Token | 未发现 `.env` 或明文密钥文件 | 0 | 🟢 低 |

### 5.3 未发现项

- ✅ 无 `.env` 文件提交
- ✅ 无 App Secret、Access Token、私钥明文
- ✅ 无真实客户手机号/聊天记录夹具（现有夹具为合成数据）

---

## 6. 依赖与外部条件

| 依赖 | 状态 | 说明 |
|---|---|---|
| Node.js ≥20 | ✅ | 当前 v22.22.1 |
| npm scripts | ❌ | 需重新初始化 |
| TypeScript | ❌ | 需安装配置 |
| Fastify | ❌ | 需安装 |
| Zod / Ajv | ❌ | 需安装 |
| Vitest | ❌ | 需安装 |
| Pino | ❌ | 需安装 |
| Dify 环境 | ❌ 未配置 | 需用户/外部提供，Trae 不能伪造 |
| 飞书测试 Base | ❌ 未配置 | 需用户/外部提供，V1 不接生产 |
| Docker | ❌ 未配置 | Phase 5 再引入 |

---

## 7. 风险与阻塞项

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 现有 `agent/index.js` 语法错误导致集成入口不可用 | 中 | Phase 0 标记；Phase 1 起用新的 `src/server/` 替代旧 agent 入口 |
| 硬编码资源 ID 需全部迁移到环境变量 | 高 | Phase 1 创建 `.env.example`；Phase 3 完成迁移 |
| 现有 Schema 字段名为中文，Dify Candidate 输出为英文，需要映射层 | 中 | Phase 2 增加 Normalization Adapter |
| 没有真实 Dify/飞书环境，Gate D/E 部分无法本地验证 | 高 | 明确标记 `BLOCKED_EXTERNAL_ENV`，不伪造证据 |
| 无 Git 历史，基线 commit 需新建 | 低 | 本阶段初始化仓库并提交 |

---

## 8. Phase 0 结论

- 现有代码提供了可用的清洗、校验、Schema 和同义词资产，可作为 V1 复用基础。
- 当前项目未具备 TypeScript/Fastify/Vitest 工程骨架，Phase 1 需从零搭建 Core Service 外壳。
- 旧 Agent 入口存在语法错误，V1 不修复旧入口，而是新建 `src/server/` 架构。
- 所有飞书资源 ID 需迁出源码；当前尚未配置 `.env` 或测试环境。
- 基线 Commit 应在完成本报告和状态文件后创建。

---

## 9. 下一步

进入 Phase 1：Core Service 外壳

1. 初始化 Git 仓库并创建基线 Commit。
2. 重构 `package.json`，安装 TypeScript、Fastify、Zod、Ajv、Vitest、Pino。
3. 创建 `tsconfig.json`、`.env.example`。
4. 实现 `src/server/app.ts`、健康检查、Ingestion API、HMAC 验签、InMemory Repository。
