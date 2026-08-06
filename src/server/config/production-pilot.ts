import { createHash, randomUUID } from 'node:crypto';
import type { WriteTable } from '../business/write-plan.js';

export type ProductionPilotStatus = 'generated' | 'confirmed' | 'consumed' | 'succeeded';

/**
 * This is the server-owned preview returned to the trusted operator UI.  The
 * execute request accepts only preview_id + nonce; it never accepts this full
 * object or any client-provided confirmation flag.
 */
export interface ProductionPilotPreview {
  preview_id: string;
  nonce: string;
  generated_at: string;
  expires_at: string;
  write_mode: 'production-pilot';
  status: ProductionPilotStatus;
  planned_record_count: number;
  target_table_aliases: WriteTable[];
  target_table_digests: Partial<Record<WriteTable, string>>;
  base_token_digest?: string;
}

/** Internal-only server input used to bind a preview to authoritative state. */
export interface ServerProductionPilotPreviewInput {
  ingestionId: string;
  targetTables: readonly WriteTable[];
  targetTableDigests: Partial<Record<WriteTable, string>>;
  baseTokenDigest?: string;
  candidateDigest: string;
  governanceDigest: string;
  authoritativePlanDigest: string;
  pilotRunId: string;
  createdAt: string;
  expiresAt: string;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function digestJson(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}

/** Generate a fresh opaque server token and public-safe preview. */
export function createServerProductionPilotPreview(
  input: ServerProductionPilotPreviewInput,
): ProductionPilotPreview {
  return {
    preview_id: randomUUID(),
    nonce: randomUUID(),
    generated_at: input.createdAt,
    expires_at: input.expiresAt,
    write_mode: 'production-pilot',
    status: 'generated',
    planned_record_count: input.targetTables.length,
    target_table_aliases: [...input.targetTables],
    target_table_digests: { ...input.targetTableDigests },
    base_token_digest: input.baseTokenDigest,
  };
}

export function buildServerProductionPilotPreviewDigest(
  input: ServerProductionPilotPreviewInput,
  previewId: string,
): string {
  return digestJson({
    previewId,
    ingestionId: input.ingestionId,
    targetTables: [...input.targetTables],
    targetTableDigests: input.targetTableDigests,
    baseTokenDigest: input.baseTokenDigest,
    candidateDigest: input.candidateDigest,
    governanceDigest: input.governanceDigest,
    authoritativePlanDigest: input.authoritativePlanDigest,
    pilotRunId: input.pilotRunId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  });
}
