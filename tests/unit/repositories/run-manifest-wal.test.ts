import { describe, expect, it, vi } from 'vitest';
import { TransactionalBatchWriter } from '../../../src/server/business/transactional-batch-writer.js';
import type { CustomerRecordWriter, CustomerRecordWriterInput } from '../../../src/server/business/customer-record-writer.js';
import { InMemoryRunManifestRepository } from '../../../src/server/repositories/run-manifest-repository.js';

async function consumedManifest(repository: InMemoryRunManifestRepository, previewId: string, ingestionId: string) {
  await repository.createGenerated({
    previewId,
    ingestionId,
    runId: `run-${previewId}`,
    previewDigest: 'a'.repeat(64),
    operator: 'operator-wal',
    createdAt: '2026-08-01T07:00:00.000Z',
    expiresAt: '2026-08-01T08:00:00.000Z',
    targetTables: ['customer'],
    targetTableDigests: { customer: 'b'.repeat(64) },
  });
  await repository.confirm(previewId, 'operator-wal', '2026-08-01T07:00:01.000Z');
  await repository.consume(previewId, '2026-08-01T07:00:02.000Z', 'operator-wal');
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    entity: 'customer' as const,
    tableId: 'tbl_customer_wal',
    ingestionId: 'ing_wal_001',
    operationKey: 'customer-record:tbl_customer_wal:ing_wal_001',
    clientToken: 'client-token-wal-001',
    createdAt: '2026-08-01T07:00:03.000Z',
    ...overrides,
  };
}

