# TEMP: Step4任务-向Wiki页面插入表格快捷访问块(测试版) | 2026-06-25 | 2026-06-28
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot

$baseToken = "MwGMbF0Q0alPc6s3jOccovvOnob"

$pagesToUpdate = @(
    @{
        docToken = "W8j6dX175o4vmdxZbh5cjiuUneg"
        title = "SOP - ZeHuai Full Process Manual"
        tableUrl = "https://pcnafnwqcuzo.feishu.cn/base/MwGMbF0Q0alPc6s3jOccovvOnob?table=tblBApBSUuftxltf&view=vewO5HrZbo"
        tableName = "[SOP Iteration Management Table]"
    },
    @{
        docToken = "B2qpdje3hoKjGhxD7cScYsUvn8d"
        title = "SOP - New Employee 7-Day Training"
        tableUrl = "https://pcnafnwqcuzo.feishu.cn/base/MwGMbF0Q0alPc6s3jOccovvOnob?table=tblBApBSUuftxltf&view=vewO5HrZbo"
        tableName = "[SOP Iteration Management Table]"
    },
    @{
        docToken = "YyfRdncSKoV14QxaHuAc0P2InRh"
        title = "SOP - Weekly Assessment Form"
        tableUrl = "https://pcnafnwqcuzo.feishu.cn/base/MwGMbF0Q0alPc6s3jOccovvOnob?table=tblBApBSUuftxltf&view=vewO5HrZbo"
        tableName = "[SOP Iteration Management Table]"
    }
)

Write-Host "=== Inserting Table Quick-Access Blocks into Wiki Pages ===" -ForegroundColor Cyan

$insertXmlTemplate = @"
<callout emoji="📊" background-color="light-blue" border-color="blue">
<p><b>Related Business Data Table</b></p>
<p>Click to view/edit: {TABLE_NAME}</p>
</callout>
<hr/>
"@

$successCount = 0
$failCount = 0

foreach ($page in $pagesToUpdate) {
    Write-Host "`nProcessing: $($page.title)" -ForegroundColor Yellow
    
    $insertXml = $insertXmlTemplate -replace '\{TABLE_NAME\}', $page.tableName
    
    $tempFile = "temp_insert.xml"
    [System.IO.File]::WriteAllText($tempFile, $insertXml, (New-Object System.Text.UTF8Encoding $false))
    
    try {
        $output = & lark-cli docs +update --api-version v2 --doc $page.docToken --command block_insert_after --block-id $(ConvertTo-Json -InputObject $page.docToken) --content-file $tempFile 2>&1 | Out-String
        
        if ($output -match '"ok"\s*:\s*true' -or $output -match 'success') {
            $successCount++
            Write-Host "  [OK] Quick-access block inserted!" -ForegroundColor Green
        } else {
            $failCount++
            Write-Host "  [RESULT] $output" -ForegroundColor Gray
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
Write-Host "=== Sub-task 2 Complete ===" -ForegroundColor Cyan
Write-Host "Success: $successCount / $($pagesToUpdate.Count)" -ForegroundColor Green
Write-Host "Failed/Partial: $failCount / $($pagesToUpdate.Count)" -ForegroundColor $(if ($failCount -gt 0) { "Yellow" } else { "Green" })

Pop-Location
