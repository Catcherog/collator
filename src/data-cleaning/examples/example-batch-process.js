const path = require('path');
const dc = require(path.join(__dirname, '..', 'index'));

dc.init();

console.log('=== 批量数据处理示例 ===\n');

function generateTestData() {
  const names = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十', '郑一', '王二',
                 '李小红', '张明', '王芳', '刘洋', '陈静', '杨帆', '黄磊', '周杰', '吴涛', '徐丽'];
  
  const phones = [
    '13800138000', '139-0013-9000', '137 0013 7000', '13600136000', '135-0013-5000',
    '13400134000', '133 0013 3000', 'invalid-phone', '13200132000', '131-0013-1000',
    '13000130000', '189 0018 9000', '188-0018-8000', '18700187000', '186-0018-6000',
    '18500185000', '184 0018 4000', '183-0018-3000', '', '18100181000'
  ];
  
  const styles = [
    ['日系清新'], ['韩系唯美'], ['日系清新', '复古胶片'], ['小清新'],
    ['暗调情绪'], ['法式浪漫'], ['日系', '韩系'], ['复古'],
    ['国潮古风'], ['浪漫法式'], ['日系清新'], ['韩系唯美'],
    ['暗调'], ['胶片复古'], ['清新'], ['唯美韩系'],
    ['国潮'], ['情绪片'], ['日系清新', '韩系唯美'], ['创作片风格']
  ];
  
  const budgets = [
    '3000-5000元', '5000以上', '2000多', '3000左右', '5k-8k',
    '1000以下', '8k-1w', '3500', '六千左右', '4k多',
    '2-3千', '5000元', '一万以上', '1k多', '8000多',
    '4500', '7k', '两千左右', '3千-5千', '6000以上'
  ];
  
  const sources = ['小红书', '抖音', '朋友推荐', '朋友圈', '老客转介绍', '视频号', '线下', '其他',
                   '小红薯', 'douyin', '微信朋友圈', '转介绍', '视频号推荐', '实体门店', '小红书推荐'];
  
  const data = [];
  for (let i = 0; i < 20; i++) {
    const record = {
      '客户姓名': '  ' + names[i] + '  ',
      '联系方式': phones[i]
    };
    
    if (i % 3 !== 0) {
      record['意向风格'] = styles[i];
    }
    if (i % 4 !== 0) {
      record['预算区间'] = budgets[i];
    }
    if (i % 2 === 0) {
      record['来源渠道'] = sources[i % sources.length];
    }
    if (i % 5 === 0) {
      record['咨询时间'] = '今天';
    }
    
    data.push(record);
  }
  
  return data;
}

const testData = generateTestData();
console.log(`已生成 ${testData.length} 条测试数据\n`);

async function runBatch() {
  const processor = dc.createBatchProcessor({
    loggerOptions: { logDir: path.join(__dirname, '..', 'logs-test', 'batch-example') }
  });
  
  console.log('开始批量处理...\n');
  
  const batchResult = await processor.processBatch('customer', testData, {
    onProgress: (progress) => {
      if (progress.processed % 5 === 0 || progress.processed === progress.total) {
        process.stdout.write(`\r处理进度: ${progress.percent}% (${progress.processed}/${progress.total})`);
      }
    }
  });
  
  console.log('\n\n处理完成!\n');
  
  console.log('=== 质量报告 ===');
  const report = processor.generateReport(batchResult);
  console.log(report);
  
  console.log('\n=== 可写入记录 (passed + warning) ===');
  const writable = processor.getWritableRecords(batchResult, true);
  console.log(`可写入记录数: ${writable.length}`);
  if (writable.length > 0) {
    console.log('前3条预览:');
    for (let i = 0; i < Math.min(3, writable.length); i++) {
      const r = writable[i];
      console.log(`  #${r.index + 1}: ${r.data['客户姓名']} / ${r.data['联系方式']} - ${r.status} (${r.quality.score}分)`);
    }
  }
  
  console.log('\n=== 失败记录 ===');
  const failed = processor.getFailedRecords(batchResult);
  console.log(`失败记录数: ${failed.length}`);
  for (const r of failed) {
    const firstError = r.errors[0];
    console.log(`  #${r.index + 1}: ${firstError ? firstError.message : '未知错误'}`);
  }
  
  console.log('\n=== 分块写入准备 ===');
  const partitioned = processor.partitionForWriting(batchResult, true, 10);
  console.log(`总可写入: ${partitioned.totalWritable}条`);
  console.log(`分块数: ${partitioned.chunks.length}块 (每块${partitioned.chunkSize}条)`);
  for (let i = 0; i < partitioned.chunks.length; i++) {
    console.log(`  块${i + 1}: ${partitioned.chunks[i].length}条`);
  }
  
  console.log('\n=== 批量处理示例完成 ===');
}

runBatch().catch(err => {
  console.error('批量处理失败:', err);
  process.exit(1);
});
