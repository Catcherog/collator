// TEMP: 图片下载脚本 - 从飞书下载嵌入图片 | 2026-06-25 | 预计删除日期 2026-06-28
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');

console.log('📥 Step 2: Downloading images from Feishu...\n');

try {
  const imagesInfo = JSON.parse(fs.readFileSync('./images_info.json', 'utf8'));
  
  console.log(`Total images to download: ${imagesInfo.length}\n`);
  
  const tempDir = './temp_images';
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`✅ Created temp directory: ${tempDir}`);
  }
  
  let successCount = 0;
  let failCount = 0;
  const downloadedImages = [];
  
  for (let i = 0; i < imagesInfo.length; i++) {
    const img = imagesInfo[i];
    const fileName = `${img.wechat}_${img.columnName}_${i + 1}.jpg`;
    const filePath = path.join(tempDir, fileName);
    
    console.log(`[${i + 1}/${imagesInfo.length}] Downloading: ${fileName}`);
    console.log(`    FileToken: ${img.fileToken}`);
    
    try {
      const downloadApiPath = `/open-apis/drive/v1/medias/${img.fileToken}/download`;
      
      const cmd = `lark-cli api GET "${downloadApiPath}" --output "${filePath}"`;
      
      execSync(cmd, { 
        encoding: 'utf8', 
        maxBuffer: 50 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        const fileSize = (fs.statSync(filePath).size / 1024).toFixed(2);
        console.log(`    ✅ Success! Size: ${fileSize}KB`);
        
        downloadedImages.push({
          ...img,
          localPath: filePath,
          fileName: fileName,
          fileSize: fileSize
        });
        
        successCount++;
      } else {
        console.log(`    ❌ Failed: File not created or empty`);
        failCount++;
      }
      
    } catch (downloadError) {
      console.error(`    ❌ Download error: ${downloadError.message?.substring(0, 100)}`);
      failCount++;
    }
    
    if (i < imagesInfo.length - 1) {
      setTimeout(() => {}, 500);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Download Summary');
  console.log('='.repeat(60));
  console.log(`   ✅ Successful: ${successCount}/${imagesInfo.length}`);
  console.log(`   ❌ Failed:     ${failCount}/${imagesInfo.length}`);
  console.log('='.repeat(60));
  
  if (downloadedImages.length > 0) {
    fs.writeFileSync('./downloaded_images.json', JSON.stringify(downloadedImages, null, 2));
    console.log(`\n💾 Download info saved to: downloaded_images.json`);
    console.log(`📁 Images saved in: ${tempDir}/`);
  }
  
} catch (error) {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
}