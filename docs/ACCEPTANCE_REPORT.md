# ACCEPTANCE REPORT

## 环境

- OS：Windows 11
- Node：v22.22.1
- npm：v10.9.2
- Dify：未配置
- 飞书测试 Base：未配置
- Commit：c1e199b

## 工程命令

| 日期 | 命令 | 退出码 | 通过 | 失败 | 关键输出 |
|---|---|---:|---:|---:|---|
| 2026-07-15 | `node src/data-cleaning/core/test-cleaner.js` | 0 | 41 | 0 | 旧清洗模块测试通过（V1 不依赖） |
| 2026-07-15 | `node src/data-cleaning/rules/test-rules.js` | 1 | 35 | 1 | 项目状态非初始触发 warning（V1 不依赖） |
| 2026-07-15 | `node src/data-cleaning/test-integration.js` | 1 | 0 | - | `agent/index.js:20` 语法错误（V1 不依赖） |
| 2026-07-15 | `npm ci` | 0 | - | - | 依赖安装成功 |
| 2026-07-15 | `npm run typecheck` | 0 | - | - | TypeScript 无错误 |
| 2026-07-15 | `npm run lint` | 0 | - | - | ESLint 无错误 |
| 2026-07-15 | `npm run test` | 0 | 16 | 0 | 单元测试全部通过 |
| 2026-07-15 | `npm run test:integration` | 0 | 10 | 0 | 集成测试全部通过 |
| 2026-07-15 | `npm run test:coverage` | 0 | - | - | Core Service 覆盖率 Stmts 90.3% / Branch 82.56% / Funcs 88.57% / Lines 90.3% |
| 2026-07-15 | `npm run build` | 0 | - | - | `dist/` 构建成功 |

## API 合同验证

| 接口 | 方法 | 测试覆盖 | 状态 |
|---|---|---|---|
| `POST /v1/ingestions` | 创建任务 | 是 | PASSED |
| `GET /v1/ingestions/:id` | 查询任务 | 是 | PASSED |
| `POST /v1/internal/ingestions/:id/candidate` | Dify 回调 | 是（HMAC 签名） | PASSED |
| `POST /v1/ingestions/:id/approve` | 审核通过 | 是 | PASSED |
| `POST /v1/ingestions/:id/reject` | 审核拒绝 | 是 | PASSED |
| 同一请求 20 次只生成一个任务 | 幂等 | 是 | PASSED |
| Candidate 回调 20 次只生成一条审核记录 | 幂等 | 是 | PASSED |

## 接口审计

| 检查项 | 状态 | 证据 |
|---|---|---|
| 创建任务返回 HTTP 202 | PASSED | tests/integration/ingestions.test.ts |
| 查询不存在任务返回 HTTP 404 | PASSED | tests/integration/ingestions.test.ts |
| 非法输入返回 HTTP 400 | PASSED | tests/integration/ingestions.test.ts |
| 非法状态跳转返回 HTTP 409 | PASSED | tests/unit/ingestion-service.test.ts |
| 错误签名返回 HTTP 401 或 403 | PASSED | tests/integration/ingestions.test.ts + tests/unit/signature.test.ts |
| 过期时间戳被拒绝 | PASSED | tests/unit/signature.test.ts |
| 相同创建请求重复提交不创建第二条任务 | PASSED | tests/unit/ingestion-service.test.ts |
| 相同 Candidate callback 重放不创建第二条审核结果 | PASSED | tests/unit/ingestion-service.test.ts |
| reject 后不能 approve | PASSED | tests/unit/ingestion-service.test.ts |
| completed 后重复 approve 不产生二次操作 | PASSED | tests/unit/ingestion-service.test.ts |

## 覆盖率基线

| 范围 | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Core Service (`src/server` 可执行代码，排除纯类型文件) | 90.3% | 82.56% | 88.57% | 90.3% |
| 全仓库（含旧 `src/data-cleaning`） | 3.05% | 47.12% | 26.49% | 3.05% |

## 数据质量

| 指标 | 结果 | 门槛 | 状态 |
|---|---:|---:|---|
| 总字段准确率 | - | 90% | IN_PROGRESS（Phase 2 构建评测集中） |
| 必填字段召回率 | - | 95% | IN_PROGRESS |
| 枚举映射精确率 | - | 95% | IN_PROGRESS |
| 非法枚举写入 | 0 | 0 | PASSED（V1 未直接写业务主表） |
| 缺失必填字段直接写入 | 0 | 0 | PASSED（V1 未直接写业务主表） |
| 重复写入率 | 0 | 0 | PASSED（幂等 + 审核状态验证） |
| 被拒绝记录写入率 | 0 | 0 | PASSED（V1 未直接写业务主表） |

## 外部集成

| 场景 | 日期 | 结果 | 证据路径 |
|---|---|---|---|
| 飞书表单触发 Core | - | BLOCKED_EXTERNAL_ENV | 未配置飞书测试 Base |
| Core 调用 Dify | - | BLOCKED_EXTERNAL_ENV | 未配置 Dify 环境 |
| Dify 回调 Candidate | 2026-07-15 | PASSED（模拟） | `tests/integration/ingestions.test.ts` |
| 人工审核写客户主表 | - | BLOCKED_EXTERNAL_ENV | 未配置飞书测试 Base；V1 未实现自动写入 |
| 写入日志 | - | NOT_STARTED | V1 仅内存日志，Phase 3 接入飞书写入日志表 |

## 安全扫描

- ✅ 未发现 `.env`、App Secret、Access Token、私钥明文入库。
- ✅ 未发现真实客户手机号/聊天记录夹具。
- ✅ HMAC 签名验签覆盖缺失、过期、重放、无效签名场景。
- ✅ 手机号、微信、原始文本脱敏逻辑已测试。
- ⚠️ 发现多处硬编码飞书 Base Token、Table ID、Field ID、Folder Token、Open ID（位于旧 `src/data-cleaning/` 与 `src/scripts/temp/`），需在 Phase 3 迁出源码。

## 未通过项

- 旧 `src/data-cleaning/test-integration.js`：旧 Agent 入口存在语法错误，V1 不依赖，计划在 Phase 3 后逐步清理。
- 旧 `src/data-cleaning/rules/test-rules.js`：项目 Schema 状态非初始导致 warning，不影响 V1，V1 主要用 customer Schema。

## Phase 1 最终结论

- **Phase 1 代码基线：PASSED**
- **Phase 1 API 合同：PASSED**
- **Phase 1 安全隐私：PASSED**
- **Phase 1 收尾审计：PASSED**
- **外部联动验收：BLOCKED_EXTERNAL_ENV**（未配置真实 Dify / 飞书环境，按手册要求不声称联动验收通过）

> 整体状态：READY_FOR_PHASE_2
