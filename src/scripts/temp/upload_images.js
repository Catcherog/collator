// TEMP: 图片上传脚本 - 上传图片到目标飞书表格 | 2026-06-25 | 预计删除日期 2026-06-28
const fs = require('fs');
const { execSync } = require('child_process');

console.log('📤 Step 3: Uploading images to target spreadsheet (using drive +upload)...\n');

try {
  const downloadedImages = JSON.parse(fs.readFileSync('./downloaded_images.json', 'utf8'));
  
  console.log(`Total images to upload: ${downloadedImages.length}\n`);
  
  const uploadedImages = [];
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < downloadedImages.length; i++) {
    const img = downloadedImages[i];
    
    console.log(`[${i + 1}/${downloadedImages.length}] Uploading: ${img.fileName}`);
    console.log(`    Local file: ${img.localPath}`);
    
    try {
      const cmd = `lark-cli drive +upload --file "${img.localPath}" --parent-type spreadsheet --parent-node "NMoisfXOrhZVFft7322c8CWYnTb"`;
      
      const result = execSync(cmd, { 
        encoding: 'utf8', 
        maxBuffer: 50 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      try {
        const responseJson = JSON.parse(result);
        
        if (responseJson.ok === true || responseJson.code === 0) {
          const newFileToken = responseJson.data?.fileToken || 
                             responseJson.data?.file_token ||
                             responseJson.file_token;
          
          console.log(`    ✅ Upload successful!`);
          if (newFileToken) {
            console.log(`    New FileToken: ${newFileToken}`);
          }
          
          uploadedImages.push({
            ...img,
            newFileToken: newFileToken,
            uploadSuccess: true
          });
          
          successCount++;
        } else {
          console.log(`    ❌ API error: ${JSON.stringify(responseJson).substring(0, 200)}`);
          failCount++;
        }
        
      } catch (parseError) {
        const resultStr = result.substring(0, 300);
        if (resultStr.includes('"ok":true') || resultStr.includes('fileToken') || resultStr.includes('file_token')) {
          console.log(`    ✅ Upload successful (raw output)!`);
          
          const tokenMatch = result.match(/"fileToken"\s*:\s*"([^"]+)"/) || 
                           result.match(/"file_token"\s*:\s*"([^"]+)"/);
          const newFileToken = tokenMatch ? tokenMatch[1] : null;
          
          uploadedImages.push({
            ...img,
            newFileToken: newFileToken,
            uploadSuccess: true
          });
          
          successCount++;
        } else {
          console.log(`    ⚠️ Could not parse response: ${resultStr}`);
          failCount++;
        }
      }
      
    } catch (uploadError) {
      console.error(`    ❌ Upload error: ${uploadError.message?.substring(0, 150)}`);
      failCount++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Upload Summary');
  console.log('='.repeat(60));
  console.log(`   ✅ Successful: ${successCount}/${downloadedImages.length}`);
  console.log(`   ❌ Failed:     ${failCount}/${downloadedImages.length}`);
  console.log('='.repeat(60));
  
  if (uploadedImages.length > 0) {
    fs.writeFileSync('./uploaded_images.json', JSON.stringify(uploadedImages, null, 2));
    console.log(`\n💾 Upload info saved to: uploaded_images.json`);
  }
  
} catch (error) {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
}