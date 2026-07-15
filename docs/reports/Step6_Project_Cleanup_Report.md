# collator 项目整理报告
> 整理日期：2026-06-25
> 整理范围：全项目文件结构、临时脚本管理、引用一致性修复

## 一、整理概览
- 整理前问题：根目录散落文件16+个、临时脚本无标记、引用断裂5+处
- 整理后状态：目录结构规范、临时脚本集中管理、引用一致
- 整理文件总数：74个（脚本35个、配置22个、文档9个、图片15张、其他3个）

## 二、目录结构变更
### 新建目录
- `public/` - 静态资源目录
- `src/scripts/temp/` - 临时脚本目录
- `public/temp_images/` - 图片资源（从根目录迁移）

## 三、文件移动清单
按类别列出所有移动的文件：

### 1. 根目录 → src/scripts/temp/（7个JS脚本 + 1个Python脚本 + 6个临时数据文件）
**JavaScript脚本（7个）：**
- generate-five-schools.js
- generate-proposal.js
- generate_plan_a.js
- generate_plan_b.js
- extract_images.js
- download_images.js
- upload_images.js

**Python脚本（1个）：**
- migrate_models.py

**临时数据文件（6个）：**
- images_info.json
- downloaded_images.json
- sheet_data.json
- nodes_list.json
- params.json
- 策划案_text.txt

### 2. 根目录 → docs/（5个Word文档 + 4个补充Word文档）
**核心策划文档（5个）：**
- 策划案.docx
- 策划案一.docx
- 策划案二.docx
- 策划案模板.docx
- 摄影拍摄前全流程核对清单.docx

**补充策划文档（4个）：**
- 东方女性肖像五派策划概览.docx
- 人像写真摄影项目策划案.docx
- 策划案A_50年代复古旗袍_摩登洋气利落_执行策划案.docx
- 策划案B_30年代复古旗袍_老宅感_执行策划案.docx

### 3. 根目录 → public/（temp_images/ 目录，15张图片）
- 0g_作品_16.jpg
- Jiaaq_作品_5.jpg
- Jiaaq_报价_4.jpg
- LOLO makeup_作品_12.jpg
- VB未颜妆造_作品_15.jpg
- uo_作品_8.jpg
- 东海山妖_作品_1.jpg
- 丹粟sususu_作品_7.jpg
- 佐伊_作品_3.jpg
- 佐伊_报价_2.jpg
- 化妆师107_作品_10.jpg
- 大吉大利的大_作品_14.jpg
- 格丫格_作品_6.jpg
- 桉淇 Makeup_作品_13.jpg
- 虞_作品_9.jpg

### 4. src/scripts/ → src/scripts/temp/（16个PowerShell临时脚本）
- create_field_api.ps1
- generate_batch.ps1
- import_all.ps1
- import_records.ps1
- import_v2.ps1
- populate_data.ps1
- scan_cloud_drive.ps1
- scan_drive_simple.ps1
- step4_append_links.ps1
- step4_batch1_knowledge_links.ps1
- step4_batch_create.ps1
- step4_generate_report.ps1
- step4_insert_links.ps1
- step4_verify_cloud.ps1
- step4_wiki_table_links.ps1
- write_to_feishu.ps1

### 5. src/importers/ → src/scripts/temp/（11个JavaScript临时脚本）
- analyze_missing.js
- check_records.js
- delete_wrong_records.js
- import_24_30.js
- import_correct_24_30.js
- import_makeup_artists.js
- import_models.js
- import_records.js
- import_remaining.js
- import_studios.js
- import_v4.js

### 6. src/config/ → src/scripts/temp/（16个临时配置JSON文件 + 2个XML/TXT文件）
**临时配置JSON（16个）：**
- field1.json
- field1_ascii.json
- field1_create.json
- field2_ascii.json
- field3_ascii.json
- field4_ascii.json
- field_matrix_account.json
- field_published_platform.json
- field_target_platform.json
- record_sop1.json
- record_sop2.json
- record_sop3.json
- single_record.json
- step4_cloud_verification.json
- step4_results.json
- tasks_to_import.json
- values_to_write.json

**其他临时文件（2个）：**
- 策划案_document.xml
- （补充：实际共18个JSON配置文件 + 2个文档文件）

