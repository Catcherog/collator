# TEMP: 特定批次(10素材×8账号×4平台)发布任务数据生成 | 2026-06-25 | 2026-06-28
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$materials = @(
    "01_FaxiZenShadow",
    "02_GaoliBuddhistSound",
    "03_GuanyinDharma",
    "04_GuoGardenRhyme",
    "05_JiuxiSerenity",
    "06_HupaSpring",
    "07_YiheImperialView",
    "08_YuanboPhotography",
    "09_ErhaiCangshan",
    "10_ManliPavilion"
)

$accounts = @(
    "XHS_Main",
    "XHS_Matrix_A", 
    "XHS_Matrix_B",
    "DY_Main",
    "DY_Matrix",
    "WX_1",
    "WX_2",
    "WX_3"
)

$platforms = @("XHS", "DY", "Moments", "Channels")

$rows = @()

foreach ($material in $materials) {
    foreach ($account in $accounts) {
        $row = @($account, $platforms, @())
        $rows += ,$row
    }
}

$data = @{
    fields = @("fldhVhZPVV", "fldHYkWKVw", "fldMQinPQ3")
    rows = $rows
}

$json = $data | ConvertTo-Json -Depth 5 -Compress
Set-Content -Path "batch_tasks.json" -Value $json -Encoding UTF8
Write-Output "[OK] Created batch_tasks.json with $($rows.Count) records"
