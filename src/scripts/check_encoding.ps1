[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$jsonContent = Get-Content "field1.json" -Raw -Encoding UTF8
Write-Output "File content: $jsonContent"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonContent)
Write-Output "First bytes: $($bytes[0]) $($bytes[1]) $($bytes[2])"