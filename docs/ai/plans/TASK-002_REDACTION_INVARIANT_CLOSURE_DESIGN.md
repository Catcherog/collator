# TASK-002 Redaction Invariant Closure — Design

## Status

APPROVED — READY FOR TRAE EXECUTION PLAN

## Goal

将 Commit `976fa6c` 暴露的 P0-01D 与 P0-04B 从两个点状修复合并为一个有边界的脱敏不变量闭包批次，使 Trae 可以连续完成实现、反例矩阵、一次最终 Gate A + Gate C-Core、文档与 Git 交付，下一次 GPT 只做最终风险复核。

## Why One Batch

P0-01D 与 P0-04B 都发生在 `redactValueDeep()` 的响应边界策略：前者是上下文敏感度被错误降级，后者是结构化 ID 豁免缺少可信字段上下文。继续按单个 payload 打补丁会重复产生“现有测试全绿、相邻反例仍泄露”的审计循环。

本批次按两个可验证不变量关闭根因：

1. 脱敏模式只能保持或升级敏感度，不能降级。
2. 结构化 ID 只有在可信 ID 字段上下文中才能按值格式原样保留。

## Architecture

### Invariant A: Monotonic Redaction Sensitivity

固定优先级：

```text
contact > content > default
```

- inherited `contact` 对所有后代字符串保持最高优先级；nested `content` / `phone` / `mobile` / `原始文本` 不得降级它。
- inherited `content` 可继续处理普通后代字符串，但遇到 nested `contact` / `联系方式` / `wechat` / `微信` 时必须升级为 `contact`。
- 数组和任意深度对象使用相同合并规则。
- Pipeline `field` sibling 对 `original` / `corrected` 的模式推断也遵守同一优先级。

实现应集中为一个小型 mode-resolution helper 或等价的单一决策点，避免 string branch、object branch 与 field-sibling branch 各自维护不同优先级。

### Invariant B: Context-Aware Structural ID Preservation

值形态本身不能证明字符串是结构化 ID。原样保留必须同时满足：

1. 当前 key/path 属于服务响应合同中的可信 ID 字段；以及
2. 值满足该字段允许的结构化 ID 格式。

最低可信字段集合必须覆盖当前任务响应实际使用的：

- `ingestion_id`
- `idempotency_key`
- `review_record_id`
- `source_record_id`
- `workflow_run_id`
- `reviewer_id`
- `business_record_id`

Trae 可根据当前 domain/API contract 补充同类、已经存在的真实 ID 字段，但不得因为任意 key 以 `_id` 结尾就自动信任攻击者控制的 Candidate 字段。未知 `fields`、`evidence`、warnings、errors 与其他任意数据仍默认经过手机号扫描。

必须保持：

- 确定性失败 ID `ing_2e042890392546c19181507170127599` 逐字节不变。
- 合同内 UUID、SHA-256 与 opaque ID 不被误改。
- `note_13800138000`、`proof_13900139000` 等未知值不能凭格式绕过 `redactPhone()`。

## Authorized Scope

Trae 可连续修改：

- `src/server/security/redaction.ts`
- `tests/unit/security/redaction.test.ts`
- `tests/integration/ingestions.test.ts`
- `docs/ai/tasks/TASK-002.md`
- `docs/ai/reviews/TASK-002_GPT_REVIEW.md`
- `docs/ai/PROJECT_STATE.md`
- `docs/ACCEPTANCE_REPORT.md`
- `reports/phase2/legacy-module-profiles.json`（仅 `audit:legacy` 正常生成变化）

如果实现中发现同一两个不变量下的直接反例，Trae 有权在以上代码和测试文件内一并修复并增加回归，无需中途请求 GPT 审计。允许条件：

- 不改变 API 请求/响应合同。
- 不增加依赖。
- 不修改 P0-02/P0-03 的证据持久化行为。
- 不触及 TASK-003。
- 不扩展为通用脱敏框架重写。

超出这些条件时停止并升级用户裁决。