## 四、临时脚本清单
所有标记为TEMP的脚本，预计删除日期：**2026-06-28**

### src/scripts/temp/ - PowerShell脚本（16个）
```
# TEMP: 飞书API字段创建调试 | 2026-06-25 | 2026-06-28
create_field_api.ps1

# TEMP: 批量数据生成测试 | 2026-06-25 | 2026-06-28
generate_batch.ps1

# TEMP: 全量数据导入脚本 | 2026-06-25 | 2026-06-28
import_all.ps1

# TEMP: 记录批量导入 | 2026-06-25 | 2026-06-28
import_records.ps1

# TEMP: V2版本数据导入 | 2026-06-25 | 2026-06-28
import_v2.ps1

# TEMP: 测试数据填充 | 2026-06-25 | 2026-06-28
populate_data.ps1

# TEMP: 云盘文件扫描 | 2026-06-25 | 2026-06-28
scan_cloud_drive.ps1

# TEMP: 简化版云盘扫描 | 2026-06-25 | 2026-06-28
scan_drive_simple.ps1

# TEMP: Step4-知识库链接追加 | 2026-06-25 | 2026-06-28
step4_append_links.ps1

# TEMP: Step4-批次1知识库链接 | 2026-06-25 | 2026-06-28
step4_batch1_knowledge_links.ps1

# TEMP: Step4-批次创建 | 2026-06-25 | 2026-06-28
step4_batch_create.ps1

# TEMP: Step4-报告生成 | 2026-06-25 | 2026-06-28
step4_generate_report.ps1

# TEMP: Step4-链接插入 | 2026-06-25 | 2026-06-28
step4_insert_links.ps1

# TEMP: Step4-云端验证 | 2026-06-25 | 2026-06-28
step4_verify_cloud.ps1

# TEMP: Step4-Wiki表格链接 | 2026-06-25 | 2026-06-28
step4_wiki_table_links.ps1

# TEMP: 飞书记录写入测试 | 2026-06-25 | 2026-06-28
write_to_feishu.ps1
```

### src/scripts/temp/ - JavaScript脚本（18个）
```
# TEMP: 缺失数据分析 | 2026-06-25 | 2026-06-28
analyze_missing.js

# TEMP: 记录检查脚本 | 2026-06-25 | 2026-06-28
check_records.js

# TEMP: 错误记录删除 | 2026-06-25 | 2026-06-28
delete_wrong_records.js

# TEMP: 图片下载脚本 | 2026-06-25 | 2026-06-28
download_images.js

# TEMP: Word图片提取 | 2026-06-25 | 2026-06-28
extract_images.js

# TEMP: 五派策划案生成 | 2026-06-25 | 2026-06-28
generate-five-schools.js

# TEMP: 通用策划案生成 | 2026-06-25 | 2026-06-28
generate-proposal.js

# TEMP: A方案策划生成 | 2026-06-25 | 2026-06-28
generate_plan_a.js

# TEMP: B方案策划生成 | 2026-06-25 | 2026-06-28
generate_plan_b.js

# TEMP: 24-30号数据导入 | 2026-06-25 | 2026-06-28
import_24_30.js

# TEMP: 24-30号修正数据导入 | 2026-06-25 | 2026-06-28
import_correct_24_30.js

# TEMP: 化妆师数据导入 | 2026-06-25 | 2026-06-28
import_makeup_artists.js

# TEMP: 模特数据导入 | 2026-06-25 | 2026-06-28
import_models.js

# TEMP: 通用记录导入 | 2026-06-25 | 2026-06-28
import_records.js

# TEMP: 剩余数据导入 | 2026-06-25 | 2026-06-28
import_remaining.js

# TEMP: 影楼数据导入 | 2026-06-25 | 2026-06-28
import_studios.js

# TEMP: V4版本数据导入 | 2026-06-25 | 2026-06-28
import_v4.js

# TEMP: 图片上传脚本 | 2026-06-25 | 2026-06-28
upload_images.js
```

### src/scripts/temp/ - Python脚本（1个）
```
# TEMP: 模特数据迁移 | 2026-06-25 | 2026-06-28
migrate_models.py
```

