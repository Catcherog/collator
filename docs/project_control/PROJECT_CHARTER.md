<!-- AUTHORITY_MARKER_START -->
> **权威仓库标记（AUTHORITY REPOSITORY）**
> 本文件是 Project ID `FEISHU-AI-MIDDLE-PLATFORM` 总章程 v1.2 的唯一权威副本。
> 权威仓库：`collator`（远程 https://github.com/Catcherog/collator.git，分支 `phase/3-feishu-integration`）
> 权威路径：`collator/docs/project_control/PROJECT_CHARTER.md`
> 其他仓库（SOP）仅保留非权威同步副本或引用。
> v1.2 引入"2 主线 + 1 辅线"执行架构（A 截图纵向闭环 / B 智能录入台 / C 机器人通知），不改变 v1.1 核心架构事实。
> v1.0 中关于写入边界的旧定义已被 v1.1 第 0.2 节明确废止，v1.2 保持该废止。
> 标记时间：2026-07-22
> 标记任务：FAMP-CHARTER-V1.2-ADOPTION-01
<!-- AUTHORITY_MARKER_END -->

# 飞书智能业务数据中台项目总章程 v1.2

> 文档性质：GPT 与 Trae 的项目级最高协作章程（权威副本，由 collator 仓库维护）  
> Project ID：`FEISHU-AI-MIDDLE-PLATFORM`  
> Project Name：飞书智能业务数据中台  
> 核心仓库：`collator`、`feishu-v2 / SOP`  
> 展示仓库：`jaelchen-portfolio`  
> 当前阶段：交互与截图纵向切片（INTERACTION_AND_SCREENSHOT_VERTICAL_SLICE）  
> 章程版本：v1.2  
> 生效日期：2026-07-22  
> 维护方式：单一事实源（SSOT）  
> 默认执行路由：R2（GPT 规划 → Trae 执行 → GPT 证据审查）  
> Codex：`NOT_REQUIRED_BY_DEFAULT`，仅在触发升级条件时介入

---


# 0. v1.1 修订声明

本版本取代 v1.0 中关于写入责任的旧定义。若历史章节、旧任务卡或完成包与本节冲突，以本节为准。

## 0.1 新权威事实

1. **飞书多维表格是核心业务数据库、日常操作界面与人工协作空间。**
2. **Collator 是飞书业务数据的主要智能写入入口，但不是唯一写入入口。**
3. 用户可以继续直接在飞书表格中新增、修改和补充业务数据。
4. 智能中台不是替代飞书数据库，而是在飞书之上增加 AI、自动化、校验、路由、复核、审计和对账能力。
5. SOP 是统一业务治理与流程执行引擎，但不是唯一物理写入通道。
6. 系统必须同时支持：
   - `PRE_WRITE`：Collator 写入前治理；
   - `POST_WRITE`：用户直接写入飞书后的治理。
7. 所有关键写入必须具备来源标识、循环触发保护、字段权威等级和分层幂等。
8. 官网可将“数据中台”和“Collator”分别作为重点案例，但两者共同组成更高层的 AI Native Operations Platform。

## 0.2 被废止的旧表述

以下表述不再有效：

> Collator 不负责正式业务表写入。  
> SOP 是正式业务数据唯一写入入口。

替换为：

> Collator 是飞书业务数据的主要智能写入入口。  
> 用户仍可直接在飞书表格中写入。  
> SOP 是统一治理门禁和流程执行引擎，但不是唯一物理写入通道。  
> 飞书是权威业务数据库。

---

# 0A. v1.2 修订声明

本版本在 v1.1 基础上引入新的执行架构，不改变 v1.1 第 0.1 节确立的 8 条核心架构事实、BR-01 ~ BR-06 业务规则不变量、双入口治理、字段权威等级和分层幂等。v1.1 的架构事实全部延续有效。

## 0A.1 v1.2 新增执行原则

1. **先完成 v1.2 章程采用，再启动功能分支。**
2. 采用"2 主线 + 1 辅线"执行架构：
   - **主线 A**：核心截图纵向闭环（Collator / Candidate / SOP / 正式写入 / 业务幂等）。
   - **主线 B**：智能录入台 MVP（Portal 页面 / 前端状态 / API Client / 契约 Mock）。
   - **辅线 C**：机器人、卡片和通知调查；核心 API 未冻结前不得改核心业务代码。
3. **A 拥有** Collator、Candidate、SOP、正式写入和业务幂等语义。
4. **B 只拥有** Portal 页面、前端状态、API Client 和契约 Mock。
5. **C 只拥有** 机器人 Adapter、消息卡片、通知和回调协议。
6. **B/C 不得复制** 客片、样片、Customer、Model 等业务规则。
7. **不引入 Dify 作为主链路依赖**；不使用 Dify 时链路仍可运行。
8. 每个仓库只在交付前执行一次全量回归；开发阶段优先运行定向测试。
9. 不为每个小步骤生成独立完成包；每条执行线最终仅输出一个紧凑完成包。
10. 不创建无必要的 SHA backfill 或纯状态提交；状态文件随功能结果一起提交。
11. 未经授权不 force push，不提交 Secret、PII、真实客户截图和真实飞书资源标识。

## 0A.2 v1.2 废止的旧任务批次

v1.1 第 29A 节的首批任务（Task 1 章程 v1.1 入库、Task 2 双入口只读调查）已全部完成并关闭。v1.2 第 29B 节定义新任务批次，取代 v1.1 旧任务队列。Candidate Contract v1.1 升级（`FAMP-CANDIDATE-CONTRACT-V1.1-01`）被新主线 A 吸收，不再作为独立前置任务。

---

# 1. 章程目的

本章程用于统一 GPT、Trae、Codex 与用户在“飞书智能业务数据中台”项目中的职责、事实口径、执行顺序、验收标准和停止条件。

本章程解决以下问题：

1. 防止 Collator 与 SOP 各自演进，形成重复或冲突能力。
2. 防止 GPT、Trae 在不同对话框中使用不同项目定义。
3. 防止一次性迁移工具叙事偏离“智能业务数据中台”产品目标。
4. 防止 OCR、ASR、LLM 逻辑散落到飞书自动化中。
5. 防止任务范围不断扩张，拖慢简历与官网展示。
6. 防止“测试通过”被错误表述为“生产可用”。
7. 防止基于未读取仓库、未运行测试或未提交证据作出虚假结论。
8. 建立可跨对话框恢复的项目控制体系。

---

# 2. 项目定义

## 2.1 产品名称

**飞书智能业务数据中台**

英文展示名称：

**AI-assisted Data Governance Platform for Feishu**

## 2.2 一句话定位

让业务人员继续在飞书中录入和管理业务数据，由后台系统自动完成多源数据摄入、格式标准化、业务规则校验、异常解释、人工复核和可信写回。

## 2.3 产品目标

第一阶段目标不是构建通用 SaaS，也不是一次性完成全部生产能力，而是交付一个：

- 可真实运行；
- 可重复演示；
- 可解释；
- 可审计；
- 可在简历和官网公开展示；

的飞书智能数据治理闭环。

## 2.4 第一阶段成功标准

用户能够在两分钟内演示：

1. 在飞书新增结构化记录，或上传匿名需求截图。
2. Collator 读取并标准化数据。
3. SOP 根据确定性业务规则作出治理决策。
4. 正常记录写入正式业务表。
5. 异常记录进入待复核任务表。
6. AI 提供字段候选或异常解释。
7. 人工确认后重新进入 SOP。
8. 第二次触发不产生重复记录。
9. 审计日志能追踪来源、规则版本、处理状态和目标记录。

达到该标准后，可标记：

`PORTFOLIO_READY`

该状态不等于：

