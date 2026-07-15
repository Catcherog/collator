# 自动化工具开发需求清单

> **生成时间**：2026-06-18 16:00
> **目标**：提升非结构化数据映射效率，支撑泽怀影像工作室数据治理体系建设
> **适用范围**：collator 项目 Phase 2 治理实施阶段
> **技术栈**：Python + lark-cli + PowerShell（Windows 环境）
> **前置依据**：知识库审视报告、云盘资产统计报告（Phase 1 现状调研成果）

---

## 一、工具需求总览

### 1.1 汇总表

| 序号 | 工具名称 | 功能简述 | 优先级 | 预估工作量（人天） | 依赖关系 | 开发顺序 |
|------|---------|---------|--------|-------------------|---------|---------|
| 1 | 知识库扫描工具 | 扫描知识库节点树，采集元数据，输出 JSON + 树状图 | P0 | 3 | 无（基础工具） | 第 1 批 |
| 2 | 云盘资产统计工具 | 递归遍历云盘目录，采集文件元数据，多维度统计分析 | P0 | 4 | 无（基础工具） | 第 1 批 |
| 3 | 批量重命名工具 | 按命名规范批量重命名知识库节点和云盘文件 | P1 | 3 | 依赖工具 1、2（提供目标清单） | 第 2 批 |
| 4 | 元数据提取工具 | 从非结构化文件提取元数据（OCR/语音/属性/业务标识） | P1 | 5 | 依赖工具 2（提供文件清单） | 第 2 批 |
| 5 | 映射校验工具 | 校验映射关系准确性与完整性，检测异常并生成报告 | P2 | 4 | 依赖工具 1、2、4（提供校验数据源） | 第 3 批 |
| **合计** | — | — | — | **19** | — | 3 批次 |

### 1.2 优先级说明

- **P0（立即开发）**：现状调研基础工具，是后续所有治理动作的数据来源
- **P1（一周后开发）**：治理优化与映射实施工具，依赖 P0 工具的输出
- **P2（一月后开发）**：维护保障工具，依赖前序工具建立的映射关系

### 1.3 依赖关系图

```
┌─────────────────────────────────────────────────────────┐
│  第 1 批（P0 基础工具，并行开发）                         │
│  ┌──────────────────┐    ┌──────────────────────┐      │
│  │ 工具1: 知识库扫描 │    │ 工具2: 云盘资产统计   │      │
│  │ (3人天)          │    │ (4人天)              │      │
│  └────────┬─────────┘    └──────────┬───────────┘      │
│           │                         │                   │
└───────────┼─────────────────────────┼───────────────────┘
            │                         │
            ▼                         ▼
┌─────────────────────────────────────────────────────────┐
│  第 2 批（P1 治理工具，并行开发）                         │
│  ┌──────────────────┐    ┌──────────────────────┐      │
│  │ 工具3: 批量重命名 │    │ 工具4: 元数据提取     │      │
│  │ (3人天)          │    │ (5人天)              │      │
│  │ 依赖: 工具1+2    │    │ 依赖: 工具2          │      │
│  └────────┬─────────┘    └──────────┬───────────┘      │
└───────────┼─────────────────────────┼───────────────────┘
            │                         │
            └────────────┬────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│  第 3 批（P2 保障工具）                                   │
│  ┌──────────────────────────────────────────────┐       │
│  │ 工具5: 映射校验 (4人天)                       │       │
│  │ 依赖: 工具1+2+4                              │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

---

## 二、详细需求

### 工具 1: 知识库扫描工具（SubTask 7.1）

#### 2.1.1 功能描述

扫描飞书知识库的完整节点树，采集每个节点的元数据（标题、类型、创建时间、更新时间、所有者、父子关系等），输出结构化 JSON 报告和可视化 Markdown 树状图。

**核心价值**：
- 替代手动 `lark-cli wiki nodes list` 逐层调用，实现一键全量扫描
- 为命名规范治理（工具 3）和映射校验（工具 5）提供数据基础
- 沉淀 Phase 1 知识库审视报告的扫描逻辑，支持定期复扫

**基于 Phase 1 报告的实际发现**：
- 知识库共 31 个节点，6 个一级节点 + 25 个二级节点，最大层级 = 2
- 存在 5 个命名不规范节点（缺失数字前缀）
- 存在 4 个僵尸/占位节点（创建后从未更新）
- 所有节点均为 docx 类型，所有者单一

#### 2.1.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 主语言 | Python 3.10+ | 跨平台、JSON 处理能力强、生态丰富 |
| API 调用 | lark-cli（wiki nodes list 子命令） | 项目已封装的飞书 Wiki CLI，支持递归列出节点 |
| 树可视化 | networkx + 手写 Markdown 树生成器 | networkx 用于构建节点关系图，Markdown 树用于人工审阅 |
| 数据存储 | JSON 文件（结构化）+ Markdown 文件（可读） | 与项目现有报告格式一致 |
| 配置管理 | YAML 配置文件 | 可读性好，支持注释 |

**关键 lark-cli 命令**：
```bash
# 列出知识库节点（递归）
lark-cli wiki nodes list --space-id 7633338901909785795 --as user
```

#### 2.1.3 输入输出

**输入**：

| 参数 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| space_id | string | 是 | 知识库 Space ID | `7633338901909785795` |
| output_dir | string | 否 | 输出目录，默认 `docs/reports/` | `docs/reports/` |
| max_depth | int | 否 | 最大递归深度，默认无限制 | `3` |
| include_content | bool | 否 | 是否采集节点正文摘要，默认 false | `false` |

**输出**：

1. **结构化 JSON 报告**：`docs/reports/wiki_scan_{timestamp}.json`
```json
{
  "scan_meta": {
    "space_id": "7633338901909785795",
    "space_name": "泽怀影像知识库",
    "scan_time": "2026-06-18T16:00:00+08:00",
    "total_nodes": 31,
    "max_depth": 2
  },
  "nodes": [
    {
      "node_token": "S0KEwYuQmi8TO1kK4SrcROH6nYf",
      "parent_node_token": null,
      "title": "泽怀影像中台 — 系统使用指南",
      "obj_type": "docx",
      "node_type": "origin",
      "obj_create_time": "2026-05-10T21:31:00+08:00",
      "obj_edit_time": "2026-06-14T20:16:00+08:00",
      "owner": "ou_e8cf2c7468a6161317cc908eb7941562",
      "has_child": true,
      "depth": 1,
      "path": "/泽怀影像中台 — 系统使用指南"
    }
  ],
  "statistics": {
    "by_type": {"docx": 31},
    "by_depth": {"1": 6, "2": 25},
    "by_owner": {"ou_e8cf2c7468a6161317cc908eb7941562": 31},
    "naming_issues": 5,
    "zombie_nodes": 4
  }
}
```

2. **可视化 Markdown 树状图**：`docs/reports/wiki_tree_{timestamp}.md`
```markdown
泽怀影像知识库（Space ID: 7633338901909785795）
│
├── 1. 泽怀影像中台 — 系统使用指南 [token]
│   ├── 01-SOP管理系统总览 [token]
│   └── ...
```

3. **问题节点清单**：`docs/reports/wiki_issues_{timestamp}.md`（命名违规、僵尸节点、占位节点）

#### 2.1.4 核心逻辑

```python
def scan_wiki_space(space_id, max_depth=None):
    """扫描知识库完整节点树"""
    all_nodes = []
    
    # Step 1: 获取根节点列表
    root_nodes = call_lark_cli_wiki_nodes(space_id, parent_node_token=None)
    
    # Step 2: 递归遍历子节点
    for root in root_nodes:
        nodes = traverse_node(root, space_id, current_depth=1, max_depth=max_depth)
        all_nodes.extend(nodes)
    
    # Step 3: 构建节点路径
    for node in all_nodes:
        node['path'] = build_path(node, all_nodes)
    
    # Step 4: 统计分析
    statistics = analyze_statistics(all_nodes)
    
    # Step 5: 检测问题节点
    issues = detect_issues(all_nodes)
    
    return {"nodes": all_nodes, "statistics": statistics, "issues": issues}


