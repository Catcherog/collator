const { execSync } = require('child_process');

function listFiles(folderToken, name) {
    const url = `/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200&order_by=CreatedTime&direction=ASC`;
    
    try {
        const result = execSync(`lark-cli api GET "${url}" --as user`, { encoding: 'utf-8', timeout: 30000 });
        const data = JSON.parse(result);
        
        if (data.data && data.data.files) {
            console.log(`\n========== ${name} ==========`);
            console.log(`数量: ${data.data.files.length}`);
            
            const folders = [];
            data.data.files.forEach((file, i) => {
                const marker = file.type === 'folder' ? '📁' : '📄';
                console.log(`  ${i + 1}. ${marker} ${file.name} [${file.type}]`);
                if (file.type === 'folder') folders.push(file);
            });
            
            return folders;
        }
    } catch (e) {
        const err = e.stdout || e.message;
        console.log(`Error in ${name}:`, typeof err === 'string' ? err.substring(0, 200) : err);
    }
    return [];
}

console.log('正在递归读取源文件夹...\n');

const rootFiles = listFiles('TBSIfKniklXj0CdcnY8cSLIFnVd', 'ROOT - 源文件夹');
let depth = 1;

function recurse(folders, prefix) {
    for (const f of folders) {
        const subFolders = listFiles(f.token, `${prefix}${f.name}`);
        if (subFolders.length > 0 && depth < 4) {
            depth++;
            recurse(subFolders, prefix + '  ');
        }
    }
}

recurse(rootFiles, '');
console.log('\n✅ 读取完成');