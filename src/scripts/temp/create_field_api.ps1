# TEMP: 创建字段API测试脚本 | 2026-06-25 | 2026-06-28
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 读取field1.json
$jsonContent = Get-Content "field1.json" -Raw -Encoding UTF8
Write-Output "JSON to send: $jsonContent"

# 使用Invoke-RestMethod直接调用API
$headers = @{
    "Authorization" = "Bearer $(lark-cli auth token --as user 2>$null)"
    "Content-Type" = "application/json; charset=utf-8"
}

$body = $jsonContent
$url = "https://open.feishu.cn/open-apis/bitable/v3/bases/MwGMbF0Q0alPc6s3jOccovvOnob/tables/tbljPr2PuZLFhSaI/fields"

try {
    $response = Invoke-RestMethod -Uri $url -Method POST -Headers $headers -Body $body
    Write-Output "Response: $($response | ConvertTo-Json)"
} catch {
    Write-Output "Error: $_"
    Write-Output "StatusCode: $($_.Exception.Response.StatusCode.value__)"
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $reader.BaseStream.Position = 0
    $errBody = $reader.ReadToEnd()
    Write-Output "ErrorBody: $errBody"
}
