// write-plan.test.ts
// FAMP-R3-FIX-R2 / RF-01: computeWritePlan 回归测试。
//
// 修复前 GuardedBatchWriter 无条件写入 ['customer','project','model']，导致：
//   - 客片（client）无条件创建 Model（违反 BR-01：客片必须关联 Customer，Model 可选）
//   - 样片（creative）无条件创建 Customer（违反 BR-02：样片必须关联 Model，Customer 可选）
//
// 本测试断言 computeWritePlan 按 project_type + ref 字段生成正确的写入计划：
//   - client    : ['customer','project']，有合法 model_ref 时追加 'model'
//   - creative  : ['project','model']，有合法 customer_ref 时前置 'customer'
//   - unknown   : [] （防御性 fail-safe）
//   - governance.classification.project_type 优先于 candidate 字段
//
// 运行：vitest run tests/unit/business/write-plan.test.ts

import { describe, it, expect } from 'vitest';
import { computeWritePlan, type WritePlanCandidate, type WritePlanGovernance } from '../../../src/server/business/write-plan.js';

// ============================================================================
// Helpers
// ============================================================================

function makeCandidate(
  projectType: string | null,
  customerRef: string | null = null,
  modelRef: string | null = null,
): WritePlanCandidate {
  return {
    normalized_fields: {
      project_type: projectType,
      customer_ref: customerRef,
      model_ref: modelRef,
    },
  };
}

function makeGovernance(projectType: string | null): WritePlanGovernance {
  return {
    classification: {
      project_type: projectType,
    },
  };
}

// ============================================================================
// Tests — client (客片)
// ============================================================================

describe('computeWritePlan — client (客片)', () => {
  it('returns [customer, project] without model_ref (BR-01: Model 可选)', () => {
    const plan = computeWritePlan(makeCandidate('client', '张三', null));
    expect(plan).toEqual(['customer', 'project']);
  });

  it('returns [customer, project, model] when valid model_ref present', () => {
    const plan = computeWritePlan(makeCandidate('client', '张三', '模特A'));
    expect(plan).toEqual(['customer', 'project', 'model']);
  });

  it('does NOT include model when model_ref is empty string', () => {
    const plan = computeWritePlan(makeCandidate('client', '张三', ''));
    expect(plan).toEqual(['customer', 'project']);
  });

  it('does NOT include model when model_ref is whitespace-only', () => {
    const plan = computeWritePlan(makeCandidate('client', '张三', '   '));
    expect(plan).toEqual(['customer', 'project']);
  });

  it('does NOT include model when model_ref is undefined', () => {
    const candidate: WritePlanCandidate = {
      normalized_fields: {
        project_type: 'client',
        customer_ref: '张三',
        // model_ref omitted
      },
    };
    const plan = computeWritePlan(candidate);
    expect(plan).toEqual(['customer', 'project']);
  });
});

// ============================================================================
// Tests — creative (样片)
// ============================================================================

describe('computeWritePlan — creative (样片)', () => {
  it('returns [project, model] without customer_ref (BR-02: Customer 可选)', () => {
    const plan = computeWritePlan(makeCandidate('creative', null, '模特A'));
    expect(plan).toEqual(['project', 'model']);
  });

  it('returns [customer, project, model] when valid customer_ref present', () => {
    const plan = computeWritePlan(makeCandidate('creative', '李四', '模特A'));
    expect(plan).toEqual(['customer', 'project', 'model']);
  });

  it('does NOT include customer when customer_ref is empty string', () => {
    const plan = computeWritePlan(makeCandidate('creative', '', '模特A'));
    expect(plan).toEqual(['project', 'model']);
  });

  it('does NOT include customer when customer_ref is whitespace-only', () => {
    const plan = computeWritePlan(makeCandidate('creative', '  ', '模特A'));
    expect(plan).toEqual(['project', 'model']);
  });

  it('does NOT include customer when customer_ref is undefined', () => {
    const candidate: WritePlanCandidate = {
      normalized_fields: {
        project_type: 'creative',
        // customer_ref omitted
        model_ref: '模特A',
      },
    };
    const plan = computeWritePlan(candidate);
    expect(plan).toEqual(['project', 'model']);
  });
});

// ============================================================================
// Tests — unknown / fail-safe
// ============================================================================

