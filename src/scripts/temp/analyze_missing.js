// TEMP: 分析作品文件迁移遗漏原因(特定迁移任务调试) | 2026-06-25 | 2026-06-28
const { execSync } = require('child_process');

console.log('=== 遗漏原因分析 ===\n');

const foldersToCheck = [
    { token: 'TBSIfKniklXj0CdcnY8cSLIFnVd', name: '源文件夹(原始链接)' },
    { token: 'K9QEfQJCkli462dHDLxcP5K9n7d', name: '目标文件夹(移动后)' },
];

for (const folder of foldersToCheck) {
    console.log(`\n--- 检查: ${folder.name} (${folder.token}) ---`);
    
    try {
        const url = `/open-apis/drive/v1/files?folder_token=${folder.token}&page_size=200`;
        const result = execSync(`lark-cli api GET "${url}" --as user`, { encoding: 'utf-8', timeout: 30000 });
        const data = JSON.parse(result);
        
        if (data.data && data.data.files) {
            console.log(`API 返回文件数: ${data.data.files.length}`);
            console.log(`has_more: ${data.data.has_more}`);
            
            data.data.files.forEach((f, i) => {
                console.log(`  ${i + 1}. [${f.type}] ${f.name}`);
                
                if (f.type === 'folder' && f.name.includes('作品')) {
                    console.log(`     ↑ 这是作品相关文件夹，token: ${f.token}`);
                }
            });
        }
    } catch (e) {
        console.log('Error:', e.stdout?.substring(0, 200));
    }
}

console.log('\n=== 结论 ===');
console.log('Web页面显示的是"作品"子文件夹的内容');
console.log('但 API list 接口返回的是父目录，包含多个子文件夹');
console.log('需要递归进入"样片与作品库 > 作品外部" 才能看到全部30个文件');
