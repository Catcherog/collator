# famp-docker-smoke.ps1 - RF-R3-01 Docker dual-service smoke test with side-effect counters
# FAMP-CONTRACT-ADOPTION-GATE-01-R1-FIX-R3
#
# 用途：启动 collator + SOP 双容器，验证：
#   1. SOP 运行时：合法 Candidate V1 → 200，PRE_WRITE 通过
#   2. SOP 停止时：Candidate V1 → 500 fail-closed
#   3. RF-R3-01: 失败前后 task/review/transport/feishu_writer/candidate_persisted 计数一致
#
# 位置：collator/scripts/famp-docker-smoke.ps1（RF-R3-04: 从 lark 根目录移入 collator 跟踪目录）

param(
    [switch]$KeepRunning = $false
)

$ErrorActionPreference = "Stop"
$exitCode = 0

# compose 文件路径（相对于本脚本）
$composeFile = Join-Path $PSScriptRoot "..\deploy\famp\docker-compose.yml"
$composeFile = (Resolve-Path $composeFile).Path

function Invoke-DockerCompose {
    param([string[]]$CommandArgs)
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & docker @CommandArgs 2>&1
        $exit = $LASTEXITCODE
        return @{ ExitCode = $exit; Output = ($output -join "`n") }
    } finally {
        $ErrorActionPreference = $prevEAP
    }
}

function Write-Step($msg) {
    Write-Host "`n=== $msg ===" -ForegroundColor Cyan
}

function Write-Ok($msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
    Write-Host "[FAIL] $msg" -ForegroundColor Red
}

function Write-Info($msg) {
    Write-Host "[INFO] $msg" -ForegroundColor Yellow
}

function Get-Counters {
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:9999/smoke/counters" -TimeoutSec 5
        # 转换为 hashtable 并强制所有值为 Int32，避免 PSCustomObject 属性的 -eq 比较 quirk
        $hash = @{}
        foreach ($prop in $resp.PSObject.Properties) {
            $hash[$prop.Name] = [Convert]::ToInt32($prop.Value)
        }
        return $hash
    } catch {
        Write-Fail "Cannot read smoke counters: $_"
        return $null
    }
}

function Format-Counters {
    param($c, [string]$label)
    if (-not $c) { return "${label}: <unavailable>" }
    return @"
${label}:
  task_save            = $($c.task_save)
  review_create        = $($c.review_create)
  pre_write_call       = $($c.pre_write_call)
  pre_write_success    = $($c.pre_write_success)
  pre_write_error      = $($c.pre_write_error)
  candidate_persisted  = $($c.candidate_persisted)
  customer_writer_call = $($c.customer_writer_call)
"@
}

$results = @{}

