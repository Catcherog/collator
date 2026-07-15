// TEMP: v4版本导入23个作品(JS版本，带临时文件写入) | 2026-06-25 | 2026-06-28
const { execSync } = require('child_process');
const fs = require('fs');

const baseToken = 'MwGMbF0Q0alPc6s3jOccovvOnob';
const tableId = 'tblho2dCpIDAonuc';
const url = 'https://pcnafnwqcuzo.feishu.cn/drive/folder/K9QEfQJCkli462dHDLxcP5K9n7d';

const names = [
    '01_法喜禅影', '02_高丽梵音', '03_观音法相', '04_郭庄园韵', '05_九溪清幽',
    '06_虎跑春泉', '07_颐和御景', '08_园博眷影', '09_洱海苍山', '10_蛮丽楼阁',
    '11_故宫俪影', '12_文庙巾帼', '13_茶馆雅集', '14_红墙光影', '15_水乡婚典',
    '16_杏花疏影', '17_与光同尘', '18_素裙清影', '19_红妆倩影', '20_蝶昏暮影',
    '21_宋画含春', '22_海上芳时', '23_蔷薇油画'
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
