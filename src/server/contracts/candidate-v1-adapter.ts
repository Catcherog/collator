/**
 * Candidate V1 适配器 — 合同采用层（Task 3 Adoption Gate）
 *
 * 用途：将 Candidate V1 合同形态（collator/src/contracts/candidate-v1.ts）
 * 适配为 collator 内部 CandidateRecord 形状（src/server/domain/ingestion.ts），
 * 使持续摄入入口 `POST /v1/ingestions/:id/candidate-v1` 能够持久化 V1 候选
 * 作为采用证据，**不**触发 customer_consultation 专用清洗管道。
 *
 * 设计原则：
 * - 适配是无损的：V1 全部 10 个必填字段都保留在 CandidateRecord.fields 中
 * - 适配器不调用任何飞书 SDK，不产生业务写入副作用
 * - 适配器是纯函数：相同输入产生深度相等的输出
 */

import type { CandidateV1 } from '../../contracts/candidate-v1.js';
import type {
  CandidateCallbackRequest,
  CandidateRecord,
} from '../domain/ingestion.js';

/**
 * Schema name 用于内部 CandidateRecord.schema_name 字段。
 * 标识此 CandidateRecord 是由 Candidate V1 合同适配而来。
 */
export const CANDIDATE_V1_SCHEMA_NAME = 'project_candidate_v1' as const;

/**
 * Prompt version 占位值。V1 合同不包含 prompt_version 字段（这是 Dify
 * Candidate 特有字段），适配时使用 'n/a' 占位以满足 CandidateRecord 必填约束。
 */
export const CANDIDATE_V1_PROMPT_VERSION_PLACEHOLDER = 'n/a' as const;

/**
 * 将 Candidate V1 适配为内部 CandidateRecord 形状。
 *
 * 适配策略：将 V1 的全部 10 个必填字段原样打包到 CandidateRecord.fields 中，
 * 同时保留 V1 的 schema_version 作为 CandidateRecord.schema_version。
 * 这样 V1 候选作为采用证据被无损持久化，后续可通过 fields._v1 还原原始 V1 形态。
 *
 * @param candidate 通过 validateCandidateV1 校验的合法 Candidate V1
 * @returns 内部 CandidateRecord 形状（可持久化到 IngestionTask.raw_candidate）
 */
export function adaptCandidateV1ToRecord(candidate: CandidateV1): CandidateRecord {
  return {
    schema_name: CANDIDATE_V1_SCHEMA_NAME,
    schema_version: candidate.schema_version,
    prompt_version: CANDIDATE_V1_PROMPT_VERSION_PLACEHOLDER,
    fields: {
      // V1 全部 10 个必填字段原样保留
      schema_version: candidate.schema_version,
      candidate_id: candidate.candidate_id,
      ingestion_id: candidate.ingestion_id,
      source: candidate.source,
      entity_type: candidate.entity_type,
      raw_evidence: candidate.raw_evidence,
      normalized_fields: candidate.normalized_fields,
      quality: candidate.quality,
      processing: candidate.processing,
      idempotency_key: candidate.idempotency_key,
    },
    field_confidence: {},
    evidence: {},
  };
}

/**
 * 将 Candidate V1 适配为内部 CandidateCallbackRequest 形状。
 *
 * 这个适配器保留供未来管道集成使用：当 customer_consultation 管道支持
 * project 实体类型后，可通过此适配器将 V1 候选接入现有 receiveCandidate 链路。
 * 当前 Task 3 Adoption Gate 不调用此函数（持续摄入入口使用 adoptCandidateV1
 * 持久化路径，不走 receiveCandidate 的清洗管道）。
 *
 * @param candidate 通过 validateCandidateV1 校验的合法 Candidate V1
 * @returns 内部 CandidateCallbackRequest 形状
 */
export function adaptCandidateV1ToCallback(candidate: CandidateV1): CandidateCallbackRequest {
  return {
    candidate: adaptCandidateV1ToRecord(candidate),
  };
}
