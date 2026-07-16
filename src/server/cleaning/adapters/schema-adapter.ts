// schema-adapter.ts
// 按需读取 schema JSON，不 import src/data-cleaning/schemas/index.js，避免 import-time 副作用。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'src', 'data-cleaning', 'schemas');

export interface SchemaField {
  fieldName: string;
  fieldId: string;
  type: string;
  required: boolean;
  enumValues: string[];
  description?: string;
}

export interface CustomerSchemaConfig {
  tableId: string;
  tableName: string;
  primaryKey: {
    fieldId: string;
    fieldName: string;
    format: string;
  };
  fields: SchemaField[];
  relations: Array<{
    relationField: string;
    targetTable: string;
    targetField: string;
    relationType: string;
    description?: string;
  }>;
}

let customerSchemaCache: CustomerSchemaConfig | null = null;

export function loadCustomerSchema(): CustomerSchemaConfig {
  if (customerSchemaCache) {
    return customerSchemaCache;
  }
  const filePath = path.join(SCHEMA_ROOT, 'customer.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as CustomerSchemaConfig;
  customerSchemaCache = parsed;
  return parsed;
}

export function clearCustomerSchemaCache(): void {
  customerSchemaCache = null;
}

export function getFieldSchema(schemaKey: string, fieldName: string): SchemaField | undefined {
  if (schemaKey !== 'customer') {
    return undefined;
  }
  const schema = loadCustomerSchema();
  return schema.fields.find(f => f.fieldName === fieldName);
}

export function getRequiredFields(schemaKey: string): SchemaField[] {
  if (schemaKey !== 'customer') {
    return [];
  }
  const schema = loadCustomerSchema();
  return schema.fields.filter(f => f.required);
}

export function getEnumFields(schemaKey: string): SchemaField[] {
  if (schemaKey !== 'customer') {
    return [];
  }
  const schema = loadCustomerSchema();
  return schema.fields.filter(f => f.enumValues && f.enumValues.length > 0);
}