describe('production-pilot CREATE_INTENT write-ahead log', () => {
  it('scans consumed manifests with pending and confirmed creates after restart', async () => {
    const repository = new InMemoryRunManifestRepository();
    await consumedManifest(repository, 'preview_wal_001', 'ing_wal_001');
    await repository.recordCreateIntent('preview_wal_001', intent());

    expect((await repository.findPendingCompensation()).map((manifest) => manifest.previewId))
      .toEqual(['preview_wal_001']);

    await repository.recordCreated('preview_wal_001', {
      entity: 'customer',
      tableId: 'tbl_customer_wal',
      operationKey: intent().operationKey,
      recordId: 'rec_wal_customer',
      createdAt: '2026-08-01T07:00:04.000Z',
    });
    await repository.recordCreated('preview_wal_001', {
      entity: 'customer',
      tableId: 'tbl_customer_wal',
      operationKey: intent().operationKey,
      recordId: 'rec_wal_customer',
      createdAt: '2026-08-01T07:00:04.000Z',
    });
    expect((await repository.findPendingCompensation()).at(0)?.createdRecords[0]?.recordId)
      .toBe('rec_wal_customer');
    expect((await repository.findByPreviewId('preview_wal_001'))?.createdRecords).toHaveLength(1);
  });

  it('compensates a consumed manifest that crashed before CREATE_INTENT', async () => {
    const repository = new InMemoryRunManifestRepository();
    await consumedManifest(repository, 'preview_wal_consumed_only', 'ing_wal_001');
    const writer = new TransactionalBatchWriter(
      undefined,
      undefined,
      undefined,
      undefined,
      repository,
    );

    await expect(writer.recoverPendingCompensations()).resolves.toEqual([
      { previewId: 'preview_wal_consumed_only', status: 'compensated' },
    ]);
    expect((await repository.findByPreviewId('preview_wal_consumed_only'))?.status)
      .toBe('compensated');
  });

  it('does not allow success to skip the committing state', async () => {
    const repository = new InMemoryRunManifestRepository();
    await consumedManifest(repository, 'preview_wal_succeeded', 'ing_wal_succeeded');
    await expect(repository.completeSuccess('preview_wal_succeeded')).rejects.toThrow('consumed');

    await repository.markExecuting('preview_wal_succeeded');
    await repository.markVerifying('preview_wal_succeeded');
    await repository.markCommitting('preview_wal_succeeded', {
      writeResults: [],
      transactionSnapshot: {
        snapshot_id: 'txn_wal_succeeded',
        status: 'committed',
        records_created: 0,
        records_rolled_back: 0,
      },
      expected_task_version: 1,
      expected_candidate_digest: 'candidate'.repeat(16),
      expected_governance_digest: 'governance'.repeat(8),
      expected_authoritative_plan_digest: 'plan'.repeat(16),
      auditEvents: [],
    });
    await repository.completeSuccess('preview_wal_succeeded');

    await expect(repository.recordCreated('preview_wal_succeeded', {
      entity: 'customer',
      tableId: 'tbl_customer_wal',
      operationKey: intent().operationKey,
      recordId: 'rec_late',
      createdAt: '2026-08-01T07:00:04.000Z',
    })).rejects.toThrow('succeeded');
  });

  it('records CREATE_CONFIRMED before post-write readback and recovers an id-less intent', async () => {
    const repository = new InMemoryRunManifestRepository();
    await consumedManifest(repository, 'preview_wal_order', 'ing_wal_001');
    const observedDuringReadback: string[] = [];
    const customerWriter: CustomerRecordWriter = {
      async write(input: CustomerRecordWriterInput) {
        await input.createLifecycle?.beforeCreate?.(intent());
        await input.createLifecycle?.afterCreate?.('rec_wal_customer');
        return { business_record_id: 'rec_wal_customer', created: true };
      },
      async verifyRecord() {
        const manifest = await repository.findByPreviewId('preview_wal_order');
        observedDuringReadback.push(manifest?.createdRecords[0]?.recordId ?? 'missing');
        throw new Error('simulated readback failure');
      },
      deleteRecord: vi.fn(async () => undefined),
      findByIngestionId: vi.fn(async () => ['rec_wal_customer']),
    };
    const writer = new TransactionalBatchWriter(customerWriter, undefined, undefined, undefined, repository);

    const result = await writer.writeBatch({
      ingestionId: 'ing_wal_001',
      normalizedFields: {},
      targetTables: ['customer'],
      customerTableId: 'tbl_customer_wal',
      verifyAfterWrite: true,
      pilotPreviewId: 'preview_wal_order',
      runManifestRepository: repository,
    });
    expect(result.status).toBe('rolled_back');
    expect(observedDuringReadback).toEqual(['rec_wal_customer']);

    const restartRepository = new InMemoryRunManifestRepository();
    await consumedManifest(restartRepository, 'preview_wal_orphan', 'ing_wal_001');
    await restartRepository.recordCreateIntent('preview_wal_orphan', intent());
    const deleteRecord = vi.fn(async () => undefined);
    const restarted = new TransactionalBatchWriter(
      { findByIngestionId: vi.fn(async () => ['rec_orphan']), deleteRecord } as unknown as CustomerRecordWriter,
      undefined,
      undefined,
      undefined,
      restartRepository,
    );
    expect(await restarted.recoverPendingCompensations()).toEqual([
      { previewId: 'preview_wal_orphan', status: 'compensated' },
    ]);
    expect(deleteRecord).toHaveBeenCalledWith('rec_orphan');
  });

  it('fails closed when an id-less intent matches multiple records during recovery', async () => {
    const repository = new InMemoryRunManifestRepository();
    await consumedManifest(repository, 'preview_wal_ambiguous', 'ing_wal_001');
    await repository.recordCreateIntent('preview_wal_ambiguous', intent());
    const writer = new TransactionalBatchWriter(
      { findByIngestionId: vi.fn(async () => ['rec_one', 'rec_two']) } as unknown as CustomerRecordWriter,
      undefined,
      undefined,
      undefined,
      repository,
    );

    await expect(writer.recoverPendingCompensations()).rejects.toThrow('multiple records');
    expect((await repository.findByPreviewId('preview_wal_ambiguous'))?.status).toBe('consumed');
  });
});