def traverse_node(node, space_id, current_depth, max_depth):
    """递归遍历单个节点的子节点"""
    result = [node]
    if max_depth and current_depth >= max_depth:
        return result
    if not node.get('has_child'):
        return result
    
    children = call_lark_cli_wiki_nodes(space_id, parent_node_token=node['node_token'])
    for child in children:
        child['depth'] = current_depth + 1
        result.extend(traverse_node(child, space_id, current_depth + 1, max_depth))
    
    return result


def detect_issues(nodes):
    """检测问题节点（基于 Phase 1 报告规则）"""
    issues = []
    for node in nodes:
        # 命名规范检查：同级节点应有数字前缀
        if not has_number_prefix(node['title']):
            siblings = get_siblings(node, nodes)
            if any(has_number_prefix(s['title']) for s in siblings):
                issues.append({"type": "naming", "node": node, "desc": "缺失数字前缀"})
        
        # 僵尸节点检查：创建后从未更新
        if node['obj_create_time'] == node['obj_edit_time']:
            age_days = days_since(node['obj_create_time'])
            if age_days > 30:
                issues.append({"type": "zombie", "node": node, "desc": "创建后从未更新"})
        
        # 占位节点检查：标题含【待补充】等标记
        if '【' in node['title'] and ('待补充' in node['title'] or 'TODO' in node['title']):
            issues.append({"type": "placeholder", "node": node, "desc": "占位节点未清理"})
    
    return issues
```

#### 2.1.5 异常处理

| 异常场景 | 处理策略 | 实现 |
|---------|---------|------|
| API 限频（429） | 指数退避重试，最大 3 次 | `retry_with_backoff(max_retries=3, base_delay=1s)` |
| Token 失效（91402） | 提示重新认证，终止扫描 | 捕获错误码，输出认证指引 |
| 节点已删除 | 跳过并记录警告 | `try-except` 包裹单节点调用，记录到 `skipped_nodes` |
| 网络超时 | 单节点超时 30s，重试 2 次 | `timeout=30`，重试间隔 2s |
| 分页 token 失效 | 重新发起首页请求 | 记录已采集节点，从断点续扫 |
| 节点数量过大（>500） | 分批输出，每 100 节点写入一次 | 流式写入 JSON，避免内存溢出 |

#### 2.1.6 优先级与工作量

- **优先级**：P0（现状调研基础工具，是工具 3、5 的数据来源）
- **预估工作量**：3 人天
  - Day 1：API 调用封装 + 递归遍历逻辑（1 人天）
  - Day 2：统计分析 + 问题检测 + Markdown 树生成（1 人天）
  - Day 3：异常处理 + 测试 + 文档（1 人天）

---

### 工具 2: 云盘资产统计工具（SubTask 7.2）

#### 2.2.1 功能描述

递归遍历飞书云盘目录树，采集每个文件/文件夹的元数据（名称、类型、创建/修改时间、所有者、所在目录等），进行多维度统计分析（类型分布、目录分布、时间分布、孤立文件检测、与核心表关联分析），输出结构化 JSON 资产清单和 Markdown 统计报告。

**核心价值**：
- 替代手动 `lark-cli drive files list` 逐目录调用，实现一键全量扫描
- 解决 Phase 1 报告中"深层目录扫描不完整"问题（L4-L5 覆盖率仅 7.7%-27.8%）
- 沉淀云盘资产统计逻辑，支持定期复扫和趋势追踪

**基于 Phase 1 报告的实际发现**：
- 云盘共 130 个项目（68 文件夹 + 62 文件），6 层目录结构
- 原根目录 Token `K9QEfQJCkli462dHDLxcP5K9n7d` 已失效，需使用新 Token
- 孤立文件 9 个（14.5%），关联率 85.5%
- 文件大小信息缺失（飞书云文档 API 不返回 size）
- 照片素材统计不完整（仅扫描 1/30 主题文件夹）

#### 2.2.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 主语言 | Python 3.10+ | 同工具 1 |
| API 调用 | lark-cli（drive files list 子命令） | 项目已封装的飞书 Drive CLI |
| 统计分析 | pandas | DataFrame 处理多维度统计高效 |
| 文件大小获取 | lark-cli api（drive metas batch_query 原生 API） | 补充云文档 API 不返回 size 的问题 |
| 数据存储 | JSON + Markdown | 同工具 1 |

**关键 lark-cli 命令**：
```bash
# 列出云盘目录文件
lark-cli drive files list --folder-token nodcnAEyuStJphFcjenhqsq2NFf --as user

# 批量查询文件元数据（获取 size）
lark-cli api POST "/open-apis/drive/v1/metas/batch_query" --data @metas_request.json
```

#### 2.2.3 输入输出

**输入**：

| 参数 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| root_folder_token | string | 是 | 云盘根目录 Token | `nodcnAEyuStJphFcjenhqsq2NFf` |
| output_dir | string | 否 | 输出目录，默认 `docs/reports/` | `docs/reports/` |
| max_depth | int | 否 | 最大递归深度，默认无限制 | `6` |
| fetch_size | bool | 否 | 是否调用 metas API 获取文件大小，默认 true | `true` |
| core_table_mapping | string | 否 | 核心表关联规则配置文件路径 | `src/config/core_table_mapping.yaml` |

**输出**：

1. **结构化 JSON 资产清单**：`docs/reports/cloud_drive_scan_{timestamp}.json`
```json
{
  "scan_meta": {
    "root_folder_token": "nodcnAEyuStJphFcjenhqsq2NFf",
    "scan_time": "2026-06-18T16:00:00+08:00",
    "total_items": 130,
    "total_folders": 68,
    "total_files": 62,
    "max_depth": 6,
    "scanned_dirs": 26,
    "skipped_dirs": 0
  },
  "items": [
    {
      "token": "LzD9fsxDvlE7ZUdvwsJcODYhnOf",
      "parent_token": "nodcnAEyuStJphFcjenhqsq2NFf",
      "name": "项目文件",
      "type": "folder",
      "url": "",
      "created_time": "2026-02-03T10:00:00+08:00",
      "modified_time": "2026-06-14T20:30:00+08:00",
      "owner": "ou_e8cf2c7468a6161317cc908eb7941562",
      "size": null,
      "depth": 1,
      "path": "/项目文件"
    }
  ],
  "statistics": {
    "by_type": {"folder": 68, "docx": 33, "sheet": 13, "file": 7, "bitable": 3, "shortcut": 3, "slides": 2, "mindnote": 1},
    "by_depth": {"1": 11, "2": 5, "3": 18, "4": 56, "5": 24, "6": 16},
    "by_owner": {"ou_e8cf2c7468a6161317cc908eb7941562": 128, "ou_d9eddd4aabfc28eb73dfc610fe7ce16d": 2},
    "orphan_files": 9,
    "core_table_relation": {
      "客户信息主表": 30,
      "拍摄执行表": 44,
      "订单管理表": 6,
      "模特信息表": 7,
      "客户咨询表": 3,
      "话术库": 0,
      "异常日志表": 0
    }
  }
}
```

2. **Markdown 统计报告**：`docs/reports/cloud_drive_stats_{timestamp}.md`（含目录树、分类统计、异常清单）

3. **孤立文件清单**：`docs/reports/orphan_files_{timestamp}.md`

#### 2.2.4 核心逻辑

```python
def scan_cloud_drive(root_token, max_depth=None, fetch_size=True):
    """递归扫描云盘完整目录树"""
    all_items = []
    
    # Step 1: 递归遍历目录
    all_items = traverse_folder(root_token, current_depth=1, max_depth=max_depth)
    
    # Step 2: 补充文件大小信息（可选）
    if fetch_size:
        file_tokens = [i['token'] for i in all_items if i['type'] == 'file']
        size_map = batch_query_metas(file_tokens)
        for item in all_items:
            if item['token'] in size_map:
                item['size'] = size_map[item['token']]
    
    # Step 3: 构建完整路径
    for item in all_items:
        item['path'] = build_path(item, all_items)
    
    # Step 4: 多维度统计分析
    statistics = analyze_with_pandas(all_items)
    
    # Step 5: 孤立文件检测
    orphans = detect_orphan_files(all_items)
    
    # Step 6: 核心表关联分析
    relations = analyze_core_table_relation(all_items)
    
    return {"items": all_items, "statistics": statistics, "orphans": orphans, "relations": relations}


