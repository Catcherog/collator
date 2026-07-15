# TEMP: 写入本地模特招募SOP文档到指定飞书文档(硬编码路径和docToken) | 2026-06-25 | 2026-06-28
# 读取 Markdown 文件内容
$filePath = 'd:\360Downloads\Trae 项目\collator\模特招募SOP.md'
$content = Get-Content -Path $filePath -Raw -Encoding UTF8

# 写入飞书文档
lark-cli docs +update --api-version v2 --doc "H0qwd1MD9oUfdDxQ2jjcve5bnMe" --command overwrite --content $content --doc-format markdown --as user

Write-Host "Document written successfully!"
