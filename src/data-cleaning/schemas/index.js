const path = require('path');
const fs = require('fs');

const schemasDir = __dirname;

const schemaFiles = {
  customer: 'customer.json',
  project: 'project.json',
  product: 'product.json',
  resource: 'resource.json',
  material: 'material.json',
  research: 'research.json',
  sop: 'sop.json'
};

let cachedSchemas = null;

function loadSchema(filename) {
  const filePath = path.join(schemasDir, filename);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load schema ${filename}:`, error.message);
    return null;
  }
}

function loadAllSchemas() {
  if (cachedSchemas) {
    return cachedSchemas;
  }

  const schemas = {};
  for (const [key, filename] of Object.entries(schemaFiles)) {
    schemas[key] = loadSchema(filename);
  }

  cachedSchemas = {
    ...schemas,
    byTableId: {},
    byTableName: {},
    loadedAt: new Date().toISOString()
  };

  for (const schema of Object.values(schemas)) {
    if (schema) {
      cachedSchemas.byTableId[schema.tableId] = schema;
      cachedSchemas.byTableName[schema.tableName] = schema;
    }
  }

  return cachedSchemas;
}

function getSchema(key) {
  const schemas = loadAllSchemas();
  return schemas[key] || null;
}

function getSchemaByTableId(tableId) {
  const schemas = loadAllSchemas();
  return schemas.byTableId[tableId] || null;
}

function getSchemaByTableName(tableName) {
  const schemas = loadAllSchemas();
  return schemas.byTableName[tableName] || null;
}

function getFieldSchema(schemaKey, fieldName) {
  const schema = getSchema(schemaKey);
  if (!schema || !schema.fields) return null;
  return schema.fields.find(f => f.fieldName === fieldName) || null;
}

function getFieldByFieldId(schemaKey, fieldId) {
  const schema = getSchema(schemaKey);
  if (!schema || !schema.fields) return null;
  return schema.fields.find(f => f.fieldId === fieldId) || null;
}

function getRequiredFields(schemaKey) {
  const schema = getSchema(schemaKey);
  if (!schema || !schema.fields) return [];
  return schema.fields.filter(f => f.required);
}

function getEnumFields(schemaKey) {
  const schema = getSchema(schemaKey);
  if (!schema || !schema.fields) return [];
  return schema.fields.filter(f => f.enumValues && f.enumValues.length > 0);
}

function clearCache() {
  cachedSchemas = null;
}

module.exports = {
  loadAllSchemas,
  getSchema,
  getSchemaByTableId,
  getSchemaByTableName,
  getFieldSchema,
  getFieldByFieldId,
  getRequiredFields,
  getEnumFields,
  clearCache,
  schemaFiles
};