def traverse_folder(folder_token, current_depth, max_depth):
    """递归遍历单个文件夹"""
    items = []
    page_token = None
    
    # 分页获取文件夹内容
    while True:
        result = call_lark_cli_drive_files(folder_token, page_token=page_token)
        files = result.get('files', [])
        items.extend(files)
        page_token = result.get('next_page_token')
        if not page_token:
            break
    
    # 递归处理子文件夹
    if max_depth and current_depth >= max_depth:
        return items
    
    for item in items:
        if item['type'] == 'folder':
            children = traverse_folder(item['token'], current_depth + 1, max_depth)
            for child in children:
                child['depth'] = current_depth + 1
            items.extend(children)
    
    return items


def detect_orphan_files(items):
    """检测孤立文件（无法关联到核心表的文件）"""
    orphans = []
    business_keywords = ['客户', '订单', '拍摄', '模特', '话术', '合同', '报价', '策划', '成品', '资源']
    
    for item in items:
        if item['type'] == 'folder':
            continue
        
        name = item['name']
        # 规则1：文件名为空
        if not name or name.strip() == '':
            orphans.append({"item": item, "reason": "文件名为空"})
            continue
        
        # 规则2：文件名不含任何业务关键词
        if not any(kw in name for kw in business_keywords):
            # 规则3：会议纪要类（间接关联）
            if '会议' in name or '纪要' in name:
                orphans.append({"item": item, "reason": "会议纪要，间接关联", "level": "partial"})
            else:
                orphans.append({"item": item, "reason": "无业务标识关键词", "level": "full"})
    
    return orphans


def batch_query_metas(file_tokens):
    """批量查询文件元数据获取大小（分批，每批50个）"""
    size_map = {}
    batch_size = 50
    
    for i in range(0, len(file_tokens), batch_size):
        batch = file_tokens[i:i + batch_size]
        request_body = {"request_docs": [{"doc_token": t, "doc_type": "file"} for t in batch]}
        
        # 写入临时文件（避免 PowerShell JSON 传递问题）
        with open('metas_request.json', 'w', encoding='utf-8') as f:
            json.dump(request_body, f)
        
        result = call_lark_cli_api('POST', '/open-apis/drive/v1/metas/batch_query', data_file='metas_request.json')
        
        for meta in result.get('data', {}).get('docs', []):
            size_map[meta['doc_token']] = meta.get('size')
    
    return size_map
```

#### 2.2.5 异常处理

| 异常场景 | 处理策略 | 实现 |
|---------|---------|------|
| 根目录 Token 失效（1061007） | 提示 Token 已删除，建议使用新 Token | 捕获错误码，输出配置更新指引 |
| 子目录 Token 失效 | 跳过该目录，记录到 `skipped_dirs` | `try-except` 包裹，继续扫描其他目录 |
| API 限频 | 每次调用间隔 200ms，限频时指数退避 | `time.sleep(0.2)` + 重试机制 |
| metas API 不支持某类型 | 跳过 size 获取，记录 `size=null` | 按类型过滤，仅查询 `type=file` |
| 深层目录数量大 | 分批写入，每 200 项写入一次 | 流式写入 JSON |
| 网络超时 | 单次调用超时 30s，重试 2 次 | `timeout=30` |

#### 2.2.6 优先级与工作量

- **优先级**：P0（现状调研基础工具，是工具 3、4、5 的数据来源）
- **预估工作量**：4 人天
  - Day 1：API 调用封装 + 递归遍历逻辑（1 人天）
  - Day 2：metas API 集成 + 文件大小补充（1 人天）
  - Day 3：pandas 统计分析 + 孤立文件检测 + 核心表关联（1 人天）
  - Day 4：异常处理 + 测试 + 文档（1 人天）

---

### 工具 3: 批量重命名工具（SubTask 7.3）

#### 2.3.1 功能描述

按预定义的命名规范，批量重命名飞书知识库节点和云盘文件/文件夹。支持重命名前预览（dry-run）、批量操作限频控制、命名冲突检测、操作回滚机制，输出详细的重命名执行报告。

**核心价值**：
- 解决 Phase 1 报告中发现的命名不规范问题（知识库 5 个节点、云盘空名称文档等）
- 替代手动逐个重命名，支持批量操作
- 提供安全机制（预览 + 回滚），避免误操作

**基于 Phase 1 报告的实际发现**：
- 知识库：5 个节点缺失数字前缀（接客话术、运营日报模板、拍摄项目总结模板、SOP考核表、数据分析与复盘流程）
- 知识库：1 个一级节点命名风格不一致（"泽怀影像中台 — 系统使用指南"）
- 云盘：1 个空名称文档（项目文件/写真业务/作品下）
- 云盘：1 个笼统命名文件（"热点.docx"）

#### 2.3.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 主语言 | Python 3.10+ | 同工具 1 |
| API 调用 | lark-cli（wiki nodes update + drive files rename） | 项目已封装的重命名 CLI |
| 规则引擎 | 自定义 Python 规则匹配 | 命名规则相对简单，无需重型规则引擎 |
| 预览机制 | dry-run 模式 + diff 输出 | 安全第一，先预览后执行 |
| 回滚机制 | 操作日志 + 反向操作记录 | 记录原名称，支持手动回滚 |

**关键 lark-cli 命令**：
```bash
# 重命名知识库节点
lark-cli wiki nodes update --node-token {token} --title "新标题" --as user

# 重命名云盘文件
lark-cli api POST "/open-apis/drive/v1/files/{token}/rename" --data @rename_request.json
```

#### 2.3.3 输入输出

**输入**：

| 参数 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| target_type | string | 是 | 目标类型：`wiki` / `drive` / `both` | `wiki` |
| rename_rules | string | 是 | 重命名规则配置文件路径 | `src/config/rename_rules.yaml` |
| target_tokens | string | 否 | 指定目标 token 列表，缺省则按规则自动匹配 | `tokens.txt` |
| dry_run | bool | 否 | 预览模式，默认 true（安全优先） | `true` |
| rollback_log | string | 否 | 回滚日志路径（用于执行回滚） | `rollback_log.json` |

**重命名规则配置示例**（`src/config/rename_rules.yaml`）：
```yaml
rules:
  - id: "wiki_add_number_prefix"
    target: "wiki"
    description: "为缺失数字前缀的知识库节点补充序号"
    conditions:
      - field: "title"
        operator: "not_match"
        pattern: "^\\d+-"
      - field: "has_siblings_with_prefix"
        operator: "equals"
        value: true
    action:
      type: "add_prefix"
      prefix_source: "next_available_number"
      format: "{number:02d}-{original_title}"
    
  - id: "wiki_normalize_first_level"
    target: "wiki"
    description: "统一一级节点命名风格"
    conditions:
      - field: "depth"
        operator: "equals"
        value: 1
      - field: "title"
        operator: "contains"
        value: "—"
    action:
      type: "replace"
      pattern: "—"
      replacement: "-"
    
  - id: "drive_fill_empty_name"
    target: "drive"
    description: "为空名称文件填充默认名"
    conditions:
      - field: "name"
        operator: "equals"
        value: ""
    action:
      type: "set_name"
      value: "未命名文档_{token_prefix}"
