import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateCandidateV1,
  createIdempotencyKey,
  ContractValidationError,
  CandidateV1Schema,
  SUPPORTED_SCHEMA_VERSIONS,
  type CandidateV1,
} from '../../../src/contracts/candidate-v1.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES_PATH = path.join(
  REPO_ROOT,
  'src',
  'contracts',
  'fixtures',
  'project-candidates.json',
);

interface FixtureMap {
  cand_demo_client_ok: CandidateV1;
  cand_demo_creative_ok: CandidateV1;
  cand_demo_client_missing_customer: CandidateV1;
  cand_demo_missing_type: CandidateV1;
}

function loadFixtures(): CandidateV1[] {
  const raw = fs.readFileSync(FIXTURES_PATH, 'utf-8');
  return JSON.parse(raw) as CandidateV1[];
}

function fixtureById(id: keyof FixtureMap): CandidateV1 {
  const all = loadFixtures();
  const found = all.find(c => c.candidate_id === id);
  if (!found) {
    throw new Error(`fixture not found: ${id}`);
  }
  // 深拷贝避免测试间相互污染
  return JSON.parse(JSON.stringify(found)) as CandidateV1;
}

describe('Candidate V1 合同 — fail-closed 校验', () => {
  // 测试 1: 合法客片通过验证
  it('合法客片（cand_demo_client_ok）通过验证且返回完整字段', () => {
    const candidate = fixtureById('cand_demo_client_ok');
    const result = validateCandidateV1(candidate);

    expect(result.schema_version).toBe('v1');
    expect(result.candidate_id).toBe('cand_demo_client_ok');
    expect(result.entity_type).toBe('project');
    expect(result.source.system).toBe('feishu_bitable');
    expect(result.source.table).toBe('project_statistics_demo');
    expect(result.normalized_fields.project_type).toBe('client');
    expect(result.normalized_fields.customer_ref).toBe('customer_demo_001');
    expect(result.normalized_fields.model_ref).toBeNull();
    expect(result.quality.status).toBe('PASS');
    expect(result.quality.score).toBeGreaterThanOrEqual(0);
    expect(result.quality.score).toBeLessThanOrEqual(1);
    expect(result.idempotency_key).toMatch(/^sha256_[0-9a-f]+$/);
  });

  // 测试 2: 合法样片通过验证
  it('合法样片（cand_demo_creative_ok）通过验证', () => {
    const candidate = fixtureById('cand_demo_creative_ok');
    const result = validateCandidateV1(candidate);

    expect(result.candidate_id).toBe('cand_demo_creative_ok');
    expect(result.normalized_fields.project_type).toBe('creative');
    expect(result.normalized_fields.customer_ref).toBeNull();
    expect(result.normalized_fields.model_ref).toBe('model_demo_001');
    expect(result.quality.status).toBe('PASS');
  });

  // 测试 3: 客片缺 Customer 通过 Collator 合同验证（Collator 不做业务规则校验）
  it('客片缺 Customer（cand_demo_client_missing_customer）通过形态校验', () => {
    const candidate = fixtureById('cand_demo_client_missing_customer');
    const result = validateCandidateV1(candidate);

    expect(result.candidate_id).toBe('cand_demo_client_missing_customer');
    expect(result.normalized_fields.project_type).toBe('client');
    expect(result.normalized_fields.customer_ref).toBeNull();
    // NEEDS_REVIEW 是合法的 quality.status 形态
    expect(result.quality.status).toBe('NEEDS_REVIEW');
    expect(result.quality.issues).toHaveLength(1);
    expect(result.quality.issues[0].code).toBe('CUSTOMER_REQUIRED');
  });

  // 测试 4: 项目类型为空通过 Collator 合同验证
  it('类型为空（cand_demo_missing_type）通过形态校验', () => {
    const candidate = fixtureById('cand_demo_missing_type');
    const result = validateCandidateV1(candidate);

    expect(result.candidate_id).toBe('cand_demo_missing_type');
    expect(result.normalized_fields.project_type).toBe('unknown');
    expect(result.quality.status).toBe('NEEDS_REVIEW');
    expect(result.quality.issues[0].code).toBe('PROJECT_TYPE_REQUIRED');
  });

  // 测试 5: 缺失必填字段 fail closed
  it('缺失必填字段 candidate_id 抛 MISSING_REQUIRED_FIELD', () => {
    const candidate = fixtureById('cand_demo_client_ok');
    // 删除 candidate_id 字段
    const { candidate_id: _removed, ...withoutId } = candidate;
    void _removed;

    expect(() => validateCandidateV1(withoutId)).toThrow(ContractValidationError);
    try {
      validateCandidateV1(withoutId);
    } catch (err) {
      expect(err).toBeInstanceOf(ContractValidationError);
      expect((err as ContractValidationError).code).toBe('MISSING_REQUIRED_FIELD');
    }
  });

  // 测试 6: 错误类型 fail closed
  it('quality.score 为字符串时抛 INVALID_FIELD_TYPE', () => {
    const candidate = fixtureById('cand_demo_client_ok');
    // 将 score 改为字符串
    (candidate as unknown as { quality: { score: unknown } }).quality.score = 'high';

    expect(() => validateCandidateV1(candidate)).toThrow(ContractValidationError);
    try {
      validateCandidateV1(candidate);
    } catch (err) {
      expect(err).toBeInstanceOf(ContractValidationError);
      expect((err as ContractValidationError).code).toBe('INVALID_FIELD_TYPE');
    }
  });

  // 测试 7: 未知 schema_version fail closed
  it('未知 schema_version (v99) 抛 UNKNOWN_SCHEMA_VERSION', () => {
    const candidate = fixtureById('cand_demo_client_ok');
    (candidate as unknown as { schema_version: string }).schema_version = 'v99';

    expect(() => validateCandidateV1(candidate)).toThrow(ContractValidationError);
    try {
      validateCandidateV1(candidate);
    } catch (err) {
      expect(err).toBeInstanceOf(ContractValidationError);
      expect((err as ContractValidationError).code).toBe('UNKNOWN_SCHEMA_VERSION');
    }
  });

  // 测试 8: createIdempotencyKey 测试
  it('createIdempotencyKey 确定性、唯一性、前缀正确', () => {
    const content1 = 'candidate|rec_demo_001|project|client';
    const content2 = 'candidate|rec_demo_001|project|client';
    const content3 = 'candidate|rec_demo_002|project|creative';

    const key1 = createIdempotencyKey(content1);
    const key2 = createIdempotencyKey(content2);
    const key3 = createIdempotencyKey(content3);

    // 相同输入产生相同 key
    expect(key1).toBe(key2);
    // 不同输入产生不同 key
    expect(key1).not.toBe(key3);
    // key 以 sha256_ 开头
    expect(key1).toMatch(/^sha256_[0-9a-f]+$/);
    expect(key3).toMatch(/^sha256_[0-9a-f]+$/);
  });

  // 测试 9: 四种 fixtures 全部通过验证
  it('四种 fixtures 全部通过 validateCandidateV1', () => {
    const fixtures = loadFixtures();
    expect(fixtures).toHaveLength(4);

    const expectedIds = [
      'cand_demo_client_ok',
      'cand_demo_creative_ok',
      'cand_demo_client_missing_customer',
      'cand_demo_missing_type',
    ];
    const actualIds = fixtures.map(f => f.candidate_id);
    expect(actualIds.sort()).toEqual([...expectedIds].sort());

    for (const fixture of fixtures) {
      const result = validateCandidateV1(fixture);
      expect(result.schema_version).toBe('v1');
      expect(result.idempotency_key).toMatch(/^sha256_[0-9a-f]+$/);
      expect(result.raw_evidence.redacted).toBe(true);
    }
  });

  // 测试 10: 安全约束 — redacted=false 时 fail closed
  it('raw_evidence.redacted=false 时 fail closed（强制要求脱敏标记）', () => {
    const candidate = fixtureById('cand_demo_client_ok');
    // 模拟 raw_evidence 中含 token 字段（passthrough 应允许）
    // 但 redacted 必须为 true 才通过
    (candidate as unknown as { raw_evidence: { redacted: boolean; token?: string } }).raw_evidence = {
      redacted: false,
      token: 'fake_secret_token_demo_only',
    };

    expect(() => validateCandidateV1(candidate)).toThrow(ContractValidationError);
    try {
      validateCandidateV1(candidate);
    } catch (err) {
      expect(err).toBeInstanceOf(ContractValidationError);
      // redacted=false 被字面量校验拦截，归类为 INVALID_FIELD_TYPE
      expect((err as ContractValidationError).code).toBe('INVALID_FIELD_TYPE');
    }
  });

  // 补充：raw_evidence 含敏感字段但 redacted=true 时仍通过（passthrough 允许）
  it('raw_evidence 含 token 但 redacted=true 时仍通过（脱敏标记存在）', () => {
    const candidate = fixtureById('cand_demo_client_ok');
    (candidate as unknown as { raw_evidence: { redacted: boolean; token?: string } }).raw_evidence = {
      redacted: true,
      token: 'fake_secret_token_demo_only',
    };

    // 应通过（Collator 不在此层强制脱敏内容，但要求 redacted 标记）
    expect(() => validateCandidateV1(candidate)).not.toThrow();
  });
});

describe('Candidate V1 合同 — 公共导出', () => {
  it('SUPPORTED_SCHEMA_VERSIONS 仅包含 v1', () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual(['v1']);
  });

  it('CandidateV1Schema 可独立 safeParse', () => {
    const candidate = fixtureById('cand_demo_client_ok');
    const result = CandidateV1Schema.safeParse(candidate);
    expect(result.success).toBe(true);
  });
});
