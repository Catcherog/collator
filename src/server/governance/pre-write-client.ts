/**
 * PRE_WRITE 治理客户端 — R1: handlePreWrite 真实调用方接线
 *
 * FAMP-CONTRACT-ADOPTION-GATE-01-R1 / AC-R1-02
 *
 * 用途：将 SOP 的 handlePreWrite 接入 collator 持续摄入链路，使
 * 「validateCandidateV1（合同校验）→ handlePreWrite（PRE_WRITE 治理）→ 持久化」
 * 成为真实的运行时调用链，而非仅测试引用。
 *
 * 设计：
 * - PreWriteClient 接口：collator 内部依赖倒置，不直接耦合 SOP 实现
 * - SopPreWriteClient：生产实现，通过动态 import() 调用 SOP 的 handlePreWrite
 * - NoOpPreWriteClient：测试默认实现，返回 PASS（与 Task 3 占位行为一致）
 *
 * 跨仓库 import 说明：
 * SOP 是 ESM 模块（SOP/package.json "type": "module"），collator 也是 ESM。
 * 使用动态 import() 从 collator 加载 SOP 的 handlePreWrite，懒加载并缓存。
 * 路径：collator/src/server/governance/ → SOP/src/governance/pre-write-handler.js
 */

import type { CandidateV1 } from '../../contracts/candidate-v1.js';

/**
 * collator 需要的治理结果最小形状（从 SOP GovernanceResultV1 提取）
 */
export interface PreWriteGovernanceResult {
  candidate_id: string;
  decision: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
  write_status: string;
  violations_count: number;
}

/**
 * PRE_WRITE 治理客户端接口
 */
export interface PreWriteClient {
  callPreWrite(candidate: CandidateV1): Promise<PreWriteGovernanceResult>;
}

/**
 * No-op 客户端 — 测试默认实现
 *
 * 返回 PASS（与 Task 3 占位行为一致），使测试不受 SOP 模块加载影响。
 * 生产环境应使用 SopPreWriteClient。
 */
export class NoOpPreWriteClient implements PreWriteClient {
  async callPreWrite(candidate: CandidateV1): Promise<PreWriteGovernanceResult> {
    return {
      candidate_id: candidate.candidate_id,
      decision: 'PASS',
      write_status: 'NOT_ATTEMPTED',
      violations_count: 0,
    };
  }
}

/**
 * SOP PRE_WRITE 客户端 — 生产实现
 *
 * 通过动态 import() 调用 SOP 的 handlePreWrite，将 PRE_WRITE 治理
 * 接入 collator 持续摄入链路。
 *
 * Fail-closed：如果 SOP 模块加载失败，抛错（不静默降级）。
 */
export class SopPreWriteClient implements PreWriteClient {
  private handlePreWriteFn: ((candidate: unknown, options?: unknown) => unknown) | null = null;

  private async loadHandler(): Promise<(candidate: unknown, options?: unknown) => unknown> {
    if (!this.handlePreWriteFn) {
      try {
        // 跨仓库动态 import：collator → SOP
        // 路径：collator/src/server/governance/ → lark/ → SOP/src/governance/
        // 使用变量路径避免 TypeScript 尝试解析跨仓库 .js 模块声明（TS7016）
        const modulePath = '../../../../SOP/src/governance/pre-write-handler.js';
        const mod = (await import(modulePath)) as {
          handlePreWrite: (candidate: unknown, options?: unknown) => unknown;
        };
        this.handlePreWriteFn = mod.handlePreWrite;
      } catch (err) {
        throw new Error(
          `SopPreWriteClient: failed to load SOP handlePreWrite: ${(err as Error).message}`
        );
      }
    }
    return this.handlePreWriteFn;
  }

  async callPreWrite(candidate: CandidateV1): Promise<PreWriteGovernanceResult> {
    const handler = await this.loadHandler();
    const result = handler(candidate) as {
      candidate_id: string;
      decision: string;
      write: { status: string };
      violations: unknown[];
    };
    return {
      candidate_id: result.candidate_id,
      decision: result.decision as PreWriteGovernanceResult['decision'],
      write_status: result.write.status,
      violations_count: Array.isArray(result.violations) ? result.violations.length : 0,
    };
  }
}
