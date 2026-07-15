const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG = {
  appToken: null,
  batchSize: 50,
  batchDelayMs: 200,
  maxRetries: 3,
  retryDelayMs: 1000,
  timeoutMs: 30000
};

class BitableWriter {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.tableMap = this.config.tables || {};
    const token = this.config.appToken;
    if (!token) {
      throw new Error('BitableWriter requires appToken');
    }
    this.appToken = token;
  }

  initialize() {
    return Promise.resolve(this);
  }

  getTableId(key) {
    if (this.tableMap[key]) {
      return this.tableMap[key].tableId || this.tableMap[key];
    }
    return this.tableMap[key] || null;
  }

  async executeApi(method, apiPath, data = null) {
    const tempFile = path.join(process.cwd(), `_bitable_temp_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    
    try {
      if (data) {
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
      }

      const args = ['lark-cli', 'api', method, apiPath];
      if (data) {
        args.push('--data', `@${path.basename(tempFile)}`);
      }

      const result = await new Promise((resolve, reject) => {
        const child = require('child_process').spawn('npx', args, {
          cwd: process.cwd(),
          shell: true,
          windowsHide: true,
          timeout: this.config.timeoutMs,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString('utf-8');
        });

        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString('utf-8');
        });

        child.on('error', (err) => {
          reject(new Error(`Failed to execute lark-cli: ${err.message}`));
        });

        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`lark-cli exited with code ${code}: ${stderr || stdout}`));
            return;
          }
          resolve({ stdout, stderr });
        });
      });

      let response;
      try {
        response = JSON.parse(result.stdout.trim());
      } catch (e) {
        response = { raw: result.stdout, code: -1, msg: 'Failed to parse JSON response' };
      }

      return response;
    } finally {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  async createRecord(tableId, fields) {
    const apiPath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${tableId}/records`;
    const data = { fields };

    let lastError;
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.executeApi('POST', apiPath, data);
        
        if (response.code === 0) {
          return {
            success: true,
            record: response.data.record,
            recordId: response.data.record.record_id
          };
        }

        if (response.code === 91403) {
          throw new Error(`Permission denied (91403): ${response.msg}`);
        }

        lastError = new Error(`API error ${response.code}: ${response.msg}`);
        
        if (attempt < this.config.maxRetries) {
          await this.delay(this.config.retryDelayMs * attempt);
        }
      } catch (err) {
        lastError = err;
        if (attempt < this.config.maxRetries) {
          await this.delay(this.config.retryDelayMs * attempt);
        }
      }
    }

    return {
      success: false,
      error: lastError.message
    };
  }

  async batchCreateRecords(tableId, records, options = {}) {
    const results = {
      success: [],
      failed: [],
      total: records.length
    };

    const batchSize = options.batchSize || this.config.batchSize;
    const batches = [];
    
    for (let i = 0; i < records.length; i += batchSize) {
      batches.push(records.slice(i, i + batchSize));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const apiPath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/batch_create`;
      const data = {
        records: batch.map(fields => ({ fields }))
      };

      let lastError;
      let success = false;

      for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
        try {
          const response = await this.executeApi('POST', apiPath, data);

          if (response.code === 0) {
            const created = (response.data && response.data.records) || [];
            results.success.push(...created.map(r => ({
              recordId: r.record_id,
              fields: r.fields
            })));
            success = true;
            break;
          }

          lastError = new Error(`Batch API error ${response.code}: ${response.msg}`);
          
          if (attempt < this.config.maxRetries) {
            await this.delay(this.config.retryDelayMs * attempt);
          }
        } catch (err) {
          lastError = err;
          if (attempt < this.config.maxRetries) {
            await this.delay(this.config.retryDelayMs * attempt);
          }
        }
      }

      if (!success) {
        results.failed.push(...batch.map((fields, idx) => ({
          fields,
          error: lastError ? lastError.message : 'Unknown error',
          batchIndex,
          indexInBatch: idx
        })));
      }

      if (batchIndex < batches.length - 1) {
        await this.delay(this.config.batchDelayMs);
      }
    }

    return {
      ...results,
      successCount: results.success.length,
      failedCount: results.failed.length,
      allSuccess: results.failed.length === 0
    };
  }

  async updateRecord(tableId, recordId, fields) {
    const apiPath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/${recordId}`;
    const data = { fields };

    const response = await this.executeApi('PUT', apiPath, data);

    if (response.code === 0) {
      return {
        success: true,
        record: response.data.record,
        recordId: response.data.record.record_id
      };
    }

    return {
      success: false,
      error: `API error ${response.code}: ${response.msg}`
    };
  }

  async getRecord(tableId, recordId) {
    const apiPath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/${recordId}`;
    
    const response = await this.executeApi('GET', apiPath);

    if (response.code === 0) {
      return {
        success: true,
        record: response.data.record
      };
    }

    return {
      success: false,
      error: `API error ${response.code}: ${response.msg}`
    };
  }

  async findRecords(tableId, options = {}) {
    const { fieldNames, filter, pageSize = 100 } = options;
    let allRecords = [];
    let pageToken = null;

    do {
      let apiPath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${tableId}/records?page_size=${pageSize}`;
      
      if (fieldNames && fieldNames.length > 0) {
        apiPath += `&field_names=${JSON.stringify(fieldNames)}`;
      }
      
      if (filter) {
        apiPath += `&filter=${encodeURIComponent(JSON.stringify(filter))}`;
      }
      
      if (pageToken) {
        apiPath += `&page_token=${pageToken}`;
      }

      const response = await this.executeApi('GET', apiPath);

      if (response.code !== 0) {
        return {
          success: false,
          error: `API error ${response.code}: ${response.msg}`,
          records: []
        };
      }

      const items = response.data.items || [];
      allRecords = allRecords.concat(items);
      pageToken = response.data.page_token || null;

      if (pageToken) {
        await this.delay(100);
      }
    } while (pageToken);

    return {
      success: true,
      records: allRecords,
      total: allRecords.length
    };
  }

  async findRecordByField(tableId, fieldName, value) {
    const filter = {
      conjunction: 'and',
      conditions: [
        {
          field_name: fieldName,
          operator: 'is',
          value: [value]
        }
      ]
    };

    const result = await this.findRecords(tableId, { filter, pageSize: 10 });
    
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      record: result.records.length > 0 ? result.records[0] : null,
      recordId: result.records.length > 0 ? result.records[0].record_id : null,
      found: result.records.length > 0,
      total: result.total
    };
  }

  async createBidirectionalLink(tableId1, recordId1, linkFieldId1, tableId2, recordId2, linkFieldId2) {
    const results = {
      link1: null,
      link2: null,
      success: false
    };

    try {
      const link1Result = await this.updateRecord(tableId1, recordId1, {
        [linkFieldId1]: [{ record_ids: [recordId2] }]
      });
      results.link1 = link1Result;

      if (!link1Result.success) {
        return { ...results, success: false, error: 'Failed to create link from table1' };
      }

      await this.delay(100);

      const link2Result = await this.updateRecord(tableId2, recordId2, {
        [linkFieldId2]: [{ record_ids: [recordId1] }]
      });
      results.link2 = link2Result;

      results.success = link2Result.success;
      return results;
    } catch (err) {
      return { ...results, success: false, error: err.message };
    }
  }

  async listFields(tableId) {
    const apiPath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${tableId}/fields?page_size=100`;
    const response = await this.executeApi('GET', apiPath);

    if (response.code === 0) {
      return {
        success: true,
        fields: response.data.items || []
      };
    }

    return {
      success: false,
      error: `API error ${response.code}: ${response.msg}`,
      fields: []
    };
  }

  async listRecords(tableId, options = {}) {
    const { pageSize = 100, filter, sort } = options;
    let apiPath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${tableId}/records?page_size=${pageSize}`;
    if (filter) {
      apiPath += `&filter=${encodeURIComponent(filter)}`;
    }
    const response = await this.executeApi('GET', apiPath);

    if (response.code === 0) {
      const items = response.data.items || [];
      return items.map(item => ({
        recordId: item.record_id,
        fields: item.fields
      }));
    }
    return [];
  }

  async deleteRecord(tableId, recordId) {
    const apiPath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/${recordId}`;
    const response = await this.executeApi('DELETE', apiPath);
    return response.code === 0;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function createBitableWriter(options) {
  return new BitableWriter(options);
}

module.exports = {
  BitableWriter,
  createBitableWriter
};
