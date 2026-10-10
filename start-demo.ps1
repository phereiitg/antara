# Start the ANTARA web prototype in the background and open it in the browser.
#   powershell -ExecutionPolicy Bypass -File .\start-demo.ps1
#   powershell -ExecutionPolicy Bypass -File .\start-demo.ps1 -Stop
param([switch]$Stop, [int]$Port = 5173)
$root = $PSScriptRoot
$pidFile = Join-Path $root 'data\web-demo.pid'
New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null

if (Test-Path $pidFile) {
  $old = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}
if ($Stop) { Write-Host 'ANTARA prototype stopped.'; return }

$inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($inUse) { Write-Host "Port $Port is busy (PID $($inUse[0].OwningProcess)). Use -Port 5174." -ForegroundColor Yellow; return }

$env:ANTARA_WEB_PORT = "$Port"
$p = Start-Process -FilePath node -ArgumentList "`"$root\web\serve.mjs`"" -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $root 'data\web-demo.log') -RedirectStandardError (Join-Path $root 'data\web-demo.err.log')
Set-Content $pidFile $p.Id
Start-Sleep 2
$url = "http://127.0.0.1:$Port"
try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5 | Out-Null; Write-Host "ANTARA prototype running: $url" -ForegroundColor Cyan; Start-Process $url }
catch { Write-Host "Server did not respond; see data\web-demo.err.log" -ForegroundColor Red }