`PRODUCTION_READY`

---

# 3. 项目范围

## 3.1 In Scope

第一阶段包含：

1. 飞书多维表格作为业务操作入口。
2. Collator 作为统一摄入和数据清洗层。
3. SOP 作为业务规则、幂等和写入决策层。
4. Customer、Project、Model 等现有业务实体规则。
5. 客片与样片的差异化关联校验。
6. 结构化 Project 纵向切片。
7. 图片 OCR 最小切片。
8. 60 秒以内短音频 ASR 最小切片。
9. 人工复核任务表。
10. 原始证据、候选字段、错误码和审计记录。
11. 版本化跨仓库 Candidate 合同。
12. 幂等和重复触发处理。
13. 匿名化公开演示。
14. 官网案例、简历描述和面试演示材料。

## 3.2 Out of Scope

第一阶段不包含：

1. 合并 Collator 与 SOP 仓库。
2. 重写全部现有分类器。
3. 构建新的复杂后台管理系统。
4. 通用行业 SaaS 化。
5. LLM 直接覆盖正式业务数据。
6. 全量复杂 PDF 解析。
7. 长音频实时会议助手。
8. 多说话人识别。
9. 所有业务实体的完全自动化。
10. 生产级多租户权限体系。
11. 全量 SLA、计费和商业化能力。
12. 为非阻塞问题持续扩大审计范围。
13. 为官网展示提前完成所有生产基础设施优化。

---

# 4. 权威业务规则

以下规则为项目核心业务不变量，任何代码、测试、文档和展示都不得违反。

## BR-01 客片关联规则

项目类型为“客片”时：

- 必须关联 Customer。
- 缺少 Customer 时进入 `NEEDS_REVIEW` 或 `BLOCKED`。
- 不得自动使用 Model 替代 Customer。

## BR-02 样片关联规则

项目类型为“创作”或“样片”时：

- 必须关联 Model。
- Customer 为空是合法状态。
- 不得判定为 `ORPHAN_PROJECT`。
- 不得要求补充 Customer。

## BR-03 类型缺失规则

项目类型为空时：

- 必须进入 `NEEDS_REVIEW`。
- 错误码应为 `PROJECT_TYPE_REQUIRED` 或等价确定性错误码。
- 不得由 LLM 猜测后直接写入正式表。

## BR-04 权威来源规则

用户提供的飞书“项目统计表”是项目类型与业务关联的权威来源。

任何迁移数据、分类结果或历史推断与其冲突时，以该表为准。

## BR-05 AI 决策边界

AI 可以：

- 提取字段候选；
- 解释异常；
- 生成修复建议；
- 提供多个候选值。

AI 不可以：

- 直接决定最终业务分类；
- 绕过 SOP 写入正式表；
- 静默覆盖人工确认值；
- 将推断值伪装成原始事实。

## BR-06 幂等规则

同一来源记录、附件内容和处理版本重复触发时：

- 不得重复创建正式记录；
- 不得无限创建重复复核任务；
- 必须返回明确的重复处理状态；
- 必须保留可追踪审计记录。

---

# 5. 目标架构

```text
飞书多维表格 / 附件上传 / 自动化 / 事件
                    ↓
              Collator
      数据摄入 / 下载 / OCR / ASR
      富文本归一 / 日期与枚举标准化
      原始证据 / 字段候选 / 置信状态
      幂等键 / 提取器版本 / 错误码
                    ↓
          Versioned Candidate Contract
                    ↓
                 SOP
      业务分类 / 关联校验 / 状态判断
      幂等写入 / 复核任务 / 审计日志
             ↙                 ↘
       正式业务表             待复核任务表
                                  ↓
                            AI 异常解释
                                  ↓
                              人工确认
                                  ↓
                              SOP 重试
```

---

# 6. 模块职责

## 6.1 飞书业务层

负责：

- 用户录入和查看业务数据。
- 上传图片、PDF 和短音频。
- 触发自动化、事件或状态变化。
- 展示正式业务记录。
- 展示待复核任务。
- 接受人工确认。

不负责：

- 在自动化节点中编写复杂 OCR/ASR 逻辑。
- 承担业务分类和最终写入判断。
- 保存不可审计的 Prompt 和推理结果。
- 直接调用多个外部模型后覆盖正式字段。

## 6.2 Collator

定位：

**AI 数据摄入与质量治理 Agent，以及飞书业务数据的主要智能写入入口**

负责：

1. 接收结构化记录、图片、PDF、音频和外部数据。
2. 下载飞书附件并调用 OCR、ASR、后续妙记或 CLIP 能力。
3. 标准化富文本、string、空值、日期、枚举和引用字段。
4. 保存原始证据并执行 Schema Mapping。
5. 提取字段候选，生成数据质量问题和置信状态。
6. 执行摄入级去重与幂等。
7. 生成版本化 Candidate。
8. 调用 SOP 的 `PRE_WRITE` 治理。
9. 在 SOP 通过后写入飞书正式业务表。
10. 写入摄入任务、原始文本、候选和技术审计。
11. 对外部 AI 失败进行降级。
12. 防止自身写入引发无限循环。

不负责：

1. 自行维护与 SOP 不一致的业务规则。
2. 绕过 SOP 将不确定候选写成权威业务事实。
3. 静默覆盖人工确认值。
4. 建立另一套权威业务数据库。
5. 阻止用户直接编辑飞书。
## 6.3 SOP

定位：

**统一业务治理、自动化编排和流程执行引擎**

负责：

1. 接收并校验 Collator Candidate。
2. 支持 `PRE_WRITE` 写入前治理。
3. 支持用户直写后的 `POST_WRITE` 写入后治理。
4. 验证合同和 schema version。
5. 执行业务分类、实体关系和状态流转规则。
6. 执行业务级幂等。
7. 生成 `PASS / NEEDS_REVIEW / BLOCKED`。
8. 创建和管理业务规则复核任务。
9. 生成业务原因码并记录规则版本与业务审计。
10. 控制下游自动化是否继续。
11. 处理人工确认后的重试。
12. 对绕过 Collator 的人工记录进行周期性对账。

不负责：

1. 下载附件或重复解析 OCR/ASR 原文。
2. 重复处理飞书富文本格式。
3. 禁止用户直接修改飞书。
4. 将所有物理写入强制集中到单一进程。
5. 使用 LLM 替代确定性业务规则。
## 6.4 AI / LLM

负责：

- 从 OCR/ASR 文本中提取结构化候选字段。
- 解释规则错误。
- 生成用户可读修复建议。
- 对候选值提供依据。

不负责：

- 最终分类；
- 最终关联；
- 正式写入；
- 绕过人工复核；
- 保存或输出密钥。

---


## 6.5 双入口治理

### PRE_WRITE

适用于 Collator、OCR、ASR、PDF、外部系统、迁移和批量导入：

```text
Source
→ Collator
→ Candidate
→ SOP PRE_WRITE
→ PASS：Collator 写入飞书
→ NEEDS_REVIEW / BLOCKED：创建复核任务
```

### POST_WRITE

适用于用户直接新增或修改飞书记录：

```text
飞书记录变化
→ 事件订阅或定时扫描
→ SOP POST_WRITE
→ PASS：保留并放行后续自动化
→ NEEDS_REVIEW：标记并创建复核
→ BLOCKED：阻止下游自动化
```

POST_WRITE 不得阻止用户保存、静默回滚人工值或覆盖人工确认字段。

## 6.6 写入来源与循环保护

关键记录必须能识别：

```text
write_origin:
- HUMAN
- COLLATOR
- FEISHU_AUTOMATION
- MIGRATION
- SYSTEM_REPAIR
```

建议字段：

