// TEMP: 检查素材管理表当前所有记录(一次性调试查询) | 2026-06-25 | 2026-06-28
const { execSync } = require('child_process');

const baseToken = 'MwGMbF0Q0alPc6s3jOccovvOnob';
const tableId = 'tblho2dCpIDAonuc';

try {
    const result = execSync(
        `lark-cli base +record-list --base-token ${baseToken} --table-id ${tableId} --as user --limit 50`,
        { encoding: 'utf-8', timeout: 30000 }
    );
    const data = JSON.parse(result);
    
    if (data.data && data.data.items) {
        console.log(`=== 当前所有记录 (共${data.data.items.length}条) ===\n`);
        
        data.data.items.forEach((item, i) => {
            const fields = item.fields || {};
            const name = fields.fld3SES6vU || '(空)';
            console.log(`${i + 1}. ${name} | ID: ${item.record_id}`);
        });
    }
} catch (e) {
    console.log('Error:', e.stdout?.substring(0, 500) || e.message);
}
