/**
 * PRE_WRITE 治理客户端 — RF-01: HTTP 服务解耦
 *
 * FAMP-CONTRACT-ADOPTION-GATE-01-R1-FIX / RF-01
 *
 * 原方案（R1）：通过动态 import('../../../../SOP/src/governance/pre-write-handler.js')
 * 调用 SOP 的 handlePreWrite。该路径仅在 dev monorepo 结构下可用，Docker 镜像
 * 内必然失败（构建上下文只复制 collator 自身）。
 *
 * 新方案（RF-01）：SOP 作为独立 HTTP 服务运行（`npm run serve` in SOP，默认 :3001），
 * collator 通过 HTTP 调用 SOP 的 PRE_WRITE 端点。
 *
 * 部署模型：
 *   - SOP: `npm run serve` (默认 http://localhost:3001)
 *   - collator: 配置 SOP_HTTP_URL=http://sop:3001 (或 localhost:3001 本地)
 *
 * 合同版本一致性校验（GPT RF-01 要求）：
 *   - 首次调用 callPreWrite 前，GET /v1/version 获取 SOP 支持的合同版本
 *   - 与本地 EXPECTED_CANDIDATE_SCHEMA_VERSIONS 比对
 *   - 不一致 → fail-closed 抛错（不静默降级）
 *
 * Fail-closed：
 *   - HTTP 不可达 → 抛错（不静默降级到 NoOp）
 *   - HTTP 5xx → 抛错
 *   - 合同版本不一致 → 抛错
 *   - 4xx 业务错误（INVALID_JSON）→ 抛错（应是 collator 端的 bug）
 */

import type { CandidateV1 } from '../../contracts/candidate-v1.js';
import {
  SUPPORTED_SCHEMA_VERSIONS as EXPECTED_CANDIDATE_SCHEMA_VERSIONS,
} from '../../contracts/candidate-v1.js';

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
 *
 * RF-FIX-02: NoOp 实现已移至 tests/fixtures/noop-pre-write-client.ts。
 * 生产源码不含 NoOp fallback（RF-02）。测试必须显式注入 PreWriteClient
 * 实例（从 tests/fixtures/ 导入 NoOp，或使用 Fake/Sop 客户端）。
 */
export interface PreWriteClient {
  callPreWrite(candidate: CandidateV1): Promise<PreWriteGovernanceResult>;
}

/**
 * SOP PRE_WRITE 客户端 — HTTP 实现（RF-01）
 *
 * 通过 HTTP 调用 SOP 服务的 PRE_WRITE 端点。
 */
export class SopPreWriteClient implements PreWriteClient {
  private readonly sopHttpUrl: string;
  private readonly fetchImpl: typeof fetch;
  private versionCheckDone = false;
  private versionCheckPromise: Promise<void> | null = null;

  constructor(options?: {
    /** SOP HTTP 服务 URL，默认读取 SOP_HTTP_URL 环境变量或 http://localhost:3001 */
    sopHttpUrl?: string;
    /** 可注入 fetch（用于测试） */
    fetchImpl?: typeof fetch;
  }) {
    this.sopHttpUrl = (
      options?.sopHttpUrl ??
      process.env.SOP_HTTP_URL ??
      'http://localhost:3001'
    ).replace(/\/+$/, ''); // 去除尾部斜杠
    this.fetchImpl = options?.fetchImpl ?? fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'SopPreWriteClient: global fetch is not available. Use Node 18+ or inject fetchImpl.'
      );
    }
  }

  /**
   * 启动时（或首次调用前）做合同版本一致性校验。
   *
   * GET /v1/version → 比较 contract_versions.candidate 与本地
   * EXPECTED_CANDIDATE_SCHEMA_VERSIONS。
   *
   * 不一致时抛错（fail-closed，不静默降级）。
   */
  async ensureVersionConsistency(): Promise<void> {
    if (this.versionCheckDone) return;
    // 并发调用合并为单次 promise
    if (this.versionCheckPromise) return this.versionCheckPromise;
    this.versionCheckPromise = this.doVersionCheck();
    await this.versionCheckPromise;
    this.versionCheckPromise = null;
    this.versionCheckDone = true;
  }

  private async doVersionCheck(): Promise<void> {
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.sopHttpUrl}/v1/version`, { method: 'GET' });
    } catch (err) {
      throw new Error(
        `SopPreWriteClient: cannot reach SOP at ${this.sopHttpUrl}/v1/version ` +
        `(version check phase): ${(err as Error).message}. ` +
        `Ensure SOP_HTTP_URL is set correctly and SOP service is running (npm run serve in SOP/).`
      );
    }
    if (!resp.ok) {
      throw new Error(
        `SopPreWriteClient: SOP /v1/version returned HTTP ${resp.status} (version check phase)`
      );
    }
    const body = await resp.json() as {
      service?: string;
      contract_versions?: { candidate?: string[] };
    };
    if (!body || !body.contract_versions || !Array.isArray(body.contract_versions.candidate)) {
      throw new Error(
        `SopPreWriteClient: SOP /v1/version returned malformed response (missing contract_versions.candidate array)`
      );
    }
    const sopCandidateVersions = body.contract_versions.candidate;
    // 验证 SOP 支持所有 collator 需要的版本
    for (const expected of EXPECTED_CANDIDATE_SCHEMA_VERSIONS) {
      if (!sopCandidateVersions.includes(expected)) {
        throw new Error(
          `SopPreWriteClient: contract version mismatch. collator requires candidate ` +
          `schema version "${expected}" but SOP only supports [${sopCandidateVersions.join(', ')}]. ` +
          `Upgrade SOP or downgrade collator. Fail-closed — no silent degradation.`
        );
      }
    }
  }

  async callPreWrite(candidate: CandidateV1): Promise<PreWriteGovernanceResult> {
    // 首次调用前做版本一致性校验
    await this.ensureVersionConsistency();

    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.sopHttpUrl}/v1/pre-write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(candidate),
      });
    } catch (err) {
      throw new Error(
        `SopPreWriteClient: cannot reach SOP at ${this.sopHttpUrl}/v1/pre-write ` +
        `(call phase): ${(err as Error).message}. ` +
        `Ensure SOP service is running and reachable.`
      );
    }

    if (!resp.ok) {
      // 4xx / 5xx 都是错误（INVALID_JSON 应该是 collator 端 bug）
      let errorBody: { error?: string; message?: string } = {};
      try {
        errorBody = (await resp.json()) as { error?: string; message?: string };
      } catch {
        // 忽略 JSON 解析失败
      }
      throw new Error(
        `SopPreWriteClient: SOP /v1/pre-write returned HTTP ${resp.status} ` +
        `(error=${errorBody.error ?? 'UNKNOWN'}, message=${errorBody.message ?? '<empty>'})`
      );
    }

    const result = await resp.json() as {
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