- `write_origin`
- `correlation_id`
- `source_record_id`
- `ingestion_id`
- `record_version`
- `content_hash`
- `extractor_version`
- `rule_version`

Collator 自身写入再次触发事件时，必须通过 `write_origin`、`correlation_id`、`content_hash` 和已处理版本识别并返回：

- `SELF_TRIGGER_SKIPPED`
- `NO_CONTENT_CHANGE`
- `DUPLICATE_SKIPPED`

## 6.7 分层幂等

### Collator 摄入级幂等

推荐组成：

```text
source_record_id
+ attachment_hash / content_hash
+ extractor_version
```

解决同一附件、同一记录和同一内容的重复摄入或重复 OCR/ASR。

### SOP 业务级幂等

推荐组成：

```text
candidate_id
+ entity_type
+ business_identity
+ rule_version
```

解决正式实体、复核任务和人工确认重试的业务重复。

## 6.8 字段权威等级

关键字段应区分：

```text
RAW
CANDIDATE
CONFIRMED
AUTHORITATIVE
```

默认优先级：

```text
人工确认值
> 已存在权威业务值
> 确定性规则推导值
> 高置信 AI 候选
> 中低置信 AI 候选
```

AI 候选不得覆盖 `CONFIRMED`；Collator 不得静默覆盖人工修改；关键冲突必须进入复核。


# 7. OCR、PDF 与 ASR 总则

## 7.1 嵌入原则

OCR、PDF 和 ASR 均属于 Collator 的 Source Adapter。

飞书自动化只负责：

1. 发现新附件或记录变化。
2. 传递必要的来源引用。
3. 更新触发或处理状态。

飞书自动化不得包含：

- OCR 文本解析；
- 字段提取 Prompt；
- 客片/样片业务判断；
- 正式表写入分支；
- 多层重试与状态机。

## 7.2 OCR 第一阶段

支持：

- 图片附件；
- 客户需求截图；
- 活动通知或海报；
- 单页 PDF 渲染后的图片；
- 匿名演示附件。

第一阶段候选字段：

- 客户名称；
- 拍摄日期；
- 地点；
- 项目类型；
- 预算；
- 风格要求；
- 交付要求；
- 联系方式。

任何字段候选必须保留：

- 候选值；
- 原始文本片段；
- 来源页码或区域；
- 置信状态；
- 提取器类型；
- 提取器版本；
- 是否需要人工复核。

## 7.3 PDF 第一阶段

基础 OCR 不直接等同于 PDF 解析。

第一阶段规则：

- 单页 PDF：Collator 渲染为图片后 OCR。
- 多页 PDF：仅在明确页数上限内逐页处理。
- 必须保留页码。
- 复杂表格、合同条款和版面还原不在第一阶段范围。

不得在官网中表述为：

“系统已原生支持任意 PDF 智能解析。”

## 7.4 ASR 第一阶段

第一阶段约束：

- 音频不超过 60 秒；
- 中文普通话优先；
- 单一主要说话人；
- 只生成候选字段；
- 默认人工确认；
- 不承诺说话人分离；
- 不直接覆盖正式字段。

长音频后续路线：

- 音频切片；
- 流式识别；
- 飞书妙记文字记录；
- 独立长音频处理任务。

长音频路线不阻塞第一阶段。

---

# 8. 跨仓库数据合同

## 8.1 Candidate Contract

Collator 必须输出来源无关的 Candidate。

SOP 不应关心数据来自：

- 人工表格；
- 图片 OCR；
- PDF OCR；
- 音频 ASR；
- 妙记文字记录。

## 8.2 Candidate 必填信息

至少包含：

```json
{
  "schema_version": "1.0",
  "candidate_id": "cand_xxx",
  "ingestion_id": "ing_xxx",
  "source": {
    "system": "feishu_bitable",
    "table_ref": "logical:project_leads",
    "record_id": "rec_xxx",
    "attachment_id": "optional",
    "source_type": "BITABLE|IMAGE_OCR|PDF_OCR|AUDIO_ASR|MINUTES_TRANSCRIPT"
  },
  "entity_type": "project",
  "raw_evidence": {
    "raw_text": "原始文本",
    "segments": [],
    "content_hash": "sha256_xxx"
  },
  "normalized_fields": {},
  "quality": {
    "status": "PASS|NEEDS_REVIEW|BLOCKED",
    "issues": []
  },
  "processing": {
    "extractor_version": "v1",
    "attempt": 1,
    "created_at": "ISO-8601"
  },
  "idempotency_key": "sha256_xxx"
}
```

## 8.3 Candidate 不变量

1. `schema_version` 必填。
2. `source.record_id` 必填。
3. 附件来源必须具备附件级引用。
4. 原始证据必须可回溯。
5. 候选字段不能只保存最终值。
6. 关键字段必须有来源文本或可解释依据。
7. 幂等键在同一来源和版本下稳定。
8. Secret、Token、App Secret 不得进入合同。
9. 真实 Base 标识不得进入公开示例。
10. SOP 对未知合同版本必须 fail closed。

## 8.4 SOP 治理结果

至少包含：

```json
{
  "schema_version": "1.0",
  "candidate_id": "cand_xxx",
  "decision": "PASS|NEEDS_REVIEW|BLOCKED",
  "classification": "CLIENT_PROJECT|CREATIVE_PROJECT|UNKNOWN",
  "rule_version": "project-rules-v1",
  "violations": [],
  "write": {
    "status": "NOT_ATTEMPTED|SUCCEEDED|FAILED|DUPLICATE_SKIPPED",
    "target_table": "logical:projects",
    "target_record_id": "optional"
  },
  "review": {
    "required": true,
    "review_task_id": "optional"
  },
  "audit": {
    "processed_at": "ISO-8601",
    "idempotency_key": "sha256_xxx"
  }
}
```

---

# 9. 角色总则

## 9.1 用户

用户是：

- 产品最终决策者；
- 业务规则权威来源；
- 权限和真实飞书资源的所有者；
- 范围取舍的最终批准者；
- 公开展示内容的最终确认者。

用户负责：

1. 确认业务规则。
2. 进行必须由账户所有者完成的权限操作。
3. 决定是否公开某项真实能力。
4. 对重大范围变化作出最终决策。
5. 提供必要但最小化的真实环境证据。

用户不需要：

- 为每个任务上传整个仓库；
- 手动整理所有测试日志；
- 重复回答已确认的业务规则；
- 将 Secret 粘贴到完成包或公开文档。

---

# 10. GPT 角色章程

## 10.1 GPT 的定位

GPT 是：

- 项目规划者；
- 任务拆解者；
- 范围控制者；
- 产品架构审查者；
- 故障分析者；
- 证据审查者；
- 官网和简历口径控制者；
- Codex 使用审批者。

## 10.2 GPT 负责

1. 将用户目标转换为明确任务。
2. 定义 In Scope 和 Out of Scope。
3. 编写可验证 Acceptance Criteria。
4. 设计正常、边界、异常和回归测试。
5. 分析 Trae 提供的仓库上下文、Diff、日志和测试结果。
6. 输出供 Trae 执行的精确任务卡。
7. 审查 Trae 或 Codex 提供的完成包。
8. 判断是否真正需要 Codex。
9. 检查任务是否发生范围扩张。
10. 维护产品定义与求职展示口径一致。
11. 区分证据审查和独立仓库验证。
12. 更新项目总章程中的决策和状态。
13. 在新对话框中恢复项目上下文。
14. 优先减少非必要审计和 Codex 使用。

## 10.3 GPT 不得声称

GPT 不得声称：

