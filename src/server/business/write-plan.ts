// write-plan.ts
// FAMP-R3-FIX-R2 / RF-01: 按 project_type 构建显式写入计划。
//
// 修复前 GuardedBatchWriter / TransactionalBatchWriter 在 targetTables 缺省
// 时无条件写入 ['customer','project','model'] 三表，导致客片（client）无条件
// 创建 Model、样片（creative）无条件创建 Customer，违反章程 BR-01/BR-02 的
// 实体关联语义。
//
// 本模块在「进入 Feishu Writer 前」（ScreenshotService.confirmWrite）根据治理
// 完成后的 project_type + customer_ref + model_ref 构建显式写入计划。Gate
// （isRealWriteAllowed）职责仍是 6 条件 fail-closed，不在此层混入业务规划。
//
// 规则（AC-FIX-02）：
//   client    : required = Project + Customer；Model 仅在存在合法 model_ref 时
//   creative  : required = Project + Model；Customer 仅在存在合法 customer_ref 时
//   unknown   : 不生成正写入计划（返回 []，防御性 fail-safe）
//
// governance.classification.project_type 优先于 candidate.normalized_fields.project_type
// （治理后的类型比 OCR 原始推断更权威）。

/**
 * 业务表逻辑名。与 TransactionalBatchWriterInput.targetTables 的元素类型对齐。
 */
export type WriteTable = 'customer' | 'project' | 'model';

/**
 * computeWritePlan 所需的 Candidate 形状（结构化类型，避免耦合完整 CandidateV1）。
 * project_type / customer_ref / model_ref 字段定义见 candidate-v1.ts。
 */
export interface WritePlanCandidate {
  normalized_fields: {
    project_type?: string | null;
    customer_ref?: string | null;
    model_ref?: string | null;
  };
}

/**
 * computeWritePlan 所需的 Governance Result 形状（结构化类型）。
 * classification.project_type 由 SOP 治理后填充，见 screenshot-governance-client.ts。
 */
export interface WritePlanGovernance {
  classification?: {
    project_type?: string | null;
  };
}

/**
 * 判断引用字段是否为「合法非空引用」。
 * null / undefined / 空白字符串均视为无引用（不据此创建可选实体）。
 */
function isValidRef(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 按 project_type 构建显式写入计划（AC-FIX-02）。
 *
 * project_type 解析优先级：governance.classification.project_type >
 * candidate.normalized_fields.project_type > 'unknown'。
 *
 * 返回的表顺序保持 Customer → Project → Model 的既定事务写入顺序（与
 * TransactionalBatchWriter 的有序写入约定一致），便于 inner writer 直接消费。
 *
 * unknown / 无法判定时返回空数组：BR-03 要求 project_type 缺失 → NEEDS_REVIEW，
 * 正常路径下 governance 不会对 unknown 下发 PASS，因此此处不应到达。返回 [] 是
 * 防御性 fail-safe —— 即使异常到达，也不会产生任何业务写入，优于无条件全表写入。
 */
export function computeWritePlan(
  candidate: WritePlanCandidate,
  governance?: WritePlanGovernance | null
): WriteTable[] {
  const fields = candidate?.normalized_fields ?? {};
  const projectType =
    governance?.classification?.project_type ??
    fields.project_type ??
    'unknown';

  if (projectType === 'client') {
    // 客片：必须关联 Customer（BR-01）。Model 仅在存在合法 model_ref 时可选。
    const tables: WriteTable[] = ['customer', 'project'];
    if (isValidRef(fields.model_ref)) {
      tables.push('model');
    }
    return tables;
  }

  if (projectType === 'creative') {
    // 样片：必须关联 Model（BR-02）。Customer 仅在存在合法 customer_ref 时可选。
    // 保持 Customer → Project → Model 既定写入顺序（与 TransactionalBatchWriter
    // 有序写入 + 反向回滚约定一致）。
    const tables: WriteTable[] = [];
    if (isValidRef(fields.customer_ref)) {
      tables.push('customer');
    }
    tables.push('project', 'model');
    return tables;
  }

  // unknown / 任何无法判定的值：不生成正写入计划（fail-safe）。
  return [];
}
