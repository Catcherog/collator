# TEMP: Step4任务-验证Wiki页面云盘备份链接并补全 | 2026-06-25 | 2026-06-28
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot

$pagesToVerify = @(
    @{
        docToken = "W8j6dX175o4vmdxZbh5cjiuUneg"
        title = "SOP - ZeHuai Full Process Manual"
        expectedCloudUrl = "https://pcnafnwqcuzo.feishu.cn/docx/ZYQIdgU2GolGsQxWH05cwZFbnad"
    },
    @{
        docToken = "B2qpdje3hoKjGhxD7cScYsUvn8d"
        title = "SOP - New Employee 7-Day Training"
        expectedCloudUrl = "https://pcnafnwqcuzo.feishu.cn/docx/UiSidkJDFoNZ2Nx2L6dciErined"
    },
    @{
        docToken = "YyfRdncSKoV14QxaHuAc0P2InRh"
        title = "SOP - Weekly Assessment Form"
        expectedCloudUrl = "https://pcnafnwqcuzo.feishu.cn/docx/HDDldlVfJoPAwcxo4Vdc0hSYnUh"
    }
)

Write-Host "=== Verifying Cloud Drive Backup Links in Wiki Pages ===" -ForegroundColor Cyan

$verifiedCount = 0
$missingCount = 0
$verificationResults = @()

foreach ($page in $pagesToVerify) {
    Write-Host "`nVerifying: $($page.title)" -ForegroundColor Yellow
    
    try {
        $output = & lark-cli docs +fetch --api-version v2 --doc $page.docToken --detail full 2>&1 | Out-String
        
        if ($output -match '"ok"\s*:\s*true') {
            if ($output -match $page.expectedCloudUrl) {
                $verifiedCount++
                Write-Host "  [OK] Cloud drive link FOUND" -ForegroundColor Green
                $verificationResults += @{status="VERIFIED"; title=$page.title; cloudLink=$page.expectedCloudUrl}
            } else {
                $missingCount++
                Write-Host "  [WARN] Cloud drive link NOT FOUND" -ForegroundColor Yellow
                Write-Host "  Expected: $($page.expectedCloudUrl)" -ForegroundColor Gray
                
                $appendXml = @"
<hr/>
<callout emoji="☁️" background-color="light-gray" border-color="gray">
<p><b>Original Cloud Drive File (Backup)</b></p>
<p><a href="$($page.expectedCloudUrl)">Click to view original file</a></p>
</callout>
"@
                
                $tempFile = "temp_cloud_link.xml"
                [System.IO.File]::WriteAllText($tempFile, $appendXml, (New-Object System.Text.UTF8Encoding $false))
                
                Write-Host "  [ACTION] Appending cloud backup link..." -ForegroundColor Cyan
                $appendResult = & lark-cli docs +update --api-version v2 --doc $page.docToken --command append --content "@$tempFile" 2>&1 | Out-String
                
                if ($appendResult -match '"ok"\s*:\s*true') {
                    Write-Host "  [OK] Cloud link appended successfully!" -ForegroundColor Green
                    $verificationResults += @{status="FIXED"; title=$page.title; cloudLink=$page.expectedCloudUrl}
                } else {
                    Write-Host "  [ERROR] Failed to append: $($appendResult.Substring(0, [Math]::Min(150, $appendResult.Length)))" -ForegroundColor Red
                    $verificationResults += @{status="FAILED"; title=$page.title; error=$appendResult}
                }
                
                Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
            }
        } else {
            $missingCount++
            Write-Host "  [ERROR] Failed to fetch page content" -ForegroundColor Red
            $verificationResults += @{status="ERROR"; title=$page.title; error="Fetch failed"}
        }
    }
    catch {
        $missingCount++
        Write-Host "  [EXCEPTION] $_" -ForegroundColor Magenta
        $verificationResults += @{status="EXCEPTION"; title=$page.title; error=$_}
    }
    
    Start-Sleep -Milliseconds 300
}

Write-Host ""
Write-Host "=== Sub-task 3 Verification Complete ===" -ForegroundColor Cyan
Write-Host "Already had cloud links: $verifiedCount" -ForegroundColor Green
Write-Host "Fixed (added missing): $($verificationResults | Where-Object { $_.status -eq 'FIXED' }).Count" -ForegroundColor Cyan
Write-Host "Still failed: $($verificationResults | Where-Object { $_.status -eq 'FAILED' -or $_.status -eq 'ERROR' }).Count" -ForegroundColor $(if (($verificationResults | Where-Object { $_.status -eq 'FAILED' -or $_.status -eq 'ERROR' }).Count -gt 0) { "Red" } else { "Green" })

$verificationResults | ConvertTo-Json -Depth 2 | Out-File "step4_cloud_verification.json" -Encoding UTF8

Pop-Location
