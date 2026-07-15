# TEMP: Step4任务-批次1知识库目录管理表链接创建 | 2026-06-25 | 2026-06-28
$ErrorActionPreference = "Stop"
$baseToken = "MwGMbF0Q0alPc6s3jOccovvOnob"
$tableId = "tbl077eS0Xm1gaFf"

$records = @(
    @{
        "fld5agMhzn" = "泽怀影像全流程SOP操作总手册"
        "flds45HNRr" = "https://pcnafnwqcuzo.feishu.cn/wiki/V0iBwg6XaiySoJkk29VcEJl9nmx"
        "fld3HCnJ26" = @("拍摄前准备", "拍摄执行", "后期制作", "运营推广", "客户服务")
        "fldON3qMbu" = @("拍摄技巧", "后期修图", "运营推广", "客户沟通", "资源管理")
    },
    @{
        "fld5agMhzn" = "新人7天培训计划与考核题库"
        "flds45HNRr" = "https://pcnafnwqcuzo.feishu.cn/wiki/F1mCwkSuviPodgkHdorcBGb7n5g"
        "fld3HCnJ26" = @("拍摄前准备", "拍摄执行")
        "fldON3qMbu" = @("客户沟通", "资源管理")
    },
    @{
        "fld5agMhzn" = "SOP执行情况周度考核表"
        "flds45HNRr" = "https://pcnafnwqcuzo.feishu.cn/wiki/MmPYwJFQui9slWkJhk5cF0Vknlj"
        "fld3HCnJ26" = @("运营推广")
        "fldON3qMbu" = @("客户沟通")
    }
)

foreach ($record in $records) {
    $jsonBody = $record | ConvertTo-Json -Compress
    $tempFile = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tempFile, $jsonBody, (New-Object System.Text.UTF8Encoding $false))
    
    Write-Host "Creating record: $($record['fld5agMhzn'])..."
    
    try {
        $result = lark-cli base +record-upsert --base-token $baseToken --table-id $tableId --json "@$tempFile" --as user 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "SUCCESS: Record created for '$($record['fld5agMhzn'])'" -ForegroundColor Green
        } else {
            Write-Host "FAILED: $result" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "ERROR: $_" -ForegroundColor Red
    }
    finally {
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`nBatch 1 complete! Created $($records.Count) records in Knowledge Base Directory Table."
