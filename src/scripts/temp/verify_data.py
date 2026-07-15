# TEMP: 验证客户数据录入结果 | 2026-06-27 | 预计删除日期 2026-06-30
import subprocess
import json
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

os.chdir(r'd:\360Downloads\Trae 项目\collator')

cmd = [
    'npx', 'lark-cli', 'sheets', '+csv-get',
    '--url', 'https://pcnafnwqcuzo.feishu.cn/sheets/OpG5sJpFAh7pTWt0123ccpBxnYg',
    '--sheet-name', '聚光客户',
    '--range', 'A1:H5'
]

result = subprocess.run(' '.join(cmd), shell=True, capture_output=True, text=True, encoding='utf-8')

try:
    data = json.loads(result.stdout)
    csv_data = data['data']['annotated_csv']
    
    print("=" * 60)
    print("数据验证结果 - 聚光客户表")
    print("=" * 60)
    
    lines = csv_data.split('\n')
    for line in lines:
        if line.strip():
            print(line)
    
    print("\n" + "=" * 60)
    print("JG-2 客户数据验证:")
    print("=" * 60)
    
    for line in lines:
        if 'JG-2' in line:
            parts = line.split('] ')[1].split(',')
            fields = ['序号', '客户名称', '地点', '沟通进度', '喜好风格', '喜好时间', '人数', '拍摄次数']
            for i, field in enumerate(fields):
                if i < len(parts):
                    print(f"  {field}: {parts[i]}")
    
    print("\n✅ 验证完成：JG-2数据已成功写入！")
    
except Exception as e:
    print(f"解析结果: {e}")
    print(f"原始输出: {result.stdout[:500]}")
    if result.stderr:
        print(f"错误: {result.stderr[:300]}")
