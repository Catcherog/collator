// TEMP: 模特资源数据一次性导入(从电子表格到多维表) | 2026-06-25 | 2026-06-28
const fs = require('fs');
const { execSync } = require('child_process');

// 配置
const SPREADSHEET_URL = 'https://pcnafnwqcuzo.feishu.cn/sheets/R4STsa1GlhrvMstFhgCc3YkEned';
const BASE_TOKEN = 'MwGMbF0Q0alPc6s3jOccovvOnob';
const TABLE_ID = 'tbl8hmZgzg1PiXLn'; // 模特资源子表

// 字段映射配置
const FIELD_MAPPING = {
  target: ['艺名/昵称', '报价', '身高体重'] // 只映射能匹配的字段
};

function extractPrice(priceText) {
  if (!priceText) return null;
  const text = typeof priceText === 'string' ? priceText : String(priceText);

  // 处理特殊情况：互勉、面议等
  if (text.includes('互勉') || text.includes('互免')) return 0;
  if (text.includes('面议')) return null;

  const match = text.match(/(\d+)/);
  return match ? parseFloat(match[1]) : null;
}

function transformRow(row) {
  const [name, price, , , sizeInfo] = row; // 微信、报价、地点、档期、尺码

  return [
    name || null,
    extractPrice(price),
    sizeInfo || null // 尺码信息写入身高体重字段
  ];
}

async function main() {
  console.log('🚀 开始导入模特数据到中台...\n');

  try {
    // 读取源数据
    console.log('📖 读取源电子表格数据...');
    const readCmd = `lark-cli sheets +read --url "${SPREADSHEET_URL}" --sheet-id "5Eclh8" --range "A2:I400" --as user`;
    const readResult = execSync(readCmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    const readData = JSON.parse(readResult);

    if (!readData.ok || !readData.data?.valueRange?.values) {
      throw new Error('读取源数据失败');
    }

    const rawData = readData.data.valueRange.values;
    console.log(`✅ 成功读取 ${rawData.length} 条原始数据\n`);

    // 转换数据
    console.log('🔄 转换数据格式...');
    const transformedData = rawData.map(transformRow).filter(row => row[0]); // 过滤掉没有姓名的空行
    console.log(`✅ 转换完成，有效数据 ${transformedData.length} 条\n`);

    // 分批写入（每批200条）
    const batchSize = 200;
    const batches = Math.ceil(transformedData.length / batchSize);

    let totalCreated = 0;
    let totalFailed = 0;

    for (let i = 0; i < batches; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, transformedData.length);
      const batch = transformedData.slice(start, end);

      console.log(`📝 写入第 ${i + 1}/${batches} 批 (${batch.length} 条)...`);

      const createData = {
        fields: FIELD_MAPPING.target,
        rows: batch
      };

      const jsonFile = `./batch_model_${i}.json`;
      fs.writeFileSync(jsonFile, JSON.stringify(createData, null, 2));

      const createCmd = `lark-cli base +record-batch-create --base-token "${BASE_TOKEN}" --table-id "${TABLE_ID}" --as user --json @${jsonFile}`;

      try {
        const createResult = execSync(createCmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
        const resultData = JSON.parse(createResult);

        if (resultData.ok && resultData.data?.record_id_list) {
          const created = resultData.data.record_id_list.length;
          totalCreated += created;
          console.log(`   ✅ 成功创建 ${created} 条记录`);
        } else {
          totalFailed += batch.length;
          console.log(`   ❌ 写入失败: ${resultData.error?.message || '未知错误'}`);
        }
      } catch (error) {
        totalFailed += batch.length;
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
    console.log('📊 模特数据导入完成！');
    console.log(`   ✅ 成功: ${totalCreated} 条`);
    console.log(`   ❌ 失败: ${totalFailed} 条`);
    console.log(`   📈 总计: ${totalCreated + totalFailed} 条`);
    console.log('='.repeat(50) + '\n');

  } catch (error) {
    console.error('❌ 执行失败:', error.message);
    process.exit(1);
  }
}

main();
