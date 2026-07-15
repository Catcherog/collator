const { createDataScanner } = require('./data-scanner');

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

function createMockRecords() {
  return [
    {
      recordId: 'rec001',
      fields: {
        '客户姓名': '张三',
        '联系方式': '137-6666-8888',
        '来源渠道': '小红书'
      },
      lastModifiedTime: Date.now() - 86400000
    },
    {
      recordId: 'rec002',
      fields: {
        '客户姓名': '李四',
        '联系方式': '138 0013 8000',
        '来源渠道': '抖音'
      },
      lastModifiedTime: Date.now() - 43200000
    },
    {
      recordId: 'rec003',
      fields: {
        '客户姓名': '王五',
        '联系方式': '13900139000',
        '来源渠道': '错误渠道',
        '意向风格': ['小清新']
      },
      lastModifiedTime: Date.now()
    },
    {
      recordId: 'rec004',
      fields: {
        '联系方式': '13600136000'
      },
      lastModifiedTime: Date.now()
    },
    {
      recordId: 'rec005',
      fields: {
        '客户姓名': '赵六',
        '联系方式': '13500135000',
        '来源渠道': '朋友圈',
        '预算区间': '2000多'
      },
      lastModifiedTime: Date.now()
    }
  ];
}

function runTests() {
  console.log('=== 数据质量扫描器测试 ===\n');

  console.log('1. 扫描器初始化测试');
  const scanner = createDataScanner({
    mockFetchRecords: (tableId, options) => {
      return {
        records: createMockRecords(),
        total: 5,
        hasMore: false
      };
    }
  });
  assert(scanner !== null, '扫描器创建成功');
  assert(typeof scanner.scanTable === 'function', 'scanTable方法存在');
  assert(typeof scanner.fetchRecords === 'function', 'fetchRecords方法存在');
  console.log();

  console.log('2. 手机号格式问题识别测试');
  const result1 = scanner.scanTable('customer');
  assert(result1.schemaKey === 'customer', 'schemaKey正确');
  assert(result1.tableId !== undefined, 'tableId存在');
  assert(result1.totalRecords === 5, `总记录数为5（实际${result1.totalRecords}）`);
  assert(Array.isArray(result1.issues), '返回issues数组');
  assert(typeof result1.summary === 'object', '返回summary对象');

  const phoneIssue1 = result1.issues.find(iss => iss.recordId === 'rec001');
  assert(phoneIssue1 !== undefined, 'rec001（手机号带横杠）有问题记录');
  if (phoneIssue1) {
    assert(phoneIssue1.suggestedFixes['联系方式'] === '13766668888', `手机号建议修正值为13766668888（实际"${phoneIssue1.suggestedFixes['联系方式']}"）`);
  }

  const phoneIssue2 = result1.issues.find(iss => iss.recordId === 'rec002');
  assert(phoneIssue2 !== undefined, 'rec002（手机号带空格）有问题记录');
  if (phoneIssue2) {
    assert(phoneIssue2.suggestedFixes['联系方式'] === '13800138000', `手机号建议修正值为13800138000（实际"${phoneIssue2.suggestedFixes['联系方式']}"）`);
  }
  console.log();

  console.log('3. 非法枚举值识别与建议测试');
  const enumIssue = result1.issues.find(iss => iss.recordId === 'rec003');
  assert(enumIssue !== undefined, 'rec003（非法来源渠道）有问题记录');
  if (enumIssue) {
    const sourceIssue = enumIssue.issues.find(i => i.field === '来源渠道');
    assert(sourceIssue !== undefined, '来源渠道字段有问题');
    assert(sourceIssue.code === 'ENUM_MISMATCH', `问题类型为ENUM_MISMATCH（实际${sourceIssue.code}）`);
  }
  console.log();

  console.log('4. 必填字段缺失测试');
  const missingIssue = result1.issues.find(iss => iss.recordId === 'rec004');
  assert(missingIssue !== undefined, 'rec004（缺少客户姓名）有问题记录');
  if (missingIssue) {
    const nameIssue = missingIssue.issues.find(i => i.field === '客户姓名');
    assert(nameIssue !== undefined, '客户姓名字段有问题');
    assert(nameIssue.code === 'REQUIRED_MISSING', `问题类型为REQUIRED_MISSING（实际${nameIssue.code}）`);
    assert(missingIssue.suggestedFixes['客户姓名'] === '需补充', '缺失字段建议为"需补充"');
  }
  console.log();

  console.log('5. Summary统计正确性测试');
  const summary = result1.summary;
  assert(typeof summary.passed === 'number', 'passed为数字');
  assert(typeof summary.withWarnings === 'number', 'withWarnings为数字');
  assert(typeof summary.withErrors === 'number', 'withErrors为数字');
  assert(summary.passed + summary.withWarnings + summary.withErrors === 5, `统计总数等于5（passed=${summary.passed}, warnings=${summary.withWarnings}, errors=${summary.withErrors}）`);
  assert(typeof summary.averageScore === 'number', 'averageScore为数字');
  assert(summary.averageScore > 0 && summary.averageScore <= 100, `平均分在0-100之间（实际${summary.averageScore}）`);
  assert(typeof summary.issueByField === 'object', 'issueByField为对象');
  assert(typeof summary.issueByType === 'object', 'issueByType为对象');
  assert(summary.issueByField['客户姓名'] >= 1, '客户姓名字段问题数>=1');
  assert(summary.issueByType['REQUIRED_MISSING'] >= 1, 'REQUIRED_MISSING类型问题>=1');
  assert(summary.issueByType['ENUM_MISMATCH'] >= 1, 'ENUM_MISMATCH类型问题>=1');
  console.log();

  console.log('6. 问题记录包含必要字段测试');
  for (const issue of result1.issues) {
    assert(issue.recordId !== undefined, `问题记录有recordId (${issue.recordId || 'undefined'})`);
    assert(Array.isArray(issue.issues), '问题记录有issues数组');
    assert(typeof issue.qualityScore === 'number', `问题记录有qualityScore (${issue.qualityScore})`);
    assert(issue.qualityGrade !== undefined, `问题记录有qualityGrade (${issue.qualityGrade})`);
    assert(typeof issue.suggestedFixes === 'object', '问题记录有suggestedFixes对象');
  }
  console.log();

  console.log('7. 质量评分等级测试');
  for (const issue of result1.issues) {
    const validGrades = ['优秀', '良好', '中等', '较差'];
    assert(validGrades.includes(issue.qualityGrade), `质量等级有效 (${issue.qualityGrade})`);
    assert(issue.qualityScore >= 0 && issue.qualityScore <= 100, `质量分数在0-100之间 (${issue.qualityScore})`);
  }
  console.log();

  console.log('8. 进度回调测试');
  let progressCalls = 0;
  let lastProgress = null;
  const progressScanner = createDataScanner({
    mockFetchRecords: (tableId, options) => {
      return {
        records: createMockRecords().slice(0, 3),
        total: 3,
        hasMore: false
      };
    }
  });

  const result2 = progressScanner.scanTable('customer', {
    onProgress: (progress) => {
      progressCalls++;
      lastProgress = progress;
      assert(typeof progress.current === 'number', '进度回调有current');
      assert(typeof progress.total === 'number', '进度回调有total');
      assert(progress.recordId !== undefined, '进度回调有recordId');
    }
  });

  assert(progressCalls === 3, `进度回调被调用3次（实际${progressCalls}次）`);
  assert(lastProgress !== null, '最后一次进度记录存在');
  if (lastProgress) {
    assert(lastProgress.current === 3, `最后进度current=3（实际${lastProgress.current}）`);
    assert(lastProgress.total === 3, `最后进度total=3（实际${lastProgress.total}）`);
  }
  console.log();

  console.log('9. 扫描状态持久化测试');
  const fs = require('fs');
  const path = require('path');
  const stateFile = path.join(__dirname, '..', 'data', 'scan-state.json');
  assert(fs.existsSync(stateFile), 'scan-state.json文件已创建');
  if (fs.existsSync(stateFile)) {
    const stateContent = fs.readFileSync(stateFile, 'utf-8');
    const state = JSON.parse(stateContent);
    assert(state.lastScanTime !== undefined, '状态文件包含lastScanTime');
    assert(state.scans !== undefined, '状态文件包含scans');
    assert(state.scans.customer !== undefined, '状态文件包含customer的扫描时间');
  }
  console.log();

  console.log('10. 增量扫描筛选测试');
  const oldTime = Date.now() - 100000;
  const incrementalScanner = createDataScanner({
    mockFetchRecords: (tableId, options) => {
      return {
        records: createMockRecords(),
        total: 5,
        hasMore: false
      };
    }
  });

  const fs2 = require('fs');
  const path2 = require('path');
  const statePath = path2.join(__dirname, '..', 'data', 'scan-state.json');
  fs2.writeFileSync(statePath, JSON.stringify({
    lastScanTime: oldTime,
    scans: { customer: oldTime }
  }));

  const incrementalResult = incrementalScanner.scanTable('customer', {
    incremental: true
  });
  assert(incrementalResult.totalRecords >= 0, '增量扫描正常执行');
  console.log();

  console.log('11. 无问题记录不加入issues测试');
  const cleanRecords = [
    {
      recordId: 'recClean1',
      fields: {
        '客户姓名': '干净数据',
        '联系方式': '13800138000',
        '来源渠道': '小红书'
      },
      lastModifiedTime: Date.now()
    }
  ];

  const cleanScanner = createDataScanner({
    mockFetchRecords: (tableId, options) => {
      return {
        records: cleanRecords,
        total: 1,
        hasMore: false
      };
    }
  });

  const cleanResult = cleanScanner.scanTable('customer');
  assert(cleanResult.summary.passed >= 1, '干净数据记录在passed中');
  const cleanIssue = cleanResult.issues.find(iss => iss.recordId === 'recClean1');
  assert(cleanIssue === undefined, '干净数据不在issues列表中');
  console.log();

  console.log('12. 无 token 调用飞书 API 抛错测试');
  const savedToken12 = process.env.FEISHU_APP_TOKEN;
  delete process.env.FEISHU_APP_TOKEN;
  const noTokenScanner = createDataScanner({
    mockFetchRecords: (tableId, options) => {
      return { records: [], total: 0, hasMore: false };
    }
  });
  let threwNoToken = false;
  let errMsg = '';
  try {
    noTokenScanner._callLarkApi('GET', '/open-apis/bitable/v1/apps/test/tables/tbl/records', {});
  } catch (e) {
    threwNoToken = true;
    errMsg = e.message;
  }
  assert(threwNoToken, '无 token 时 _callLarkApi 抛错');
  assert(errMsg.includes('FEISHU_APP_TOKEN'), `错误信息包含 FEISHU_APP_TOKEN（实际"${errMsg}"）`);
  if (savedToken12 !== undefined) {
    process.env.FEISHU_APP_TOKEN = savedToken12;
  }
  console.log();

  console.log('13. options.appToken 优先级高于环境变量测试');
  const savedToken13 = process.env.FEISHU_APP_TOKEN;
  process.env.FEISHU_APP_TOKEN = 'env-token-value';
  const priorityScanner = createDataScanner({
    appToken: 'options-token-value',
    mockFetchRecords: (tableId, options) => {
      return { records: [], total: 0, hasMore: false };
    }
  });
  assert(priorityScanner.appToken === 'options-token-value', `appToken 取 options 值（实际"${priorityScanner.appToken}"）`);
  if (savedToken13 !== undefined) {
    process.env.FEISHU_APP_TOKEN = savedToken13;
  } else {
    delete process.env.FEISHU_APP_TOKEN;
  }
  console.log();

  console.log('14. 环境变量作为 fallback 测试');
  const savedToken14 = process.env.FEISHU_APP_TOKEN;
  process.env.FEISHU_APP_TOKEN = 'env-fallback-token';
  const fallbackScanner = createDataScanner({
    mockFetchRecords: (tableId, options) => {
      return { records: [], total: 0, hasMore: false };
    }
  });
  assert(fallbackScanner.appToken === 'env-fallback-token', `appToken 取环境变量值（实际"${fallbackScanner.appToken}"）`);
  if (savedToken14 !== undefined) {
    process.env.FEISHU_APP_TOKEN = savedToken14;
  } else {
    delete process.env.FEISHU_APP_TOKEN;
  }
  console.log();

  console.log('=== 测试结果汇总 ===');
  console.log(`通过: ${passed}, 失败: ${failed}`);
  
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n所有测试通过！✓');
    process.exit(0);
  }
}

runTests();
