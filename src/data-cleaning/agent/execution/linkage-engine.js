class LinkageEngine {
  constructor(writer, rollbackManager) {
    this.writer = writer;
    this.rollback = rollbackManager;
  }

  async executeLinkages(primaryResult, context = {}) {
    const { tableId, recordId, fields, scene } = primaryResult;
    const executed = [];
    const failed = [];
    const snapshotId = context.snapshotId;

    try {
      if (scene === 'customer_consultation' || scene === 'order_creation') {
        if (context.customerRecordId &amp;&amp; recordId &amp;&amp; tableId === this.writer.getTableId('project')) {
          try {
            await this.linkCustomerToProject(context.customerRecordId, recordId, snapshotId);
            executed.push({
              type: 'customer_project_bidirectional',
              description: `客户 ${context.customerRecordId} &lt;-&gt; 项目 ${recordId} 双向关联`
            });
          } catch (err) {
            failed.push({ type: 'customer_project', error: err.message });
          }
        }
      }

      if (fields &amp;&amp; fields['项目负责人'] &amp;&amp; recordId) {
        executed.push({
          type: 'info',
          description: '项目负责人字段已包含在写入数据中'
        });
      }

      if (fields &amp;&amp; fields['参与人员'] &amp;&amp; recordId) {
        executed.push({
          type: 'info',
          description: '参与人员字段已包含在写入数据中'
        });
      }

      if (context.resourceAssignments &amp;&amp; context.resourceAssignments.length &gt; 0) {
        for (const assignment of context.resourceAssignments) {
          try {
            await this.linkResourceToProject(assignment.resourceRecordId, recordId, snapshotId);
            executed.push({
              type: 'resource_project',
              description: `资源 ${assignment.resourceRecordId} -&gt; 项目 ${recordId}`
            });
          } catch (err) {
            failed.push({ type: 'resource_project', error: err.message, resource: assignment });
          }
        }
      }

      return { executed, failed };
    } catch (err) {
      return { executed, failed: [...failed, { type: 'fatal', error: err.message }] };
    }
  }

  async linkCustomerToProject(customerRecordId, projectRecordId, snapshotId) {
    const projectTableId = this.writer.getTableId('project');
    const customerTableId = this.writer.getTableId('customer');

    await this.writer.updateRecord(projectTableId, projectRecordId, {
      fields: { '关联客户 ID': [customerRecordId] }
    });

    if (snapshotId) {
      this.rollback.recordLinkage(snapshotId, projectTableId, projectRecordId, customerTableId, customerRecordId, '关联客户 ID');
    }
  }

  async linkResourceToProject(resourceRecordId, projectRecordId, snapshotId) {
    const projectTableId = this.writer.getTableId('project');
    const resourceTableId = this.writer.getTableId('resource');

    try {
      const project = await this.writer.getRecord(projectTableId, projectRecordId);
      const existingResources = project?.fields?.['参与人员'] || [];
      if (!existingResources.includes(resourceRecordId)) {
        existingResources.push(resourceRecordId);
        await this.writer.updateRecord(projectTableId, projectRecordId, {
          fields: { '参与人员': existingResources }
        });
      }
    } catch (e) {
      await this.writer.updateRecord(projectTableId, projectRecordId, {
        fields: { '参与人员': [resourceRecordId] }
      });
    }

    if (snapshotId) {
      this.rollback.recordLinkage(snapshotId, projectTableId, projectRecordId, resourceTableId, resourceRecordId, '参与人员');
    }
  }

  async checkDuplicatePhone(phone, tableKey = 'customer') {
    if (!this.writer || !phone) return { isDuplicate: false };

    const tableId = this.writer.getTableId(tableKey);
    if (!tableId) return { isDuplicate: false };

    try {
      const filter = `CurrentValue.[联系方式] = "${phone}"`;
      const records = await this.writer.listRecords(tableId, { filter });
      
      if (records &amp;&amp; records.length &gt; 0) {
        return {
          isDuplicate: true,
          existingRecordId: records[0].recordId,
          existingRecord: records[0],
          count: records.length
        };
      }
      return { isDuplicate: false };
    } catch (err) {
      return { isDuplicate: false, error: err.message, checkFailed: true };
    }
  }
}

function createLinkageEngine(writer, rollbackManager) {
  return new LinkageEngine(writer, rollbackManager);
}

module.exports = {
  LinkageEngine,
  createLinkageEngine
};
