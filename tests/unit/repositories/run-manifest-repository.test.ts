import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileRunManifestRepository,
  InMemoryRunManifestRepository,
  type CreateRunManifestInput,
} from '../../../src/server/repositories/run-manifest-repository.js';

const BASE_INPUT: CreateRunManifestInput = {
  previewId: 'preview_manifest_001',
  ingestionId: 'ing_manifest_001',
  runId: 'pilot-run-manifest-001',
  previewDigest: 'a'.repeat(64),
  operator: 'reviewer_manifest',
  createdAt: '2026-08-01T07:00:00.000Z',
  expiresAt: '2026-08-01T07:15:00.000Z',
};

describe('RunManifestRepository', () => {
  it('enforces generated -> confirmed -> consumed and rejects replay', async () => {
    const repository = new InMemoryRunManifestRepository();

    await repository.createGenerated(BASE_INPUT);
    await repository.confirm(BASE_INPUT.previewId, BASE_INPUT.operator, BASE_INPUT.createdAt);
    await repository.consume(BASE_INPUT.previewId, '2026-08-01T07:01:00.000Z');

    await expect(
      repository.confirm(BASE_INPUT.previewId, BASE_INPUT.operator, '2026-08-01T07:02:00.000Z')
    ).rejects.toMatchObject({ code: 'RUN_MANIFEST_STATE_INVALID' });
    await expect(
      repository.consume(BASE_INPUT.previewId, '2026-08-01T07:03:00.000Z')
    ).rejects.toMatchObject({ code: 'RUN_MANIFEST_STATE_INVALID' });
  });

  it('treats a consumed manifest with no CREATE_INTENT as unfinished work', async () => {
    const repository = new InMemoryRunManifestRepository();
    await repository.createGenerated({
      ...BASE_INPUT,
      previewId: 'preview_manifest_consumed_empty',
      runId: 'pilot-run-manifest-consumed-empty',
    });
    await repository.confirm('preview_manifest_consumed_empty', BASE_INPUT.operator, BASE_INPUT.createdAt);
    await repository.consume('preview_manifest_consumed_empty', '2026-08-01T07:01:00.000Z');

    expect((await repository.findPendingCompensation()).map((manifest) => manifest.previewId))
      .toEqual(['preview_manifest_consumed_empty']);
  });

  it('rejects expired confirmation and serializes concurrent confirms', async () => {
    const repository = new InMemoryRunManifestRepository();
    await repository.createGenerated({
      ...BASE_INPUT,
      previewId: 'preview_manifest_expired',
      runId: 'pilot-run-manifest-expired',
      expiresAt: '2026-08-01T06:59:00.000Z',
    });
    await expect(
      repository.confirm('preview_manifest_expired', BASE_INPUT.operator, BASE_INPUT.createdAt)
    ).rejects.toMatchObject({ code: 'RUN_MANIFEST_EXPIRED' });

    await repository.createGenerated({
      ...BASE_INPUT,
      previewId: 'preview_manifest_concurrent',
      runId: 'pilot-run-manifest-concurrent',
    });
    const outcomes = await Promise.allSettled([
      repository.confirm('preview_manifest_concurrent', BASE_INPUT.operator, BASE_INPUT.createdAt),
      repository.confirm('preview_manifest_concurrent', BASE_INPUT.operator, BASE_INPUT.createdAt),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  });

  it('persists created records and compensation state across repository instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'collator-manifest-'));
    const filePath = join(directory, 'pilot-manifests.json');
    try {
      const first = new FileRunManifestRepository(filePath);
      await first.createGenerated(BASE_INPUT);
      await first.confirm(BASE_INPUT.previewId, BASE_INPUT.operator, BASE_INPUT.createdAt);
      await first.consume(BASE_INPUT.previewId, '2026-08-01T07:01:00.000Z');
      await first.recordCreated(BASE_INPUT.previewId, {
        entity: 'customer',
        recordId: 'rec_customer_manifest',
        createdAt: '2026-08-01T07:01:01.000Z',
      });
      await first.markCompensationRequired(BASE_INPUT.previewId);

      const restarted = new FileRunManifestRepository(filePath);
      const recovered = await restarted.findByPreviewId(BASE_INPUT.previewId);
      expect(recovered?.status).toBe('compensation_required');
      expect(recovered?.createdRecords).toEqual([
        expect.objectContaining({
          entity: 'customer',
          recordId: 'rec_customer_manifest',
          state: 'CREATED',
        }),
      ]);

      await restarted.markRecordDeleted(BASE_INPUT.previewId, 'customer', 'rec_customer_manifest');
      await restarted.completeCompensation(BASE_INPUT.previewId, true);
      expect((await new FileRunManifestRepository(filePath).findPendingCompensation()).length).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serializes confirmation across two file-backed repository instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'collator-manifest-concurrent-'));
    const filePath = join(directory, 'pilot-manifests.json');
    try {
      const first = new FileRunManifestRepository(filePath);
      const second = new FileRunManifestRepository(filePath);
      const input = {
        ...BASE_INPUT,
        previewId: 'preview_manifest_file_concurrent',
        runId: 'pilot-run-manifest-file-concurrent',
      };
      await first.createGenerated(input);

      const outcomes = await Promise.allSettled([
        first.confirm(input.previewId, input.operator, input.createdAt),
        second.confirm(input.previewId, input.operator, input.createdAt),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
