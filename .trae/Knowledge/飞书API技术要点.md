# 飞书API调用技术要点与最佳实践

> **版本**：v1.0  
> **最后更新**：2026-05-12  
> **用途**：AI在执行飞书相关操作时必须掌握的通用技术知识  
> **适用范围**：所有涉及飞书API调用的场景（表格/多维表/文档等）

---

## 一、PowerShell环境下的JSON参数传递问题

### 1.1 问题背景

在Windows PowerShell环境中调用CLI工具时，**JSON字符串中的双引号会被Shell错误解析**，导致：
- JSON被拆分成多个位置参数
- API返回"invalid JSON"或"positional arguments"错误
- 复杂数据结构（嵌套数组、特殊字符）传递失败

### 1.2 典型失败案例

```powershell
# ❌ 错误方式1：直接内联JSON
lark-cli sheets +write --values '[["a","b","c"]]'
# 结果：Error: positional arguments are not supported (got ["b," "c"]])

# ❌ 错误方式2：使用单引号包裹
lark-cli api PUT '/path' --data '{"key":"value"}'
# 结果：PowerShell将单引号内容作为整体，但内部双引号仍可能被解析

# ❌ 错误方式3：转义双引号
lark-cli sheets +write --values "[[\"a\", \"b\", \"c\"]]"
# 结果：某些情况下仍会失败（取决于JSON复杂度）
```

### 1.3 正确解决方案

#### 方案A：使用文件传递数据（推荐）

```python
import json

params = {"valueRange": {"range": "sheetId!A1:C3", "values": [["a", "b", "c"]]}}

# 写入临时文件
with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(params, f)

# 通过 @ 引用文件
cmd = 'lark-cli api PUT "/path" --data @"data.json"'
```

**优点**：
- 完全避免Shell解析问题
- 支持任意复杂的JSON结构
- 可读性好，便于调试

**注意事项**：
- 文件路径必须是**相对路径**（不能使用绝对路径如 `C:\Users\...`）
- 文件必须在当前工作目录或子目录下

#### 方案B：使用stdin管道传递

```python
import subprocess
import json

data = [["a", "b", "c"]]
cmd = 'lark-cli command --values -'

proc = subprocess.Popen(
    cmd,
    shell=True,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    encoding='utf-8'
)
stdout, stderr = proc.communicate(input=json.dumps(data))
```

**适用场景**：简单数据结构、需要动态生成数据的场景

---

## 二、飞书电子表格API调用规范

### 2.1 CLI封装命令 vs 原生API

| 类型 | 命令格式 | 适用场景 | 局限性 |
|------|----------|----------|--------|
| **CLI封装** | `lark-cli sheets +write` | 简单读写操作 | PowerShell下JSON传参易出错 |
| **原生API** | `lark-cli api METHOD /path` | 复杂操作/批量写入 | 需要了解API规范 |

### 2.2 电子表格写入API（原生）

**端点**：`PUT /open-apis/sheets/v2/spreadsheets/{spreadsheetToken}/values`

**请求体结构**：
```json
{
  "valueRange": {
    "range": "{sheetId}!{startCell}:{endCell}",
    "values": [
      ["row1_col1", "row1_col2", "row1_col3"],
      ["row2_col1", "row2_col2", "row2_col3"]
    ]
  }
}
```

**关键参数说明**：

| 参数 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `range` | ✅ | 目标范围，格式为 `sheetId!A1:J10` | `"1c5466!A2:J32"` |
| `values` | ✅ | 二维数组，外层代表行，内层代表列 | `[["col1", "col2"]]` |

**响应结构**：
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "revision": 52,
    "updatedCells": 310,     // 更新的单元格数
    "updatedColumns": 10,    // 更新的列数
    "updatedRows": 31,       // 更新的行数
    "updatedRange": "1c5466!A2:J32",
    "spreadsheetToken": "EqGnsTc4UhmmJbtEHFdcqNXwnKb"
  }
}
```

### 2.3 范围指定规则

| 范围写法 | 示例 | 描述 |
|----------|------|------|
| 完整范围 | `sheetId!A1:B5` | 从A1到B5的矩形区域 |
| 列范围 | `sheetId!A:B` | 整个A列到B列 |
| 混合范围 | `sheetId!A2:B` | 从A2行开始到B列结束 |
| 仅SheetId | `sheetId` | 整个工作表（谨慎使用） |

**最佳实践**：
- 明确指定行列范围，避免意外覆盖
- 使用 `A{start}:J{end}` 格式确保精确控制
- 批量写入时分批处理（建议每批≤50行）

---

## 三、数据迁移通用流程

### 3.1 标准五步法

```
Step 1: 数据读取
   ↓ 读取源表格/文件/API，获取原始数据
Step 2: 字段映射
   ↓ 根据目标表结构定义映射规则（含字段拆分/合并）
Step 3: 数据转换
   ↓ 清洗、标准化、类型转换、空值处理
