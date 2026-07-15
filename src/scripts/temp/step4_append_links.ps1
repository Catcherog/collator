# TEMP: Step4任务-向Wiki页面追加表格快捷链接(硬编码docToken) | 2026-06-25 | 2026-06-28
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot

$baseToken = "MwGMbF0Q0alPc6s3jOccovvOnob"

$pagesToUpdate = @(
    @{
        docToken = "W8j6dX175o4vmdxZbh5cjiuUneg"
        title = "SOP - ZeHuai Full Process Manual"
        tableUrl = "https://pcnafnwqcuzo.feishu.cn/base/MwGMbF0Q0alPc6s3jOccovvOnob?table=tblBApBSUuftxltf"
        tableName = "SOP Iteration Management Table"
    },
    @{
        docToken = "B2qpdje3hoKjGhxD7cScYsUvn8d"
        title = "SOP - New Employee 7-Day Training"
        tableUrl = "https://pcnafnwqcuzo.feishu.cn/base/MwGMbF0Q0alPc6s3jOccovvOnob?table=tblBApBSUuftxltf"
        tableName = "SOP Iteration Management Table"
    }
)

Write-Host "=== Inserting Table Quick-Access Links (using append) ===" -ForegroundColor Cyan

$successCount = 0
$failCount = 0

foreach ($page in $pagesToUpdate) {
    Write-Host "`nProcessing: $($page.title)" -ForegroundColor Yellow
    
    $insertXml = @"
<callout emoji="📊" background-color="light-blue" border-color="blue">
<p><b>Related Business Data Table</b></p>
<p><a href="$($page.tableUrl)">$($page.tableName)</a></p>
</callout>
<hr/>
"@
    
    $tempFile = "temp_insert.xml"
    [System.IO.File]::WriteAllText($tempFile, $insertXml, (New-Object System.Text.UTF8Encoding $false))
    
    try {
        $output = & lark-cli docs +update --api-version v2 --doc $page.docToken --command append --content "@$tempFile" 2>&1 | Out-String
        
        if ($output -match '"ok"\s*:\s*true' -or $output -match 'success') {
            $successCount++
            Write-Host "  [OK] Quick-access link appended!" -ForegroundColor Green
        } else {
            $failCount++
            Write-Host "  [RESULT] $($output.Substring(0, [Math]::Min(200, $output.Length)))" -ForegroundColor Gray
        }
    }
    catch {
        $failCount++
        Write-Host "  [ERROR] $_" -ForegroundColor Red
    }
    
    Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "=== Sub-task 2 Results ===" -ForegroundColor Cyan
Write-Host "Success: $successCount / $($pagesToUpdate.Count)" -ForegroundColor Green
Write-Host "Failed: $failCount / $($pagesToUpdate.Count)" -ForegroundColor $(if ($failCount -gt 0) { "Yellow" } else { "Green" })

Pop-Location
