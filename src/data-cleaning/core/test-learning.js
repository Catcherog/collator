const fs = require('fs');
const path = require('path');
const os = require('os');
const { RuleLearner } = require('./rule-learning');
const { OperationLogger } = require('./operation-logger');

let testDir;
let learner;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function setup() {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-learning-test-'));
  const configDir = path.join(testDir, 'config');
  const dataDir = path.join(testDir, 'data');
  const logsDir = path.join(testDir, 'logs');
  
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const initialSynonyms = {
    version: '1.0.0',
    description: '测试同义词库',
    lastUpdated: '2026-06-26',
    styleSynonyms: {
      '日系清新': ['日系', '清新']
    },
    shootTypeMapping: {},
    sourceChannelMapping: {},
    budgetRangeMapping: {},
    timeExpressionMapping: {}
  };
  fs.writeFileSync(path.join(configDir, 'synonyms.json'), JSON.stringify(initialSynonyms, null, 2), 'utf8');

  const logger = new OperationLogger({ logDir: logsDir });

  learner = new RuleLearner({
    configDir: configDir,
    dataDir: dataDir,
    synonymsPath: path.join(configDir, 'synonyms.json'),
    versionsDir: path.join(configDir, 'versions'),
    feedbackPath: path.join(dataDir, 'feedback.jsonl'),
    logger: logger
  });
}

function teardown() {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (e) {}
}

function testAddSynonymAndPersistence() {
  console.log('\n=== 测试1: 添加同义词并持久化保存 ===');
  
  const lib1 = learner.getSynonymLibrary();
  assert(
    lib1.styleSynonyms['日系清新'].includes('日系'),
    '初始同义词库包含已有同义词'
  );

  const result = learner.addSynonym('styleSynonyms', '日系清新', '森系');
  assert(result.success === true, '添加同义词成功');
  assert(result.added === true, '新同义词被标记为已添加');

  const lib2 = learner.getSynonymLibrary();
  assert(
    lib2.styleSynonyms['日系清新'].includes('森系'),
    '内存中同义词库包含新添加的"森系"'
  );

  const synonymsPath = path.join(testDir, 'config', 'synonyms.json');
  const savedContent = JSON.parse(fs.readFileSync(synonymsPath, 'utf8'));
  assert(
    savedContent.styleSynonyms['日系清新'].includes('森系'),
    '文件已持久化保存，包含"森系"'
  );

  const backupPath = synonymsPath + '.bak';
  assert(fs.existsSync(backupPath), '.bak备份文件已创建');
}

function testFeedbackAndSuggestions() {
  console.log('\n=== 测试2: 反馈记录与建议规则 ===');
  
  for (let i = 0; i < 3; i++) {
    learner.recordFeedback({
      category: 'style_synonym',
      originalValue: '校园风',
      correctedValue: '韩系唯美',
      tableName: 'customer',
      fieldName: 'style',
      operator: 'test_user'
    });
  }

  const feedbackPath = path.join(testDir, 'data', 'feedback.jsonl');
  assert(fs.existsSync(feedbackPath), '反馈文件已创建');
  
  const lines = fs.readFileSync(feedbackPath, 'utf8').trim().split('\n');
  assert(lines.length >= 3, '反馈文件包含至少3条记录');

  const suggestions = learner.getSuggestedRules(3);
  assert(suggestions.length >= 1, '返回至少1条建议');
  
  const campusSuggestion = suggestions.find(s => s.originalValue === '校园风');
  assert(campusSuggestion !== undefined, '找到"校园风"的建议');
  assert(campusSuggestion.suggestedValue === '韩系唯美', '建议目标值为"韩系唯美"');
  assert(campusSuggestion.count === 3, '建议计数为3');
  assert(campusSuggestion.confidence > 0, '置信度大于0');
}