1. 已读取未提供的本地仓库。
2. 已检查未上传的文件。
3. 已运行本地测试。
4. 已直接修改或提交仓库。
5. 已独立验证 Trae 本地工作区。
6. 已确认真实飞书环境状态，除非用户或 Trae 提供证据。
7. 已确认线上部署成功，除非有可核验结果。

## 10.4 GPT 输出类型

### 新任务

优先输出快速任务卡：

```text
Project ID:
Task ID:
Risk Level:
Recommended Owner:
Recommended Route:

Objective:

In Scope:

Out of Scope:

Acceptance Criteria:

Repository Assumptions To Verify:

Implementation Guidance:

Test Matrix:

Trae Execution Steps:

Codex Escalation Conditions:

Stop Conditions:

Status: READY_FOR_TRAE_EXECUTION
```

### 完成包审查

优先输出：

```text
Verdict:

Acceptance Criteria Review:

Diff Risks:

Test Coverage Review:

Missing Evidence:

Required Fixes:

Codex Necessity:

Next Owner:
```

裁决值：

- `EVIDENCE_REVIEW_PASS`
- `FIX_REQUIRED`
- `CODEX_REQUIRED`
- `BLOCKED_USER_DECISION`

`EVIDENCE_REVIEW_PASS` 只代表基于提交证据通过，不代表独立运行仓库。

---

# 11. Trae 角色章程

## 11.1 Trae 的定位

Trae 是：

- 本地仓库执行者；
- 实现者；
- 测试运行者；
- Diff 和日志收集者；
- 完成包生产者；
- Git 操作者；
- 真实环境验证执行者。

## 11.2 Trae 负责

1. 在任务开始前读取权威项目文件。
2. 核对分支、HEAD 和工作区状态。
3. 核对 GPT 标记的 `ASSUMPTION_TO_VERIFY`。
4. 按任务卡执行最小范围修改。
5. 不擅自扩大范围。
6. 运行任务卡要求的测试。
7. 收集真实命令、exit code、日志和 Diff。
8. 保护 Secret、Token、PII 和真实资源标识。
9. 输出任务级完成包。
10. 说明未完成项、债务和阻塞。
11. 在允许时提交和 push。
12. 同步更新权威状态文件。
13. 遇到 Stop Condition 时停止并上报。
14. 不用“应该通过”代替真实运行结果。

## 11.3 Trae 执行前必须核对

1. 当前仓库路径。
2. 当前分支。
3. 当前 HEAD。
4. `git status --short`。
5. 是否存在非本任务预存变更。
6. 权威状态文件。
7. 当前任务是否与其他任务冲突。
8. 是否涉及真实环境权限或凭据。
9. 是否需要用户操作。
10. 是否触发 Codex 升级条件。

## 11.4 Trae 不得

1. 擅自修改权威业务规则。
2. 将 OCR、ASR 或业务规则散落到飞书自动化。
3. 让 LLM 直接写正式数据。
4. 为通过测试降低业务门槛。
5. 混入其他任务未提交变更。
6. 将 Secret 写入命令、日志、完成包或 Git。
7. 将真实客户附件提交公开仓库。
8. 用 mock 结果冒充真实飞书 Gate。
9. 在没有证据时宣称生产可用。
10. 未经用户或任务卡许可 force push。

---

# 12. Codex 角色章程

## 12.1 默认状态

`NOT_REQUIRED_BY_DEFAULT`

## 12.2 可以升级 Codex 的条件

仅在以下情况使用 Codex：

1. 安全、鉴权、权限、Token、Secret 或 PII。
2. 并发、事务、幂等、状态机、重试或回滚。
3. 数据迁移或破坏兼容性。
4. 跨核心模块复杂重构。
5. Trae 连续两轮无法解决。
6. 必须通过完整仓库搜索、运行或调试才能判断。
7. 测试通过但核心业务不变量仍有重大疑点。
8. 高风险任务合并前需要独立仓库验证。
9. 跨仓库合同存在无法通过局部上下文确认的冲突。
10. 写入存在部分成功或不可逆风险。

## 12.3 不应使用 Codex 的情况

1. 普通文档更新。
2. 小范围字段适配。
3. 常规单元测试补充。
4. 官网文案和架构图。
5. 已有明确修复点的简单 bug。
6. OCR/ASR 普通 Adapter 实现。
7. 仅需 Trae 运行命令收集证据。
8. 非阻塞性审计润色。

---

# 13. 默认协作路由

## R0：Trae 直接执行

适用：

- 低风险文档更新；
- 状态同步；
- 明确的小型配置调整；
- 不影响核心业务规则的任务。

## R1：GPT 规划，Trae 执行

适用：

- 常规功能；
- 单仓库小范围修改；
- 风险可控；
- 无需额外证据审查。

## R2：GPT 规划，Trae 执行，GPT 证据审查

适用：

- 跨模块功能；
- 真实飞书 Gate；
- 官网公开能力；
- 业务规则修改；
- OCR/ASR 集成；
- 幂等和写入链路；
- 默认主要路线。

## R3：GPT 规划，Trae 执行，GPT 审查，Codex 必要时介入

适用：

- 高风险；
- Trae 连续失败；
- 安全或状态机问题；
- 需要独立仓库验证。

---

# 14. 项目执行顺序

## Phase 0：章程入库

目标：

- 将本章程作为项目级 SSOT。
- 明确唯一权威路径。
- 其他仓库仅保留引用或同步副本。

状态：

`DONE`

## Phase 1：跨仓库合同冻结 — ADOPTED

目标：

- Candidate V1。
- Governance Result V1。
- 统一状态枚举。
- 统一错误码。
- 两仓库合同测试。

状态：

`ADOPTED`（合同已冻结，Adoption Gate 已关闭，GPT EVIDENCE_REVIEW_PASS）

## Phase 2：交互与截图纵向切片（INTERACTION_AND_SCREENSHOT_VERTICAL_SLICE）— IN_PROGRESS

v1.2 将 v1.1 的 Phase 2（Project 结构化纵向切片）与 Phase 3（图片 OCR 最小切片）合并为统一纵向闭环，采用"2 主线 + 1 辅线"并行执行：

### 主线 A：客户聊天截图核心纵向闭环

Task ID: `FAMP-CHAT-SCREENSHOT-VERTICAL-SLICE-01`

必须实现：
- 1～10 张匿名截图输入，按稳定顺序处理多图
- OCR 原文和字段级证据
- Candidate 生成，人工修正值标记为 CONFIRMED
- SOP PRE_WRITE 治理
- 合法客片 + Customer / 合法样片 + Model（Customer 为空合法）/ 类型缺失进入 NEEDS_REVIEW
- Customer / Project 最小创建和关联
- Review Task 创建或复用 + Audit Log
- 返回受控飞书记录引用
- 重复上传和重复确认幂等
- Provider 失败 fail closed 或转人工

详见第 29B 节任务卡。

### 主线 B：智能录入台 MVP

Task ID: `FAMP-SMART-INTAKE-PORTAL-MVP-01`

只拥有 Portal 页面、前端状态、API Client 和契约 Mock，不得修改 Collator 核心逻辑、SOP 业务规则或核心合同权威定义。

### 辅线 C：机器人与主动通知

Task ID: `FAMP-FEISHU-BOT-AUTOMATION-MVP-01`

只做只读调查和协议产物，核心 API 未冻结前不得改核心业务代码。只拥有机器人 Adapter、消息卡片、通知和回调协议。

状态：

`IN_PROGRESS`（v1.2 章程采用后立即启动 A 和 B）

## Phase 3：短音频 ASR 最小切片 — DEFERRED

v1.2 将短音频 ASR 降级为 DEFERRED，不阻塞 PORTFOLIO_READY 目标。仅在主线 A/B 闭环完成且有余力时考虑。

## Phase 4：官网、简历和演示发布

