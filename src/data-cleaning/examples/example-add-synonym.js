const path = require('path');
const fs = require('fs');
const dc = require(path.join(__dirname, '..', 'index'));

dc.init();

console.log('=== 同义词学习示例 ===\n');

const exampleDataDir = path.join(__dirname, '..', 'data', 'example-learning');
const exampleConfigDir = path.join(__dirname, '..', 'config', 'example-learning');

if (!fs.existsSync(exampleDataDir)) {
  fs.mkdirSync(exampleDataDir, { recursive: true });
}
if (!fs.existsSync(exampleConfigDir)) {
  fs.mkdirSync(exampleConfigDir, { recursive: true });
}

const emptySynonyms = {
  version: '1.0.0',
  description: '示例同义词库',
  lastUpdated: new Date().toISOString().split('T')[0],
  styleSynonyms: {
    '日系清新': ['小清新', '清新', '日系']
  },
  shootTypeMapping: {},
  sourceChannelMapping: {},
  budgetRangeMapping: {},
  timeExpressionMapping: {}
};

fs.writeFileSync(path.join(exampleConfigDir, 'synonyms.json'), JSON.stringify(emptySynonyms, null, 2), 'utf8');

const learner = dc.createRuleLearner({
  configDir: exampleConfigDir,
  dataDir: exampleDataDir,
  synonymsPath: path.join(exampleConfigDir, 'synonyms.json')
});

console.log('当前同义词库:');
const lib = learner.getSynonymLibrary();
console.log('  风格同义词:', JSON.stringify(lib.styleSynonyms, null, 2).split('\n').join('\n  '));
console.log();

console.log('=== 步骤1: 记录用户反馈 ===');
const feedbacks = [
  { category: 'style_synonym', originalValue: '唯美', correctedValue: '韩系唯美', fieldName: '意向风格', accepted: true },
  { category: 'style_synonym', originalValue: '唯美', correctedValue: '韩系唯美', fieldName: '意向风格', accepted: true },
  { category: 'style_synonym', originalValue: '唯美', correctedValue: '韩系唯美', fieldName: '意向风格', accepted: true },
  { category: 'style_synonym', originalValue: '胶片', correctedValue: '复古胶片', fieldName: '意向风格', accepted: true },
  { category: 'style_synonym', originalValue: '胶片', correctedValue: '复古胶片', fieldName: '意向风格', accepted: true },
  { category: 'source_channel', originalValue: '小红薯', correctedValue: '小红书', fieldName: '来源渠道', accepted: true },
  { category: 'source_channel', originalValue: '小红薯', correctedValue: '小红书', fieldName: '来源渠道', accepted: true },
  { category: 'source_channel', originalValue: '小红薯', correctedValue: '小红书', fieldName: '来源渠道', accepted: true }
];

for (const fb of feedbacks) {
  const result = learner.recordFeedback(fb);
  console.log(`  记录反馈: "${fb.originalValue}" → "${fb.correctedValue}" (${fb.category}) - ${result.success ? '成功' : '失败'}`);
}
console.log(`共记录 ${feedbacks.length} 条反馈\n`);

console.log('=== 步骤2: 查看建议规则 ===');
const suggestions = learner.getSuggestedRules(2);
console.log(`发现 ${suggestions.length} 条建议规则 (最少出现2次):`);
for (const sug of suggestions) {
  console.log(`  - [${sug.category}] "${sug.originalValue}" → "${sug.suggestedValue}" (出现${sug.count}次, 置信度${sug.confidence})`);
  console.log(`    字段: ${sug.fieldNames.join(', ')}`);
}
console.log();

console.log('=== 步骤3: 手动添加新同义词 ===');
const addResult1 = learner.addSynonym('styleSynonyms', '法式浪漫', '浪漫');
console.log(`  添加"浪漫"→"法式浪漫": ${addResult1.added ? '成功' : '已存在'}`);

const addResult2 = learner.addSynonym('styleSynonyms', '法式浪漫', '法式');
console.log(`  添加"法式"→"法式浪漫": ${addResult2.added ? '成功' : '已存在'}`);

const addResult3 = learner.addSynonym('sourceChannelMapping', '老客转介绍', '朋友推荐');
console.log(`  添加"朋友推荐"→"老客转介绍" (来源渠道): ${addResult3.added ? '成功' : '已存在'}`);
console.log();

console.log('=== 步骤4: 应用建议规则 ===');
for (const sug of suggestions) {
  const applyResult = learner.applySuggestion(sug);
  console.log(`  应用建议 "${sug.originalValue}"→"${sug.suggestedValue}": ${applyResult.success ? '成功' : '失败'}`);
}
console.log();

console.log('=== 更新后的同义词库 ===');
const updatedLib = learner.getSynonymLibrary();
console.log('  风格同义词:');
for (const [style, syns] of Object.entries(updatedLib.styleSynonyms)) {
  console.log(`    ${style}: ${Array.isArray(syns) ? syns.join(', ') : JSON.stringify(syns)}`);
}
console.log('  来源渠道映射:');
for (const [channel, syns] of Object.entries(updatedLib.sourceChannelMapping)) {
  console.log(`    ${channel}: ${Array.isArray(syns) ? syns.join(', ') : JSON.stringify(syns)}`);
}
console.log();

console.log('=== 版本历史 ===');
const versions = learner.getVersionHistory();
console.log(`共有 ${versions.length} 个版本:`);
for (const v of versions.slice(0, 5)) {
  console.log(`  - ${v.filename} (${v.createdAt}, ${v.size} bytes)`);
}
console.log();

console.log('=== 测试新同义词生效 ===');
const testData = {
  '客户姓名': '测试用户',
  '联系方式': '13800138000',
  '意向风格': '唯美',
  '来源渠道': '小红薯'
};

const cleaner = dc.createCleaner();
const result = cleaner.cleanRecord('customer', testData);
console.log('输入:', JSON.stringify(testData));
console.log('清洗后意向风格:', result.data['意向风格']);
console.log('清洗后来源渠道:', result.data['来源渠道']);
console.log('自动修正:');
for (const corr of result.corrections) {
  console.log(`  ${corr.field}: "${corr.original}" → "${corr.corrected}" (${corr.reason}, 置信度${corr.confidence || 'N/A'})`);
}
console.log();

console.log('=== 同义词学习示例完成 ===');
