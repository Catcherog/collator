// config-adapter.ts
// 按需读取 config JSON，不 import src/data-cleaning/config/index.js，避免 import-time 副作用与 RuleLearner 初始化。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'src', 'data-cleaning', 'config');

export interface SynonymsConfig {
  version: string;
  description: string;
  lastUpdated: string;
  styleSynonyms: Record<string, string[]>;
  shootTypeMapping: Record<string, {
    synonyms: string[];
    confidence: number;
    needsConfirmation?: boolean;
  }>;
  sourceChannelMapping: Record<string, string[]>;
  budgetRangeMapping: Record<string, {
    keywords: string[];
    range: number[];
  }>;
  timeExpressionMapping: Record<string, string[]>;
}

export interface CleaningRulesConfig {
  version: string;
  description: string;
  lastUpdated: string;
  fieldFormatRules: Record<string, unknown>;
  deduplicationRules: Record<string, unknown>;
  validationLevels: Record<string, unknown>;
  scoringWeights: Record<string, unknown>;
  logicConsistencyRules: Array<Record<string, unknown>>;
  stateMachines: Record<string, {
    states: string[];
    initial: string;
    transitions: Record<string, string[]>;
    allowRollback: boolean;
    allowJump: boolean;
  }>;
}

let synonymsCache: SynonymsConfig | null = null;
let cleaningRulesCache: CleaningRulesConfig | null = null;

function readJson<T>(fileName: string): T {
  const filePath = path.join(CONFIG_ROOT, fileName);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

export function loadSynonyms(): SynonymsConfig {
  if (!synonymsCache) {
    synonymsCache = readJson<SynonymsConfig>('synonyms.json');
  }
  return synonymsCache;
}

export function loadCleaningRules(): CleaningRulesConfig {
  if (!cleaningRulesCache) {
    cleaningRulesCache = readJson<CleaningRulesConfig>('cleaning-rules.json');
  }
  return cleaningRulesCache;
}

export function clearConfigCache(): void {
  synonymsCache = null;
  cleaningRulesCache = null;
}

export function getFieldFormatRule(fieldName: string): Record<string, unknown> | undefined {
  const rules = loadCleaningRules();
  return rules.fieldFormatRules[fieldName] as Record<string, unknown> | undefined;
}

export function getStateMachine(machineName: string): CleaningRulesConfig['stateMachines'][string] | undefined {
  const rules = loadCleaningRules();
  return rules.stateMachines[machineName];
}
