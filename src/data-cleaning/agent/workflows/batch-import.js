const fs = require('fs');
const path = require('path');
const BaseWorkflow = require('./base-workflow');

class BatchImportWorkflow extends BaseWorkflow {
  get name() { return 'batch_import'; }
  get description() { return '批量导入：从CSV/JSON批量写入飞书多维表'; }

  async execute(input, context = {}) {
    const { tableKey = 'customer', filePath, data, autoConfirm = false } = context;
    
    let records = data;
    
    if (filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.json') {
        records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } else if (ext === '.csv') {
        const csvData = fs.readFileSync(filePath, 'utf-8');
        records = this.parseCSV(csvData);
      }
    }

    if (!records || !Array.isArray(records) || records.length === 0) {
      throw new Error('批量导入需要提供数据数组或CSV文件路径');
    }

    const schema = this.agent.schemas[tableKey];
    if (!schema) {
      throw new Error(`Schema not found: ${tableKey}`);
    }

    const validationResult = this.validateBatch(records, schema);

    if (!autoConfirm) {
      return {
        status: 'preview',
        total: records.length,
        valid: validationResult.valid.length,
        invalid: validationResult.errors.length,
        errors: validationResult.errors,
        previewMessage: this.agent.ui.generateBatchPreview({
          total: records.length,
          valid: validationResult.valid.length,
          invalid: validationResult.errors.length,
          errors: validationResult.errors
        })
      };
    }

    const snapshotId = this.rollback.createSnapshot(`batch_import_${tableKey}`);
    const createdRecords = [];
    const batchSize = this.agent.config.processing.batchSize || 50;

    try {
      for (let i = 0; i < validationResult.valid.length; i += batchSize) {
        const batch = validationResult.valid.slice(i, i + batchSize);
        const recordsToCreate = batch.map(r => ({ fields: r }));
        
        const result = await this.writer.batchCreateRecords(this.writer.getTableId(tableKey), recordsToCreate);

        const createdList = (result && result.success) || [];
        for (const rec of createdList) {
          createdRecords.push({ recordId: rec.recordId, tableId: this.writer.getTableId(tableKey), tableName: tableKey });
          this.rollback.recordCreation(snapshotId, this.writer.getTableId(tableKey), rec.recordId, { tableName: tableKey });
        }

        if (i + batchSize < validationResult.valid.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      return {
        status: 'success',
        total: records.length,
        created: createdRecords.length,
        failed: validationResult.errors.length,
        records: createdRecords,
        errors: validationResult.errors,
        snapshotId
      };
    } catch (err) {
      await this.rollback.rollback(snapshotId);
      throw { message: err.message, rollback: true, partialSuccess: createdRecords.length };
    }
  }

  parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      const record = {};
      headers.forEach((h, idx) => {
        record[h] = values[idx] || '';
      });
      records.push(record);
    }

    return records;
  }

  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  validateBatch(records, schema) {
    const valid = [];
    const errors = [];
    const requiredFields = (schema.fields || []).filter(f => f.required).map(f => f.fieldName);

    records.forEach((record, idx) => {
      const rowErrors = [];
      for (const field of requiredFields) {
        if (!record[field] && record[field] !== 0) {
          rowErrors.push(`缺少必填字段: ${field}`);
        }
      }

      if (rowErrors.length > 0) {
        errors.push({ row: idx + 2, message: rowErrors.join('; '), data: record });
      } else {
        valid.push(record);
      }
    });

    return { valid, errors };
  }
}

module.exports = BatchImportWorkflow;
