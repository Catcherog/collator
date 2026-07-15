# Collator V1 验收清单

## A. 架构边界

- [ ] 生产运行不依赖 Trae。
- [ ] 未引入 LangChain、LangGraph 或 ReAct Agent。
- [ ] Dify 未直接写飞书业务主表。
- [ ] Core 使用 TypeScript + Fastify。
- [ ] 现有清洗、校验和 Schema 被复用或有迁移对照。
- [ ] `AUTO_COMMIT_ENABLED=false`。
- [ ] V1 仅支持 customer_consultation 纯文本链路。

## B. 工程质量

- [ ] `npm ci` 通过。
- [ ] `npm run typecheck` 通过。
- [ ] `npm run lint` 通过。
- [ ] `npm run test` 通过。
- [ ] `npm run test:integration` 通过。
- [ ] `npm run build` 通过。
- [ ] Core 关键模块行覆盖率 ≥80%。

## C. API 与状态机

- [ ] 创建任务返回 202。
- [ ] 重复创建 20 次只产生一个任务。
- [ ] Callback 重放 20 次只产生一条审核记录。
- [ ] HMAC 错误或过期请求被拒绝。
- [ ] 非法状态跳转返回 409。
- [ ] 拒绝后不能再次批准。
- [ ] 已完成任务重复批准不重复写入。

## D. 数据质量

- [ ] 固定评测集 ≥50 条。
- [ ] 总字段准确率 ≥90%。
- [ ] 必填字段召回率 ≥95%。
- [ ] 枚举映射精确率 ≥95%。
- [ ] 非法枚举写入为 0。
- [ ] 缺必填字段直接写入为 0。
- [ ] 同名客户不自动合并。
- [ ] 相对日期无证据时不编造精确日期。

## E. 飞书联动

- [ ] 任务表提交能触发 Core。
- [ ] Core 能调用 Dify。
- [ ] Dify 能回调 Candidate。
- [ ] 审核表展示原始、提取、清洗、证据、警告和重复候选。
- [ ] 修改后批准时使用人工修正值。
- [ ] 拒绝后客户主表零写入。
- [ ] 同一任务重复触发客户表不重复写入。
- [ ] 写入日志包含版本、审核人和 before/after。

## F. 安全

- [ ] 无 `.env`、App Secret、Access Token 或私钥入库。
- [ ] 测试夹具无真实客户数据。
- [ ] 日志手机号脱敏。
- [ ] 应用日志不记录原始聊天全文。
- [ ] Dify Cloud 不使用未脱敏数据。
- [ ] Secret scan 通过。

## G. 部署

- [ ] Docker 构建通过。
- [ ] `docker compose up -d` 成功。
- [ ] `/healthz` 通过。
- [ ] `/readyz` 在正确配置下通过。
- [ ] 未配置凭据时默认 Dry Run，不误写真实飞书。
- [ ] README 能让新环境 30 分钟内启动。

## H. 官网证据

- [ ] 飞书入口真实截图。
- [ ] Dify Workflow 真实截图。
- [ ] Dify Trace 真实截图。
- [ ] 审核前后差异截图。
- [ ] 最终客户记录截图。
- [ ] 写入日志截图。
- [ ] 50 条评测报告。
- [ ] 幂等测试证据。
- [ ] 拒绝零写入证据。
- [ ] 60—90 秒端到端录屏。
