// TEMP: 删除24-30号错误导入的作品记录(一次性数据修复) | 2026-06-25 | 2026-06-28
const { execSync } = require('child_process');

const baseToken = 'MwGMbF0Q0alPc6s3jOccovvOnob';
const tableId = 'tblho2dCpIDAonuc';

try {
    const result = execSync(
        `lark-cli base +record-list --base-token ${baseToken} --table-id ${tableId} --as user --limit 50`,
        { encoding: 'utf-8', timeout: 30000 }
    );
    const data = JSON.parse(result);
    
    const recordIds = data.data?.record_id_list || [];
    const records = data.data?.data || [];
    
    console.log('=== 需要删除的24-30记录 ===\n');
    
    const toDelete = [];
    for (let i = 23; i < Math.min(30, records.length); i++) {
        const name = records[i][2];
        const id = recordIds[i];
        console.log(`${i + 1}. ${name} (ID: ${id})`);
        toDelete.push(id);
    }
    
    console.log(`\n共 ${toDelete.length} 条，正在删除...\n`);
    
    for (const id of toDelete) {
        try {
            execSync(
                `lark-cli base +record-delete --base-token ${baseToken} --table-id ${tableId} --record-id ${id} --as user --yes`,
                { encoding: 'utf-8', timeout: 15000 }
            );
            console.log(`✓ 删除成功: ${id}`);
        } catch (e) {
            console.log(`✗ 删除失败: ${id}`);
        }
    }
    
    console.log('\n✅ 完成！');
} catch (e) {
    console.log('Error:', e.stdout || e.message);
}