```

**输出**：

1. **预览报告**（dry-run 模式）：`docs/reports/rename_preview_{timestamp}.md`
```markdown
## 重命名预览报告

### 知识库节点（共 5 项待重命名）

| 序号 | 节点路径 | 原标题 | 新标题 | 规则ID |
|------|---------|--------|--------|--------|
| 1 | 一、获客与转化/接客话术与物料发送 SOP | 接客话术与物料发送 SOP | 03-接客话术与物料发送流程 | wiki_add_number_prefix |
| 2 | 五、数据与复盘/运营日报/周报/月报标准化模板 | 运营日报/周报/月报标准化模板 | 01-运营日报周报月报标准化模板 | wiki_add_number_prefix |
```

2. **执行报告**（实际执行模式）：`docs/reports/rename_execution_{timestamp}.md`
```markdown
## 重命名执行报告

### 执行结果汇总
- 总计：5 项
- 成功：4 项
- 失败：1 项（原因：权限不足）
- 跳过：0 项

### 失败详情
| 节点Token | 原标题 | 目标标题 | 错误信息 |
```

3. **回滚日志**：`src/config/rename_rollback_{timestamp}.json`
```json
{
  "operations": [
    {
      "target_type": "wiki",
      "token": "NIiLw8ibXij7v7kaWJxcMqbkn8g",
      "original_title": "接客话术与物料发送 SOP",
      "new_title": "03-接客话术与物料发送流程",
      "timestamp": "2026-06-18T16:30:00+08:00",
      "status": "success"
    }
  ]
}
```

#### 2.3.4 核心逻辑

```python
def batch_rename(target_type, rules_file, dry_run=True, target_tokens=None):
    """批量重命名主流程"""
    
    # Step 1: 加载重命名规则
    rules = load_rename_rules(rules_file)
    
    # Step 2: 获取目标列表
    if target_tokens:
        targets = load_targets_from_file(target_tokens)
    else:
        targets = discover_targets(target_type, rules)
    
    # Step 3: 规则匹配，生成重命名计划
    rename_plan = []
    for target in targets:
        for rule in rules:
            if match_rule(target, rule):
                new_name = apply_action(target, rule['action'])
                if new_name != target['title']:  # 名称确实变化
                    rename_plan.append({
                        "target": target,
                        "original": target['title'],
                        "new": new_name,
                        "rule_id": rule['id']
                    })
    
    # Step 4: 命名冲突检测
    conflicts = detect_naming_conflicts(rename_plan)
    if conflicts:
        rename_plan = resolve_conflicts(rename_plan, conflicts)
    
    # Step 5: 预览模式 - 仅输出报告
    if dry_run:
        generate_preview_report(rename_plan)
        return {"status": "preview", "count": len(rename_plan)}
    
    # Step 6: 执行模式 - 逐项重命名
    results = []
    rollback_log = []
    for item in rename_plan:
        try:
            execute_rename(item)
            results.append({"item": item, "status": "success"})
            rollback_log.append(build_rollback_entry(item))
        except Exception as e:
            results.append({"item": item, "status": "failed", "error": str(e)})
        
        # 限频控制：每次操作间隔 300ms
        time.sleep(0.3)
    
    # Step 7: 输出执行报告和回滚日志
    generate_execution_report(results)
    save_rollback_log(rollback_log)
    
    return {"status": "executed", "success": sum(1 for r in results if r['status'] == 'success')}


def execute_rename(item):
    """执行单个重命名操作"""
    target = item['target']
    new_name = item['new']
    
    if target['type'] == 'wiki':
        # 知识库节点重命名
        cmd = f'lark-cli wiki nodes update --node-token {target["token"]} --title "{new_name}" --as user'
        result = run_command(cmd)
        if result['code'] != 0:
            raise Exception(f"Wiki rename failed: {result['msg']}")
    
    elif target['type'] == 'drive':
        # 云盘文件重命名（使用原生 API + 文件传参）
        request_body = {"name": new_name}
        with open('rename_request.json', 'w', encoding='utf-8') as f:
            json.dump(request_body, f)
        
        cmd = f'lark-cli api POST "/open-apis/drive/v1/files/{target["token"]}/rename" --data @rename_request.json'
        result = run_command(cmd)
        if result['code'] != 0:
            raise Exception(f"Drive rename failed: {result['msg']}")
```

#### 2.3.5 异常处理

| 异常场景 | 处理策略 | 实现 |
|---------|---------|------|
| 权限不足（91402） | 跳过该项，记录失败原因 | `try-except`，记录到失败清单 |
| 命名冲突（同名已存在） | 自动追加序号后缀或跳过 | `detect_naming_conflicts()` + 用户确认 |
| API 限频 | 每次操作间隔 300ms，限频时退避 | `time.sleep(0.3)` + 重试 |
| 网络超时 | 单次超时 30s，重试 2 次 | `timeout=30` |
| 回滚需求 | 提供回滚命令，基于回滚日志反向操作 | `rollback` 子命令读取日志执行 |
| 部分失败 | 不影响其他项，继续执行 | 单项异常不中断批量流程 |

#### 2.3.6 优先级与工作量

- **优先级**：P1（治理优化工具，依赖工具 1、2 提供目标清单）
- **预估工作量**：3 人天
  - Day 1：规则引擎 + 规则匹配逻辑（1 人天）
  - Day 2：重命名执行 + 限频控制 + 回滚机制（1 人天）
  - Day 3：预览报告 + 冲突检测 + 测试（1 人天）

---

### 工具 4: 元数据提取工具（SubTask 7.4）

#### 2.4.1 功能描述

从非结构化文件中自动提取元数据，包括：图片 OCR 文字识别、语音/视频转写、文件属性提取、业务标识正则匹配。提取的元数据用于建立文件与核心多维表的映射关系。

**核心价值**：
- 解决 Phase 1 报告中"30 个作品文件夹仅扫描 1 个"的元数据缺失问题
- 为照片素材、会议纪要、策划案等非结构化文件建立业务关联
- 支撑映射校验工具（工具 5）的元数据完整性检查

**基于 Phase 1 报告的实际发现**：
- 30 个作品主题文件夹，仅 1 个（28_夏合情思）扫描了 7 张 jpg 照片
- 6 份会议纪要无法通过文件名关联业务，需提取正文关键词
- 14 份策划案文档需提取客户名、拍摄主题、日期等业务标识
- 短视频/花絮文件夹为空，待上传后需提取视频元数据

#### 2.4.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 主语言 | Python 3.10+ | 同工具 1 |
| OCR 引擎 | Tesseract OCR（本地）+ 飞书图片识别 API（云端备选） | Tesseract 开源免费，飞书 API 准确率更高 |
| 语音转写 | 飞书妙记 API（lark-cli minutes） | 项目已有 lark-minutes skill，支持音视频转写 |
| 文件属性 | lark-cli drive metas + Python 文件解析 | 获取文件大小、类型、创建时间等 |
| 业务标识 | Python re 模块（正则匹配） | 业务标识规则相对固定，正则足够 |
| 文档正文 | lark-cli doc get（读取 docx 正文） | 提取文档内容用于关键词匹配 |

**关键 lark-cli 命令**：
```bash
# 读取文档正文
lark-cli doc get --doc-id {token} --as user

# 上传音视频生成妙记（转写）
lark-cli minutes upload --file {local_path} --as user

