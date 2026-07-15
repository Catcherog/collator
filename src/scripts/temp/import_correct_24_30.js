// TEMP: 修正导入24-30号作品(正确名称版本) | 2026-06-25 | 2026-06-28
const { execSync } = require('child_process');
const fs = require('fs');

const baseToken = 'MwGMbF0Q0alPc6s3jOccovvOnob';
const tableId = 'tblho2dCpIDAonuc';
const url = 'https://pcnafnwqcuzo.feishu.cn/drive/folder/K9QEfQJCkli462dHDLxcP5K9n7d';

const names = [
    '24_\u975e\u552f\u96c5\u97f5',
    '25_\u7946\u98ce\u6e05\u5f71',
    '26_\u68a8\u82b1\u5411\u665a',
    '27_\u6c49\u6587\u5deb\u5e05',
    '28_\u590f\u5408\u6665\u601d',
    '29_\u58a8\u97f5\u65d7\u888d',
    '30_\u4e8c\u6708\u5170\u82b3'
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    let successCount = 0;
    
    for (const name of names) {
        const recordData = {
            fld3SES6vU: name,
            fldTLrsrvN: url,
            fldZBkMivb: '\u5df2\u5f52\u6863',
            fldXm5vKJO: '\u521d\u7b5b\u6210\u7247'
        };
        
        const jsonFile = `temp_${names.indexOf(name)}.json`;
        fs.writeFileSync(jsonFile, JSON.stringify(recordData), 'utf8');
        
        try {
            execSync(
                `lark-cli base +record-upsert --base-token ${baseToken} --table-id ${tableId} --as user --json @${jsonFile}`,
                { encoding: 'utf-8', timeout: 30000 }
            );
            console.log(`✅ ${name}`);
            successCount++;
        } catch (e) {
            console.log(`❌ ${name}: ${e.stdout?.substring(0, 100) || e.message}`);
        }
        
        try { fs.unlinkSync(jsonFile); } catch(e) {}
        await sleep(500);
    }
    
    console.log(`\n=== 完成: ${successCount}/${names.length} ===`);
}

run();
