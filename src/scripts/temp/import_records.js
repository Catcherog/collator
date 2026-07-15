// TEMP: 导入23个作品记录(JS版本，硬编码作品列表) | 2026-06-25 | 2026-06-28
const { execSync } = require('child_process');

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
    for (const name of names) {
        const fields = {
            fld3SES6vU: name,
            fldTLrsrvN: url,
            fldZBkMivb: '\u5DF2\u5F52\u6863',
            fldXm5vKJO: '\u521D\u7B5B\u6210\u7247'
        };
        const body = JSON.stringify({ fields });
        const escapedBody = body.replace(/"/g, '\\"');
        
        try {
            const result = execSync(
                `lark-cli base +record-upsert --base-token ${baseToken} --table-id ${tableId} --as user --json "${escapedBody}"`,
                { encoding: 'utf-8', timeout: 30000 }
            );
            console.log(`✓ ${name}: ${result.substring(0, 80)}`);
        } catch (e) {
            const errOut = e.stdout ? e.stdout.substring(0, 100) : e.message;
            console.log(`✗ ${name}: ${errOut}`);
        }
        
        await sleep(500);
    }
    console.log('\nDone! Created records.');
}

run();
