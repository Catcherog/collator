import { createHash } from 'node:crypto';
import type { WriteTable } from '../business/write-plan.js';

/**
 * The inputs used to build a production-pilot preview. Raw identifiers are
 * accepted here only so the preview can bind itself to the exact target; they
 * are never returned by the preview object or written to evidence.
 */
export interface ProductionWritePreviewRequest {
  ingestionId: string;
  targetTables: readonly WriteTable[];
  targetTableIds: Partial<Record<WriteTable, string | undefined>>;
  targetBaseToken?: string;
}

/** A public-safe, confirmation-bearing write preview. */
export interface ProductionWritePreview {
  previewId: string;
  generatedAt: string;
  writeMode: 'production-pilot';
  plannedRecordCount: number;
  targetTableAliases: WriteTable[];
  targetTableDigests: Partial<Record<WriteTable, string>>;
  baseTokenDigest?: string;
  confirmed: boolean;
  confirmedAt?: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalRequest(request: ProductionWritePreviewRequest): string {
  const tableEntries = [...request.targetTables]
    .map((table) => [table, request.targetTableIds[table] ?? ''] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  return JSON.stringify({
    ingestionId: request.ingestionId,
    targetTables: tableEntries,
    targetBaseToken: request.targetBaseToken ?? '',
  });
}

/**
 * Build a deterministic preview without calling Feishu or exposing raw
 * Base/Table/record identifiers. The preview id binds the later write to the
 * exact request that was shown to the operator.
 */
export function previewProductionWrite(
  request: ProductionWritePreviewRequest
): ProductionWritePreview {
  const previewId = digest(canonicalRequest(request));
  const targetTableDigests: Partial<Record<WriteTable, string>> = {};
  for (const table of request.targetTables) {
    const tableId = request.targetTableIds[table];
    if (tableId) targetTableDigests[table] = digest(tableId);
  }

  return {
    previewId,
    generatedAt: new Date().toISOString(),
    writeMode: 'production-pilot',
    plannedRecordCount: request.targetTables.length,
    targetTableAliases: [...request.targetTables],
    targetTableDigests,
    baseTokenDigest: request.targetBaseToken ? digest(request.targetBaseToken) : undefined,
    confirmed: false,
  };
}

/** Mark an already displayed preview as explicitly confirmed by an operator. */
export function confirmProductionWritePreview(
  preview: ProductionWritePreview
): ProductionWritePreview {
  return {
    ...preview,
    confirmed: true,
    confirmedAt: new Date().toISOString(),
  };
}

/**
 * Verify that a confirmed preview is bound to the current write request.
 * This is intentionally pure so the gate can enforce it before any API call.
 */
export function isProductionWritePreviewValid(
  preview: ProductionWritePreview | undefined,
  request: ProductionWritePreviewRequest
): boolean {
  if (
    !preview ||
    preview.writeMode !== 'production-pilot' ||
    !preview.confirmed ||
    !preview.confirmedAt
  ) {
    return false;
  }
  if (preview.previewId !== digest(canonicalRequest(request))) return false;
  if (preview.plannedRecordCount !== request.targetTables.length) return false;
  if (
    [...preview.targetTableAliases].sort().join(',') !==
    [...request.targetTables].sort().join(',')
  ) {
    return false;
  }
  if (
    request.targetBaseToken &&
    preview.baseTokenDigest !== digest(request.targetBaseToken)
  ) {
    return false;
  }
  return request.targetTables.every((table) => {
    const tableId = request.targetTableIds[table];
    return Boolean(tableId && preview.targetTableDigests[table] === digest(tableId));
  });
}