describe('computeWritePlan — unknown / fail-safe', () => {
  it('returns [] for unknown project_type', () => {
    const plan = computeWritePlan(makeCandidate('unknown', '张三', '模特A'));
    expect(plan).toEqual([]);
  });

  it('returns [] when project_type is null', () => {
    const plan = computeWritePlan(makeCandidate(null, '张三', '模特A'));
    expect(plan).toEqual([]);
  });

  it('returns [] when project_type is undefined', () => {
    const candidate: WritePlanCandidate = {
      normalized_fields: {
        customer_ref: '张三',
        model_ref: '模特A',
      },
    };
    const plan = computeWritePlan(candidate);
    expect(plan).toEqual([]);
  });

  it('returns [] for unrecognized project_type value', () => {
    const candidate: WritePlanCandidate = {
      normalized_fields: {
        project_type: 'wedding' as string,
        customer_ref: '张三',
        model_ref: '模特A',
      },
    };
    const plan = computeWritePlan(candidate);
    expect(plan).toEqual([]);
  });

  it('returns [] when candidate is null/undefined (defensive)', () => {
    expect(computeWritePlan(null as unknown as WritePlanCandidate)).toEqual([]);
    expect(computeWritePlan(undefined as unknown as WritePlanCandidate)).toEqual([]);
  });
});

// ============================================================================
// Tests — governance overrides candidate
// ============================================================================

describe('computeWritePlan — governance.classification.project_type 优先', () => {
  it('uses governance project_type over candidate project_type', () => {
    // candidate says 'client', governance says 'creative'
    const candidate = makeCandidate('client', '张三', null);
    const governance = makeGovernance('creative');
    const plan = computeWritePlan(candidate, governance);
    // creative without customer_ref in candidate → but candidate HAS customer_ref '张三'
    // → [customer, project, model]
    expect(plan).toEqual(['customer', 'project', 'model']);
  });

  it('uses governance creative when candidate says client, no customer in candidate', () => {
    const candidate = makeCandidate('client', null, null);
    const governance = makeGovernance('creative');
    const plan = computeWritePlan(candidate, governance);
    // creative: no customer_ref → [project, model]
    expect(plan).toEqual(['project', 'model']);
  });

  it('uses governance client when candidate says creative', () => {
    const candidate = makeCandidate('creative', null, null);
    const governance = makeGovernance('client');
    const plan = computeWritePlan(candidate, governance);
    // client: no model_ref → [customer, project]
    expect(plan).toEqual(['customer', 'project']);
  });

  it('returns [] when governance says unknown even if candidate says client', () => {
    const candidate = makeCandidate('client', '张三', '模特A');
    const governance = makeGovernance('unknown');
    const plan = computeWritePlan(candidate, governance);
    expect(plan).toEqual([]);
  });

  it('falls back to candidate when governance is null', () => {
    const plan = computeWritePlan(makeCandidate('client', '张三', null), null);
    expect(plan).toEqual(['customer', 'project']);
  });

  it('falls back to candidate when governance is undefined', () => {
    const plan = computeWritePlan(makeCandidate('creative', null, '模特A'), undefined);
    expect(plan).toEqual(['project', 'model']);
  });

  it('falls back to candidate when governance.classification is undefined', () => {
    const governance: WritePlanGovernance = {};
    const plan = computeWritePlan(makeCandidate('client', '张三', null), governance);
    expect(plan).toEqual(['customer', 'project']);
  });

  it('falls back to candidate when governance.classification.project_type is null', () => {
    const governance: WritePlanGovernance = {
      classification: { project_type: null },
    };
    const plan = computeWritePlan(makeCandidate('creative', null, '模特A'), governance);
    expect(plan).toEqual(['project', 'model']);
  });
});

// ============================================================================
// Tests — write order invariant (Customer → Project → Model)
// ============================================================================

describe('computeWritePlan — 写入顺序不变量', () => {
  it('client full plan maintains Customer → Project → Model order', () => {
    const plan = computeWritePlan(makeCandidate('client', '张三', '模特A'));
    expect(plan).toEqual(['customer', 'project', 'model']);
  });

  it('creative full plan maintains Customer → Project → Model order', () => {
    const plan = computeWritePlan(makeCandidate('creative', '李四', '模特A'));
    expect(plan).toEqual(['customer', 'project', 'model']);
  });

  it('creative without customer still places Project before Model', () => {
    const plan = computeWritePlan(makeCandidate('creative', null, '模特A'));
    expect(plan).toEqual(['project', 'model']);
  });
});
