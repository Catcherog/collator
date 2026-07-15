# 执行层模块实施计划

## 任务目标
为泽怀影像数据摄入Agent创建执行层模块，位置：`src/data-cleaning/agent/execution/`

## 模块清单

### 1. confirmation-ui.js - 确认界面消息生成
**导出函数**：
- `generateConfirmation(parsedResult)` - 生成确认消息，包含场景、质量评分、带置信度的字段、行动计划
- `generateSuccessReport(result)` - 生成成功报告，包含表格链接、记录数
- `generateErrorReport(error)` - 生成错误报告，包含诊断和修复建议
- `generateBatchPreview(batchResult)` - 生成批量导入预览

**设计要点**：
- 遵循业务规则库中的"输出约束"标准模板
- 使用 emoji 图标增强可读性（✅⚠️❌📊🔗等）
- 消息格式适合终端/聊天界面展示

---

### 2. linkage-engine.js - 跨表联动引擎
**依赖**：`./bitable-writer` (BitableWriter)

**导出函数**：
- `executeLinkages(primaryResult, context)` - 自动执行跨表联动规则

**联动规则**（来自业务规则库约束3）：
1. **创建项目时**：
   - 验证客户存在（客户表 `tblmRVrUnfodlzlo`）
   - 创建双向链接：项目表 `fldJeSf4KT` ↔ 客户表关联字段
2. **分配资源时**：
   - 创建双向链接：项目表 `fldlZu8rKr` ↔ 资源表 `fldJajNEVf`

**返回值**：`{ executed: [...], failed: [...] }`

**核心表ID速查**：
- 客户表：`tblmRVrUnfodlzlo`
- 项目表：`tblGDULWtzvXLvPm`
- 资源表：`tblw4NagUnXw9yEw`
- 成品表：`tbljPr2PuZLFhSaI`
- 素材表：`tblho2dCpIDAonuc`

---

### 3. rollback-manager.js - 回滚管理器
**功能**：管理快照和回滚能力，跟踪创建的记录，支持批量操作回滚

**导出函数**：
- `createSnapshot()` - 创建新快照，返回 snapshotId
- `recordCreation(snapshotId, tableId, recordId)` - 记录创建的记录
- `rollback(snapshotId)` - 回滚指定快照的所有记录（删除已创建记录）

**设计要点**：
- 内存存储（当前会话有效）
- 每个快照记录创建的所有 (tableId, recordId) 对
- rollback 时按逆序删除记录
- 返回回滚结果：成功数、失败数

---

### 4. index.js - 模块入口
**导出内容**：
- 所有执行层模块（confirmation-ui, linkage-engine, rollback-manager）的导出
- 重新导出 `BitableWriter` 和 `createBitableWriter` from './bitable-writer'

---

## 实施约束
- 使用 CommonJS (`require`/`module.exports`)
- 不添加注释（用户明确要求）
- 函数保持实用性，遵循业务规则
- 不修改现有 bitable-writer.js