## Explicitly Out of Scope

- TASK-003 或客户主表写入。
- P0-02/P0-03 重构。
- 新公共 API、配置项、外部依赖或 ADR。
- 与两个不变量无关的命名、目录或通用安全清理。
- 将整个 redaction 模块改造成通用 path-policy framework。

## Test Matrix

### Unit Matrix

1. Contact parent：nested `content` / `phone` / `mobile` / `原始文本` / `联系方式`，含对象、数组、多层组合。
2. Content parent：nested `contact` / `联系方式` / `wechat` / `微信` 必须升级；普通 phone/content 后代仍使用 content 行为。
3. Pipeline field sibling：contact/content/default 的 `original` 与 `corrected` 使用同一优先级规则。
4. Trusted ID fields：确定性 ingestion ID、UUID、SHA-256、实际 opaque IDs 逐字节保留。
5. Untrusted values：未知 Candidate/evidence 中 `note_<phone>`、`proof_<phone>`、数组内同类值必须脱敏。
6. 所有矩阵均验证输入不变与重复调用确定性。

测试优先采用 table-driven cases，避免为每个字符串复制大段结构。

### HTTP Matrix

至少保留并通过：

1. 原 P0-01C contact-parent 签名 callback → GET。
2. 原 P0-04 确定性 ingestion ID GET。
3. P0-01D content-parent + nested contact 签名 callback → GET。
4. P0-04B unknown fields/evidence wrapped phone 签名 callback → GET。

HTTP 回归必须同时断言：

- GET 不含原始秘密。
- GET 包含预期 mask 或逐字节稳定 ID。
- repository 与 review 中的原始证据保持不变。
- GET 不修改存储。

## Execution and Verification Policy

为减少非必要审计，执行顺序固定为：

1. Trae 写反例测试并确认 targeted red phase。
2. 连续实现两个不变量及同根因直接反例。
3. 运行 targeted unit + integration，直到全部 green。
4. 只在代码与测试稳定后运行一次最终 Gate A + Gate C-Core：
   - `npm ci`
   - `npm run audit:legacy`
   - `npm run typecheck`
   - `npm run lint`
   - `npm run test`
   - `npm run test:integration`
   - `npm run test:coverage`
   - `npm run build`
   - `npm run evaluate`
   - `git diff origin/main -- src/data-cleaning`
   - `git diff --check`
5. 更新授权范围内四份控制文档和 audit 产物。
6. Trae 检查最终 diff、敏感信息与 Git 状态，commit + push 一次，并返回新 commit。
7. GPT 下一轮只审查：commit 范围、两个不变量、反例回归、最终 Gate 摘要与 Git/control 状态；不重复无风险的全量探索。

Gate A 任一命令失败时，Trae 可在当前授权文件内进行与本批次直接相关的恢复；确认是无关基线失败时记录证据，不顺手修复。

## Acceptance Criteria

- P0-01A/B/C 既有复现保持通过。
- P0-01D 的 content-parent nested contact/wechat 所有矩阵不再泄露。
- 确定性 ingestion ID、合同内 UUID/SHA-256/opaque IDs 逐字节保留。
- P0-04B 的未知 Candidate/evidence `prefix_<phone>` 所有矩阵均脱敏。
- repository/review 原始证据保持完整，GET 不修改存储。
- P0-02/P0-03 保持 accepted 行为。
- 最终 Gate A + Gate C-Core 全部通过。
- Legacy diff 为空，TASK-003 未启动。
- 实现、测试、控制文档与 audit 产物由 Trae 合并为一个可审计的新 commit 并 push。

## Final Review Boundary

下一次 GPT 复核只允许继续阻塞：

1. 上述两个不变量仍可被当前 API 路径违反；或
2. 本批次引入直接安全/数据完整性回归；或
3. 最终 Gate/Git/control evidence 与提交事实不一致。

代码偏好、额外抽象、非当前 API 可达的推测性形态以及无关技术债不得继续阻塞 TASK-002。
