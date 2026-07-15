# TEMP: 云盘全量递归扫描脚本(中文版) - 一次性资产盘点 | 2026-06-25 | 2026-06-28
# 泽怀影像云盘全量递归扫描脚本
# 功能：递归扫描所有文件夹和文件，输出完整资产清单

$global:allItems = @()
$global:folderQueue = @(@{token="K9QEfQJCkli462dHDLxcP5K9n7d"; path="/泽怀影像根目录"; level=0})
$global:processedFolders = @{}
$fileCount = 0
$folderCount = 0

Write-Host "🚀 开始递归扫描泽怀影像云盘..." -ForegroundColor Cyan

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
    
    Write-Host "`n📁 扫描 [$currentPath] (Level $level)" -ForegroundColor Yellow
    
    $jsonInput = "{`"folder_token`":`"$folderToken`"}"
    $result = echo $jsonInput | lark-cli drive files list --params - --as user --page-all 2>$null
    
    try {
        $data = $result | ConvertFrom-Json
        
        if ($data.code -eq 0 -and $data.data.files) {
            foreach ($file in $data.data.files) {
                $fullPath = "$currentPath/$($file.name)"
                $itemInfo = @{
                    name = $file.name
                    token = $file.token
                    type = $file.type
                    url = $file.url
                    path = $fullPath
                    parent_token = $file.parent_token
                    created_time = $file.created_time
                    modified_time = $file.modified_time
                    owner_id = $file.owner_id
                    size = $null
                }
                
                if ($file.type -eq "folder") {
                    $global:folderQueue += @{token=$file.token; path=$fullPath; level=($level+1)}
                    $folderCount++
                    Write-Host "   📂 文件夹: $($file.name)" -ForegroundColor DarkGray
                } else {
                    $fileCount++
                    
                    # 获取文件元数据（包含大小）
                    try {
                        $metaResult = lark-cli drive metas batch_query --data "{`"items`":[{`"file_token`":`"$($file.token)`",`"file_type`":`"$($file.type)`"}]}" --as user 2>$null
                        $metaData = $metaResult | ConvertFrom-Json
                        if ($metaData.code -eq 0 -and $metaData.data.items) {
                            $itemInfo.size = $metaData.data.items[0].size
                        }
                    } catch {}
                    
                    $sizeStr = if ($itemInfo.size) { [math]::Round($itemInfo.size/1MB, 2).ToString() + " MB" } else { "未知" }
                    Write-Host "   📄 [$($file.type)] $($file.name) ($sizeStr)" -ForegroundColor Green
                }
                
                $global:allItems += $itemInfo
            }
            
            if ($data.data.has_more -eq $true) {
                Write-Host "   ⚠️ 该目录还有更多内容（已自动分页获取）" -ForegroundColor Magenta
            }
        }
    } catch {
        Write-Host "   ❌ 解析错误: $_" -ForegroundColor Red
    }
    
    Start-Sleep -Milliseconds 200
}

# 输出统计报告
Write-Host "`n" + "="*80 -ForegroundColor Cyan
Write-Host "✅ 扫描完成！" -ForegroundColor Green
Write-Host "="*80 -ForegroundColor Cyan
Write-Host "`n📊 统计摘要：" -ForegroundColor Yellow
Write-Host "   • 总计扫描到: $($global:allItems.Count) 个项目" -ForegroundColor White
Write-Host "   • 文件夹数量: $folderCount 个" -ForegroundColor White
Write-Host "   • 文件数量: $fileCount 个" -ForegroundColor White

$totalSize = ($global:allItems | Where-Object { $_.size -and $_.type -ne 'folder' } | Measure-Object -Property size -Sum).Sum
if ($totalSize) {
    Write-Host "   • 总文件大小: $([math]::Round($totalSize/1GB, 2)) GB" -ForegroundColor White
}

# 输出完整清单到JSON文件
$outputPath = "d:\360Downloads\Trae 项目\collator\cloud_drive_full_scan_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
$global:allItems | ConvertTo-Json -Depth 10 | Out-File -FilePath $outputPath -Encoding UTF8
Write-Host "`n💾 完整清单已保存至: $outputPath" -ForegroundColor Cyan

# 按类型分类统计
Write-Host "`n📋 按文件类型分布：" -ForegroundColor Yellow
$typeGroups = $global:allItems | Where-Object { $_.type -ne 'folder' } | Group-Object -Property type | Sort-Object -Property Count -Descending
foreach ($group in $typeGroups) {
    Write-Host "   • $($group.Name): $($group.Count) 个文件" -ForegroundColor White
}
