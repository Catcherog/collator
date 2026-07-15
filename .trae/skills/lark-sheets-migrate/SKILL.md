# lark-sheets-migrate Skill

> **技能名称**：飞书电子表格数据迁移  
> **版本**：v1.0  
> **触发场景**：需要在两个飞书电子表格之间复制/迁移数据时自动调用

---

## 技能概述

本技能封装了**飞书电子表格间数据迁移**的完整操作流程，解决以下核心问题：
- ✅ 跨表格数据读取与写入
- ✅ 字段映射与转换（支持字段拆分、合并、重命名）
- ✅ PowerShell环境下JSON参数传递的兼容性问题
- ✅ 批量写入与错误处理
- ✅ 结果验证与日志输出

**前置依赖**：
- 必须已读取 `../../Knowledge/飞书API技术要点.md`（了解技术坑点）
- 必须已完成飞书认证（参考 `../lark-shared/SKILL.md` skill）

---

## 标准操作流程

### Phase 1: 需求确认（必做）

在开始迁移前，必须向用户确认以下信息：

```
□ 源表格链接（或 spreadsheet_token + sheet_id）
□ 目标表格链接（或 spreadsheet_token + sheet_id）
□ 字段映射规则（哪些列对应哪些列）
□ 特殊处理需求（如：字段拆分、数据过滤条件）
□ 是否需要保留源表中的空值
```

**输出格式示例**：
```
📋 迁移需求确认：
  源表：模特子表 (sheet=5Eclh8)
  目标表：已确认模特子表 (sheet=1c5466)
  映射规则：小红书→名称+链接(拆分), 微信→微信, 地点→地点
  特殊处理：仅复制有数据的行，空行跳过
```

### Phase 2: 数据读取

#### 2.1 获取源表结构

```bash
lark-cli sheets +info --spreadsheet-token "{source_token}" --url "{source_url}"
```

提取关键信息：
- `sheetId`：工作表ID
- 列数：确认源表的列结构
- 行数：预估数据量

#### 2.2 读取源数据

```bash
lark-cli sheets +read \
  --spreadsheet-token "{source_token}" \
  --sheet-id "{source_sheet_id}" \
  --range "A1:Z{last_row}"
```

**数据处理**：
```python
def read_source_data(token, sheet_id):
    """读取源表格数据"""
    cmd = f'lark-cli sheets +read --spreadsheet-token "{token}" --sheet-id "{sheet_id}"'
    result = run_command(cmd)
    
    if not result or not result.get('ok'):
        raise Exception(f"读取失败: {result}")
    
    rows = result['data']['valueRange']['values']
    header = rows[0] if rows else []
    data = rows[1:] if len(rows) > 1 else []
    
    return header, data
```

### Phase 3: 字段映射与转换

#### 3.1 定义映射规则

创建映射配置字典：

```python
MAPPING_RULES = {
    # 源列索引/名称 : (目标列位置, 转换函数)
    '小红书': (0, parse_xiaohongshu),      # → 第0列（名称）+ 第1列（链接）
    '微信': (2, lambda x: x or ''),          # → 第2列
    '作品': (3, lambda x: x or ''),          # → 第3列
    '地点': (4, lambda x: x or ''),          # → 第4列
    '档期': (5, lambda x: x or ''),          # → 第5列
    '尺码': (6, lambda x: x or ''),          # → 第6列
    '价格': (7, lambda x: x or ''),          # → 第7列
    '优先级': (8, lambda x: x or ''),        # → 第8列
}
```

#### 3.2 实现转换函数

