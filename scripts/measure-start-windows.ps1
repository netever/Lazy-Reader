# Cold start on Windows: from launch to the first page of the last opened book.
#
# Before running: install the app, open any book in it and close the app with the book open
# (the app reopens the last book on start).
#
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts\measure-start-windows.ps1 -Exe "C:\path\to\app.exe" [-Runs 10]
#
# The script starts the app, waits for the "PERF first_page" line in perf.log and computes
# the time from Start-Process to that mark by the wall clock. Copy the summary into docs/PERF.md.
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [int]$Runs = 10
)

$ErrorActionPreference = "Stop"
$log = Join-Path $env:APPDATA "com.lazyreader.app\perf.log"
$name = [System.IO.Path]::GetFileNameWithoutExtension($Exe)
$results = @()

for ($i = 1; $i -le $Runs; $i++) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    $before = if (Test-Path $log) { (Get-Content $log).Count } else { 0 }
    $t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Start-Process -FilePath $Exe
    $mark = $null
    for ($k = 0; $k -lt 120 -and -not $mark; $k++) {
        Start-Sleep -Milliseconds 250
        if (Test-Path $log) {
            $mark = Get-Content $log | Select-Object -Skip $before | Where-Object { $_ -match "PERF first_page" } | Select-Object -First 1
        }
    }
    if (-not $mark) {
        Write-Host "run ${i}: no first_page mark within 30 s (is a book open in the app?)"
        continue
    }
    $epoch = [long]([regex]::Match($mark, "epoch_ms=(\d+)").Groups[1].Value)
    $ms = $epoch - $t0
    Write-Host "run ${i}: first_page_ms=$ms"
    $results += $ms
}
Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force

if ($results.Count -gt 0) {
    $sorted = $results | Sort-Object
    $n = $sorted.Count
    $median = if ($n % 2) { $sorted[($n - 1) / 2] } else { ($sorted[$n / 2 - 1] + $sorted[$n / 2]) / 2 }
    Write-Host "runs=$n median_first_page_ms=$median"
    Write-Host "device: $((Get-CimInstance Win32_ComputerSystem).Model), $((Get-CimInstance Win32_Processor).Name)"
}
