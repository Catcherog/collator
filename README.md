# Collator

泽怀影像非结构化数据结构化摄入 Agent（V1）。

## V1 边界

- 技术栈：Node.js 20+、TypeScript、Fastify、Zod、Ajv、Vitest、Pino。
- 只处理 `customer_consultation` 纯文本链路。
- Dify 只负责 LLM 结构化提取与 HTTP 回调。
- Collator Core 负责确定性清洗、五重校验、幂等、查重、审核状态与飞书写入。
- 所有业务写入必须经过飞书人工审核，`AUTO_COMMIT_ENABLED=false`。
- V1 不使用 LangChain、LangGraph 或 ReAct Agent。
- Trae 仅作为开发环境，最终服务可脱离 Trae 独立运行。

## 快速启动

```bash
# 1. 安装依赖
npm ci

# 2. 复制环境变量模板并填写
npm run typecheck

# 3. 运行测试
npm run test

# 4. 本地开发
npm run dev

# 5. 构建
npm run build

# 6. 生产启动
npm start
```

## 健康检查

```bash
curl http://localhost:8787/healthz
curl http://localhost:8787/readyz
```

## 核心 API

- `POST /v1/ingestions` — 创建摄入任务
- `GET /v1/ingestions/:id` — 查询任务状态
- `POST /v1/internal/ingestions/:id/candidate` — Dify 结构化结果回调
- `POST /v1/ingestions/:id/approve` — 人工审核通过
- `POST /v1/ingestions/:id/reject` — 人工审核拒绝

## 文档

- `docs/BASELINE_REPORT.md` — Phase 0 基线盘点
- `docs/PROJECT_STATE.md` — 跨窗口状态
- `docs/DECISIONS.md` — 架构决策
- `docs/ACCEPTANCE_REPORT.md` — 验收证据
- `docs/API_CONTRACT.md` — 接口合同（待 Phase 1 完善）
- `docs/FEISHU_SETUP.md` — 飞书配置（待 Phase 3）
- `docs/OPERATIONS.md` — 运维说明（待 Phase 5）
