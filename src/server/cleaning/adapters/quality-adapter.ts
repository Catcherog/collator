// quality-adapter.ts
// 通过 LegacyModuleLoader 加载 src/data-cleaning/core/quality-scorer.js，包装质量分计算。

import { loadLegacyClass } from '../legacy-module-loader.js';
import type { ValidationIssue } from './rules-adapter.js';

const QUALITY_MODULE = 'core/quality-scorer.js';

export interface QualityWeights {
  requiredFieldsComplete?: number;
  formatValid?: number;
  enumValid?: number;
  logicConsistent?: number;
  confidenceWeighted?: number;
}

export interface QualityDeduction {
  field: string;
  reason: string;
  points: number;
  suggestion?: string;
}

export interface QualityReport {
  score: number;
  grade: string;
  deductions: QualityDeduction[];
  suggestions: string[];
  summary: string;
}

export interface ValidationRun {
  schemaKey: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function calculateQualityScore(runs: ValidationRun[], weights?: QualityWeights): QualityReport {
  const QualityScorer = loadLegacyClass<new (w?: QualityWeights) => {
    score(schemaKey: string, cleanedData: Record<string, unknown>, validationResult: { errors: ValidationIssue[]; warnings: ValidationIssue[] }): QualityReport;
  }>(QUALITY_MODULE, 'QualityScorer');

  const scorer = new QualityScorer(weights);

  let totalScore = 100;
  const allDeductions: QualityDeduction[] = [];
  const allSuggestions: string[] = [];
  let worstGrade: string | null = null;

  // 合并多次校验结果，取最差分数作为最终质量分
  for (const run of runs) {
    const cleanedData: Record<string, unknown> = {};
    const report = scorer.score(run.schemaKey, cleanedData, {
      errors: run.errors,
      warnings: run.warnings,
    });
    if (report.score < totalScore) {
      totalScore = report.score;
      allDeductions.length = 0;
      allDeductions.push(...report.deductions);
      allSuggestions.length = 0;
      allSuggestions.push(...report.suggestions);
      worstGrade = report.grade;
    }
  }

  if (worstGrade === null) {
    worstGrade = totalScore >= 90 ? '优秀' : totalScore >= 70 ? '良好' : totalScore >= 50 ? '中等' : '较差';
  }

  return {
    score: totalScore,
    grade: worstGrade,
    deductions: allDeductions,
    suggestions: allSuggestions,
    summary: `数据质量${worstGrade}，共${allDeductions.length}个问题`,
  };
}
