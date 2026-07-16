// rules-adapter.ts
// 通过 LegacyModuleLoader 加载 src/data-cleaning/rules/index.js 的允许导出，并包装为类型安全函数。

import { loadLegacyExport } from '../legacy-module-loader.js';
import { LegacyAdapterError } from '../errors.js';

const RULES_MODULE = 'rules/index.js';

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

export interface FieldValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  sanitizedValue?: unknown;
}

export interface RequiredFieldsResult {
  valid: boolean;
  errors: ValidationIssue[];
  missingFields: string[];
}

export interface LogicConsistencyResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface RecordValidationResult {
  status: 'passed' | 'warning' | 'failed';
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  score: number;
  sanitizedData: Record<string, unknown>;
}

export interface StateTransitionResult {
  valid: boolean;
  error?: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function adaptValidateField(fieldSchema: Record<string, unknown>, value: unknown): FieldValidationResult {
  const fn = loadLegacyExport<(fs: Record<string, unknown>, v: unknown) => FieldValidationResult>(
    RULES_MODULE,
    'validateField'
  );
  const clonedSchema = clone(fieldSchema);
  const clonedValue = clone(value);
  return fn(clonedSchema, clonedValue);
}

export function adaptValidateRequiredFields(schemaKey: string, data: Record<string, unknown>): RequiredFieldsResult {
  const fn = loadLegacyExport<(sk: string, d: Record<string, unknown>) => RequiredFieldsResult>(
    RULES_MODULE,
    'validateRequiredFields'
  );
  const clonedData = clone(data);
  return fn(schemaKey, clonedData);
}

export function adaptValidateLogicConsistency(
  data: Record<string, unknown>,
  schemaKey?: string
): LogicConsistencyResult {
  const fn = loadLegacyExport<(d: Record<string, unknown>, sk?: string) => LogicConsistencyResult>(
    RULES_MODULE,
    'validateLogicConsistency'
  );
  const clonedData = clone(data);
  return fn(clonedData, schemaKey);
}

export function adaptValidateStateTransition(
  machineName: string,
  fromState: string | null | undefined,
  toState: string
): StateTransitionResult {
  const fn = loadLegacyExport<(m: string, f: string | null | undefined, t: string) => StateTransitionResult>(
    RULES_MODULE,
    'validateStateTransition'
  );
  return fn(machineName, fromState, toState);
}

export function adaptValidateRecord(schemaKey: string, data: Record<string, unknown>): RecordValidationResult {
  const fn = loadLegacyExport<(sk: string, d: Record<string, unknown>) => RecordValidationResult>(
    RULES_MODULE,
    'validateRecord'
  );
  const clonedData = clone(data);
  const result = fn(schemaKey, clonedData);
  return {
    status: result.status,
    errors: clone(result.errors),
    warnings: clone(result.warnings),
    score: result.score,
    sanitizedData: clone(result.sanitizedData),
  };
}

export function adaptMakeIssue(
  field: string,
  code: string,
  message: string,
  severity: 'error' | 'warning',
  suggestion?: string
): ValidationIssue {
  const fn = loadLegacyExport<(f: string, c: string, m: string, s: 'error' | 'warning', sug?: string) => ValidationIssue>(
    RULES_MODULE,
    'makeIssue'
  );
  return fn(field, code, message, severity, suggestion);
}

export function adaptIsEmpty(value: unknown): boolean {
  const fn = loadLegacyExport<(v: unknown) => boolean>(RULES_MODULE, 'isEmpty');
  return fn(value);
}

export function adaptValidateRecordSafe(
  schemaKey: string,
  data: Record<string, unknown>
): RecordValidationResult {
  try {
    return adaptValidateRecord(schemaKey, data);
  } catch (cause) {
    throw new LegacyAdapterError('LEGACY_INVOCATION_FAILED', RULES_MODULE, { cause });
  }
}
