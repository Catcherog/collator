/**
 * Durable lifecycle callbacks around the exact external Create Record call.
 *
 * The callback beforeCreate is the write-ahead boundary.  The callback after
 * Create returns is the CREATE_CONFIRMED boundary and therefore runs before
 * any read-back verification or success reporting.
 */
export interface CreateLifecycleIntent {
  entity: 'customer' | 'project' | 'model';
  tableId: string;
  ingestionId: string;
  operationKey: string;
  clientToken: string;
  createdAt: string;
}

export interface CreateRecordLifecycle {
  beforeCreate?: (intent: CreateLifecycleIntent) => Promise<void>;
  afterCreate?: (recordId: string) => Promise<void>;
}

export class CreateLifecyclePersistenceError extends Error {
  readonly recordId: string;

  constructor(recordId: string, cause?: unknown) {
    super('CREATE_CONFIRMED persistence failed', { cause });
    this.name = 'CreateLifecyclePersistenceError';
    this.recordId = recordId;
  }
}