**字段拆分示例（小红书）**：
```python
import re

def parse_xiaohongshu(cell_value):
    """
    解析小红书字段，返回元组：(名称, 链接)
    
    支持三种格式：
    1. 纯文本："用户名" → ("用户名", "")
    2. 富文本对象：{"text": "用户名", "link": "https://..."} → ("用户名", "https://...")
    3. 混合文本："用户名 https://..." → ("用户名", "https://...")
    """
    if not cell_value:
        return '', ''
    
    cell_str = str(cell_value).strip()
    
    # 空值检查
    if not cell_str or cell_str.lower() in ['none', 'null', '']:
        return '', ''
    
    # 情况1：富文本对象
    if isinstance(cell_value, dict):
        text = cell_value.get('text', '')
        link = cell_value.get('link', '') or cell_value.get('url', '')
        return str(text) if text else '', str(link) if link else ''
    
    # 情况2：包含URL的混合文本
    url_pattern = r'(https?://[^\s\x7c|]+)'
    match = re.search(url_pattern, cell_str)
    
    if match:
        url = match.group(1)
        name = re.sub(url_pattern, '', cell_str).strip().strip('|').strip()
        return name, url
    
    # 情况3：纯文本
    return cell_str, ''


def transform_row(source_row, header):
    """
    将单行源数据转换为目标格式
    
    参数:
        source_row: 源数据行（列表）
        header: 表头行（用于定位列）
    
    返回:
        目标格式的行（10个字段的列表）
    """
    result = ['', '', '', '', '', '', '', '', '', '']  # 10个空字符串
    
    for col_name, (target_idx, transform_func) in MAPPING_RULES.items():
        if col_name in header:
            col_idx = header.index(col_name)
            raw_value = source_row[col_idx] if col_idx < len(source_row) else None
            
            transformed = transform_func(raw_value)
            
            # 如果是元组（如小红书），展开到多列
            if isinstance(transformed, tuple):
                for i, val in enumerate(transformed):
                    if target_idx + i < len(result):
                        result[target_idx + i] = val
            else:
                if target_idx < len(result):
                    result[target_idx] = transformed
    
    return result
```

### Phase 4: 批量写入目标表

#### 4.1 使用原生API写入（推荐）

**原因**：避免PowerShell下CLI封装命令的JSON解析问题

```python
import subprocess
import json
import os

def write_to_sheet(target_token, target_sheet_id, data_rows, start_row=2):
    """
    将数据批量写入目标表格
    
    参数:
        target_token: 目标表格token
        target_sheet_id: 目标工作表ID
        data_rows: 二维数组（待写入的数据）
        start_row: 起始行号（默认第2行，跳过表头）
    
    返回:
        成功写入的行数
    """
    if not data_rows:
        print("[WARN] No data to write")
        return 0
    
    batch_size = 50
    total_written = 0
    
    print(f"\n📝 准备写入 {len(data_rows)} 条记录...")
    
    for i in range(0, len(data_rows), batch_size):
        batch = data_rows[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (len(data_rows) + batch_size - 1) // batch_size
        
        print(f"\n⏳ 正在写入第 {batch_num}/{total_batches} 批 ({len(batch)} 条)...")
        
        # 计算范围
        current_start_row = start_row + i
        current_end_row = current_start_row + len(batch) - 1
        range_str = f"A{current_start_row}:J{current_end_row}"
        
        # 构造API请求体
        params = {
            "valueRange": {
                "range": f"{target_sheet_id}!{range_str}",
                "values": batch
            }
        }
        
        # 写入临时文件（使用相对路径）
        data_file = 'migrate_batch_data.json'
        try:
            with open(data_file, 'w', encoding='utf-8') as f:
                json.dump(params, f, ensure_ascii=False)
            
            # 调用原生API
            cmd = f'lark-cli api PUT "/open-apis/sheets/v2/spreadsheets/{target_token}/values" --data @"{data_file}"'
            
            proc = subprocess.Popen(
                cmd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                encoding='utf-8',
                errors='ignore'
            )
            stdout, stderr = proc.communicate()
            
            # 处理响应
            if proc.returncode == 0:
                result = json.loads(stdout)
                
                if result.get('code') == 0:
                    updated = result['data']
                    written = updated.get('updatedRows', 0)
                    total_written += written
                    print(f"✅ 第 {batch_num} 批成功: 写入 {written} 行 | 范围: {updated.get('updatedRange')}")
                else:
                    print(f"❌ 第 {batch_num} 批失败: {result.get('msg', 'Unknown error')}")
            else:
                print(f"❌ 第 {batch_num} 批异常 (返回码 {proc.returncode})")
                if stderr:
                    print(f"   错误详情: {stderr[:300]}")
                    
        finally:
            if os.path.exists(data_file):
                os.remove(data_file)
    
    print(f"\n{'='*60}")
    print(f"🎉 写入完成! 总计写入 {total_written} 条记录")
    print(f"{'='*60}")
    
    return total_written
```

