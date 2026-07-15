class RollbackManager {
  constructor(writer) {
    this.writer = writer;
    this.snapshots = new Map();
  }

  createSnapshot(description = '') {
    const snapshotId = `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.snapshots.set(snapshotId, {
      id: snapshotId,
      description,
      createdAt: new Date().toISOString(),
      records: [],
      linkages: [],
      status: 'active'
    });
    return snapshotId;
  }

  recordCreation(snapshotId, tableId, recordId, options = {}) {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }
    snapshot.records.push({
      tableId,
      recordId,
      tableName: options.tableName,
      createdAt: new Date().toISOString()
    });
  }

  recordLinkage(snapshotId, sourceTable, sourceRecordId, targetTable, targetRecordId, fieldName) {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }
    snapshot.linkages.push({
      sourceTable,
      sourceRecordId,
      targetTable,
      targetRecordId,
      fieldName,
      createdAt: new Date().toISOString()
    });
  }

  async rollback(snapshotId) {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      return { success: false, error: `Snapshot not found: ${snapshotId}` };
    }

    if (snapshot.status === 'rolled_back') {
      return { success: true, message: 'Already rolled back', snapshotId };
    }

    const result = {
      snapshotId,
      recordsDeleted: 0,
      recordsFailed: [],
      linkagesRemoved: 0,
      linkagesFailed: []
    };

    for (let i = snapshot.records.length - 1; i >= 0; i--) {
      const rec = snapshot.records[i];
      try {
        if (this.writer && this.writer.deleteRecord) {
          await this.writer.deleteRecord(rec.tableId, rec.recordId);
          result.recordsDeleted++;
        }
      } catch (err) {
        result.recordsFailed.push({ ...rec, error: err.message });
      }
    }

    for (let i = snapshot.linkages.length - 1; i >= 0; i--) {
      const link = snapshot.linkages[i];
      try {
        if (this.writer && this.writer.updateRecord) {
          await this.writer.updateRecord(link.sourceTable, link.sourceRecordId, {
            fields: { [link.fieldName]: [] }
          });
          result.linkagesRemoved++;
        }
      } catch (err) {
        result.linkagesFailed.push({ ...link, error: err.message });
      }
    }

    snapshot.status = 'rolled_back';
    snapshot.rolledBackAt = new Date().toISOString();
    snapshot.rollbackResult = result;

    return { success: true, ...result };
  }

  getSnapshot(snapshotId) {
    return this.snapshots.get(snapshotId);
  }

  listSnapshots() {
    return Array.from(this.snapshots.values()).map(s => ({
      id: s.id,
      description: s.description,
      createdAt: s.createdAt,
      status: s.status,
      recordCount: s.records.length,
      linkageCount: s.linkages.length
    }));
  }

  cleanup(maxAge = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAge;
    let cleaned = 0;
    for (const [id, snapshot] of this.snapshots.entries()) {
      const created = new Date(snapshot.createdAt).getTime();
      if (created < cutoff && snapshot.status !== 'active') {
        this.snapshots.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}

function createRollbackManager(writer) {
  return new RollbackManager(writer);
}

module.exports = {
  RollbackManager,
  createRollbackManager
};
