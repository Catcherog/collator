// cleaner-adapter.ts
// 从 src/data-cleaning/core/data-cleaner.js 中提取纯清洗逻辑，不 import 旧模块。

import {
  sanitizePhone,
  sanitizeText,
  sanitizeUrl,
  parseDate,
  normalizeBudget,
  findMatchingStyle,
  findMatchingShootType,
  type ParseDateContext,
} from './utils-adapter.js';
import { loadSynonyms, type SynonymsConfig } from './config-adapter.js';
import { getFieldSchema, type SchemaField } from './schema-adapter.js';

export interface CleanResult {
  data: Record<string, unknown>;
  corrections: Array<{
    field: string;
    original: unknown;
    corrected: unknown;
    reason: string;
    confidence?: number;
    source?: string;
  }>;
  warnings: string[];
}

export interface CleanOptions {
  /** 解析自然语言日期所需的基准日期上下文 */
  dateContext?: ParseDateContext;
  /** 枚举映射置信度阈值，默认 0.85 */
  enumConfidenceThreshold?: number;
}

function cloneInput(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data };
}

export function adaptFormatClean(
  schemaKey: string,
  data: Record<string, unknown>,
  options: CleanOptions = {}
): CleanResult {
  const cleanedData = cloneInput(data);
  const corrections: CleanResult['corrections'] = [];
  const warnings: string[] = [];

  for (const [fieldName, value] of Object.entries(cleanedData)) {
    if (value === null || value === undefined || value === '') continue;

    const fieldSchema = getFieldSchema(schemaKey, fieldName);
    if (!fieldSchema) {
      warnings.push(`未知字段 ${fieldName}，已忽略`);
      continue;
    }

    try {
      let sanitizedValue: unknown = value;
      const fieldType = fieldSchema.type;

      if (fieldType === 'text(phone)') {
        sanitizedValue = sanitizePhone(String(value));
      } else if (fieldType === 'text(date)' || fieldType === 'datetime' || fieldType === 'date') {
        if (typeof value === 'string') {
          const parsed = parseDate(value, options.dateContext);
          if (parsed) {
            sanitizedValue = parsed;
          }
        }
      } else if (fieldType === 'text(budget)' || (fieldSchema.enumValues && fieldSchema.enumValues.some(v => v.includes('元')))) {
        if (typeof value === 'string' && !fieldSchema.enumValues.includes(value)) {
          const budgetResult = normalizeBudget(value);
          if (budgetResult.interval && fieldSchema.enumValues.includes(budgetResult.interval)) {
            sanitizedValue = budgetResult.interval;
          }
        }
      } else if (fieldType === 'text(url)') {
        sanitizedValue = sanitizeUrl(value);
      } else if (fieldType === 'text' && typeof value === 'string') {
        sanitizedValue = sanitizeText(value);
      }

      if (sanitizedValue !== value) {
        corrections.push({
          field: fieldName,
          original: value,
          corrected: sanitizedValue,
          reason: '格式清洗',
        });
        cleanedData[fieldName] = sanitizedValue;
      }
    } catch (err) {
      warnings.push(`字段 ${fieldName} 格式化失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { data: cleanedData, corrections, warnings };
}

function matchEnumValue(
  fieldSchema: SchemaField,
  input: unknown,
  synonyms: SynonymsConfig
): { matched: string | null; confidence: number; source?: string; needsConfirmation?: boolean } {
  if (!fieldSchema.enumValues || fieldSchema.enumValues.length === 0 || !input) {
    return { matched: null, confidence: 0 };
  }

  const strInput = String(input).toLowerCase();

  for (const enumValue of fieldSchema.enumValues) {
    if (enumValue.toLowerCase() === strInput) {
      return { matched: enumValue, confidence: 1.0 };
    }
    if (enumValue.toLowerCase().includes(strInput) || strInput.includes(enumValue.toLowerCase())) {
      return { matched: enumValue, confidence: 0.9 };
    }

    const styleSynonyms = synonyms.styleSynonyms?.[enumValue];
    if (styleSynonyms) {
      for (const syn of styleSynonyms) {
        if (strInput.includes(syn.toLowerCase())) {
          return { matched: enumValue, confidence: 0.85, source: 'styleSynonyms' };
        }
      }
    }

    const sourceMapping = synonyms.sourceChannelMapping?.[enumValue];
    if (sourceMapping) {
      for (const syn of sourceMapping) {
        if (strInput.includes(syn.toLowerCase())) {
          return { matched: enumValue, confidence: 0.85, source: 'sourceChannelMapping' };
        }
      }
    }
  }

  if (fieldSchema.fieldName.includes('风格') || fieldSchema.fieldName.includes('类型')) {
    const styleMatch = findMatchingStyle(String(input), synonyms.styleSynonyms);
    if (styleMatch) {
      return { matched: styleMatch.style, confidence: styleMatch.confidence, source: 'fuzzyMatch' };
    }

    const shootMatch = findMatchingShootType(String(input), synonyms.shootTypeMapping);
    if (shootMatch) {
      return {
        matched: shootMatch.type,
        confidence: shootMatch.confidence,
        needsConfirmation: shootMatch.needsConfirmation,
        source: 'shootTypeMapping',
      };
    }
  }

  return { matched: null, confidence: 0 };
}

export function adaptEnumMapClean(
  schemaKey: string,
  data: Record<string, unknown>,
  options: CleanOptions = {}
): CleanResult {
  const cleanedData = cloneInput(data);
  const corrections: CleanResult['corrections'] = [];
  const warnings: string[] = [];
  const threshold = options.enumConfidenceThreshold ?? 0.85;
  const synonyms = loadSynonyms();

  for (const [fieldName, value] of Object.entries(cleanedData)) {
    if (value === null || value === undefined || value === '') continue;

    const fieldSchema = getFieldSchema(schemaKey, fieldName);
    if (!fieldSchema || !fieldSchema.enumValues || fieldSchema.enumValues.length === 0) continue;

    try {
      const values = Array.isArray(value) ? value : [value];
      const mappedValues: unknown[] = [];
      let hasMapping = false;

      for (const v of values) {
        if (fieldSchema.enumValues.includes(String(v))) {
          mappedValues.push(v);
          continue;
        }

        const matchResult = matchEnumValue(fieldSchema, v, synonyms);
        if (matchResult.matched && matchResult.confidence >= threshold) {
          mappedValues.push(matchResult.matched);
          hasMapping = true;
          corrections.push({
            field: fieldName,
            original: v,
            corrected: matchResult.matched,
            confidence: matchResult.confidence,
            reason: '枚举同义词映射',
            source: matchResult.source || 'directMatch',
          });
        } else if (matchResult.matched && matchResult.confidence >= 0.5) {
          warnings.push(`字段 ${fieldName} 的值 "${v}" 可能映射到 "${matchResult.matched}"（置信度 ${matchResult.confidence}），建议确认`);
          mappedValues.push(v);
        } else {
          mappedValues.push(v);
        }
      }

      if (hasMapping) {
        cleanedData[fieldName] = Array.isArray(value) ? mappedValues : mappedValues[0];
      }
    } catch (err) {
      warnings.push(`字段 ${fieldName} 枚举映射失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { data: cleanedData, corrections, warnings };
}