### src/scripts/temp/ - 临时数据/配置文件（22个）
- downloaded_images.json
- field1.json ~ field4_ascii.json（字段创建调试数据）
- field_matrix_account.json / field_published_platform.json / field_target_platform.json
- images_info.json
- nodes_list.json
- params.json
- record_sop1.json ~ record_sop3.json
- sheet_data.json
- single_record.json
- step4_cloud_verification.json / step4_results.json
- tasks_to_import.json
- values_to_write.json
- 策划案_document.xml
- 策划案_text.txt

## 五、引用修复清单
修复的16处引用问题：

| 序号 | 文件 | 原引用问题 | 修复方式 |
|------|------|-----------|---------|
| 1 | generate-five-schools.js | 根目录执行引用相对路径错误 | 统一使用项目根目录作为执行路径 |
| 2 | generate-proposal.js | 模板文件路径硬编码 | 更新为 docs/ 目录下的模板路径 |
| 3 | generate_plan_a.js | 引用策划案.docx路径错误 | 修正为 docs/策划案A_*.docx |
| 4 | generate_plan_b.js | 引用策划案.docx路径错误 | 修正为 docs/策划案B_*.docx |
| 5 | extract_images.js | 输出目录不存在 | 更新为 public/temp_images/ |
| 6 | download_images.js | 临时目录不存在 | 更新为 src/scripts/temp/ 数据文件路径 |
| 7 | upload_images.js | 图片源路径错误 | 更新为 public/temp_images/ |
| 8 | import_models.js | 模特数据JSON路径错误 | 修正为 src/scripts/temp/ 下对应JSON |
| 9 | migrate_models.py | Python脚本跨目录引用 | 保持在temp目录，添加路径说明 |
| 10 | step4_*.ps1 | 批量脚本引用公共模块路径错误 | 统一使用相对src/scripts/路径 |
| 11 | scan_cloud_drive.ps1 | 输出JSON路径未指定 | 输出到 src/scripts/temp/ |
| 12 | import_all.ps1 | 子脚本调用路径断裂 | 更新为 src/scripts/temp/ 路径 |
| 13 | populate_data.ps1 | 测试数据文件路径错误 | 引用temp目录下JSON |
| 14 | create_field_api.ps1 | 字段JSON配置路径错误 | 引用temp目录下field*.json |
| 15 | write_to_feishu.ps1 | 单条记录JSON路径错误 | 引用temp目录下single_record.json |
| 16 | import_records.js/ps1 | 通用导入脚本数据路径冲突 | 拆分JS和PS1版本，明确各自用途 |

## 六、保留的核心脚本
保留在原位置的通用工具脚本：

### src/scripts/（5个通用工具）
- `check_encoding.ps1` - 文件编码检查工具
- `get_fields.ps1` - 飞书表字段查询工具
- `get_tables.ps1` - 飞书多维表列表查询
- `list_recent.ps1` - 最近修改文件列表
- `search_base.ps1` - 多维表记录搜索工具

### src/importers/（1个目录扫描工具）
- `list_files.js` - 目录文件列表扫描工具

## 七、保留的核心配置
src/config/ 保留的6个核心配置文件：

1. `all_23_works.json` - 23个作品完整数据
2. `batch1.json` - 第一批次数据
3. `batch1_correct.json` - 第一批次修正数据
4. `batch_tasks.json` - 批量任务配置
5. `cloud_drive_asset_report.json` - 云盘资产扫描报告
6. `cloud_drive_asset_report_v2.json` - 云盘资产扫描报告V2版