#### 4.2 完整迁移脚本模板

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
飞书电子表格数据迁移脚本
用途：将源表数据按映射规则转换后写入目标表
"""

import subprocess
import json
import os
import re
from typing import List, Tuple, Dict, Any, Optional


# ============================================================
# 配置区（根据实际需求修改）
# ============================================================

SOURCE_CONFIG = {
    'spreadsheet_token': 'R4STsa1GlhrvMstFhgCc3YkEned',
    'sheet_id': '5Eclh8',
    'name': '模特子表'
}

TARGET_CONFIG = {
    'spreadsheet_token': 'EqGnsTc4UhmmJbtEHFdcqNXwnKb',
    'sheet_id': '1c5466',
    'name': '已确认模特子表'
}

# 字段映射规则：源列名 -> (目标列索引, 转换函数)
FIELD_MAPPING = {
    '小红书': (0, parse_xiaohongshu),
    '微信': (2, clean_text),
    '作品': (3, clean_text),
    '地点': (4, clean_text),
    '档期': (5, clean_text),
    '尺码': (6, clean_text),
    '价格': (7, clean_text),
    '优先级': (8, clean_text),
}


# ============================================================
# 工具函数
# ============================================================

def run_command(cmd: str) -> Optional[Dict]:
    """执行shell命令并返回JSON结果"""
    result = subprocess.run(
        cmd,
        shell=True,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='ignore'
    )
    
    if result.returncode != 0:
        print(f"[ERROR] Command failed: {result.stderr[:500]}")
        return None
    
    try:
        return json.loads(result.stdout)
    except Exception as e:
        print(f"[ERROR] JSON parse error: {e}")
        return None


def clean_text(value: Any) -> str:
    """清理文本值，统一转为字符串"""
    if value is None:
        return ''
    text = str(value).strip()
    return text if text.lower() not in ['none', 'null', 'nan'] else ''


def parse_xiaohongshu(value: Any) -> Tuple[str, str]:
    """解析小红书字段（见上文详细实现）"""
    # ... （同上文的完整实现）
    pass


# ============================================================
# 主流程
# ============================================================

def main():
    print("=" * 60)
    print("🚀 开始数据迁移")
    print(f"   源表: {SOURCE_CONFIG['name']} ({SOURCE_CONFIG['sheet_id']})")
    print(f"   目标: {TARGET_CONFIG['name']} ({TARGET_CONFIG['sheet_id']})")
    print("=" * 60)
    
    # Step 1: 读取源数据
    print("\n📖 Step 1: 读取源数据...")
    source_header, source_data = read_source_data(
        SOURCE_CONFIG['spreadsheet_token'],
        SOURCE_CONFIG['sheet_id']
    )
    print(f"   读取到 {len(source_data)} 行数据")
    
    # Step 2: 数据转换
    print("\n🔄 Step 2: 字段映射与转换...")
    transformed_data = []
    for row in source_data:
        new_row = transform_row(row, source_header)
        # 过滤完全空的行（可选）
        if any(new_row):  # 至少有一个非空字段
            transformed_data.append(new_row)
    
    print(f"   转换后得到 {len(transformed_data)} 条有效记录")
    
    # 预览前3条
    if transformed_data:
        print("\n   📋 数据预览（前3条）:")
        for idx, row in enumerate(transformed_data[:3], 1):
            xhs_name = row[0] if row[0] else '(空)'
            wechat = row[2] if row[2] else '(空)'
            location = row[4] if row[4] else '(空)'
            print(f"   {idx}. 小红书:{xhs_name} | 微信:{wechat} | 地点:{location}")
    
    # Step 3: 写入目标表
    print("\n✍️  Step 3: 写入目标表...")
    total_written = write_to_sheet(
        TARGET_CONFIG['spreadsheet_token'],
        TARGET_CONFIG['sheet_id'],
        transformed_data
    )
    
    # Step 4: 结果汇总
    print("\n" + "=" * 60)
    print("📊 迁移结果汇总:")
    print(f"   源数据行数: {len(source_data)}")
    print(f"   有效记录数: {len(transformed_data)}")
    print(f"   成功写入数: {total_written}")
    print("=" * 60)


if __name__ == '__main__':
    main()
```

---

## 常见场景速查

### 场景A：简单列复制（无转换）

```python
FIELD_MAPPING = {
    '姓名': (0, clean_text),     # A列
    '电话': (1, clean_text),     # B列
    '地址': (2, clean_text),     # C列
}
```

### 场景B：字段拆分（一列→多列）

```python
FIELD_MAPPING = {
    '姓名+电话': (0, split_name_phone),  # → A列(姓名) + B列(电话)
}

def split_name_phone(text):
    """将'张三 13800138000'拆分为('张三', '13800138000')"""
    parts = str(text).split()
    return parts[0] if parts else '', parts[1] if len(parts) > 1 else ''
```

### 场景C：字段合并（多列→一列）

```python
FIELD_MAPPING = {
    '姓': (0, merge_full_name),   # 配合下面的'名'
    '名': (0, merge_full_name),   # 都映射到第0列
}

full_name_cache = {}

def merge_full_name(value, row_idx=None):
    """合并姓和名为完整姓名"""
    # 需要在transform_row中特殊处理此逻辑
    pass
```

### 场景D：带条件过滤

```python
def transform_row_with_filter(source_row, header):
    """增加过滤逻辑的转换函数"""
    
    # 示例：只迁移"状态"为"有效"的行
    status_col = header.index('状态') if '状态' in header else -1
    if status_col >= 0 and source_row[status_col] != '有效':
        return None  # 返回None表示跳过此行
    
    return transform_row(source_row, header)

# 在主循环中使用
for row in source_data:
    new_row = transform_row_with_filter(row, source_header)
    if new_row is not None:
        transformed_data.append(new_row)
```

---

## 错误处理指南

### 1. 认证失败（code 91402）

**症状**：`NOTEXIST` 或权限不足

**解决方案**：
```bash
lark-cli auth login
# 或
lark-cli auth login --as bot
```

### 2. JSON解析失败

**症状**：`invalid JSON, must be a 2D array`

**检查清单**：
- [ ] 是否使用了文件传递方案（`--data @file.json`）
- [ ] 文件路径是否为相对路径
- [ ] values是否为二维数组（外层是列表，内层也是列表）
- [ ] 是否有未转义的特殊字符

### 3. 范围错误（code 90202）

**症状**：`columns of value:N > range`

**解决方案**：
```python
# 错误：范围太小
range_str = f"A{start_row}"  # 只指定起始单元格

# 正确：明确指定完整范围
range_str = f"A{start_row}:J{end_row}"  # 包含所有列
```

### 4. Sheet不存在

**症状**：`Wrong Sheet Id`

**排查步骤**：
1. 使用 `lark-cli sheets +info --url "表格URL"` 查看所有工作表
2. 确认 `sheet_id` 是否正确（从URL的 `?sheet=` 参数获取）

---

## 性能优化建议

### 大数据量迁移（>1000行）

1. **分批读取**：每次读取500行，避免内存溢出
2. **并行写入**：使用多线程（注意频率限制）
3. **进度显示**：每100条打印一次进度
4. **断点续传**：记录已写入的行号，失败时可从断点继续

```python
def migrate_large_dataset(source_token, target_token, chunk_size=500):
    """大数据量分块迁移"""
    offset = 0
    batch_num = 1
    
    while True:
        # 分批读取
        source_data = read_chunk(source_token, offset, chunk_size)
        if not source_data:
            break
        
        # 转换并写入
        transformed = [transform_row(row) for row in source_data]
        write_to_sheet(target_token, transformed, start_row=offset+2)
        
        offset += chunk_size
        batch_num += 1
        print(f"Progress: {offset} rows processed...")
```

---

## 测试验证

### 单元测试模板

```python
def test_parse_xiaohongshu():
    """测试小红书字段解析"""
    assert parse_xiaohongshu(None) == ('', '')
    assert parse_xiaohongshu('') == ('', '')
    assert parse_xiaohongshu('纯文本用户名') == ('纯文本用户名', '')
    assert parse_xiaohongshu({'text': '用户名', 'link': 'https://x.com/u'}) == ('用户名', 'https://x.com/u')
    assert parse_xiaohongshu('用户名 https://x.com/u')[1] == 'https://x.com/u'

def test_transform_row():
    """测试行转换"""
    header = ['小红书', '微信', '地点']
    row = [{'text': 'test', 'link': 'http://t.com'}, 'wx123', '杭州']
    result = transform_row(row, header)
    assert result[0] == 'test'  # 小红书名称
    assert result[1] == 'http://t.com'  # 小红书链接
    assert result[2] == 'wx123'  # 微信
    assert result[4] == '杭州'  # 地点
```

---

## 维护日志

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 2026-05-12 | 初始版本，基于模特数据迁移实战经验总结 |

---

**调用方式**：当用户提出"把A表的数据复制到B表"、"迁移表格数据"、"同步两个表"等需求时，AI应自动加载本Skill并按流程执行。
