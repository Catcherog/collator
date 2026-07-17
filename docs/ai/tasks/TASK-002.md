# TASK-002: 接通 Candidate 映射、CleaningPipeline 与飞书审核记录

## Status

PLANNED

## Stage

MVP / Phase 3B

## Dependencies

- TASK-001 完成并通过复审。

## Objective

把 Dify Candidate 的英文键转换为中文 Schema，执行 Phase 2C 确定性清洗管道，并将候选、标准化结果和校验信息写入飞书审核表。

## Canonical Field Mapping

| Candidate key | 中文 Schema 字段 |
|---|---|
| `customer_name` | `客户姓名` |
| `contact` | `联系方式` |
| `source_channel` | `来源渠道` |
| `consultation_time` | `咨询时间` |
| `shooting_type` | `拍摄类型` |
| `budget` | `预算区间` |
| `style_preferences` | `意向风格` |
| `follow_up_notes` | `跟进记录` |
| `review_record` | `好评记录` |

中文字段允许直接传入。未知字段保留在原始 Candidate 中，但不得进入业务写入，并产生 `UNMAPPED_CANDIDATE_FIELD` warning。中英文同时提供且值冲突时，以中文字段为准并记录 warning。

## In Scope

- 新增无副作用的 Candidate 字段映射层。
- `receiveCandidate()` 调用映射层及 `runCleaningPipeline()`。
- 将 `standardizedRecord` 保存为 `normalized_fields`。
- 将 Pipeline corrections、warnings、errors 和 validation 结果保存到任务与审核记录。
- 新增 `ReviewRepository` 及内存、飞书实现。
- 飞书实现返回真实 Base `record_id` 作为不透明 `review_record_id`。
- Candidate 重放返回原审核记录，不创建第二条。
- Pipeline 阶段异常时进入 `validation_failed`，不创建审核记录。
- 更新 `docs/API_CONTRACT.md`，正式记录英文键、warning 和失败状态语义。

## Out of Scope

- Dify 真实调用。
- 审核通过后的客户表写入。
- 项目、素材、资源等其他 Schema。
- 修改 Legacy 源码或旧 Schema 文件。

## Expected Files

- Create: `src/server/mapping/customer-candidate-mapper.ts`
- Create: `src/server/repositories/review-repository.ts`
- Create: `src/server/repositories/in-memory-review-repository.ts`
- Create: `src/server/repositories/feishu-review-repository.ts`
- Modify: `src/server/services/ingestion-service.ts`
- Modify: `src/server/domain/ingestion.ts`
- Modify: `src/server/app.ts`
- Modify: `docs/API_CONTRACT.md`
- Test: `tests/unit/mapping/customer-candidate-mapper.test.ts`
- Test: `tests/unit/repositories/feishu-review-repository.test.ts`
- Modify/Test: `tests/unit/ingestion-service.test.ts`
- Modify/Test: `tests/integration/ingestions.test.ts`

## Acceptance Criteria

- [ ] 英文 Candidate 与等价中文 Candidate 产生相同 Pipeline 标准化结果。
- [ ] 现有 50 条 Gate C-Core fixture 结果不回归。
- [ ] Pipeline 阶段顺序、不可变性和确定性保持不变。
- [ ] 成功回调后任务状态为 `pending_review`，并存在真实审核记录。
- [ ] 20 次相同回调只存在一条审核记录。
- [ ] 未知字段和字段冲突产生明确 warning，且不会写入业务字段。
- [ ] Pipeline 阶段异常时状态为 `validation_failed`，不创建审核记录。
- [ ] warning/error 中的手机号、路径和敏感文本继续脱敏。
- [ ] 新链路不读取旧 Schema 中已漂移的 field ID。
- [ ] `git diff origin/main -- src/data-cleaning` 无输出。

## Implementation Constraints

- 映射函数必须是纯函数，不修改传入 Candidate。
- 审核记录 ID 对调用方是不透明字符串，不依赖 `rec_review_` 格式。
- Candidate 原始 JSON 可用于审核证据，但不得出现在普通应用日志。
- Gate C-LLM 仍保持阻塞，不得用合成 Candidate 宣称真实 LLM 已通过。

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:integration`
- `npm run test:coverage`
- `npm run build`
- `npm run audit:legacy`
- `npm run evaluate`
- `git diff origin/main -- src/data-cleaning`