# 查询妙记转写结果
lark-cli minutes get --minute-id {id} --as user
```

#### 2.4.3 输入输出

**输入**：

| 参数 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| file_list | string | 是 | 待处理文件列表（JSON，来自工具 2 输出） | `cloud_drive_scan_xxx.json` |
| extractors | list | 否 | 启用的提取器列表，默认全部 | `["ocr", "transcribe", "property", "business_id"]` |
| business_rules | string | 否 | 业务标识正则规则配置 | `src/config/business_id_rules.yaml` |
| output_dir | string | 否 | 输出目录 | `docs/reports/` |

**业务标识规则配置示例**（`src/config/business_id_rules.yaml`）：
```yaml
rules:
  - id: "customer_name"
    name: "客户姓名"
    patterns:
      - regex: "客户[：:]\\s*([\\u4e00-\\u9fa5]{2,4})"
        group: 1
      - regex: "([\\u4e00-\\u9fa5]{2,4})老师"
        group: 1
    target_table: "客户信息主表"
    target_field: "客户姓名"
    
  - id: "shoot_date"
    name: "拍摄日期"
    patterns:
      - regex: "(\\d{4})[年/-](\\d{1,2})[月/-](\\d{1,2})"
        group: "full"
        format: "{0}-{1:02d}-{2:02d}"
    target_table: "拍摄执行表"
    target_field: "拍摄日期"
    
  - id: "shoot_theme"
    name: "拍摄主题"
    patterns:
      - regex: "主题[：:]\\s*(.+?)[\\n，,]"
        group: 1
      - regex: "^([\\u4e00-\\u9fa5]+)_"
        group: 1
    target_table: "拍摄执行表"
    target_field: "拍摄主题"
    
  - id: "order_amount"
    name: "订单金额"
    patterns:
      - regex: "金额[：:]\\s*(\\d+[.]?\\d*)\\s*元"
        group: 1
    target_table: "订单管理表"
    target_field: "订单金额"
```

**输出**：

1. **元数据 JSON**：`docs/reports/file_metadata_{timestamp}.json`
```json
{
  "extract_meta": {
    "extract_time": "2026-06-18T16:00:00+08:00",
    "total_files": 62,
    "extracted": 55,
    "failed": 7,
    "extractors_used": ["property", "business_id", "ocr", "transcribe"]
  },
  "files": [
    {
      "token": "xxx",
      "name": "28_夏合情思_策划案.docx",
      "type": "docx",
      "path": "/项目文件/泽怀影像/1.项目归档库/策划案",
      "metadata": {
        "property": {
          "size": 102400,
          "created_time": "2026-04-27T12:28:00+08:00",
          "modified_time": "2026-06-11T19:15:00+08:00",
          "owner": "ou_e8cf2c7468a6161317cc908eb7941562"
        },
        "business_id": {
          "customer_name": "夏合情思",
          "shoot_theme": "夏合情思",
          "shoot_date": null,
          "order_amount": null
        },
        "ocr": null,
        "transcribe": null,
        "content_summary": "本策划案针对夏合情思主题拍摄..."
      },
      "relation": {
        "target_table": "拍摄执行表",
        "confidence": 0.95,
        "match_field": "拍摄主题"
      }
    },
    {
      "token": "yyy",
      "name": "28_夏合情思_001.jpg",
      "type": "file",
      "metadata": {
        "property": {"size": 2048000},
        "ocr": {
          "text": "夏合情思 2026.04 段老师",
          "confidence": 0.89
        },
        "business_id": {
          "customer_name": "段老师",
          "shoot_theme": "夏合情思",
          "shoot_date": "2026-04"
        }
      },
      "relation": {
        "target_table": "客户信息主表",
        "confidence": 0.88
      }
    }
  ]
}
```

2. **提取失败清单**：`docs/reports/extraction_failures_{timestamp}.md`

#### 2.4.4 核心逻辑

```python
def extract_metadata(file_list, extractors=None, business_rules=None):
    """从文件列表提取元数据"""
    if extractors is None:
        extractors = ["ocr", "transcribe", "property", "business_id"]
    
    rules = load_business_rules(business_rules) if business_rules else []
    results = []
    failures = []
    
    for file_info in file_list:
        try:
            metadata = {}
            
            # Step 1: 提取文件属性（基础）
            if "property" in extractors:
                metadata['property'] = extract_property(file_info)
            
            # Step 2: 根据文件类型选择内容提取器
            content = None
            if file_info['type'] == 'docx':
                content = extract_docx_content(file_info['token'])
            elif file_info['type'] == 'sheet':
                content = extract_sheet_content(file_info['token'])
            elif file_info['type'] == 'file' and is_image(file_info['name']):
                if "ocr" in extractors:
                    metadata['ocr'] = extract_ocr(file_info)
                    content = metadata['ocr']['text']
            elif is_audio_video(file_info['name']):
                if "transcribe" in extractors:
                    metadata['transcribe'] = extract_transcribe(file_info)
                    content = metadata['transcribe']['text']
            
            # Step 3: 业务标识正则匹配
            if "business_id" in extractors and content:
                metadata['business_id'] = extract_business_id(content, rules)
            
            # Step 4: 建立业务关联
            relation = build_relation(metadata, rules)
            
            results.append({
                "token": file_info['token'],
                "name": file_info['name'],
                "type": file_info['type'],
                "metadata": metadata,
                "relation": relation
            })
            
        except Exception as e:
            failures.append({"file": file_info, "error": str(e)})
    
    return {"files": results, "failures": failures}


def extract_ocr(file_info):
    """OCR 提取图片文字"""
    # Step 1: 下载图片到本地临时目录
    local_path = download_file(file_info['token'], temp_dir='src/scripts/temp/')
    
    # Step 2: 调用 Tesseract OCR
    try:
        import pytesseract
        from PIL import Image
        
        image = Image.open(local_path)
        text = pytesseract.image_to_string(image, lang='chi_sim+eng')
        confidence = estimate_ocr_confidence(image)
        
        return {"text": text.strip(), "confidence": confidence}
    finally:
        # 清理临时文件
        os.remove(local_path)


def extract_transcribe(file_info):
    """语音/视频转写"""
    # Step 1: 下载音视频文件
    local_path = download_file(file_info['token'], temp_dir='src/scripts/temp/')
    
    # Step 2: 上传到飞书妙记生成转写
    upload_result = call_lark_cli_minutes_upload(local_path)
    minute_id = upload_result['minute_id']
    
    # Step 3: 轮询转写结果（异步任务）
    for _ in range(60):  # 最多等待 30 分钟
        time.sleep(30)
        minute_info = call_lark_cli_minutes_get(minute_id)
        if minute_info['status'] == 'completed':
            return {
                "text": minute_info['transcript'],
                "minute_id": minute_id,
                "duration": minute_info.get('duration')
            }
        elif minute_info['status'] == 'failed':
            raise Exception(f"Transcription failed: {minute_info.get('error')}")
    
    raise Exception("Transcription timeout (30 minutes)")


def extract_business_id(content, rules):
    """业务标识正则匹配"""
    extracted = {}
    for rule in rules:
        for pattern in rule['patterns']:
            match = re.search(pattern['regex'], content)
            if match:
                value = match.group(pattern.get('group', 0))
                if 'format' in pattern:
                    value = pattern['format'].format(*match.groups())
                extracted[rule['id']] = value
                break
        else:
            extracted[rule['id']] = None
    
    return extracted
