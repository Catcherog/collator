import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function loadEnvFile(path) {
  const env = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[line.slice(0, eq).trim()] = value;
  }
  return env;
}

const env = loadEnvFile('D:/360Downloads/Trae 项目/lark/collator-internal-write-r1/.env');
Object.assign(process.env, env);

const { FeishuClient } = await import(pathToFileURL('D:/360Downloads/Trae 项目/lark/collator/dist/server/feishu/feishu-client.js').href);
const client = new FeishuClient({
  appId: env.FEISHU_APP_ID,
  appSecret: env.FEISHU_APP_SECRET,
  baseToken: env.FEISHU_BASE_APP_TOKEN,
});

const ingestionId = 'famp-r3-probe-1785864274945-d3e18cc2';
const tableId = env.FEISHU_CUSTOMER_TABLE_ID;
const records = await client.searchRecords(tableId, {
  filter: {
    conjunction: 'and',
    conditions: [{
      field_name: env.FEISHU_CUSTOMER_WRITE_KEY_FIELD?.trim() || 'Collator 摄入 ID',
      operator: 'is',
      value: [ingestionId],
    }],
  },
  page_size: 10,
});
console.log('found orphan customer records:', records.length);
for (const r of records) {
  await client.deleteRecord(tableId, r.record_id);
  console.log('deleted', r.record_id);
}
