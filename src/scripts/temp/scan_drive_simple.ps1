# TEMP: 云盘全量递归扫描脚本(英文版) - 一次性资产盘点 | 2026-06-25 | 2026-06-28
# Zehuai Image Cloud Drive Full Recursive Scan Script
$global:allItems = @()
$global:folderQueue = @(@{token="K9QEfQJCkli462dHDLxcP5K9n7d"; path="/Root"; level=0})
$global:processedFolders = @{}
$fileCount = 0
$folderCount = 0

Write-Host "[START] Starting recursive scan of Zehuai Image cloud drive..." -ForegroundColor Cyan

while ($global:folderQueue.Count -gt 0) {
    $current = $global:folderQueue[0]
    $global:folderQueue = $global:folderQueue[1..($global:folderQueue.Count-1)]
    
    $folderToken = $current.token
    $currentPath = $current.path
    $level = $current.level
    
    if ($processedFolders.ContainsKey($folderToken)) {
        continue
    }
    $processedFolders[$folderToken] = $true
    
    Write-Host "`n[FOLDER] Scanning [$currentPath] (Level $level)" -ForegroundColor Yellow
    
    $jsonInput = "{`"folder_token`":`"$folderToken`"}"
    $result = echo $jsonInput | lark-cli drive files list --params - --as user --page-all 2>$null
    
    try {
        $data = $result | ConvertFrom-Json
        
        if ($data.code -eq 0 -and $data.data.files) {
            foreach ($file in $data.data.files) {
                $fullPath = "$currentPath/$($file.name)"
                $itemInfo = [ordered]@{
                    name = $file.name
                    token = $file.token
                    type = $file.type
                    url = $file.url
                    path = $fullPath
                    parent_token = $file.parent_token
                    created_time = $file.created_time
                    modified_time = $file.modified_time
                    size = $null
                }
                
                if ($file.type -eq "folder") {
                    $global:folderQueue += @{token=$file.token; path=$fullPath; level=($level+1)}
                    $folderCount++
                    Write-Host "   [DIR] $($file.name)" -ForegroundColor DarkGray
                } else {
                    $fileCount++
                    
                    try {
                        $metaJson = "{`"items`":[{`"file_token`":`"$($file.token)`",`"file_type`":`"$($file.type)`"}]}"
                        $metaResult = lark-cli drive metas batch_query --data $metaJson --as user 2>$null
                        $metaData = $metaResult | ConvertFrom-Json
                        if ($metaData.code -eq 0 -and $metaData.data.items) {
                            $itemInfo.size = $metaData.data.items[0].size
                        }
                    } catch {}
                    
                    $sizeStr = if ($itemInfo.size) { [math]::Round($itemInfo.size/1MB, 2).ToString() + " MB" } else { "N/A" }
                    Write-Host "   [FILE] [$($file.type)] $($file.name) ($sizeStr)" -ForegroundColor Green
                }
                
                $global:allItems += $itemInfo
            }
        }
    } catch {
        Write-Host "   [ERROR] Parse error: $_" -ForegroundColor Red
    }
    
    Start-Sleep -Milliseconds 200
}

Write-Host "`n" + "="*80 -ForegroundColor Cyan
Write-Host "[DONE] Scan completed!" -ForegroundColor Green
Write-Host "="*80 -ForegroundColor Cyan
Write-Host "`n[STATS] Summary:" -ForegroundColor Yellow
Write-Host "   Total items: $($global:allItems.Count)" -ForegroundColor White
Write-Host "   Folders: $folderCount" -ForegroundColor White
Write-Host "   Files: $fileCount" -ForegroundColor White

$totalSize = ($global:allItems | Where-Object { $_.size -and $_.type -ne 'folder' } | Measure-Object -Property size -Sum).Sum
if ($totalSize) {
    Write-Host "   Total file size: $([math]::Round($totalSize/1GB, 2)) GB" -ForegroundColor White
}

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outputPath = "d:\360Downloads\Trae 项目\collator\cloud_drive_scan_$timestamp.json"
$global:allItems | ConvertTo-Json -Depth 10 | Out-File -FilePath $outputPath -Encoding UTF8
Write-Host "`n[SAVE] Full inventory saved to: $outputPath" -ForegroundColor Cyan

Write-Host "`n[DISTRIBUTION] File type breakdown:" -ForegroundColor Yellow
$typeGroups = $global:allItems | Where-Object { $_.type -ne 'folder' } | Group-Object -Property type | Sort-Object -Property Count -Descending
foreach ($group in $typeGroups) {
    Write-Host "   - $($group.Name): $($group.Count) files" -ForegroundColor White
}
