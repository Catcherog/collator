// TEMP: 导入24-30号作品(第一版错误数据) | 2026-06-25 | 2026-06-28
const { execSync } = require('child_process');
const fs = require('fs');

const baseToken = 'MwGMbF0Q0alPc6s3jOccovvOnob';
const tableId = 'tblho2dCpIDAonuc';
const url = 'https://pcnafnwqcuzo.feishu.cn/drive/folder/K9QEfQJCkli462dHDLxcP5K9n7d';

const names = [
    '24_江南烟雨',
    '25_水墨丹青',
    '26_琴瑟和鸣',
    '27_花开富贵',
    '28_竹影清风',
    '29_月色如水',
    '30_锦绣中华'
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    let successCount = 0;
    let failCount = 0;
    
    for (const name of names) {
        const recordData = {
            fld3SES6vU: name,
            fldTLrsrvN: url,
            fldZBkMivb: '\u5DF2\u5F52\u6863',
            fldXm5vKJO: '\u521D\u7B5B\u6210\u7247'
        };
        
        const jsonFile = `temp_record_${names.indexOf(name)}.json`;
        fs.writeFileSync(jsonFile, JSON.stringify(recordData), 'utf8');
        
        try {
            const result = execSync(
                `lark-cli base +record-upsert --base-token ${baseToken} --table-id ${tableId} --as user --json @${jsonFile}`,
                { encoding: 'utf-8', timeout: 30000 }
            );
            console.log(`✓ ${name}`);
            successCount++;
        } catch (e) {
            const errOut = e.stdout ? e.stdout.substring(0, 150) : e.message;
            console.log(`✗ ${name}: ${errOut}`);
            failCount++;
        }
        
        try { fs.unlinkSync(jsonFile); } catch(e) {}
        await sleep(500);
    }
    
    console.log(`\n=== 完成 ===`);
    console.log(`成功: ${successCount}, 失败: ${failCount}, 总计: ${names.length}`);
}

run();