function testVersionHistory() {
  console.log('\n=== 测试3: 版本备份与历史 ===');
  
  const versionsDir = path.join(testDir, 'config', 'versions');
  assert(fs.existsSync(versionsDir), 'versions目录已创建');
  
  const versionFiles = fs.readdirSync(versionsDir).filter(f => f.startsWith('synonyms-'));
  assert(versionFiles.length >= 1, '至少有1个版本备份文件');

  const history = learner.getVersionHistory();
  assert(history.length >= 1, 'getVersionHistory返回至少1个版本');
  assert(history[0].filename.startsWith('synonyms-'), '版本文件名格式正确');
  assert(history[0].createdAt !== undefined, '版本包含创建时间');
}

function testReload() {
  console.log('\n=== 测试4: 重新加载同义词库 ===');
  
  const synonymsPath = path.join(testDir, 'config', 'synonyms.json');
  const fileContent = JSON.parse(fs.readFileSync(synonymsPath, 'utf8'));
  assert(
    fileContent.styleSynonyms['日系清新'].includes('森系'),
    '文件中包含"森系"'
  );

  const learner2 = new RuleLearner({
    configDir: path.join(testDir, 'config'),
    dataDir: path.join(testDir, 'data'),
    logger: new OperationLogger({ logDir: path.join(testDir, 'logs') })
  });
  
  const lib = learner2.getSynonymLibrary();
  assert(
    lib.styleSynonyms['日系清新'].includes('森系'),
    '新实例重新加载后仍然包含"森系"'
  );
}

function testRollback() {
  console.log('\n=== 测试5: 版本回滚 ===');
  
  const history = learner.getVersionHistory();
  assert(history.length >= 1, '有版本可以回滚');

  learner.addSynonym('styleSynonyms', '日系清新', '测试词_临时');
  const libBeforeRollback = learner.getSynonymLibrary();
  assert(
    libBeforeRollback.styleSynonyms['日系清新'].includes('测试词_临时'),
    '临时测试词已添加'
  );

  const firstVersion = history[history.length - 1].filename;
  const rollbackResult = learner.rollback(firstVersion);
  assert(rollbackResult.success === true, '回滚操作成功');

  const libAfterRollback = learner.getSynonymLibrary();
  assert(
    !libAfterRollback.styleSynonyms['日系清新'].includes('测试词_临时'),
    '回滚后临时测试词已移除'
  );
}

function testDuplicateSynonym() {
  console.log('\n=== 测试6: 重复同义词不重复添加 ===');
  
  const result1 = learner.addSynonym('styleSynonyms', '日系清新', '森系');
  assert(result1.added === false, '重复添加同义词返回added: false');
}

function testApplySuggestion() {
  console.log('\n=== 测试7: 应用建议规则 ===');
  
  const suggestions = learner.getSuggestedRules(3);
  const campusSuggestion = suggestions.find(s => s.originalValue === '校园风');
  
  if (campusSuggestion) {
    const applyResult = learner.applySuggestion(campusSuggestion);
    assert(applyResult.success === true, '应用建议成功');
    
    const lib = learner.getSynonymLibrary();
    assert(
      lib.styleSynonyms['韩系唯美'] && lib.styleSynonyms['韩系唯美'].includes('校园风'),
      '应用建议后"校园风"已添加到"韩系唯美"的同义词'
    );
  } else {
    assert(false, '没有找到可应用的建议');
  }
}

function runTests() {
  console.log('========================================');
  console.log('  RuleLearner 模块测试');
  console.log('========================================');

  setup();

  try {
    testAddSynonymAndPersistence();
    testFeedbackAndSuggestions();
    testVersionHistory();
    testReload();
    testRollback();
    testDuplicateSynonym();
    testApplySuggestion();
  } catch (err) {
    console.log('\n  ✗ 测试执行出错:', err.message);
    console.log(err.stack);
    failed++;
  } finally {
    teardown();
  }

  console.log('\n========================================');
  console.log(`  测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('========================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
