# deploy-func.ps1 -- deploy the Aliyun FC function AND publish the newest APK to it.
#
# Why this exists: handing out APKs used to rely on temporary tunnels
# (cloudflared quick tunnel / localhost.run). Those die on their own: the cloudflared
# process exiting invalidates the hostname, and localhost.run drops roughly every
# 20 minutes and hands out a DIFFERENT subdomain -- so every link we sent went stale.
# The FC function is always up and reachable from mainland China, so the APK ships
# inside the function code and the download URL never changes.
#
# NOTE: comments/messages here are intentionally ASCII-only. PowerShell 5.1 reads a
# BOM-less UTF-8 .ps1 with the ANSI codepage, which turns Chinese comments into
# mojibake and can even break string literals. Keep this file ASCII.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\deploy-func.ps1

param(
  [string]$Apk = '',                       # default: newest FAST_v*.apk in D:\DSH工作\fastapk
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$simDir  = $PSScriptRoot
$projDir = Split-Path $simDir -Parent
$codeSrc = Join-Path $projDir 'aliyun-fc-mail\index.py'
$depDir  = Join-Path $projDir 'fc-deploy\fast-mail-deploy'
$codeDir = Join-Path $depDir 'code'
$apkDir  = 'D:\DSH工作\fastapk'
$base    = 'https://fast-mail-code-uzzxqcntro.cn-hangzhou.fcapp.run'
$token   = $env:FAST_APP_TOKEN            # never hardcode: this repo is public
if (-not $token) { throw 'FAST_APP_TOKEN env var not set (App download token)' }

if (-not $Apk) {
  $Apk = (Get-ChildItem $apkDir -Filter 'FAST_v*.apk' |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not $Apk -or -not (Test-Path $Apk)) { throw "APK not found: $Apk" }
$apkName = Split-Path $Apk -Leaf

New-Item -ItemType Directory -Force -Path $codeDir | Out-Null
Copy-Item $codeSrc (Join-Path $codeDir 'index.py') -Force
Copy-Item $Apk     (Join-Path $codeDir 'fast.apk') -Force
Write-Host ("staged: index.py {0} bytes, fast.apk {1} bytes" -f `
  (Get-Item (Join-Path $codeDir 'index.py')).Length, (Get-Item (Join-Path $codeDir 'fast.apk')).Length)

$env:PATH = 'D:\DSH工作\tools\node\node-v22.14.0-win-x64;' + $env:PATH
$env:S_ACCESS_FILE_PATH = 'D:\DSH工作\tools\s-home'

Push-Location $depDir
try {
  & 'D:\DSH工作\tools\npm-global\s.cmd' deploy -a fcdeploy -y 2>&1 |
    Select-String -Pattern 'failed|Error Message' | Select-Object -First 3
} finally { Pop-Location }

Start-Sleep -Seconds 3
$hz = (Invoke-WebRequest "$base/healthz" -TimeoutSec 30).Content
Write-Host "healthz: $hz"

$url = "$base/dl/$apkName`?t=$token"
Write-Host "URL: $url"

if (-not $SkipVerify) {
  $tmp = Join-Path $env:TEMP ('verify_' + $apkName)
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  & curl.exe -s --max-time 300 $url -o $tmp -w "HTTP %{http_code}  downloaded %{size_download} bytes`n" | Write-Host
  $local = (Get-FileHash $Apk -Algorithm SHA256).Hash
  $got   = (Get-FileHash $tmp -Algorithm SHA256).Hash
  Write-Host "local sha256: $local"
  Write-Host "got   sha256: $got"
  if ($local -ne $got) { throw "DOWNLOAD MISMATCH -- do NOT hand this link to the user" }
  Write-Host 'OK: download verified byte-for-byte'
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
