# TEMP: Step4任务-添加Wiki表格快捷链接(未完成测试脚本) | 2026-06-25 | 2026-06-28
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot

$wikiPages = @(
    @{
        docToken = "W8j6dX175o4vmdxZbh5cjiuUneg"
        title = "SOP - ZeHuai Full Process Manual"
        tableLink = "https://pcnafnwqcuzo.feishu.cn/base/MwGMbF0Q0alPc6s3jOccovvOnob?table=tblBApBSUuftxltf"
        tableName = "SOP Iteration Management Table"
    },
    @{
        docToken = "B2qpdje3hoKjGhxD7cScYsUvn8d"
        title = "SOP - New Employee 7-Day Training"
        tableLink = "https://pcnafnwqcuzo.feishu.cn/base/MwGMbF0Q0alPc6s3jOccovvOnob?table=tblBApBSUuftxltf"
        tableName = "SOP Iteration Management Table"
    }
)

Write-Host "=== Adding Table Quick-Access Links to Wiki Pages ===" -ForegroundColor Cyan

$quickAccessXml = @"
<callout emoji="🔗" background-color="light-blue" border-color="blue">
<p><b>Quick Access to Related Data Tables</b></p>
<p>Click the link below to view/edit related business data directly:</p>
</callout>
"@

foreach ($page in $wikiPages) {
    Write-Host "Processing: $($page.title)" -ForegroundColor Yellow
    
    try {
        $fetchResult = & lark-cli docs +fetch --api-version v2 --doc $page.docToken --detail full 2>&1 | Out-String
        
        if ($fetchResult -match '"ok"\s*:\s*true') {
            Write-Host "  [OK] Fetched page content" -ForegroundColor Green
            
            $linkBlockXml = "<p><a type=`"url-preview`" href=`"$($page.tableLink)`">$($page.tableName)</a></p>"
            
            Write-Host "  [INFO] Would add link block to page top" -ForegroundColor Gray
            Write-Host "  Link: $($page.tableLink)" -ForegroundColor Gray
        } else {
            Write-Host "  [WARN] Could not fetch page: $fetchResult" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "  [ERROR] $_" -ForegroundColor Red
    }
    
    Start-Sleep -Milliseconds 300
}

Write-Host ""
Write-Host "=== Note ===" -ForegroundColor Cyan
Write-Host "Feishu Wiki does not support direct embedding of Bitable (multi-dimensional table)."
Write-Host "Instead, we add quick-access links that allow one-click navigation to the corresponding table views."
Write-Host ""
Write-Host "Recommended manual action for each wiki page:"
Write-Host "1. Open the wiki page in browser"
Write-Host "2. Insert a 'Link Preview' block at the top of the page"
Write-Host "3. Paste the corresponding Base table URL"

Pop-Location