开始条件：集成 Gate 通过，或机器人真实 Gate 被明确标记为外部权限阻塞但 Portal 核心闭环通过。

目标：
- 五层架构图 / 产品模块图
- 智能录入台截图 / 候选和证据对照截图
- 飞书记录和审计截图 / 机器人卡片截图
- 正常、复核、重复提交三条流程
- 中文项目描述 / 英文项目描述 / 两分钟演示脚本
- 技术栈和产品取舍 / 测试与真实集成证据摘要
- 明确 `PORTFOLIO_READY` 不等于 `PRODUCTION_READY`

状态：

`PLANNED`

## Phase 5：长期增强

状态：

`DEFERRED`

包含：

- 多页 PDF；
- 长音频；
- 妙记；
- 通用工作流；
- 运行看板；
- 权限分层；
- 生产 SLA；
- 多租户。

---

# 15. 当前任务优先级（v1.2）

## 立即执行

1. Task 0：章程 v1.2 采用（R0 / LOW，完成后不单独等待审查）。
2. 主线 A + 主线 B 同时启动。
3. 辅线 C：有空闲窗口做调查、卡片协议和通知去重；无窗口则等待 A0。

## A 发布 API 契约后

B/C 只允许适配 API Client，不得要求 A 修改业务语义迎合界面。

## 三线完成后

只进行一次统一证据审查。

## 集成 Gate 通过后

立即发布官网，不等待 P1 查询、ASR、PDF 或生产级基础设施。

## Deferred

1. 长音频。
2. 妙记。
3. 多页复杂 PDF。
4. 通用 SaaS。
5. 新后台 UI。
6. 短音频 ASR（v1.2 降级）。
7. 登录权限中心 / 通用后台 / 表单搭建器 / Dify / PDF / 业务查询 / 全量历史任务管理（Portal 第一阶段不实现）。

---

# 16. Acceptance Criteria 总则

每个任务的 Acceptance Criteria 必须：

1. 可验证。
2. 可通过命令、日志、Diff、截图或真实环境结果证明。
3. 不使用“基本完成”“大致正确”等模糊表述。
4. 区分代码测试与真实集成测试。
5. 明确正常、边界、异常和回归行为。
6. 明确安全和脱敏要求。
7. 明确幂等行为。
8. 明确失败时系统状态。
9. 明确是否需要 commit 和 push。
10. 明确公开展示口径。

---

# 17. 测试总则

## 17.1 正常测试

至少包括：

- 合法结构化记录；
- 合法客片；
- 合法样片；
- 清晰 OCR；
- 清晰短音频；
- 正常写入；
- 正常人工确认。

## 17.2 边界测试

至少包括：

- 空 optional field；
- 60 秒边界音频；
- 空白图片；
- 单页 PDF；
- 重复附件；
- 富文本数组；
- 空值；
- 模糊日期；
- 多候选字段。

## 17.3 异常测试

至少包括：

- 附件下载失败；
- OCR 权限不足；
- ASR 权限不足；
- 外部 API 超时；
- 未知 schema version；
- 写入失败；
- 复核任务创建失败；
- 不支持格式；
- 非法实体类型；
- Secret 扫描失败。

## 17.4 回归测试

必须确保：

- 原有飞书富文本兼容不退化；
- 客片/样片规则不退化；
- 原有分类器和投影测试不退化；
- 现有幂等行为不退化；
- OCR/ASR 失败不影响结构化主链路；
- AI 失败不改变 SOP 决策。

---

# 18. 证据标准

## 18.1 证据等级

### E0：陈述

只有执行者描述，没有命令或结果。

不能作为通过依据。

### E1：静态证据

包括：

- 代码 Diff；
- 配置文件；
- 测试文件；
- 文档。

可以证明实现存在，但不能证明真实运行成功。

### E2：本地运行证据

包括：

- 命令；
- exit code；
- 测试汇总；
- 日志；
- 容器结果。

可以证明执行环境中的运行结果。

### E3：真实集成证据

包括：

- 飞书真实 API；
- 真实 Base 记录；
- 真实附件；
- 真实写入和清理；
- 真实幂等复验。

公开时必须匿名化。

### E4：独立仓库验证

由 Codex 或其他独立执行者在完整仓库环境中复核。

只在高风险任务需要。

## 18.2 完成包最低内容

Trae 完成包至少包含：

1. Project ID。
2. Task ID。
3. Branch。
4. Base Commit。
5. Result Commit。
6. Git Status。
7. Changed Files。
8. Acceptance Criteria 逐条结果。
9. 测试命令。
10. Exit Code。
11. 测试汇总。
12. 真实环境结果。
13. 幂等结果。
14. 脱敏扫描结果。
15. 未完成项。
16. 已知债务。
17. Stop Condition。
18. 推荐下一角色。
19. 是否已 commit。
20. 是否已 push。

---

# 19. 状态与裁决

## 19.1 任务状态

- `READY_FOR_TRAE_EXECUTION`
- `IN_PROGRESS`
- `BLOCKED_USER_ACTION`
- `BLOCKED_EXTERNAL`
- `AWAITING_GPT_EVIDENCE_REVIEW`
- `FIX_REQUIRED`
- `EVIDENCE_REVIEW_PASS`
- `CODEX_REQUIRED`
- `CLOSED`

## 19.2 产品状态

- `PLANNED`
- `CORE_COMPONENT_READY`
- `INTEGRATION_PENDING`
- `VERTICAL_SLICE_READY`
- `DEMO_READY`
- `PORTFOLIO_READY`
- `PRODUCTION_READY`

不得跳过中间证据直接将项目标记为 `PRODUCTION_READY`。

---

# 20. Stop Conditions

Trae 遇到以下情况必须停止并上报：

1. 需要用户将 Secret 明文写入聊天或完成包。
2. 当前工作区存在大量未知变更。
3. 任务需要修改权威业务规则。
4. Candidate 合同需要破坏现有公开接口。
5. 重复执行产生重复正式记录。
6. 写入出现部分成功。
7. OCR/ASR 结果绕过 SOP。
8. 真实客户附件无法匿名化。
9. 需要 force push。
10. 当前任务与另一任务修改同一核心文件。
11. 飞书权限不足。
12. 真实环境与本地 mock 行为冲突。
13. 测试通过但业务不变量失败。
14. 需要引入高风险系统依赖但无部署方案。
15. 范围从最小切片扩张为平台重构。

GPT 遇到以下情况必须停止裁决为通过：

1. 缺少关键测试命令。
2. 缺少 exit code。
3. 缺少真实 Gate 证据。
4. Diff 与任务范围不一致。
5. 完成包表述与证据冲突。
6. 业务规则被降低。
7. 安全扫描缺失。
8. 幂等未验证。
9. 公开展示存在虚假完成陈述。
10. Trae 无法区分本任务和预存变更。

---

# 21. 范围控制规则

## 21.1 允许的任务内修复

- 完成 Acceptance Criteria 所必需的最小修复。
- 增加相关测试。
- 更新必要文档。
- 修复直接阻塞的兼容问题。
- 修复本任务引入的回归。

## 21.2 需要新任务卡的事项

- 新实体。
- 新数据库。
- 新消息队列。
- 新后台 UI。
- 仓库合并。
- 长音频。
- 妙记。
- 多租户。
- 通用化规则引擎。
- 大规模重构。
- 破坏兼容性修改。

## 21.3 范围扩张判断

出现以下任一情况，视为范围扩张：

- 修改超过两个核心模块；
- 引入新的基础设施；
- 修改公共合同；
- 增加未在任务卡中的业务实体；
- 修改权威业务规则；
- 为“以后可能需要”增加复杂抽象；
- 为展示任务提前实现生产全量能力。

