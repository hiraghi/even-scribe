param(
  [int]$Port = 5175
)

# Even Scribe is a fully local (IndexedDB) Even Hub app: no vault API server and no
# baseUrl. The simulator just loads the dev client directly.

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClientDir = Join-Path $AppDir "client"

$RootUrl = "http://127.0.0.1:$Port/"
$ClientUrl = $RootUrl

function Test-HttpOk([string]$Url) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { return $false }
}

function Wait-HttpOk([string]$Url, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpOk $Url) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# Free the port if a stale dev server (node/vite) is still holding it. Without this,
# vite silently drifts to the next free port and the simulator would open a URL that
# is never served -> "the emulator won't start".
function Clear-StalePort([int]$p) {
  try {
    $listeners = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    foreach ($procId in (@($listeners.OwningProcess) | Sort-Object -Unique)) {
      if ($procId -and $procId -ne 0) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -match 'node') {
          Write-Host "Freeing port $p (stopping stale $($proc.ProcessName) PID $procId)."
          Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
          Start-Sleep -Milliseconds 400
        }
      }
    }
  } catch {
    # Get-NetTCPConnection may be unavailable on very old Windows; the --strictPort
    # flag below still surfaces a clear "port in use" error in that case.
  }
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found in PATH. Install Node.js and retry."
}

if (-not (Test-Path (Join-Path $ClientDir "node_modules"))) {
  Push-Location $ClientDir
  try { npm install } finally { Pop-Location }
}

# NOTE: keep this file ASCII-only. cmd launches Windows PowerShell 5.1, which reads
# BOM-less scripts as ANSI (CP932); multibyte comments can swallow the newline and
# comment out the next code line.
# Run vite in a hidden window (no extra visible windows); its output goes to a log file.
$ViteLog = Join-Path $AppDir "vite-dev.log"

if (Test-HttpOk $RootUrl) {
  Write-Host "Even Scribe client is already running on port $Port."
} else {
  Clear-StalePort $Port
  Write-Host "Starting Even Scribe client on port $Port (vite log: $ViteLog) ..."
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    "cd '$ClientDir'; npm run dev -- --host 127.0.0.1 --port $Port --strictPort *>&1 | Out-File -FilePath '$ViteLog' -Encoding utf8"
  ) -WindowStyle Hidden | Out-Null

  if (-not (Wait-HttpOk $RootUrl 60)) {
    throw "Timed out waiting for $RootUrl. Check $ViteLog for errors."
  }
}

# Run the simulator directly in this console instead of opening another window.
Write-Host "Starting EvenHub simulator: $ClientUrl"
Write-Host "(Even Scribe stores notes locally in the browser (IndexedDB); no server needed.)"
Push-Location $ClientDir
try {
  npx evenhub-simulator $ClientUrl
} finally {
  Pop-Location
}