```

#### 2.4.5 异常处理

| 异常场景 | 处理策略 | 实现 |
|---------|---------|------|
| OCR 准确率低（<70%） | 标记低置信度，建议人工复核 | `confidence < 0.7` 时标记 `needs_review` |
| OCR 引擎未安装 | 降级为仅提取文件名业务标识 | 检测 Tesseract 可用性，不可用时跳过 OCR |
| 语音转写超时 | 记录失败，支持后续重试 | 30 分钟超时，记录到失败清单 |
| 文档正文读取失败 | 降级为仅提取文件名 | `try-except` 包裹，记录警告 |
| 业务标识无匹配 | 返回 null，不影响其他字段 | 单字段失败不中断 |
| 大文件下载超时 | 分片下载，超时 5 分钟 | 飞书 drive 支持分片下载 |
| 临时文件清理 | finally 块确保清理 | `try-finally` 模式 |

#### 2.4.6 优先级与工作量

- **优先级**：P1（映射实施核心工具，依赖工具 2 提供文件清单）
- **预估工作量**：5 人天
  - Day 1：文件属性提取 + 文档正文读取（1 人天）
  - Day 2：OCR 集成 + 图片文字识别（1 人天）
  - Day 3：语音转写集成 + 妙记 API 对接（1 人天）
  - Day 4：业务标识正则规则引擎 + 关联建立（1 人天）
  - Day 5：异常处理 + 批量处理 + 测试（1 人天）

---

### 工具 5: 映射校验工具（SubTask 7.5）

#### 2.5.1 功能描述

校验非结构化文件与核心多维表之间映射关系的准确性与完整性，检测三类异常（孤立文件、映射冲突、元数据缺失），生成校验报告并提供修复建议。支持定时任务集成，实现周期性（周/月）自动校验。

**核心价值**：
- 沉淀 Phase 1 报告中的关联分析逻辑，实现自动化校验
- 持续监控映射质量，从 85.5% 关联率提升至 95%+
- 提前发现命名违规、元数据缺失等问题，防止数据治理退化

**基于 Phase 1 报告的实际发现**：
- 孤立文件 9 个（14.5%），需持续监控
- 话术库、异常日志表与云盘无关联（设计如此，需排除误报）
- 文件大小信息缺失，需定期补充
- 命名规范执行后可能出现回退，需定期校验

#### 2.5.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 主语言 | Python 3.10+ | 同工具 1 |
| API 调用 | lark-cli（base records + wiki nodes + drive files） | 综合查询多维表、知识库、云盘 |
| 规则引擎 | 自定义 Python 规则 + YAML 配置 | 校验规则可配置化 |
| 定时任务 | Windows 任务计划程序 + PowerShell 脚本 | Windows 环境原生支持 |
| 报告生成 | Jinja2 模板引擎 | 报告格式灵活可定制 |

**关键 lark-cli 命令**：
```bash
# 查询多维表记录
lark-cli base records list --app-token MwGMbF0Q0alPc6s3jOccovvOnob --table-id {table_id} --as user

# 查询知识库节点
lark-cli wiki nodes list --space-id 7633338901909785795 --as user

# 查询云盘文件
lark-cli drive files list --folder-token nodcnAEyuStJphFcjenhqsq2NFf --as user
```

#### 2.5.3 输入输出

**输入**：

| 参数 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| check_period | string | 否 | 校验周期：`weekly` / `monthly` / `adhoc`，默认 `adhoc` | `weekly` |
| check_rules | string | 否 | 校验规则配置文件 | `src/config/check_rules.yaml` |
| baseline_data | string | 否 | 基线数据（上次校验结果），用于趋势对比 | `docs/reports/check_baseline.json` |
| data_sources | string | 否 | 数据源配置（多维表/知识库/云盘 Token） | `src/config/data_sources.yaml` |

**校验规则配置示例**（`src/config/check_rules.yaml`）：
```yaml
rules:
  # 异常类型1：孤立文件检测
  - id: "orphan_file_check"
    name: "孤立文件检测"
    severity: "warning"
    description: "检测无法关联到任何核心表的云盘文件"
    logic:
      source: "cloud_drive"
      condition: "no_business_relation"
      exclude_patterns:
        - "^会议纪要.*"  # 会议纪要允许间接关联
        - "^AI.*指南.*"  # 通用工具文档允许孤立
    threshold:
      max_orphan_rate: 0.05  # 孤立率阈值 5%
    
  # 异常类型2：映射冲突检测
  - id: "mapping_conflict_check"
    name: "映射冲突检测"
    severity: "error"
    description: "检测同一文件关联到多个核心表记录的情况"
    logic:
      condition: "multiple_relations"
      conflict_resolution: "manual"
    
  # 异常类型3：元数据缺失检测
  - id: "metadata_missing_check"
    name: "元数据缺失检测"
    severity: "warning"
    description: "检测已关联文件的关键元数据字段缺失"
    logic:
      required_fields: ["customer_name", "shoot_date", "shoot_theme"]
      condition: "field_is_null"
    
  # 异常类型4：命名违规检测
  - id: "naming_violation_check"
    name: "命名违规检测"
    severity: "warning"
    description: "检测不符合命名规范的文件/节点"
    logic:
      wiki_rules:
        - "siblings_must_have_number_prefix"
      drive_rules:
        - "name_must_not_be_empty"
        - "name_must_contain_business_keyword"
```

**输出**：

1. **校验报告**：`docs/reports/mapping_check_{timestamp}.md`
```markdown
# 映射关系校验报告

> 校验时间：2026-06-18 16:00
> 校验周期：weekly
> 数据源：多维表 + 知识库 + 云盘

## 一、校验结果总览

| 指标 | 当前值 | 上期值 | 趋势 | 阈值 | 状态 |
|------|--------|--------|------|------|------|
| 文件总数 | 62 | 60 | ↑2 | - | - |
| 已关联文件数 | 53 | 51 | ↑2 | - | - |
| 孤立文件数 | 9 | 9 | →0 | ≤3 | ⚠️ 超标 |
| 孤立率 | 14.5% | 15.0% | ↓0.5% | ≤5% | ⚠️ 超标 |
| 关联率 | 85.5% | 85.0% | ↑0.5% | ≥95% | ⚠️ 未达标 |
| 映射冲突数 | 0 | 0 | →0 | 0 | ✅ 达标 |
| 元数据缺失数 | 12 | 15 | ↓3 | ≤5 | ⚠️ 超标 |
| 命名违规数 | 6 | 8 | ↓2 | 0 | ⚠️ 超标 |

## 二、异常详情

### 2.1 孤立文件（9 项，超标）
| 文件名 | 类型 | 所在目录 | 孤立原因 | 修复建议 |
|--------|------|---------|---------|---------|
| （空名称）.docx | docx | 项目文件/写真业务/作品 | 文件名为空 | 重命名为具体业务标识 |

### 2.2 映射冲突（0 项，达标）

### 2.3 元数据缺失（12 项，超标）
| 文件名 | 关联表 | 缺失字段 | 修复建议 |
|--------|--------|---------|---------|
| 28_夏合情思_策划案.docx | 拍摄执行表 | shoot_date | 补充拍摄日期 |

### 2.4 命名违规（6 项，超标）
| 节点/文件 | 类型 | 违规描述 | 修复建议 |
|-----------|------|---------|---------|
| 接客话术与物料发送 SOP | wiki | 缺失数字前缀 | 重命名为 03-接客话术与物料发送流程 |

