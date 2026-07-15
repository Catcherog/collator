# TEMP: Step4任务-批量创建知识库目录关联记录(8条SOP记录) | 2026-06-25 | 2026-06-28
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot

$baseToken = "MwGMbF0Q0alPc6s3jOccovvOnob"
$tableId = "tbl077eS0Xm1gaFf"
$successCount = 0
$failCount = 0
$results = @()

$records = @(
    @{
        title = "SOP - ZeHuai Full Process Manual"
        url = "https://pcnafnwqcuzo.feishu.cn/wiki/V0iBwg6XaiySoJkk29VcEJl9nmx"
        scenarios = @("Preparation", "Shooting", "Post-production", "Operations", "Service")
        keywords = @("Shooting", "Retouching", "Marketing", "Communication", "Resources")
    },
    @{
        title = "SOP - New Employee 7-Day Training"
        url = "https://pcnafnwqcuzo.feishu.cn/wiki/F1mCwkSuviPodgkHdorcBGb7n5g"
        scenarios = @("Preparation", "Shooting")
        keywords = @("Communication", "Resources")
    },
    @{
        title = "SOP - Weekly Assessment Form"
        url = "https://pcnafnwqcuzo.feishu.cn/wiki/MmPYwJFQui9slWkJhk5cF0Vknlj"
        scenarios = @("Operations")
        keywords = @("Communication")
    },
    @{
        title = "Template - Ancient Style Makeup Plan"
        url = "https://pcnafnwqcuzo.feishu.cn/wiki/X0aGwzk27ihENZkVrqucpAZVnCb"
        scenarios = @("Shooting")
        keywords = @("Makeup", "Styling")
    },
    @{
        title = "Template - Retouching Standard SOP"
        url = "https://pcnafnwqcuzo.feishu.cn/wiki/Ym1QwGoDGiK8VCk9t70cZnqCnPh"
        scenarios = @("Post-production")
        keywords = @("Retouching", "Quality")
    },
    @{
        title = "Template - On-site Execution Checklist"
        url = "https://pcnafnwqcuzo.feishu.cn/wiki/ByMRwbgI7iVxMHkuixmc5Ek5ndd"
        scenarios = @("Shooting")
        keywords = @("Execution", "Checklist")
    },
    @{
        title = "Template - Client Requirements Form"
        url = "https://pcnafnwqcuzo.feishu.cn/wiki/DhEmwWa2piXcCvkoz6fc2RISn6H"
        scenarios = @("Preparation", "Service")
        keywords = @("Client", "Requirements")
    },
    @{
        title = "Template - Shooting Proposal Format"
        url = "https://pcnafnwqcuzo.feishu.cn/wiki/PI81wolMZiNOHRkyfUYc19V0nZg"
        scenarios = @("Preparation", "Shooting")
        keywords = @("Proposal", "Planning")
    }
)

Write-Host "=== Starting Batch Knowledge Base Link Creation ===" -ForegroundColor Cyan
Write-Host "Total records to create: $($records.Count)" -ForegroundColor Yellow
Write-Host ""

foreach ($rec in $records) {
    $jsonBody = @{
        "fld5agMhzn" = $rec.title
        "flds45HNRr" = $rec.url
        "fld3HCnJ26" = $rec.scenarios
        "fldON3qMbu" = $rec.keywords
    } | ConvertTo-Json -Compress

    [System.IO.File]::WriteAllText("temp_record.json", $jsonBody, (New-Object System.Text.UTF8Encoding $false))

    try {
        $output = & lark-cli base +record-upsert --base-token $baseToken --table-id $tableId --json "@temp_record.json" --as user 2>&1 | Out-String
        
        if ($output -match '"ok"\s*:\s*true') {
            $successCount++
            Write-Host "[OK] $($rec.title)" -ForegroundColor Green
            $results += @{status="SUCCESS"; title=$rec.title; url=$rec.url}
        } else {
            $failCount++
            Write-Host "[FAIL] $($rec.title)" -ForegroundColor Red
            $results += @{status="FAILED"; title=$rec.title; error=$output}
        }
    }
    catch {
        $failCount++
        Write-Host "[ERROR] $($rec.title): $_" -ForegroundColor Magenta
        $results += @{status="ERROR"; title=$rec.title; error=$_}
    }
    
    Start-Sleep -Milliseconds 500
}

Remove-Item "temp_record.json" -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== Batch Complete ===" -ForegroundColor Cyan
Write-Host "Success: $successCount / $($records.Count)" -ForegroundColor Green
Write-Host "Failed: $failCount / $($records.Count)" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })

$results | ConvertTo-Json -Depth 2 | Out-File "step4_results.json" -Encoding UTF8
Write-Host "Results saved to step4_results.json"

Pop-Location
