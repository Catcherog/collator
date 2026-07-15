# TEMP: 批量任务数据填充(基于batch1_correct.json) | 2026-06-25 | 2026-06-28
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output "=========================================="
Write-Output "  Zehuai Image - Task Generator"
Write-Output "=========================================="
Write-Output ""

$baseToken = "MwGMbF0Q0alPc6s3jOccovvOnob"
$tableId = "tbljPr2PuZLFhSaI"

$matrixAccounts = @(
    "XHS_Main",
    "XHS_Matrix_A",
    "XHS_Matrix_B",
    "DY_Main",
    "DY_Matrix",
    "WX_1",
    "WX_2",
    "WX_3"
)

$targetPlatforms = @("XHS", "DY", "Moments", "Channels")

Write-Output "[INFO] Reading material data..."
$dataFile = "batch1_correct.json"
if (-not (Test-Path $dataFile)) {
    Write-Output "[ERROR] File not found: $dataFile"
    exit 1
}

$jsonContent = Get-Content $dataFile -Raw -Encoding UTF8
$data = $jsonContent | ConvertFrom-Json

$materials = $data.rows
Write-Output "[OK] Found $($materials.Count) materials"

Write-Output ""
Write-Output "[LIST] Materials:"
for ($i = 0; $i -lt $materials.Count; $i++) {
    Write-Output "   $($i+1). $($materials[$i][0])"
}
Write-Output ""

$totalTasks = $materials.Count * $matrixAccounts.Count
Write-Output "[STATS] Total tasks to generate: $totalTasks ($($materials.Count) materials x $($matrixAccounts.Count) accounts)"
Write-Output ""

Write-Output "[WARNING] This script will generate $totalTasks new task records"
Write-Output ""

$recordsToCreate = @()

foreach ($material in $materials) {
    $materialName = $material[0]
    
    foreach ($account in $matrixAccounts) {
        $record = @{
            fields = @{
                "Material" = $materialName
                "MatrixAccount" = $account
                "TargetPlatform" = $targetPlatforms
                "PublishedPlatform" = @()
            }
        }
        
        $recordsToCreate += $record
        Write-Output "   [PREP] $materialName | $account"
    }
}

Write-Output ""
Write-Output "[OK] Prepared $($recordsToCreate.Count) records"

$outputFile = "tasks_to_import.json"
$recordsToCreate | ConvertTo-Json -Depth 5 | Out-File -FilePath $outputFile -Encoding UTF8
Write-Output "[SAVE] Data saved to: $outputFile"
Write-Output ""
Write-Output "=========================================="
Write-Output "  NEXT STEPS:"
Write-Output "=========================================="
Write-Output ""
Write-Output "Option 1: Manual Import"
Write-Output "  1. Open Feishu Base table"
Write-Output "  2. Click '...' -> 'Import'"
Write-Output "  3. Select file: $outputFile"
Write-Output ""
Write-Output "Option 2: CLI Import (when ready)"
Write-Output "  Command: lark-cli base +record-batch-create --base-token $baseToken --table-id $tableId --as user --json @$outputFile"
Write-Output ""
Write-Output "[DONE] Script completed!"