## 三、修复建议优先级
1. P0：重命名空名称文档（影响关联识别）
2. P0：补充 12 项元数据缺失（影响映射完整性）
3. P1：重命名 6 项命名违规（影响规范一致性）
4. P2：处理 9 项孤立文件（降低孤立率）
```

2. **基线数据 JSON**：`docs/reports/check_baseline_{timestamp}.json`（供下次校验对比）

#### 2.5.4 核心逻辑

```python
def run_mapping_check(check_rules, data_sources, baseline_data=None):
    """映射校验主流程"""
    
    # Step 1: 加载校验规则和数据源配置
    rules = load_check_rules(check_rules)
    sources = load_data_sources(data_sources)
    
    # Step 2: 采集三端数据
    base_records = fetch_base_records(sources['base_token'])
    wiki_nodes = fetch_wiki_nodes(sources['space_id'])
    drive_files = fetch_drive_files(sources['root_folder_token'])
    
    # Step 3: 构建当前映射关系
    current_mapping = build_mapping_relation(base_records, wiki_nodes, drive_files)
    
    # Step 4: 执行各类校验规则
    results = {}
    for rule in rules:
        rule_id = rule['id']
        if rule_id == 'orphan_file_check':
            results[rule_id] = check_orphan_files(drive_files, current_mapping, rule)
        elif rule_id == 'mapping_conflict_check':
            results[rule_id] = check_mapping_conflicts(current_mapping, rule)
        elif rule_id == 'metadata_missing_check':
            results[rule_id] = check_metadata_missing(current_mapping, rule)
        elif rule_id == 'naming_violation_check':
            results[rule_id] = check_naming_violation(wiki_nodes, drive_files, rule)
    
    # Step 5: 与基线数据对比，计算趋势
    if baseline_data:
        trends = calculate_trends(results, baseline_data)
    else:
        trends = None
    
    # Step 6: 生成校验报告和修复建议
    report = generate_check_report(results, trends, rules)
    suggestions = generate_repair_suggestions(results)
    
    # Step 7: 保存新的基线数据
    save_baseline(results)
    
    return {"report": report, "suggestions": suggestions, "trends": trends}


def check_orphan_files(drive_files, mapping, rule):
    """孤立文件检测"""
    orphans = []
    exclude_patterns = rule['logic'].get('exclude_patterns', [])
    
    for file_info in drive_files:
        if file_info['type'] == 'folder':
            continue
        
        # 检查是否在排除模式中
        if any(re.match(p, file_info['name']) for p in exclude_patterns):
            continue
        
        # 检查是否有业务关联
        relations = mapping.get_relations(file_info['token'])
        if not relations:
            orphans.append({
                "file": file_info,
                "reason": "无业务关联",
                "suggestion": suggest_relation(file_info)
            })
    
    orphan_rate = len(orphans) / len([f for f in drive_files if f['type'] != 'folder'])
    threshold_exceeded = orphan_rate > rule['threshold']['max_orphan_rate']
    
    return {
        "count": len(orphans),
        "rate": orphan_rate,
        "threshold_exceeded": threshold_exceeded,
        "details": orphans
    }


def generate_repair_suggestions(results):
    """生成修复建议（按优先级排序）"""
    suggestions = []
    
    # P0: 影响关联识别的问题
    for item in results.get('naming_violation_check', {}).get('details', []):
        if 'empty' in item.get('violation', '').lower():
            suggestions.append({
                "priority": "P0",
                "issue": "空名称文件",
                "action": f"重命名 {item['name']}",
                "tool": "工具3: 批量重命名工具"
            })
    
    # P0: 元数据缺失
    for item in results.get('metadata_missing_check', {}).get('details', []):
        suggestions.append({
            "priority": "P0",
            "issue": f"元数据缺失: {item['missing_fields']}",
            "action": f"补充 {item['name']} 的元数据",
            "tool": "工具4: 元数据提取工具"
        })
    
    # P1: 命名违规
    for item in results.get('naming_violation_check', {}).get('details', []):
        suggestions.append({
            "priority": "P1",
            "issue": "命名违规",
            "action": f"重命名 {item['name']}",
            "tool": "工具3: 批量重命名工具"
        })
    
    # P2: 孤立文件
    for item in results.get('orphan_file_check', {}).get('details', []):
        suggestions.append({
            "priority": "P2",
            "issue": "孤立文件",
            "action": f"建立 {item['name']} 的业务关联或归档",
            "tool": "人工处理"
        })
    
    return suggestions
```

#### 2.5.5 异常处理

| 异常场景 | 处理策略 | 实现 |
|---------|---------|------|
| 数据源不可达（多维表/知识库/云盘） | 跳过该数据源，记录警告，部分校验 | `try-except` 包裹单数据源 |
| 规则配置错误 | 加载时校验，报错终止 | YAML schema 校验 |
| 基线数据缺失 | 首次运行无趋势对比，仅输出当前值 | `if baseline_data` 判断 |
| 校验项过多（>1000） | 分批处理，流式输出 | 每 100 项写入一次 |
| 定时任务失败 | 邮件/消息通知管理员 | PowerShell 脚本捕获异常发送通知 |

**定时任务集成**（PowerShell 脚本示例）：
```powershell
# weekly_check.ps1 - 每周映射校验定时任务
$python = "python"
$script = "d:\360Downloads\Trae 项目\collator\src\scripts\mapping_check.py"
$log = "d:\360Downloads\Trae 项目\collator\docs\reports\weekly_check.log"

try {
    & $python $script --check-period weekly 2>&1 | Tee-Object -FilePath $log
    Write-Output "[$(Get-Date)] Weekly check completed successfully"
} catch {
    Write-Output "[$(Get-Date)] Weekly check failed: $_"
    # 发送失败通知（可集成飞书消息）
}
```

#### 2.5.6 优先级与工作量

- **优先级**：P2（维护保障工具，依赖工具 1、2、4 提供校验数据源）
- **预估工作量**：4 人天
  - Day 1：三端数据采集 + 映射关系构建（1 人天）
  - Day 2：四类校验规则实现（1 人天）
  - Day 3：趋势对比 + 报告生成 + 修复建议（1 人天）
  - Day 4：定时任务集成 + 测试 + 文档（1 人天）

---

## 三、开发顺序建议

### 3.1 开发路线图

```
Week 1（第 1 批，P0 基础工具）
┌─────────────────────────────────────────────────────┐
│  Day 1-3: 工具1 知识库扫描工具（3人天）              │
│  · 封装 lark-cli wiki nodes list                    │
│  · 实现递归遍历 + 统计分析                          │
│  · 输出 JSON + Markdown 树状图                      │
│                                                     │
│  Day 1-4: 工具2 云盘资产统计工具（4人天，并行）      │
│  · 封装 lark-cli drive files list                  │
│  · 集成 metas API 获取文件大小                      │
│  · pandas 多维度统计 + 孤立文件检测                 │
└─────────────────────────────────────────────────────┘
                          ↓
Week 2-3（第 2 批，P1 治理工具）
┌─────────────────────────────────────────────────────┐
│  Day 5-7: 工具3 批量重命名工具（3人天）              │
│  · 依赖工具1+2 输出的问题节点/文件清单              │
│  · 实现规则引擎 + dry-run 预览 + 回滚机制           │
│  · 执行知识库 5 节点 + 云盘 2 文件的重命名          │
│                                                     │
│  Day 5-9: 工具4 元数据提取工具（5人天，并行）        │
│  · 依赖工具2 输出的文件清单                         │
│  · 集成 Tesseract OCR + 飞书妙记 API                │
│  · 实现 30 个作品文件夹的元数据提取                 │
└─────────────────────────────────────────────────────┘
                          ↓
