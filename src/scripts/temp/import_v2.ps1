# TEMP: v2版本导入23个作品(硬编码作品列表) | 2026-06-25 | 2026-06-28
$baseToken = "MwGMbF0Q0alPc6s3jOccovvOnob"
$tableId = "tblho2dCpIDAonuc"
$url = "https://pcnafnwqcuzo.feishu.cn/drive/folder/K9QEfQJCkli462dHDLxcP5K9n7d"

$names = @(
    "01_法喜禅影", "02_高丽梵音", "03_观音法相", "04_郭庄园韵", "05_九溪清幽",
    "06_虎跑春泉", "07_颐和御景", "08_园博眷影", "09_洱海苍山", "10_蛮丽楼阁",
    "11_故宫俪影", "12_文庙巾帼", "13_茶馆雅集", "14_红墙光影", "15_水乡婚典",
    "16_杏花疏影", "17_与光同尘", "18_素裙清影", "19_红妆倩影", "20_蝶昏暮影",
    "21_宋画含春", "22_海上芳时", "23_蔷薇油画"
)

foreach ($n in $names) {
    $body = @{fields=@{fld3SES6vU=$n; fldTLrsrvN=$url; fldZBkMivb="已归档"; fldXm5vKJO="初筛成片"}} | ConvertTo-Json -Compress
    $result = lark-cli base +record-upsert --base-token $baseToken --table-id $tableId --as user --json $body 2>&1
    Write-Host "$n : $($result.Substring(0, [Math]::Min(50, $result.Length)))"
    Start-Sleep -Milliseconds 500
}
Write-Host "`nAll done!"