---

# 22. 安全与隐私

## 22.1 禁止进入公开仓库

- 真实客户姓名；
- 手机号；
- 微信号；
- 真实聊天截图；
- 真实录音；
- Base Token；
- App ID 的敏感组合；
- App Secret；
- User Token；
- Record ID；
- Table ID；
- 生产 API Key；
- 真实业务预算和私密沟通。

## 22.2 公开演示要求

只允许：

- 匿名合成数据；
- 匿名图片；
- 匿名音频；
- 脱敏日志；
- 逻辑表名；
- 环境变量引用；
- 不可反推真实资源的截图。

## 22.3 日志要求

日志不得默认输出：

- 完整 OCR 原文；
- 完整 ASR 原文；
- 完整附件 URL；
- Token；
- Secret；
- 真实客户信息。

日志应优先输出：

- hash；
- task ID；
- error code；
- 脱敏 record reference；
- 状态；
- 耗时；
- 重试次数。

---

# 23. 官网与简历口径

## 23.1 统一项目标题

**飞书智能业务数据中台｜产品负责人 / AI Agent 产品经理**

## 23.2 对外核心表达

可表达：

- 将飞书作为业务操作界面。
- Collator 统一摄入结构化记录、图片和短音频。
- SOP 执行确定性分类、关联校验、幂等和写入。
- AI 只提供字段候选和异常解释。
- 异常通过人工复核闭环。
- 系统保留原始证据、规则版本和审计日志。
- 已完成真实飞书集成和幂等验证的能力。

不得表达：

- 完全自动识别所有附件。
- 任意 PDF 原生解析。
- 长音频生产级支持。
- AI 自动决定全部业务字段。
- 已生产部署，除非有真实证据。
- OCR/ASR 已完成，除非真实 Gate 通过。

## 23.3 官网展示结构

1. 业务问题。
2. 产品方案。
3. 系统架构。
4. 关键业务规则。
5. 正常与异常流程。
6. OCR/ASR 输入路线。
7. 人工复核。
8. 幂等。
9. 测试和真实集成证据。
10. 产品决策与取舍。

---

# 24. 项目控制文件建议

建议在权威仓库创建：

```text
docs/project_control/
├── PROJECT_CHARTER.md
├── STATUS.yaml
├── CURRENT_STATE.md
├── DECISIONS.md
├── ROADMAP.md
├── TASK_QUEUE.md
├── EVIDENCE_INDEX.md
├── RISKS.md
└── SESSION_HANDOFF.md
```

权威顺序：

1. `PROJECT_CHARTER.md`
2. `STATUS.yaml`
3. `CURRENT_STATE.md`
4. `DECISIONS.md`
5. 当前任务卡
6. 完成包
7. 历史文档

历史 ZIP、旧完成包和早期讨论不得覆盖当前控制文件。

---

# 25. 项目启动与恢复规则

## 25.1 GPT 新对话框启动

复制以下内容：

```text
项目：飞书智能业务数据中台
Project ID：FEISHU-AI-MIDDLE-PLATFORM
权威章程：docs/project_control/PROJECT_CHARTER.md
核心仓库：collator + feishu-v2/SOP
展示仓库：jaelchen-portfolio

核心定义：
- 飞书是权威业务数据库、日常操作界面与人工协作空间。
- Collator 是主要但非唯一的智能写入入口，并负责摄入、OCR、ASR、清洗和数据质量治理。
- SOP 是支持 PRE_WRITE 与 POST_WRITE 的业务治理和自动化执行引擎，不是唯一物理写入通道。
- AI 不拥有最终写入权。

权威规则：
1. 客片必须关联 Customer。
2. 创作/样片必须关联 Model，Customer 为空合法。
3. 项目类型为空进入 NEEDS_REVIEW，不得猜测。

当前路线：
章程入库
→ Candidate V1
→ Project 结构化纵向切片
→ OCR
→ 短音频 ASR
→ 官网和简历发布

执行原则：
- 默认 GPT 规划、Trae 执行、GPT 证据审查。
- 非高风险不调用 Codex。
- 不合并仓库。
- 不扩大为通用 SaaS。
- 不让 LLM 直接写正式数据。
- 不公开真实附件、客户信息或飞书资源标识。
```

## 25.2 Trae 新对话框启动

```text
请先读取：
1. docs/project_control/PROJECT_CHARTER.md
2. docs/project_control/STATUS.yaml
3. docs/project_control/CURRENT_STATE.md
4. docs/project_control/TASK_QUEUE.md
5. 当前任务卡

执行前报告：
- 仓库路径
- 当前分支
- HEAD
- git status --short
- 权威状态
- ASSUMPTION_TO_VERIFY 核对结果
- 是否存在预存变更
- 是否触发 Stop Condition

未经任务卡许可：
- 不扩大范围
- 不修改权威业务规则
- 不调用 Codex
- 不 force push
- 不将 OCR/ASR 结果直接写入正式表
- 不提交真实资源标识或客户数据
```

---

# 26. 当前首批任务

## Task 1：章程入库

Project ID: `FEISHU-AI-MIDDLE-PLATFORM`  
Task ID: `FAMP-PROJECT-CHARTER-01`  
Risk Level: LOW  
Recommended Owner: Trae  
Recommended Route: R1

Objective:

将本章程作为项目最高权威文档写入权威仓库，并建立另一仓库的引用。

In Scope:

- 创建 `docs/project_control/PROJECT_CHARTER.md`。
- 记录权威仓库。
- 在另一仓库增加指向权威文件的引用。
- 更新 `CURRENT_STATE.md`。
- 更新 `STATUS.yaml`。
- 记录两仓库分支、HEAD 和工作区。

Out of Scope:

- 修改生产代码。
- 修改业务规则。
- 开发 OCR 或 ASR。
- 合并仓库。

Acceptance Criteria:

- AC-01：存在唯一权威章程。
- AC-02：另一仓库不维护冲突版本。
- AC-03：控制文件引用章程。
- AC-04：记录当前 HEAD 和工作区。
- AC-05：无生产代码变更。
- AC-06：无 Secret 和真实资源标识。
- AC-07：提交和 push 状态明确。

Status: `READY_FOR_TRAE_EXECUTION`

## Task 2：集成合同

Project ID: `FEISHU-AI-MIDDLE-PLATFORM`  
Task ID: `FAMP-INTEGRATION-CONTRACT-01`  
Risk Level: MEDIUM  
Recommended Owner: Trae  
Recommended Route: R2

Objective:

冻结 Collator → SOP Candidate V1 与 SOP → 飞书 Governance Result V1。

Acceptance Criteria:

- AC-01：合同版本化。
- AC-02：Collator 能输出合法 Project Candidate。
- AC-03：SOP 能接受合法 Candidate。
- AC-04：未知版本 fail closed。
- AC-05：原始证据可回溯。
- AC-06：幂等键稳定。
- AC-07：两仓库均有合同测试。
- AC-08：不改变权威业务规则。
- AC-09：公开示例不含真实资源标识。
- AC-10：迁移入口和持续入口使用同一合同。

Status: `BLOCKED_BY_FAMP-PROJECT-CHARTER-01`

---

# 27. Decision Log

## D-001：统一产品

Collator 与 SOP 共同构成“飞书智能业务数据中台”。

## D-002：不合并仓库

当前通过版本化合同集成，不进行仓库合并。

## D-003：OCR/ASR 进入 Collator

非结构化输入逻辑不得散落在飞书自动化。

## D-004：SOP 是持续治理引擎

SOP 不再仅定义为一次性迁移脚本。

## D-005：AI 不拥有最终写入权

AI 只生成候选与解释。

## D-006：结构化纵向切片优先

