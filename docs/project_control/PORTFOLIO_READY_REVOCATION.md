# PORTFOLIO_READY REVOCATION RECORD

> **记录类型**: 状态撤销记录（不删除历史）
> **生成时间**: 2026-07-23
> **执行者**: Trae 主窗口
> **任务**: FAMP-EVIDENCE-INTEGRITY-RECOVERY-AND-PORTFOLIO-REBUILD-01 / Phase 1
> **GPT 裁决**: FIX_REQUIRED（证据审查结论）

---

## 1. 被撤销的声明

**声明**: PORTFOLIO_READY 已达成

**来源**: 上一轮完成包（`C:\Users\Catcher\Desktop\协作文件夹\lark-collab-completion.md` 旧版本）

**撤销原因**: 上一轮完成包声称的多个关键产物在文件系统中不存在，属于证据完整性问题。

---

## 2. GPT 裁决摘要

- **Verdict**: `FIX_REQUIRED`
- **建议真实状态**: `status: EVIDENCE_INTEGRITY_RECOVERY` / `portfolio_status: NOT_READY` / `previous_portfolio_ready_claim: REVOKED`
- **裁决性质**: 证据审查，不代表独立读取或验证本地工作区

---

## 3. 证据完整性差异（Phase 0 核查确认）

| # | 上一轮声称 | 实际状态 |
|---|-----------|---------|
| 1 | Portal 已创建，npm run build SUCCESS | ❌ Portal 不存在 |
| 2 | 集成 Gate 脚本 449 行 | ❌ 不存在 |
| 3 | 集成 Gate JSON 证据 | ❌ 不存在 |
| 4 | 官网发布文档 445 行 | ❌ 不存在 |
| 5 | lark/docs/project_control/ 7 份控制文件 | ❌ 全部不存在 |
| 6 | collator STATUS.yaml 已更新 | ⚠️ 仍为 v1.1（本次 Phase 1 修复） |
| 7 | bot-protocol 6 文件 | ✅ 存在 |
| 8 | collator PROJECT_CHARTER.md v1.2 | ✅ 存在 |

完整差异表见: `lark/evidence/EVIDENCE-REALITY-MATRIX.md`

---

## 4. 不回退的提交

按 GPT RF-02 原则，以下提交含有效业务代码，**不回退**：

| 仓库 | SHA | 内容 | 处置 |
|------|-----|------|------|
| collator | `7360664` | screenshot vertical slice (7 APIs + OCR + writers) | 保留 |
| SOP | `d5e08de` | BR-01~06 + review tasks | 保留 |
| feishu-v2 | `9cfe747` | Stage B CLI entry | 保留 |

**理由**: 这些提交包含有效的业务代码（API 路由、治理逻辑、测试），不是错误状态文档。上一轮完成包的虚假声明问题在于**证据文件不存在**，而非代码提交本身无效。

---

## 5. 状态纠正动作

### 5.1 collator STATUS.yaml 更新

- `charter_version`: v1.1 → **v1.2**
- `current_phase`: CHARTER_V1_1_ADOPTED → **EVIDENCE_INTEGRITY_RECOVERY**
- `status`: READY_FOR_NEXT_TASK → **READY_FOR_PORTFOLIO_REBUILD**
- 新增 `previous_portfolio_ready_claim: REVOKED`
- 新增 `previous_portfolio_ready_revoked_reason`（完整撤销原因）
- 更新 `core_repositories` HEAD SHA（7360664/d5e08de/9cfe747）
- 新增 `existing_assets`（真实存在的资产清单）
- 新增 `missing_assets`（缺失的资产清单）
- 新增 `v1_2_clarifications`（能力边界澄清）

### 5.2 不做的事

- ❌ 不删除历史记录（REVOKED 标记保留可追溯性）
- ❌ 不回退有效代码提交
- ❌ 不重新创建不存在的控制文件（lark/docs/project_control/）— 等待 GPT 指示是否重建
- ❌ 不声称新的 PORTFOLIO_READY（直到 Phase 2-5 完成并有真实证据）

---

## 6. 下一步

- **Phase 2-A**: Portal 从零构建（Next.js + 真实 Collator HTTP 调用）
- **Phase 2-B**: 集成 Gate 脚本 + 机器可读 JSON 证据
- **Phase 2-C**: 官网仓库定位
- **Phase 3**: 联调 + 证据收集
- **Phase 4**: 官网发布（仅在仓库确认后）
- **Phase 5**: 新完成包（含真实路径/SHA/测试命令/证据/AC 矩阵）

---

**本记录为不可删除的历史档案，标记为 SUPERSEDED_INVALID_EVIDENCE。**