Step 4: 分批写入
   ↓ 按批次调用API（避免超时/限流）
Step 5: 结果验证
   ↓ 检查写入行数、校验关键字段
```

### 3.2 字段拆分示例

**场景**：源表的"小红书"字段包含名称+超链接，需拆分为两列

**实现逻辑**：
```python
def parse_xiaohongshu(cell_value):
    """解析小红书字段，提取名称和链接"""
    if not cell_value or str(cell_value).strip() == '':
        return '', ''
    
    cell_str = str(cell_value).strip()
    
    # 情况1：纯文本（无链接）
    if 'http' not in cell_str and 'xiaohongshu.com' not in cell_str:
        return cell_str, ''
    
    # 情况2：富文本对象（含link属性）
    if isinstance(cell_value, dict):
        return cell_value.get('text', ''), cell_value.get('link', '')
    
    # 情况3：混合文本（名称+URL拼接）
    import re
    url_pattern = r'(https?://[^\s]+)'
    match = re.search(url_pattern, cell_str)
    if match:
        url = match.group(1)
        name = cell_str.replace(url, '').strip()
        return name, url
    
    return cell_str, ''
```

### 3.3 批量写入策略

**推荐配置**：
- **批次大小**：50条/批（平衡效率与稳定性）
- **并发控制**：串行执行（避免触发频率限制）
- **错误处理**：单批失败不影响其他批次
- **日志记录**：每批输出成功/失败状态

**代码模板**：
```python
batch_size = 50
total_written = 0

for i in range(0, len(data), batch_size):
    batch = data[i:i + batch_size]
    
    # 构造请求参数
    params = {
        "valueRange": {
            "range": f"sheetId!A{i+2}:J{i+len(batch)+1}",
            "values": batch
        }
    }
    
    # 写入文件并调用API
    with open('batch.json', 'w', encoding='utf-8') as f:
        json.dump(params, f)
    
    result = execute_api_call(f'lark-cli api PUT "/path" --data @"batch.json"')
    
    if result['code'] == 0:
        total_written += result['data']['updatedRows']
        print(f"[OK] Batch {i//batch_size + 1}: {result['data']['updatedRows']} rows")
    else:
        print(f"[FAIL] Batch {i//batch_size + 1}: {result['msg']}")
```

---

## 四、常见错误码与解决方案

| 错误码 | 错误信息 | 原因 | 解决方案 |
|--------|----------|------|----------|
| `90202` | `columns of value:N > range` | 范围列数不足 | 扩大目标范围的列数（如 A2 → A2:J2） |
| `91402` | `NOTEXIST` | Token无效/权限不足 | 重新认证或检查token是否正确 |
| `validation` | `invalid JSON, must be a 2D array` | JSON解析失败 | 使用文件传递方案A |
| `validation` | `--file must be a relative path` | 使用了绝对路径 | 改用相对路径 `./filename.json` |
| `http_error` | `404 page not found` | API路径错误 | 检查API文档确认正确路径 |

---

## 五、性能优化建议

### 5.1 减少API调用次数

- **合并小批次**：如果数据量<100行，可一次性写入
- **使用范围扩展**：只给起始单元格，让API自动按数据尺寸展开

### 5.2 避免频率限制

- **电子表格API限制**：单租户单应用20次/分钟（创建表格）、100次/秒（操作工作表）
- **策略**：大批量数据分批写入时加入延迟（每批间隔200ms）

### 5.3 数据预处理

- **提前过滤空行**：减少无效数据传输
- **统一数据格式**：确保所有值为字符串类型（避免类型转换问题）
- **清理特殊字符**：移除可能导致JSON解析失败的字符

---

## 六、调试技巧

### 6.1 使用dry-run预览

```bash
lark-cli api PUT "/path" --data @"data.json" --dry-run
```
输出实际请求内容，不真正执行。

### 6.2 分步验证

1. 先用简单数据测试API连通性：`[["test"]]`
2. 再逐步增加数据复杂度
3. 最后使用真实数据

### 6.3 日志输出关键信息

每次操作后输出：
- 源数据行数 → 有效记录数（过滤比例）
- 目标范围（起止行列）
- API响应的 `updatedRows` / `updatedCells`
- 失败时的完整错误信息（STDERR前500字符）

---

## 七、相关资源索引

| 资源类型 | 路径 | 用途 |
|----------|------|------|
| Skill | `.trae/skills/lark-sheets/SKILL.md` | 电子表格CLI命令参考 |
| Skill | `.trae/skills/lark-openapi-explorer/SKILL.md` | 原生API挖掘指南 |
| Rule | `.trae/rules/项目操作规则.md` | 项目级操作约束 |
| Knowledge | `.trae/Knowledge/业务场景.md` | 业务背景与表结构说明 |

---

**维护说明**：当发现新的技术坑点或更优解法时，请更新本文档并递增版本号。