try {
    Write-Step "RF-R3-01 Docker dual-service smoke test with side-effect counters"

    # Step 1: Build and start containers
    Write-Step "Step 1: Build and start SOP + collator containers"
    Write-Info "docker compose -f $composeFile up --build -d"
    $composeResult = Invoke-DockerCompose -CommandArgs @("compose", "-f", $composeFile, "up", "--build", "-d")
    $composeExit = $composeResult.ExitCode
    $results.composeExit = $composeExit
    Write-Info "compose exit code: $composeExit"
    if ($composeExit -ne 0) {
        Write-Fail "docker compose up failed"
        Write-Fail $composeResult.Output
        $exitCode = 1
        throw "compose failed"
    }
    Write-Ok "Containers started"

    # Step 2: Wait for health checks
    Write-Step "Step 2: Wait for health checks"
    $maxWait = 90
    $waited = 0
    while ($waited -lt $maxWait) {
        $sopHealth = $null
        $collatorHealth = $null
        try { $sopHealth = Invoke-RestMethod -Uri "http://localhost:3001/healthz" -TimeoutSec 3 } catch {}
        try { $collatorHealth = Invoke-RestMethod -Uri "http://localhost:8787/healthz" -TimeoutSec 3 } catch {}
        if ($sopHealth -and $collatorHealth) { break }
        Start-Sleep -Seconds 2
        $waited += 2
        Write-Info "Waiting for services... (${waited}s)"
    }
    if ($waited -ge $maxWait) {
        Write-Fail "Services not ready within ${maxWait}s"
        $exitCode = 1
        throw "timeout"
    }
    Write-Ok "SOP health: $($sopHealth | ConvertTo-Json -Compress)"
    Write-Ok "collator health: $($collatorHealth | ConvertTo-Json -Compress)"

    # Step 3: Verify SOP /v1/version
    Write-Step "Step 3: Verify SOP /v1/version"
    $sopVersion = Invoke-RestMethod -Uri "http://localhost:3001/v1/version" -TimeoutSec 5
    Write-Ok "SOP version: $($sopVersion | ConvertTo-Json -Compress)"
    if ($sopVersion.contract_versions.candidate -notcontains "v1") {
        Write-Fail "SOP does not support candidate v1 contract"
        $exitCode = 1
        throw "version mismatch"
    }

    # Step 4: Create ingestion + submit valid Candidate V1 (SOP running)
    Write-Step "Step 4: Create ingestion + submit valid Candidate V1 (SOP running)"

    $ingestionBody = @{
        source_system    = "smoke-test"
        source_record_id = "rec-smoke-001"
        source_type      = "text"
        target_domain    = "customer_consultation"
        content          = "smoke test content"
        submitted_at     = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
        timezone         = "Asia/Shanghai"
        dry_run          = $true
    } | ConvertTo-Json

    $ingestionResp = Invoke-RestMethod -Uri "http://localhost:8787/v1/ingestions" -Method POST -Body $ingestionBody -ContentType "application/json" -TimeoutSec 10
    $ingestionId = $ingestionResp.ingestion_id
    Write-Ok "Ingestion #1 created: id=$ingestionId"

    $candidateV1 = @{
        schema_version  = "v1"
        candidate_id    = "cand-smoke-001"
        ingestion_id    = $ingestionId
        source          = @{
            system    = "feishu_bitable"
            table     = "smoke_test"
            record_id = "rec-smoke-001"
        }
        entity_type     = "project"
        raw_evidence    = @{ redacted = $true }
        normalized_fields = @{
            project_type = "client"
            customer_ref = "cust-smoke-001"
            model_ref    = $null
            shoot_date   = "2026-07-22"
        }
        quality = @{
            status = "PASS"
            issues = @()
            score  = 0.95
        }
        processing = @{
            ocr_version    = "tesseract-5.3.0"
            asr_version    = "whisper-large-v3"
            processed_at   = "2026-07-22T10:00:00.000Z"
            agent_version  = "collator-1.0.0"
        }
        idempotency_key = "sha256_a1b2c3d4e5f67890"
    } | ConvertTo-Json -Depth 10

    Write-Info "POST /v1/ingestions/$ingestionId/candidate-v1 (SOP running)"
    $candidateResp = Invoke-RestMethod -Uri "http://localhost:8787/v1/ingestions/$ingestionId/candidate-v1" -Method POST -Body $candidateV1 -ContentType "application/json" -TimeoutSec 15
    Write-Ok "Candidate V1 submitted successfully: $($candidateResp | ConvertTo-Json -Compress -Depth 5)"

    # Step 5: Stop SOP container
    Write-Step "Step 5: Stop SOP container"
    Write-Info "docker compose -f $composeFile stop sop"
    $stopResult = Invoke-DockerCompose -CommandArgs @("compose", "-f", $composeFile, "stop", "sop")
    $stopExit = $stopResult.ExitCode
    Write-Ok "SOP container stopped (exit=$stopExit)"
    Start-Sleep -Seconds 2

    # Step 6: fail-closed test with side-effect counters
    Write-Step "Step 6: Submit Candidate V1 with SOP stopped (expect fail-closed + no side effects)"

    # 6a: Create a NEW ingestion for the fail-closed test
    #     (GPT note: "为失败测试创建 ingestion 本身会增加 task，因此 'before' 必须在
    #      ingestion 创建后、Candidate 提交前采集。")
    $ingestionBody2 = @{
        source_system    = "smoke-test-2"
        source_record_id = "rec-smoke-002"
        source_type      = "text"
        target_domain    = "customer_consultation"
        content          = "smoke test content 2"
        submitted_at     = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
        timezone         = "Asia/Shanghai"
        dry_run          = $true
    } | ConvertTo-Json

    Write-Info "POST /v1/ingestions (new ingestion for fail-closed test)"
    $ingestionResp2 = Invoke-RestMethod -Uri "http://localhost:8787/v1/ingestions" -Method POST -Body $ingestionBody2 -ContentType "application/json" -TimeoutSec 10
    $ingestionId2 = $ingestionResp2.ingestion_id
    Write-Ok "Ingestion #2 created: id=$ingestionId2"

    # 6b: Read counters BEFORE failed candidate submission
    #     (after ingestion creation, before candidate-v1 POST)
    Write-Step "Step 6b: Read counters BEFORE failed candidate submission"
    $countersBefore = Get-Counters
    $beforeStr = Format-Counters -c $countersBefore -label "Before failed request"
    Write-Host $beforeStr -ForegroundColor Yellow
    $results.countersBefore = $countersBefore

    # 6c: Submit Candidate V1 to NEW ingestion — should fail-closed (HTTP 500)
    $candidateV1Fail = @{
        schema_version  = "v1"
        candidate_id    = "cand-smoke-002"
        ingestion_id    = $ingestionId2
        source          = @{
            system    = "feishu_bitable"
            table     = "smoke_test"
            record_id = "rec-smoke-002"
        }
        entity_type     = "project"
        raw_evidence    = @{ redacted = $true }
        normalized_fields = @{
            project_type = "client"
            customer_ref = "cust-smoke-002"
            model_ref    = $null
            shoot_date   = "2026-07-22"
        }
        quality = @{
            status = "PASS"
            issues = @()
            score  = 0.95
        }
        processing = @{
            ocr_version    = "tesseract-5.3.0"
            asr_version    = "whisper-large-v3"
            processed_at   = "2026-07-22T10:00:00.000Z"
            agent_version  = "collator-1.0.0"
        }
        idempotency_key = "sha256_b2c3d4e5f6789012"
    } | ConvertTo-Json -Depth 10

    Write-Info "POST /v1/ingestions/$ingestionId2/candidate-v1 (SOP stopped)"
    $failClosedOk = $false
    $failClosedStatus = 0
    $failClosedBody = ""
    try {
        $failResp = Invoke-RestMethod -Uri "http://localhost:8787/v1/ingestions/$ingestionId2/candidate-v1" -Method POST -Body $candidateV1Fail -ContentType "application/json" -TimeoutSec 15
        Write-Info "Returned 200 (UNEXPECTED): $($failResp | ConvertTo-Json -Compress -Depth 5)"
        $failClosedStatus = 200
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $failClosedStatus = $statusCode
        Write-Info "Returned HTTP $statusCode (expected fail-closed error)"
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $failClosedBody = $reader.ReadToEnd()
            $reader.Close()
            Write-Info "Error body: $failClosedBody"
        } catch {
            $failClosedBody = $_.Exception.Message
        }
        if ($statusCode -ge 500) {
            $failClosedOk = $true
        }
    }

    # 6d: Read counters AFTER failed candidate submission
    Write-Step "Step 6d: Read counters AFTER failed candidate submission"
    $countersAfter = Get-Counters
    $afterStr = Format-Counters -c $countersAfter -label "After failed request"
    Write-Host $afterStr -ForegroundColor Yellow
    $results.countersAfter = $countersAfter

    # Step 7: Verify fail-closed + no side effects
    Write-Step "Step 7: Verify fail-closed + no side effects"

    # 使用 Node.js 脚本做计数器比较，绕过 PowerShell 对 0 值 -eq 比较的 quirk
    #（PowerShell 在某些情况下 0 -eq 0 返回 $null 而非 $true）
    # 通过临时文件传递 JSON，避免 PowerShell 管道的 BOM/编码问题
    $verifyScript = Join-Path $PSScriptRoot "famp-smoke-verify.mjs"
    $payload = @{
        before = $countersBefore
        after = $countersAfter
        httpStatus = $failClosedStatus
    }
    $tempFile = [System.IO.Path]::GetTempFileName()
    $payload | ConvertTo-Json -Compress -Depth 5 | Out-File -FilePath $tempFile -Encoding utf8 -NoNewline

    Write-Info "Running Node.js verification script..."
    # 临时切换 EAP 为 Continue，因为 node 非零退出码在 Stop 模式下会抛异常
    $ErrorActionPreference = "Continue"
    $verifyResult = & node $verifyScript $tempFile 2>&1
    $verifyExit = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    Write-Host $verifyResult
    Remove-Item $tempFile -Force

    if ($verifyExit -eq 0) {
        $allPass = $true
        Write-Ok "All acceptance checks PASSED"
    } else {
        $allPass = $false
        $exitCode = 1
        Write-Fail "One or more acceptance checks FAILED"
    }

    $results.allPass = $allPass
    $results.httpOk = $failClosedOk
    $results.failClosedStatus = $failClosedStatus

    # Step 8: Summary
    Write-Step "Step 8: Smoke test results summary"
    $results | ConvertTo-Json -Depth 5

} catch {
    Write-Fail "Exception: $_"
    Write-Fail $_.ScriptStackTrace
    $exitCode = 1
} finally {
    if (-not $KeepRunning) {
        Write-Step "Cleanup containers"
        Write-Info "docker compose -f $composeFile down"
        $null = Invoke-DockerCompose -CommandArgs @("compose", "-f", $composeFile, "down")
        Write-Ok "Containers cleaned up"
    } else {
        Write-Info "Containers kept running (-KeepRunning)"
    }
}

Write-Host "`n=== Smoke test exit code: $exitCode ===" -ForegroundColor $(if ($exitCode -eq 0) { "Green" } else { "Red" })
exit $exitCode
