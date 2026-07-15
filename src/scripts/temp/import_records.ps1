# TEMP: 批量导入23个作品记录(使用all_23_works.json) | 2026-06-25 | 2026-06-28
$json = Get-Content 'all_23_works.json' -Raw -Encoding UTF8
lark-cli api POST "/open-apis/base/v3/bases/MwGMbF0Q0alPc6s3jOccovvOnob/tables/tblho2dCpIDAonuc/records/batch_create" --data $json --as user