## 八、整理后目录结构
```
collator/
├── .trae/                          ← AI配置
│   ├── Knowledge/                  ← 项目知识库（5个文件）
│   │   ├── 业务场景.md
│   │   ├── 数据摄入实践经验.md
│   │   ├── 文档集索引.md
│   │   ├── 项目总览.md
│   │   └── 飞书API技术要点.md
│   ├── rules/                      ← 规则文件（6个）
│   │   ├── _core.md
│   │   ├── _experience.md
│   │   ├── _file_management.md
│   │   ├── _memory.md
│   │   ├── _temp_script.md
│   │   └── 项目操作规则.md
│   ├── skills/                     ← 可执行技能
│   │   ├── collator-file-ops/
│   │   ├── lark-base/
│   │   ├── lark-doc/
│   │   ├── lark-drive/
│   │   ├── lark-openapi-explorer/
│   │   ├── lark-shared/
│   │   ├── lark-sheets/
│   │   ├── lark-sheets-migrate/
│   │   ├── lark-whiteboard/
│   │   ├── lark-wiki/
│   │   ├── ultimate-unified-framework/
│   │   └── word-doc-editor/
│   └── specs/                      ← 规范文档
│
├── bin/                            ← 可执行文件
│   └── lark-cli.exe
│
├── docs/                           ← 文档目录
│   ├── extracted_images/           ← 提取的图片（4张）
│   ├── guides/                     ← 指南文档（7个）
│   │   ├── IMPLEMENTATION_GUIDE.md
│   │   ├── agent-core-config.md
│   │   ├── automation-tools-requirements.md
│   │   ├── business-rules-library.md
│   │   ├── data-parsing-templates.md
│   │   ├── mapping-rules-and-implementation.md
│   │   └── unstructured-data-mapping-plan.md
│   ├── reports/                    ← 报告文档（本报告位置）
│   │   ├── Step4_FullLink_Association_Report.md
│   │   ├── Step5_Agent_Config_Update_Report.md
│   │   ├── Step6_Project_Cleanup_Report.md
│   │   ├── cloud_drive_asset_statistics.md
│   │   └── wiki_audit_report.md
│   ├── sop/                        ← 标准流程
│   │   └── 模特招募SOP.md
│   ├── 东方女性肖像五派策划概览.docx
│   ├── 人像写真摄影项目策划案.docx
│   ├── 摄影拍摄前全流程核对清单.docx
│   ├── 策划案.docx
│   ├── 策划案A_50年代复古旗袍_摩登洋气利落_执行策划案.docx
│   ├── 策划案B_30年代复古旗袍_老宅感_执行策划案.docx
│   ├── 策划案一.docx
│   ├── 策划案二.docx
│   └── 策划案模板.docx
│
├── public/                         ← 静态资源
│   └── temp_images/                ← 临时图片（15张）
│
├── src/                            ← 代码目录
│   ├── config/                     ← 核心配置（6个）
│   │   ├── all_23_works.json
│   │   ├── batch1.json
│   │   ├── batch1_correct.json
│   │   ├── batch_tasks.json
│   │   ├── cloud_drive_asset_report.json
│   │   └── cloud_drive_asset_report_v2.json
│   ├── importers/                  ← 导入工具
│   │   └── list_files.js
│   └── scripts/                    ← 脚本目录
│       ├── temp/                   ← 临时脚本（57个文件，带TEMP标记）
│       │   ├── *.ps1（16个）
│       │   ├── *.js（18个）
│       │   ├── *.py（1个）
│       │   ├── *.json（20个）
│       │   └── 其他（2个）
│       ├── check_encoding.ps1
│       ├── get_fields.ps1
│       ├── get_tables.ps1
│       ├── list_recent.ps1
│       └── search_base.ps1
│
├── package.json
└── package-lock.json
```

## 九、注意事项

1. **Word生成脚本执行路径**：`generate-five-schools.js`、`generate-proposal.js`、`generate_plan_a.js`、`generate_plan_b.js` 这4个Word文档生成脚本已移动到 `src/scripts/temp/`，执行时需在**项目根目录**下运行，以确保模板文件路径（docs/目录）引用正确。

2. **临时脚本到期提醒**：所有TEMP标记的临时脚本预计删除日期为 **2026-06-28**。到期后需逐个评估：
   - 确认不再使用 → 删除
   - 有复用价值 → 迁移至 `src/scripts/` 正式目录并移除TEMP标记
   - 需要保留参考 → 归档至 `docs/` 相关目录

3. **待补充文档**：`数据结构.md`、`数据操作规则.md` 目前标注为待补充状态，后续如有业务需要可创建到 `docs/guides/` 目录下。

4. **docs/extracted_images/ 说明**：该目录保留4张从Word文档中提取的图片，与 `public/temp_images/`（15张）为不同用途，前者是文档提取过程产物，后者是素材图片。

5. **核心工具脚本使用**：保留在 `src/scripts/` 下的5个PowerShell脚本为通用工具，可长期使用，无需加TEMP标记。
