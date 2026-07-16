import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadFixtures, FixtureLoaderError } from '../../../src/evaluation/fixture-loader.js';

const REPO_ROOT = path.resolve(process.cwd());
const DEFAULT_FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'customer-consultation-50.jsonl');

function createTempFile(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
  const filePath = path.join(tmpDir, 'fixtures.jsonl');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function cleanup(filePath: string): void {
  try {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe('fixture-loader - 正常加载', () => {
  it('加载默认 50 条 fixture', () => {
    const result = loadFixtures(DEFAULT_FIXTURE);
    expect(result.lineCount).toBe(50);
    expect(result.fixtures).toHaveLength(50);
    expect(result.resolvedPath).toBe(DEFAULT_FIXTURE);
  });

  it('第一条 fixture 结构正确', () => {
    const result = loadFixtures(DEFAULT_FIXTURE);
    const first = result.fixtures[0];
    expect(first.case_id).toBe('CC-001');
    expect(first.source).toBe('synthetic');
    expect(first.scenario_tags).toContain('valid');
    expect(first.candidate.schemaKey).toBe('customer');
    expect(first.candidate.recordType).toBe('customer_consultation');
    expect(first.candidate.data['客户姓名']).toBe('张三');
    expect(first.expected.success).toBe(true);
    expect(first.scoring.expect_intercepted).toBe(false);
  });

  it('case_id 全局唯一', () => {
    const result = loadFixtures(DEFAULT_FIXTURE);
    const ids = result.fixtures.map(f => f.case_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe('fixture-loader - 损坏 fixture', () => {
  let tmpFile: string;

  afterEach(() => {
    if (tmpFile) cleanup(tmpFile);
  });

  it('JSON 语法错误时抛出 FixtureLoaderError', () => {
    tmpFile = createTempFile('{ invalid json }\n');
    expect(() => loadFixtures(tmpFile)).toThrow(FixtureLoaderError);
    try {
      loadFixtures(tmpFile);
    } catch (err) {
      expect(err instanceof FixtureLoaderError).toBe(true);
      expect((err as FixtureLoaderError).line).toBe(1);
    }
  });

  it('case_id 缺失时抛出 FixtureLoaderError', () => {
    tmpFile = createTempFile(
      JSON.stringify({ source: 'synthetic', candidate: { schemaKey: 'customer', recordType: 'customer_consultation', data: {} }, expected: { normalized_fields: {}, pipeline_errors: [], validation_errors: [], validation_warnings: [], success: true }, scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: false } }) + '\n'
    );
    expect(() => loadFixtures(tmpFile)).toThrow(/case_id/);
  });

  it('case_id 重复时抛出 FixtureLoaderError', () => {
    const line = JSON.stringify({
      case_id: 'DUP-001',
      source: 'synthetic',
      scenario_tags: [],
      candidate: { schemaKey: 'customer', recordType: 'customer_consultation', data: {} },
      expected: { normalized_fields: {}, pipeline_errors: [], validation_errors: [], validation_warnings: [], success: true },
      scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: false },
    });
    tmpFile = createTempFile(line + '\n' + line + '\n');
    expect(() => loadFixtures(tmpFile)).toThrow(/重复/);
  });

  it('无效 source 时抛出 FixtureLoaderError', () => {
    tmpFile = createTempFile(
      JSON.stringify({
        case_id: 'X-001',
        source: 'invalid_source',
        scenario_tags: [],
        candidate: { schemaKey: 'customer', recordType: 'customer_consultation', data: {} },
        expected: { normalized_fields: {}, pipeline_errors: [], validation_errors: [], validation_warnings: [], success: true },
        scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: false },
      }) + '\n'
    );
    expect(() => loadFixtures(tmpFile)).toThrow(/source/);
  });

  it('缺失 candidate 时抛出 FixtureLoaderError', () => {
    tmpFile = createTempFile(
      JSON.stringify({
        case_id: 'X-002',
        source: 'synthetic',
        scenario_tags: [],
        expected: { normalized_fields: {}, pipeline_errors: [], validation_errors: [], validation_warnings: [], success: true },
        scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: false },
      }) + '\n'
    );
    expect(() => loadFixtures(tmpFile)).toThrow(/candidate/);
  });

  it('文件不存在时抛出 FixtureLoaderError', () => {
    expect(() => loadFixtures('/nonexistent/path/fixture.jsonl')).toThrow(FixtureLoaderError);
  });

  it('空文件时抛出 FixtureLoaderError', () => {
    tmpFile = createTempFile('');
    expect(() => loadFixtures(tmpFile)).toThrow(/为空|仅含空行/);
  });

  it('allowEmpty 时空文件返回空数组', () => {
    tmpFile = createTempFile('');
    const result = loadFixtures(tmpFile, { allowEmpty: true });
    expect(result.fixtures).toHaveLength(0);
    expect(result.lineCount).toBe(0);
  });
});

describe('fixture-loader - dateContext 校验', () => {
  let tmpFile: string;

  afterEach(() => {
    if (tmpFile) cleanup(tmpFile);
  });

  it('dateContext 缺少 referenceDate 时抛出错误', () => {
    tmpFile = createTempFile(
      JSON.stringify({
        case_id: 'X-010',
        source: 'synthetic',
        scenario_tags: [],
        candidate: { schemaKey: 'customer', recordType: 'customer_consultation', data: {}, dateContext: {} },
        expected: { normalized_fields: {}, pipeline_errors: [], validation_errors: [], validation_warnings: [], success: true },
        scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: false },
      }) + '\n'
    );
    expect(() => loadFixtures(tmpFile)).toThrow(/referenceDate/);
  });

  it('跳过空行不报错', () => {
    const validLine = JSON.stringify({
      case_id: 'X-011',
      source: 'synthetic',
      scenario_tags: [],
      candidate: { schemaKey: 'customer', recordType: 'customer_consultation', data: {} },
      expected: { normalized_fields: {}, pipeline_errors: [], validation_errors: [], validation_warnings: [], success: true },
      scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: false },
    });
    tmpFile = createTempFile('\n\n' + validLine + '\n\n\n');
    const result = loadFixtures(tmpFile);
    expect(result.lineCount).toBe(1);
  });
});