在 OCR 和 ASR 前，先完成结构化 Project 闭环。

## D-007：图片 OCR 先于短音频 ASR

OCR 更适合当前工作室业务场景，也更容易形成官网演示。

## D-008：长音频延后

长音频、流式识别和妙记均不阻塞第一阶段。

## D-009：展示优先于生产全量

当前以 `PORTFOLIO_READY` 为优先目标。

## D-010：减少非必要审计

只审查会影响业务不变量、真实演示、公开可信度和安全的证据。

---

# 28. Open Assumptions To Verify

以下事实由 Trae 在执行前核对：

1. 哪个仓库作为章程权威仓库。
2. Collator 当前 API 入口。
3. SOP 当前持续运行入口。
4. Candidate 是否已有可复用结构。
5. 待复核表是否已存在。
6. 当前飞书应用是否具备附件下载权限。
7. OCR 权限是否已生效。
8. ASR 权限是否已生效。
9. 当前 OCR/ASR 限制和格式。
10. 单页 PDF 的渲染依赖。
11. 当前两个仓库是否存在未提交工作区。
12. 公开演示数据是否已经匿名化。
13. 官网展示分支和发布流程。
14. 当前 Dify / LLM 接入是否可用。
15. 当前合同测试适合放在独立 schema、共享 package 还是双仓库生成文件。

以上均为：

`ASSUMPTION_TO_VERIFY`

不要求用户提前提供整个仓库。

---

# 29. 最终执行原则

本项目所有参与者必须遵守：

1. 先明确产品闭环，再写代码。
2. 先冻结合同，再跨仓库集成。
3. 先完成结构化纵向切片，再开发 OCR/ASR。
4. 先证明幂等和异常闭环，再公开展示。
5. 先使用确定性规则，再使用 AI 辅助。
6. 先使用匿名证据，再发布官网。
7. 先最小交付，再考虑平台化。
8. 默认 Trae 执行，GPT 规划与审查。
9. Codex 仅用于高风险或连续失败。
10. 所有“完成”必须有证据。
11. 所有公开能力必须与真实状态一致。
12. 所有新对话框必须从本章程恢复上下文。

---


# 29A. v1.1 首批任务（已完成，由 v1.2 第 29B 节取代）

> 以下任务均已完成并关闭。保留作为历史记录。

## Task 1：章程 v1.1 入库 — DONE

- Task ID: `FAMP-PROJECT-CHARTER-V1.1-01`
- Status: `DONE`

## Task 2：双入口架构只读调查 — DONE

- Task ID: `FAMP-DUAL-WRITE-BOUNDARY-AUDIT-01`
- Status: `DONE`

## Task 3：合同采用门禁（Adoption Gate）— CLOSED

- Task ID: `FAMP-CONTRACT-ADOPTION-GATE-01`
- Status: `CLOSED`（GPT EVIDENCE_REVIEW_PASS，AC-10 关闭）

---

# 29B. v1.2 任务批次

## Task 0：章程 v1.2 采用

Project ID: `FEISHU-AI-MIDDLE-PLATFORM`
Task ID: `FAMP-CHARTER-V1.2-ADOPTION-01`
Risk Level: LOW
Recommended Owner: Trae 主窗口
Recommended Route: R0

Objective: 将 v1.2 正式写入项目控制体系，并冻结三条执行线的仓库和文件边界。

In Scope:
- 将 v1.2 写入权威 PROJECT_CHARTER.md
- 更新 STATUS.yaml / CURRENT_STATE.md / DECISIONS.md / ROADMAP.md / TASK_QUEUE.md / SESSION_HANDOFF.md
- 标记 Phase 0 已完成、Phase 1 已采用
- 标记 A/B 为立即执行，C 为辅助并行
- 记录 Dify 非必需、Portal/Bot 不得复制规则
- 核对三个仓库路径、分支、HEAD 和 git status
- 输出三条执行线的文件所有权矩阵

Out of Scope: 任何生产代码修改、合同升级、业务规则修改、大规模历史文档清理。

Acceptance Criteria:
- AC-0-01：PROJECT_CHARTER.md 内容为 v1.2。
- AC-0-02：STATUS.yaml 的 current_phase 为 INTERACTION_AND_SCREENSHOT_VERTICAL_SLICE。
- AC-0-03：TASK_QUEUE.md 包含 A/B/C 和最终集成 Gate。
- AC-0-04：三个仓库路径、HEAD、工作区状态已记录。
- AC-0-05：A/B/C 文件边界不存在已知冲突。
- AC-0-06：没有生产代码变更。
- AC-0-07：状态文件之间不存在版本、阶段或 next owner 冲突。

Status: `READY_FOR_TRAE_EXECUTION`（完成后立即启动 A 和 B，不等待 GPT 单独审查 Task 0；Task 0 证据合并到后续总完成包）

## 主线 A：客户聊天截图核心纵向闭环

Project ID: `FEISHU-AI-MIDDLE-PLATFORM`
Task ID: `FAMP-CHAT-SCREENSHOT-VERTICAL-SLICE-01`
Risk Level: MEDIUM-HIGH
Recommended Owner: Trae 主窗口 A
Recommended Route: R2

Owned Scope:
- collator 核心摄入、文件处理、OCR Adapter、Candidate 和确认入口
- SOP PRE_WRITE、Customer/Project/Model 关系治理
- Review Task、Audit Log、正式写入和业务幂等
- 对外受控 API 契约

Phase A0（只读调查和接口冻结）：开始修改前输出当前文件上传入口、Intake/Tool API、OCR Adapter 落点、Candidate 持久化和确认入口、SOP 持续运行入口、Customer/Project/Model 写入器、Review Task 和 Audit Log 是否存在、跨实体写入部分成功风险、当前幂等层级、推荐最小实现文件清单、提供给 B/C 的 API 契约和示例响应。

API 最少包含：1.创建截图提交 2.查询处理状态 3.获取 OCR 证据和 Candidate 4.提交人工修正 5.确认写入 6.转人工复核 7.获取最终治理和写入结果。优先复用 Candidate V1、Governance Result V1 和 Interaction Envelope，不得为 Portal 单独创建第二套业务合同。

Phase A1（实现最小闭环）必须实现：1～10 张匿名截图输入、按稳定顺序处理多图、OCR 原文和字段级证据、Candidate 生成、人工修正值标记 CONFIRMED、SOP PRE_WRITE、合法客片+Customer、合法样片+Model（Customer 为空合法）、类型缺失进入 NEEDS_REVIEW、Customer/Project 最小创建和关联、Review Task 创建或复用、Audit Log、返回受控飞书记录引用、重复上传和重复确认幂等、Provider 失败 fail closed 或转人工。

关键 Acceptance Criteria:
- AC-A01：支持 1 和 10 张截图边界。
- AC-A02：字段候选可追踪到原文或图片证据。
- AC-A03：人工修改不会被后续 AI 候选覆盖。
- AC-A04：合法客片写入并关联 Customer。
- AC-A05：合法样片写入并关联 Model。
- AC-A06：客片缺 Customer 创建或复用复核任务。
- AC-A07：项目类型缺失不得猜测写入。
- AC-A08：重复上传不创建重复正式记录。
- AC-A09：重复确认不创建重复关系或任务。
- AC-A10：写入失败不会错误报告 SUCCEEDED。
- AC-A11：未知合同版本 fail closed。
- AC-A12：原有合同、富文本、分类和写入测试无回归。

Stop Conditions: 出现不可解释的跨实体部分成功 / 并发重试可能产生重复正式记录 / 需要破坏 Candidate 或 Governance Result 兼容性 / 需要将业务规则放入 Portal 或机器人 / 需要明文 Secret / 当前修改会与 B/C 修改同一核心文件。

