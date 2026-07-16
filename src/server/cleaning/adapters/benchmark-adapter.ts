// benchmark-adapter.ts
// 通过 LegacyModuleLoader 加载 src/data-cleaning/benchmark/metrics.js 的允许导出，包装为类型安全函数。

import { loadLegacyExport } from '../legacy-module-loader.js';

const BENCHMARK_MODULE = 'benchmark/metrics.js';

export function isEqual(a: unknown, b: unknown): boolean {
  const fn = loadLegacyExport<(x: unknown, y: unknown) => boolean>(BENCHMARK_MODULE, 'isEqual');
  return fn(a, b);
}

export function accuracy(correct: number, total: number): number {
  const fn = loadLegacyExport<(c: number, t: number) => number>(BENCHMARK_MODULE, 'accuracy');
  return fn(correct, total);
}

export interface FieldAccuracyResult {
  rate: number;
  correct: number;
  total: number;
  details: Array<{
    field: string;
    expected: unknown;
    actual: unknown;
    matched: boolean;
  }>;
}

export function computeFieldAccuracy(expectedData: Record<string, unknown>, actualData: Record<string, unknown>): FieldAccuracyResult {
  const fn = loadLegacyExport<(e: Record<string, unknown>, a: Record<string, unknown>) => FieldAccuracyResult>(
    BENCHMARK_MODULE,
    'computeFieldAccuracy'
  );
  return fn(expectedData, actualData);
}

export interface CorrectionAccuracyResult {
  rate: number;
  correct: number;
  total: number;
  details: Array<{
    field: string;
    expected: unknown;
    actual: unknown;
    matched: boolean;
  }>;
}

export function computeCorrectionsAccuracy(
  expectedCorrections: Array<Record<string, unknown>>,
  actualCorrections: Array<Record<string, unknown>>
): CorrectionAccuracyResult {
  const fn = loadLegacyExport<(e: Array<Record<string, unknown>>, a: Array<Record<string, unknown>>) => CorrectionAccuracyResult>(
    BENCHMARK_MODULE,
    'computeCorrectionsAccuracy'
  );
  return fn(expectedCorrections, actualCorrections);
}

export interface StatusMatchResult {
  statusMatched: boolean;
  codesMatched: boolean;
  actualStatus: string;
  actualCodes: string[];
}

export function computeStatusMatch(
  expectedStatus: string,
  actualSuccess: boolean,
  expectedErrorCodes: string[],
  actualErrors: unknown[]
): StatusMatchResult {
  const fn = loadLegacyExport<(es: string, as: boolean, eec: string[], ae: unknown[]) => StatusMatchResult>(
    BENCHMARK_MODULE,
    'computeStatusMatch'
  );
  return fn(expectedStatus, actualSuccess, expectedErrorCodes, actualErrors);
}

export function computeCasePassed(
  statusMatch: StatusMatchResult,
  scoreOk: boolean,
  expectedErrorCodes?: string[]
): boolean {
  const fn = loadLegacyExport<(sm: StatusMatchResult, so: boolean, eec?: string[]) => boolean>(
    BENCHMARK_MODULE,
    'computeCasePassed'
  );
  return fn(statusMatch, scoreOk, expectedErrorCodes);
}

export interface RecallResult {
  rate: number;
  correct: number;
  total: number;
}

export function computeSynonymRecall(cases: Array<{ description?: string; result?: { casePassed: boolean } }>): RecallResult {
  const fn = loadLegacyExport<(c: Array<{ description?: string; result?: { casePassed: boolean } }>) => RecallResult>(
    BENCHMARK_MODULE,
    'computeSynonymRecall'
  );
  return fn(cases);
}

export function computeRequiredInterception(
  cases: Array<{ expected?: { expectedErrorCodes?: string[] }; result?: { actualSuccess: boolean } }>
): RecallResult {
  const fn = loadLegacyExport<
    (c: Array<{ expected?: { expectedErrorCodes?: string[] }; result?: { actualSuccess: boolean } }>) => RecallResult
  >(BENCHMARK_MODULE, 'computeRequiredInterception');
  return fn(cases);
}

export function scoreWithinRange(actualScore: number, minScore: number): boolean {
  const fn = loadLegacyExport<(as: number, ms: number) => boolean>(BENCHMARK_MODULE, 'scoreWithinRange');
  return fn(actualScore, minScore);
}

export function computeWER(reference: string, hypothesis: string): number {
  const fn = loadLegacyExport<(r: string, h: string) => number>(BENCHMARK_MODULE, 'computeWER');
  return fn(reference, hypothesis);
}

export function computeCRA(reference: string, hypothesis: string): number {
  const fn = loadLegacyExport<(r: string, h: string) => number>(BENCHMARK_MODULE, 'computeCRA');
  return fn(reference, hypothesis);
}
