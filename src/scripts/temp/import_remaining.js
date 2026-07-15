// TEMP: 剩余资源数据批量导入(服装+修图资源子表) | 2026-06-25 | 2026-06-28
const fs = require('fs');
const { execSync } = require('child_process');

// 通用配置
const SPREADSHEET_URL = 'https://pcnafnwqcuzo.feishu.cn/sheets/R4STsa1GlhrvMstFhgCc3YkEned';
const BASE_TOKEN = 'MwGMbF0Q0alPc6s3jOccovvOnob';

// 批次配置
const BATCHES = [
  {
    name: '服装',
    sheetId: 'ZawDNW',
    tableId: 'tblW9CyLkQnaFHqI',
    fields: ['服装名称/品牌', '租赁价格'],
    range: 'A2:U201',
    transform: (row) => {
      const [name, , price] = row;
      return [name || null, extractPrice(price)];
    }
  },
  {
    name: '修图',
    sheetId: '4hfpEx',
    tableId: 'tbl3ekWWGwPITJlC',
    fields: ['姓名/昵称', '修图报价'],
    range: 'A2:V200',
    transform: (row) => {
      const [name, price] = row;
      return [name || null, extractPrice(price)];
    }
  }
];

function extractPrice(priceText) {
  if (!priceText) return null;
  const text = typeof priceText === 'string' ? priceText : String(priceText);
  if (text.includes('互勉') || text.includes('互免')) return 0;
  if (text.includes('面议')) return null;
  const match = text.match(/(\d+)/);
  return match ? parseFloat(match[1]) : null;
}

async function processBatch(batch) {
  console.log(`\n🚀 开始导入${batch.name}数据到中台...\n`);

  try {
    // 读取源数据
    console.log('📖 读取源电子表格数据...');
    const readCmd = `lark-cli sheets +read --url "${SPREADSHEET_URL}" --sheet-id "${batch.sheetId}" --range "${batch.range}" --as user`;
    const readResult = execSync(readCmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    const readData = JSON.parse(readResult);

    if (!readData.ok || !readData.data?.valueRange?.values) {
      throw new Error('读取源数据失败');
    }

    const rawData = readData.data.valueRange.values;
    console.log(`✅ 成功读取 ${rawData.length} 条原始数据\n`);

    // 转换数据
    console.log('🔄 转换数据格式...');
    const transformedData = rawData.map(batch.transform).filter(row => row[0]);
    console.log(`✅ 转换完成，有效数据 ${transformedData.length} 条\n`);

    if (transformedData.length === 0) {
      console.log('⚠️ 没有有效数据需要导入\n');
      return { created: 0, failed: 0 };
    }

    // 分批写入
    const batchSize = 200;
    const batches = Math.ceil(transformedData.length / batchSize);

    let totalCreated = 0;
    let totalFailed = 0;

    for (let i = 0; i < batches; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, transformedData.length);
      const batch_data = transformedData.slice(start, end);

      console.log(`📝 写入第 ${i + 1}/${batches} 批 (${batch_data.length} 条)...`);

      const createData = {
        fields: batch.fields,
        rows: batch_data
      };

      const jsonFile = `./batch_${batch.name.toLowerCase()}_${i}.json`;
      fs.writeFileSync(jsonFile, JSON.stringify(createData, null, 2));

      const createCmd = `lark-cli base +record-batch-create --base-token "${BASE_TOKEN}" --table-id "${batch.tableId}" --as user --json @${jsonFile}`;

      try {
        const createResult = execSync(createCmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
        const resultData = JSON.parse(createResult);

        if (resultData.ok && resultData.data?.record_id_list) {
          const created = resultData.data.record_id_list.length;
          totalCreated += created;
          console.log(`   ✅ 成功创建 ${created} 条记录`);
        } else {
          totalFailed += batch_data.length;
          console.log(`   ❌ 写入失败`);
        }
      } catch (error) {
        totalFailed += batch_data.length;
        console.log(`   ❌ 写入错误`);
      }

      // 清理临时文件
      if (fs.existsSync(jsonFile)) {
        fs.unlinkSync(jsonFile);
      }

      // 批次间延迟
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`📊 ${batch.name}数据导入完成！`);
    console.log(`   ✅ 成功: ${totalCreated} 条`);
    console.log(`   ❌ 失败: ${totalFailed} 条`);
    console.log(`   📈 总计: ${totalCreated + totalFailed} 条`);
    console.log('='.repeat(50) + '\n');

    return { created: totalCreated, failed: totalFailed };

  } catch (error) {
    console.error(`❌ ${batch.name}执行失败:`, error.message);
    return { created: 0, failed: 0 };
  }
}

async function main() {
  console.log('🎯 开始批量导入服装和修图数据...\n');

  let grandTotal = { created: 0, failed: 0 };

  for (const batch of BATCHES) {
    const result = await processBatch(batch);
    grandTotal.created += result.created;
    grandTotal.failed += result.failed;
  }

  console.log('\n' + '#'.repeat(60));
  console.log('🎉 全部批次导入完成！');
  console.log('#'.repeat(60));
  console.log(`\n📊 总体统计:`);
  console.log(`   ✅ 总成功: ${grandTotal.created} 条`);
  console.log(`   ❌ 总失败: ${grandTotal.failed} 条`);
  console.log(`   📈 总处理: ${grandTotal.created + grandTotal.failed} 条`);
  console.log('\n' + '#'.repeat(60) + '\n');
}

main();
