# TEMP: 模特数据迁移脚本 - 模特子表迁移到已确认模特表 | 2026-06-25 | 预计删除日期 2026-06-28
import json
import subprocess
import sys
import tempfile
import os

def run_command(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    if result.returncode != 0:
        print(f"[ERROR] Command failed (return code: {result.returncode})")
        print(f"STDERR: {result.stderr[:800] if result.stderr else 'empty'}")
        return None
    try:
        return json.loads(result.stdout)
    except Exception as e:
        print(f"[ERROR] JSON parse failed: {e}")
        print(f"Raw output: {result.stdout[:500]}")
        return None

def read_source_data():
    print("正在读取源表格数据...")
    cmd = 'lark-cli sheets +read --spreadsheet-token "R4STsa1GlhrvMstFhgCc3YkEned" --sheet-id "5Eclh8" --range "A2:I400"'
    result = run_command(cmd)
    if result and result.get("ok"):
        return result["data"]["valueRange"]["values"]
    return []

def parse_xiaohongshu(cell_value):
    if cell_value is None:
        return "", ""
    
    if isinstance(cell_value, str):
        return cell_value, ""
    
    if isinstance(cell_value, list):
        name = ""
        link = ""
        for item in cell_value:
            if isinstance(item, dict):
                if item.get("type") == "text":
                    name += item.get("text", "")
                elif item.get("type") == "url":
                    link = item.get("link", "")
        return name.strip(), link
    
    return str(cell_value), ""

def clean_cell_value(value):
    if value is None:
        return None
    
    if isinstance(value, (str, int, float, bool)):
        return value
    
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                if item.get("type") in ["embed-image", "image"]:
                    return None
        return value
    
    if isinstance(value, dict):
        if value.get("type") in ["embed-image", "image"]:
            return None
    
    return None

def transform_data(source_rows):
    transformed = []
    for row in source_rows:
        if not row or all(v is None for v in row[:9]):
            continue
        
        wechat = clean_cell_value(row[0]) if len(row) > 0 else None
        price = clean_cell_value(row[1]) if len(row) > 1 else None
        location = clean_cell_value(row[2]) if len(row) > 2 else None
        schedule = clean_cell_value(row[3]) if len(row) > 3 else None
        size = clean_cell_value(row[4]) if len(row) > 4 else None
        priority = clean_cell_value(row[5]) if len(row) > 5 else None
        xhs_cell = row[7] if len(row) > 7 else None
        works = clean_cell_value(row[8]) if len(row) > 8 else None
        
        xhs_name, xhs_link = parse_xiaohongshu(xhs_cell)
        
        new_row = [
            xhs_name if xhs_name else "",
            xhs_link if xhs_link else "",
            wechat if wechat else "",
            works if works else "",
            location if location else "",
            schedule if schedule else "",
            size if size else "",
            price if price else "",
            priority if priority else "",
            ""
        ]
        
        transformed.append(new_row)
    
    return transformed

def write_target_data(transformed_rows):
    if not transformed_rows:
        print("没有需要写入的数据")
        return
    
    print(f"正在写入 {len(transformed_rows)} 条数据到目标表格...")
    
    batch_size = 50
    total_written = 0
    
    for i in range(0, len(transformed_rows), batch_size):
        batch = transformed_rows[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (len(transformed_rows) + batch_size - 1) // batch_size
        
        print(f"\n正在写入第 {batch_num}/{total_batches} 批 ( {len(batch)} 条 )...")
        
        print(f"DEBUG: 前2条数据样本:")
        for idx, row in enumerate(batch[:2]):
            print(f"  行{idx}: {json.dumps(row, ensure_ascii=False)[:200]}")
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump(batch, f, ensure_ascii=False)
            temp_file = f.name
        
        try:
            start_row = i + 2
            end_row = start_row + len(batch) - 1
            range_str = f"A{start_row}:J{end_row}"
            
            params = {
                "valueRange": {
                    "range": f"1c5466!{range_str}",
                    "values": batch
                }
            }
            
            data_file = 'batch_data.json'
            with open(data_file, 'w', encoding='utf-8') as f:
                json.dump(params, f)
            
            cmd = f'lark-cli api PUT "/open-apis/sheets/v2/spreadsheets/EqGnsTc4UhmmJbtEHFdcqNXwnKb/values" --data @"{data_file}"'
            
            proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding='utf-8', errors='ignore')
            stdout, stderr = proc.communicate()
            
            if proc.returncode == 0:
                result = json.loads(stdout)
                if result.get("code") == 0:
                    updated = result["data"]
                    written = updated.get('updatedRows', 0)
                    total_written += written
                    print(f"[OK] Batch {batch_num} success: {written} rows written")
                else:
                    print(f"[FAIL] Batch {batch_num} failed: {result.get('msg', 'Unknown error')}")
            else:
                print(f"[FAIL] Batch {batch_num} failed (return code: {proc.returncode})")
                print(f"STDERR: {stderr[:500] if stderr else 'empty'}")
        finally:
            if os.path.exists('batch_data.json'):
                os.remove('batch_data.json')
    
    print(f"\n{'=' * 50}")
    print(f"[DONE] Migration completed! Total written: {total_written} records")
    print(f"{'=' * 50}")

def main():
    print("=" * 50)
    print("开始数据迁移: 模特子表 → 已确认模特")
    print("=" * 50)
    
    source_rows = read_source_data()
    print(f"读取到 {len(source_rows)} 行源数据")
    
    transformed = transform_data(source_rows)
    print(f"转换后得到 {len(transformed)} 条有效记录")
    
    if transformed:
        print("\n前3条数据预览:")
        for i, row in enumerate(transformed[:3], 1):
            print(f"{i}. 小红书: {row[0]} | 微信: {row[2]} | 地点: {row[4]}")
        
        write_target_data(transformed)
    else:
        print("没有有效的数据可迁移")

if __name__ == "__main__":
    main()
