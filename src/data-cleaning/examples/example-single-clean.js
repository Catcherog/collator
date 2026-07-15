const path = require('path');
const dc = require(path.join(__dirname, '..', 'index'));

dc.init();

console.log('=== 单条客户数据清洗示例 ===\n');

const customerData = {
  '客户姓名': '  张三  ',
  '联系方式': '138-0013-8000',
  '意向风格': '小清新',
  '预算区间': '3000多',
  '咨询时间': '今天',
  '来源渠道': '朋友推荐',
  '跟进记录': '  想拍一套日系风格的写真  '
};

console.log('原始数据:');
console.log(JSON.stringify(customerData, null, 2));
console.log();

const cleaner = dc.createCleaner();
const cleanResult = cleaner.cleanRecord('customer', customerData, {
  tableName: 'customer',
  recordId: 'demo-001',
  operator: 'example'
});

console.log('清洗结果:');
console.log('  成功:', cleanResult.success);
console.log('  清洗后数据:');
console.log(JSON.stringify(cleanResult.data, null, 2));
console.log();

if (cleanResult.corrections.length > 0) {
  console.log('自动修正记录:');
  for (const corr of cleanResult.corrections) {
    console.log(`  - ${corr.field}: "${corr.original}" → "${corr.corrected}" (${corr.reason})`);
  }
  console.log();
}

if (cleanResult.warnings.length > 0) {
  console.log('警告信息:');
  for (const warn of cleanResult.warnings) {
    console.log(`  - ${warn}`);
  }
  console.log();
}

if (cleanResult.errors.length > 0) {
  console.log('错误信息:');
  for (const err of cleanResult.errors) {
    console.log(`  - ${err}`);
  }
  console.log();
}

const scorer = dc.createQualityScorer();
const validationResult = dc.validateRecord('customer', cleanResult.data);
const qualityResult = scorer.score('customer', cleanResult.data, validationResult);

console.log('质量评分:');
console.log(`  分数: ${qualityResult.score}`);
console.log(`  等级: ${qualityResult.grade}`);
console.log(`  摘要: ${qualityResult.summary}`);
console.log();

if (qualityResult.deductions.length > 0) {
  console.log('扣分明细:');
  for (const ded of qualityResult.deductions.slice(0, 5)) {
    console.log(`  - ${ded.field}: -${ded.points}分 (${ded.reason})`);
    if (ded.suggestion) {
      console.log(`    建议: ${ded.suggestion}`);
    }
  }
  console.log();
}

if (qualityResult.suggestions.length > 0) {
  console.log('改进建议:');
  for (const sug of qualityResult.suggestions.slice(0, 3)) {
    console.log(`  - ${sug}`);
  }
  console.log();
}

console.log('=== 示例完成 ===');