Week 4（第 3 批，P2 保障工具）
┌─────────────────────────────────────────────────────┐
│  Day 10-13: 工具5 映射校验工具（4人天）              │
│  · 依赖工具1+2+4 提供的校验数据源                   │
│  · 实现四类校验规则 + 趋势对比                      │
│  · 集成 Windows 任务计划程序（周/月定时）           │
└─────────────────────────────────────────────────────┘
```

### 3.2 里程碑节点

| 里程碑 | 时间 | 交付物 | 验收标准 |
|--------|------|--------|---------|
| M1: 基础工具就绪 | Week 1 末 | 工具 1、2 可运行 | 成功扫描知识库 31 节点 + 云盘 130 项 |
| M2: 治理工具就绪 | Week 3 末 | 工具 3、4 可运行 | 完成命名治理 + 30 个作品文件夹元数据提取 |
| M3: 保障工具就绪 | Week 4 末 | 工具 5 可运行 + 定时任务 | 首次校验报告生成 + 定时任务配置完成 |
| M4: 全量上线 | Week 4 末 | 5 个工具集成 | 孤立率 ≤5%，关联率 ≥95% |

### 3.3 依赖关系说明

1. **工具 1、2 无依赖**：可立即启动，并行开发
2. **工具 3 依赖工具 1、2**：需要扫描结果提供重命名目标清单
3. **工具 4 依赖工具 2**：需要云盘文件清单作为输入
4. **工具 5 依赖工具 1、2、4**：需要三端数据 + 元数据作为校验数据源
5. **工具 3、4 可并行**：互不依赖，第 2 批同步推进

### 3.4 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| lark-cli API 限频 | 批量操作受阻 | 所有工具内置限频控制（200-300ms 间隔） |
| Tesseract OCR 未安装 | 工具 4 OCR 功能不可用 | 提供安装指引，降级为仅文件名匹配 |
| 飞书妙记转写耗时 | 工具 4 批量处理慢 | 异步处理 + 超时控制（30 分钟/文件） |
| 云盘 Token 再次失效 | 工具 2、5 扫描失败 | 配置化 Token，支持快速切换 |
| 命名规则变更 | 工具 3、5 规则失效 | 规则配置化（YAML），无需改代码 |

---

## 四、技术选型说明

### 4.1 PowerShell vs Python 选型考量

| 维度 | PowerShell | Python | 本项目选型 |
|------|-----------|--------|-----------|
| JSON 处理 | 弱（双引号解析问题） | 强（原生 json 模块） | **Python** |
| 跨平台 | 仅 Windows | 跨平台 | Python（但项目仅 Windows） |
| 生态库 | 有限 | 丰富（pandas/networkx/pytesseract） | **Python** |
| lark-cli 调用 | 原生支持 | subprocess 调用 | 两者均可 |
| 定时任务 | 原生任务计划程序 | 需借助 cron/任务计划 | **PowerShell**（定时脚本） |
| 团队维护 | Windows 运维熟悉 | 开发人员熟悉 | **Python**（主逻辑） |

**结论**：
- **主逻辑全部用 Python**：避免 PowerShell JSON 传递坑点（详见 `.trae/Knowledge/飞书API技术要点.md`）
- **定时任务用 PowerShell**：利用 Windows 任务计划程序原生能力，调用 Python 脚本
- **lark-cli 调用**：Python 通过 `subprocess` 调用 lark-cli，JSON 数据通过文件传递（方案 A）

### 4.2 lark-cli 能力边界

| 能力 | 支持情况 | 备注 |
|------|---------|------|
| 知识库节点列表 | ✅ `wiki nodes list` | 支持递归，需分页处理 |
| 知识库节点重命名 | ✅ `wiki nodes update` | 支持 title 修改 |
| 云盘文件列表 | ✅ `drive files list` | 支持分页，需递归遍历 |
| 云盘文件重命名 | ✅ 原生 API `drive/v1/files/{token}/rename` | 需用文件传参 |
| 文件元数据查询 | ✅ 原生 API `drive/v1/metas/batch_query` | 补充 size 信息 |
| 多维表记录查询 | ✅ `base records list` | 支持分页 |
| 文档正文读取 | ✅ `doc get` | 支持 docx 内容提取 |
| 妙记转写 | ✅ `minutes upload + get` | 异步任务，需轮询 |
| OCR 识别 | ❌ 不支持 | 需集成 Tesseract 或第三方 |
| 批量操作 | ⚠️ 部分支持 | 需自行实现分批 + 限频 |

### 4.3 外部依赖清单

| 依赖 | 用途 | 安装方式 | 必需性 |
|------|------|---------|--------|
| Python 3.10+ | 主语言 | 官网下载 | 必需 |
| lark-cli | 飞书 API 调用 | 项目已安装 | 必需 |
| pandas | 云盘统计分析 | `pip install pandas` | 必需（工具 2） |
| networkx | 知识库树可视化 | `pip install networkx` | 可选（工具 1，可用手写树替代） |
| pytesseract | OCR 文字识别 | `pip install pytesseract` | 可选（工具 4，降级方案） |
| Tesseract OCR | OCR 引擎 | 官网安装 + 中文语言包 | 可选（工具 4） |
| Pillow | 图片处理 | `pip install Pillow` | 可选（工具 4，OCR 依赖） |
| PyYAML | 配置文件解析 | `pip install pyyaml` | 必需 |
| Jinja2 | 报告模板 | `pip install jinja2` | 可选（工具 5，可用 f-string 替代） |

### 4.4 文件存放规范

根据项目 `_file_management.md` 规则，工具相关文件存放位置：

| 文件类型 | 存放目录 | 命名规范 |
|---------|---------|---------|
| 工具脚本 | `src/scripts/` | `{tool_name}.py`（如 `wiki_scanner.py`） |
| 配置文件 | `src/config/` | `{tool_name}_rules.yaml`（如 `rename_rules.yaml`） |
| 输出报告 | `docs/reports/` | `{tool_name}_{type}_{timestamp}.md/json` |
| 临时脚本 | `src/scripts/temp/` | 加 TEMP 标记，3 天后清理 |
| 定时任务脚本 | `src/scripts/` | `{tool_name}_scheduled.ps1` |

### 4.5 与现有 Skill 的关系

本需求清单中的 5 个工具是对现有 lark-* skill 的**批量化、自动化封装**，而非替代：

| 工具 | 依赖的 Skill | 关系说明 |
|------|-------------|---------|
| 工具 1 知识库扫描 | lark-wiki | 封装 `wiki nodes list` 为递归批量扫描 |
| 工具 2 云盘统计 | lark-drive | 封装 `drive files list` 为递归遍历 + 统计 |
| 工具 3 批量重命名 | lark-wiki + lark-drive | 封装重命名 API 为批量操作 + 安全机制 |
| 工具 4 元数据提取 | lark-doc + lark-minutes | 集成文档读取 + 妙记转写 + OCR |
| 工具 5 映射校验 | lark-base + lark-wiki + lark-drive | 综合查询三端数据 + 规则校验 |

**开发原则**：工具脚本通过 `subprocess` 调用 lark-cli，遵循 `.trae/Knowledge/飞书API技术要点.md` 中的 JSON 文件传递方案，避免 PowerShell 解析问题。

---

## 附录：与 Phase 1 报告的对应关系

| Phase 1 发现 | 对应工具 | 治理动作 |
|-------------|---------|---------|
| 知识库 31 节点全貌 | 工具 1 | 沉淀扫描逻辑，支持定期复扫 |
| 知识库 5 节点命名不规范 | 工具 3 | 批量重命名补充数字前缀 |
| 知识库 4 个僵尸/占位节点 | 工具 1 + 工具 5 | 扫描识别 + 校验监控 |
| 云盘 130 项资产 | 工具 2 | 沉淀统计逻辑，全量递归扫描 |
| 云盘原根目录 Token 失效 | 工具 2 | 配置化 Token，支持快速切换 |
| 云盘 9 个孤立文件（14.5%） | 工具 2 + 工具 5 | 检测 + 持续监控 |
| 云盘关联率 85.5% | 工具 5 | 定期校验，目标提升至 95%+ |
| 30 个作品文件夹仅扫描 1 个 | 工具 4 | 全量元数据提取 |
| 文件大小信息缺失 | 工具 2 | 集成 metas API 补充 |
| 6 份会议纪要无关联 | 工具 4 + 工具 5 | 提取关键词 + 建议归档 |

---

> **文档版本**：v1.0
> **文档作者**：collator 项目技术架构师
> **下次更新**：工具开发完成后，根据实际实现补充技术细节
