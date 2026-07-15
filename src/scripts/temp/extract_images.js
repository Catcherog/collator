// TEMP: 图片信息提取脚本 - 从源飞书表格提取嵌入图片元数据 | 2026-06-25 | 预计删除日期 2026-06-28
const fs = require('fs');
const { execSync } = require('child_process');

console.log('📸 Step 1: Extracting image information from source sheet...\n');

try {
  const sourceData = execSync(
    'lark-cli sheets +read --url "https://pcnafnwqcuzo.feishu.cn/sheets/R4STsa1GlhrvMstFhgCc3YkEned" --sheet-id "08d824" --range "A2:H196"',
    { encoding: 'utf8' }
  );
  
  const sourceJson = JSON.parse(sourceData);
  const rows = sourceJson.data.valueRange.values;
  
  console.log(`Total rows scanned: ${rows.length}`);
  
  const imagesInfo = [];
  
  rows.forEach((row, rowIndex) => {
    const rowNum = rowIndex + 2;
    
    if (row[0] === null || row[0] === undefined) return;
    
    const wechat = row[0];
    
    row.forEach((cell, colIndex) => {
      if (cell && typeof cell === 'object') {
        if (Array.isArray(cell)) {
          cell.forEach(item => {
            if (item && item.type === 'embed-image' && item.fileToken) {
              imagesInfo.push({
                row: rowNum,
                column: String.fromCharCode(65 + colIndex),
                columnName: ['微信', '报价', '地点', '优先级', '档期', '备注', '小红书', '作品'][colIndex],
                wechat: wechat,
                fileToken: item.fileToken,
                width: item.width,
                height: item.height,
                name: item.name || `image_${rowNum}_${String.fromCharCode(65 + colIndex)}.jpg`
              });
            }
          });
        } else if (cell.type === 'embed-image' && cell.fileToken) {
          imagesInfo.push({
            row: rowNum,
            column: String.fromCharCode(65 + colIndex),
            columnName: ['微信', '报价', '地点', '优先级', '档期', '备注', '小红书', '作品'][colIndex],
            wechat: wechat,
            fileToken: cell.fileToken,
            width: cell.width,
            height: cell.height,
            name: cell.name || `image_${rowNum}_${String.fromCharCode(65 + colIndex)}.jpg`
          });
        }
      }
    });
  });
  
  console.log(`\n✅ Found ${imagesInfo.length} images in source data\n`);
  
  if (imagesInfo.length > 0) {
    console.log('📋 Image Details:');
    console.log('-'.repeat(80));
    
    imagesInfo.forEach((img, idx) => {
      console.log(`\n[${idx + 1}] Row ${img.row}, Column ${img.column} (${img.columnName})`);
      console.log(`    WeChat: ${img.wechat}`);
      console.log(`    FileToken: ${img.fileToken.substring(0, 20)}...`);
      console.log(`    Size: ${img.width}x${img.height}px`);
      console.log(`    Name: ${img.name}`);
    });
    
    fs.writeFileSync('./images_info.json', JSON.stringify(imagesInfo, null, 2));
    console.log(`\n\n💾 Image metadata saved to: images_info.json`);
  } else {
    console.log('⚠️ No embed-image objects found in the source data');
    console.log('   Images may be stored as URLs or in a different format');
  }
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}