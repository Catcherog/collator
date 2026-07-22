/**
 * 主线 A1: 截图治理客户端 — 返回完整 Governance Result V1
 *
 * 与现有 PreWriteClient（返回最小形状）并行存在，不破坏现有合同。
 * ScreenshotService 使用此客户端获取完整治理结果用于 API 响应。
 */

import type { CandidateV1 } from '../../contracts/candidate-v1.js';

/** 完整 Governance Result V1 形状（与 SOP governance-result-v1.js 对齐） */
export interface FullGovernanceResult {
  schema_version: string;
  candidate_id: string;
  decision: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
  classification: {
    entity_type: string;
    project_type?: string;
    confidence?: number;
  };
  rule_version: string;
  violations: Array<{
    code: string;
    message: string;
    severity: string;
  }>;
  write: {
    status: string;
    target_table: string;
    target_record_id: string | null;
    attempted_at?: string;
  };
  review: {
    status: string;
    review_task_id: string | null;
    ai_explanation?: {
      available: boolean;
      reason: string;
      summary?: string;
      suggested_fix?: string;
    };
  };
  audit: {
    audit_id: string;
    timestamp: string;
    source_record_id: string;
    idempotency_key: string;
    rule_version: string;
  };
}

/** 截图治理客户端接口 */
export interface ScreenshotGovernanceClient {
  callPreWriteFull(candidate: CandidateV1): Promise<FullGovernanceResult>;
}

/**
 * SOP HTTP 客户端 — 调用 SOP /v1/pre-write 返回完整 Governance Result V1。
 *
 * 与 SopPreWriteClient 不同，此客户端不剥离响应，保留完整治理结果
 * 供截图 API 响应使用。
 */
export class SopScreenshotGovernanceClient implements ScreenshotGovernanceClient {
  private readonly sopHttpUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options?: {
    sopHttpUrl?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.sopHttpUrl = (
      options?.sopHttpUrl ??
      process.env.SOP_HTTP_URL ??
      'http://localhost:3001'
    ).replace(/\/+$/, '');
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  async callPreWriteFull(candidate: CandidateV1): Promise<FullGovernanceResult> {
    const resp = await this.fetchImpl(`${this.sopHttpUrl}/v1/pre-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candidate),
    });

    if (!resp.ok) {
      let errorBody: { error?: string; message?: string } = {};
      try {
        errorBody = (await resp.json()) as { error?: string; message?: string };
      } catch {
        // 忽略 JSON 解析失败
      }
      throw new Error(
        `SopScreenshotGovernanceClient: SOP /v1/pre-write returned HTTP ${resp.status} ` +
        `(error=${errorBody.error ?? 'UNKNOWN'}, message=${errorBody.message ?? '<empty>'})`
      );
    }

    return (await resp.json()) as FullGovernanceResult;
  }
}