Codex Escalation: 仅在事务、补偿、并发幂等、不可逆部分成功或安全权限风险无法通过局部实现关闭时升级。

Status: `BLOCKED_BY_FAMP-CHARTER-V1.2-ADOPTION-01`

## 主线 B：智能录入台 MVP

Project ID: `FEISHU-AI-MIDDLE-PLATFORM`
Task ID: `FAMP-SMART-INTAKE-PORTAL-MVP-01`
Risk Level: MEDIUM
Recommended Owner: Trae 并行窗口 B
Recommended Route: R2

Owned Scope: Portal 页面、前端组件、上传状态、Candidate/证据展示、表单编辑状态、API Client、契约 Mock、匿名演示数据。

不得修改: Collator 核心逻辑、SOP 业务规则、Customer/Project/Model 关系判断、正式飞书写入器、核心合同权威定义。

执行顺序: 调查 jaelchen-portfolio 或现有 Next.js/React 工程 → 隔离应用或路由 → 使用 A0 冻结的 API 契约（A0 未完成前使用本地 Mock）→ UI 完成后仅替换 API Client → 准备匿名公开截图和演示路径。

Acceptance Criteria:
- AC-B01：支持选择、预览、删除、重新排序 1～10 张截图。
- AC-B02：显示上传、OCR、候选、治理、写入阶段。
- AC-B03：候选字段可查看对应证据。
- AC-B04：人工修改字段有明确视觉标记。
- AC-B05：具有确认写入和转人工复核操作。
- AC-B06：显示四类核心结果状态（PASS/NEEDS_REVIEW/BLOCKED/DUPLICATE_SKIPPED）。
- AC-B07：失败后保留用户修改，可重试。
- AC-B08：重复点击在客户端被禁用，服务端仍以幂等为准。
- AC-B09：浏览器中不存在飞书 Secret 或正式写入 Token。
- AC-B10：前端不存在客片/样片关系规则。
- AC-B11：常见手机宽度和桌面宽度可用。
- AC-B12：匿名合成数据可生成官网截图。

Status: `BLOCKED_BY_FAMP-CHARTER-V1.2-ADOPTION-01`

## 辅线 C：机器人与主动通知

Project ID: `FEISHU-AI-MIDDLE-PLATFORM`
Task ID: `FAMP-FEISHU-BOT-AUTOMATION-MVP-01`
Risk Level: MEDIUM-HIGH
Recommended Owner: Trae 并行窗口 C；资源不足时延后
Recommended Route: R2

第一阶段先做只读调查和协议产物，不得等待外部权限后才开始：当前飞书应用机器人能力、事件订阅、消息卡片版本、卡片回调和签名校验、所需权限清单、公网回调落点、Review Task 是否包含通知目标、通知去重键、与 A API 的调用协议、卡片 JSON 模板、回调 Payload fixture、重复投递测试设计、P1 查询和提醒命令草案。

C 的第一可交付切片：NEEDS_REVIEW → 创建或复用 Review Task → 生成通知事件 → 发送候选/复核消息卡片 → 用户确认或转复核 → 调用 A 的受控 API → 返回结果卡片。截图直接发送给机器人可在 A API 稳定后接入，不得在机器人中重复实现 OCR。

Acceptance Criteria:
- AC-C01：权限、事件、回调和部署要求明确。
- AC-C02：卡片展示关键字段、错误原因和证据摘要。
- AC-C03：卡片确认、修改和转复核只调用受控 API。
- AC-C04：相同 action_id 重复回调不重复执行。
- AC-C05：相同 Review Task 状态不重复通知。
- AC-C06：消息发送失败有审计状态和有限重试边界。
- AC-C07：机器人不持有独立业务规则。
- AC-C08：不使用 Dify 时链路仍可运行。
- AC-C09：没有权限时输出 BLOCKED_USER_ACTION 清单，不伪造真实 Gate。
- AC-C10：提供 P1 查询、跟进、拍摄前检查和逾期提醒的受控合同草案。

Stop Conditions: 涉及回调签名、Token 权限、并发重复投递或复杂通知状态机时停止，交 GPT 判断是否升级 Codex。

Status: `BLOCKED_BY_FAMP-CHARTER-V1.2-ADOPTION-01`（资源不足时可延后至 A0 完成后启动）

## 集成 Gate

Project ID: `FEISHU-AI-MIDDLE-PLATFORM`
Task ID: `FAMP-END-TO-END-INTEGRATION-GATE-01`
Owner: Trae 主窗口

开始条件：A 目标 API 和真实核心路径完成 + B 已接真实 API + C 至少完成 NEEDS_REVIEW 消息卡片闭环（或明确记录外部权限阻塞）。

必须验证三条公开演示流程：
1. Flow 1 正常写入：匿名聊天截图 → OCR 和证据 → 人工确认 → SOP PASS → Customer/Project/Model 关系 → 飞书记录引用
2. Flow 2 人工复核：类型缺失或客片缺 Customer → NEEDS_REVIEW → Review Task → 飞书通知卡片 → 人工确认 → 重试成功
3. Flow 3 重复处理：同一截图重复上传或同一按钮重复点击 → DUPLICATE_SKIPPED / NOTIFICATION_ALREADY_SENT → 不产生重复正式记录、关系、任务或通知

Status: `BLOCKED_BY_A_AND_B_COMPLETION`

## 官网发布

Project ID: `FEISHU-AI-MIDDLE-PLATFORM`
Task ID: `FAMP-PORTFOLIO-RELEASE-01`

开始条件：集成 Gate 通过，或机器人真实 Gate 被明确标记为外部权限阻塞但 Portal 核心闭环通过。

交付：五层架构图 / 产品模块图 / 智能录入台截图 / 候选和证据对照截图 / 飞书记录和审计截图 / 机器人卡片截图（没有真实 Gate 时必须标为 Prototype）/ 正常/复核/重复提交三条流程 / 中文项目描述 / 英文项目描述 / 两分钟演示脚本 / 技术栈和产品取舍 / 测试与真实集成证据摘要 / 明确 PORTFOLIO_READY 不等于 PRODUCTION_READY。

Status: `BLOCKED_BY_FAMP-END-TO-END-INTEGRATION-GATE-01`

---

# 30. 当前项目状态（v1.2）

```yaml
project_id: FEISHU-AI-MIDDLE-PLATFORM
project_name: 飞书智能业务数据中台
charter_version: v1.2
authoritative_database: feishu_bitable
collator_role: primary_intelligent_write_entry_but_not_exclusive
direct_feishu_editing_allowed: true
sop_role: governance_and_workflow_engine_not_exclusive_physical_writer
governance_modes:
  - PRE_WRITE
  - POST_WRITE
field_authority_levels:
  - RAW
  - CANDIDATE
  - CONFIRMED
  - AUTHORITATIVE
current_phase: INTERACTION_AND_SCREENSHOT_VERTICAL_SLICE
product_target: PORTFOLIO_READY
default_route: R2
next_owner: Trae
next_task: FAMP-CHAT-SCREENSHOT-VERTICAL-SLICE-01
codex_required: false
dify_required: false
execution_lines:
  - line_A: FAMP-CHAT-SCREENSHOT-VERTICAL-SLICE-01
  - line_B: FAMP-SMART-INTAKE-PORTAL-MVP-01
  - line_C: FAMP-FEISHU-BOT-AUTOMATION-MVP-01
execution_order:
  - charter_v1_2_adoption
  - line_A_phase_A0_investigation
  - line_A_phase_A1_implementation
  - line_B_portal_mvp
  - line_C_bot_investigation
  - end_to_end_integration_gate
  - portfolio_release
status: READY_FOR_TRAE_EXECUTION
```
