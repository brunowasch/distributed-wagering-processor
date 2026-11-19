param(
    [Parameter(Mandatory = $true)]
    [string] $DatabaseName
)

$ErrorActionPreference = 'Stop'
$bunPath = (Get-Command bun).Source
$projectPath = (Get-Location).Path
$env:DATABASE_NAME = $DatabaseName
$env:SQS_CONSUMER_ENABLED = 'false'
$env:OUTBOX_PUBLISHER_ENABLED = 'false'
$env:REFERENCE_WORKER_ENABLED = 'false'
$taskTempDir = Join-Path ([IO.Path]::GetTempPath()) ('wager-multiprocess-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskTempDir | Out-Null
$workerPath = Join-Path $taskTempDir 'worker.ps1'
$workerBody = @'
param([string]$RequestFile, [string]$BunPath, [string]$ProjectPath)
$ErrorActionPreference = 'Stop'
$env:SQS_CONSUMER_ENABLED = 'false'
$env:OUTBOX_PUBLISHER_ENABLED = 'false'
$env:REFERENCE_WORKER_ENABLED = 'false'
$env:WAGER_PROCESS_REQUEST = [IO.File]::ReadAllText($RequestFile)
Set-Location -LiteralPath $ProjectPath
& $BunPath run test/support/process-wager.ts
exit $LASTEXITCODE
'@
Set-Content -LiteralPath $workerPath -Value $workerBody -Encoding UTF8
$jobs = @()

try {
    $preparedLines = & $bunPath run test/support/prepare-process-race.ts
    if ($LASTEXITCODE -ne 0) { throw 'Race preparation process failed.' }
    $preparedLine = $preparedLines | Where-Object { $_ -match '^\{' } | Select-Object -Last 1
    if (-not $preparedLine) { throw "Race preparation did not return JSON: $preparedLines" }
    $prepared = $preparedLine | ConvertFrom-Json

    for ($index = 0; $index -lt 3; $index++) {
        $requestPath = Join-Path $taskTempDir "request-$index.json"
        $stdoutPath = Join-Path $taskTempDir "worker-$index.stdout"
        $stderrPath = Join-Path $taskTempDir "worker-$index.stderr"
        $prepared.requests[$index] | ConvertTo-Json -Compress -Depth 10 | Set-Content -LiteralPath $requestPath -Encoding UTF8
        $argumentLine = "-NoProfile -ExecutionPolicy Bypass -File `"$workerPath`" -RequestFile `"$requestPath`" -BunPath `"$bunPath`" -ProjectPath `"$projectPath`""
        $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentLine -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden
        $jobs += [pscustomobject]@{ Process = $process; Stdout = $stdoutPath; Stderr = $stderrPath }
    }

    foreach ($job in $jobs) {
        if (-not $job.Process.WaitForExit(30000)) { throw "Worker wrapper PID $($job.Process.Id) timed out." }
        $job.Process.Refresh()
        if ($null -ne $job.Process.ExitCode -and $job.Process.ExitCode -ne 0) {
            throw "Worker failed (exit $($job.Process.ExitCode)): $(Get-Content -LiteralPath $job.Stderr -Raw)"
        }
    }

    $workerResults = @()
    foreach ($job in $jobs) {
        $resultLine = Get-Content -LiteralPath $job.Stdout | Where-Object { $_ -match '^\{' } | Select-Object -Last 1
        if (-not $resultLine) { throw "Worker did not return JSON: $(Get-Content -LiteralPath $job.Stdout -Raw) $(Get-Content -LiteralPath $job.Stderr -Raw)" }
        $workerResults += $resultLine | ConvertFrom-Json
    }
    if (@($workerResults.pid | Select-Object -Unique).Count -ne 3) { throw 'The three Bun worker PIDs were not distinct.' }
    if (@($workerResults | Where-Object status -eq 'PROCESSED').Count -ne 2 -or @($workerResults | Where-Object status -eq 'REJECTED').Count -ne 1) {
        throw "Unexpected worker outcomes: $($workerResults | ConvertTo-Json -Compress)"
    }

    $env:WAGER_PROCESS_WALLET_ID = $prepared.walletId
    $verification = & $bunPath run test/support/verify-process-race.ts
    if ($LASTEXITCODE -ne 0) { throw 'Post-race database verification failed.' }
    'Independent Bun worker PIDs: ' + ($workerResults.pid -join ', ')
    'Worker states: ' + ($workerResults.status -join ', ')
    $verification | Where-Object { $_ -match '^\{' } | Select-Object -Last 1
} finally {
    foreach ($job in $jobs) { $job.Process.Close() }
    $resolvedTemp = (Resolve-Path -LiteralPath $taskTempDir).Path
    $resolvedRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemp.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to clean temporary files outside the temp directory.'
    }
    foreach ($file in Get-ChildItem -LiteralPath $resolvedTemp -File) {
        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
    }
}
