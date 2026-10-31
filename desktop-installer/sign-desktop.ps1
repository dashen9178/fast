# FAST 桌面端代码签名脚本
#
# 为什么需要：没有受信任的代码签名证书时，Windows 会显示「未知发布者」，
# SmartScreen / 安全软件（如火绒）也可能拦截安装。
#
# 用法（先准备好受信任的 .pfx 证书）：
#   $env:FAST_SIGN_PFX='D:\certs\fast.pfx'
#   $env:FAST_SIGN_PASSWORD='证书密码'
#   powershell -File sign-desktop.ps1
#
# 只想签某个文件：
#   powershell -File sign-desktop.ps1 -Files 'D:\DSH工作\Fast\FAST_Setup_v1.0.3.exe'
#
# 说明：自签名证书只能在「本机安装了该证书」的电脑上显示发布者，分发给别人仍会提示
#       「未知发布者」。要真正对外显示发布者名称，需要购买/申请受信任的代码签名证书
#       （OV/EV），或使用面向开源项目的免费签名服务。
param(
  [string]$Pfx = $env:FAST_SIGN_PFX,
  [string]$Password = $env:FAST_SIGN_PASSWORD,
  [string[]]$Files
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (-not $Files -or $Files.Count -eq 0) {
  $Files = @(
    (Join-Path $root '..\desktop-shell\publish\FAST.exe'),
    (Join-Path $root '..\desktop-installer\publish\FAST_Setup.exe')
  )
}

# 找 signtool：优先 Windows Kits 最新版本
$signtool = $null
$kits = 'C:\Program Files (x86)\Windows Kits\10\bin'
if (Test-Path $kits) {
  $signtool = Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $signtool) { $signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source }
if (-not $signtool) { throw '找不到 signtool.exe（需要安装 Windows SDK）' }

if (-not $Pfx -or -not (Test-Path $Pfx)) {
  Write-Host ''
  Write-Host '未提供受信任的代码签名证书（FAST_SIGN_PFX）—— 无法签名，文件仍会显示「未知发布者」。' -ForegroundColor Yellow
  Write-Host '获取受信任证书的常见途径：'
  Write-Host '  · Certum Open Source Code Signing（开源项目可免费申请，需实名审核）'
  Write-Host '  · SignPath.io（面向开源项目的免费代码签名服务）'
  Write-Host '  · Microsoft Azure Trusted Signing（按月付费，需身份验证）'
  Write-Host '  · 传统 OV / EV 代码签名证书（国内 CA 或 Sectigo / DigiCert 等）'
  Write-Host ''
  Write-Host '拿到 .pfx 后设置 FAST_SIGN_PFX / FAST_SIGN_PASSWORD 再运行本脚本。'
  exit 1
}

foreach ($f in $Files) {
  if (-not (Test-Path $f)) { Write-Host ('跳过（不存在）：' + $f) -ForegroundColor DarkGray; continue }
  Write-Host ('签名：' + $f)
  & $signtool sign /f $Pfx /p $Password /fd SHA256 /tr 'http://timestamp.digicert.com' /td SHA256 $f
  if ($LASTEXITCODE -ne 0) { throw ('签名失败：' + $f) }
  & $signtool verify /pa $f
  if ($LASTEXITCODE -ne 0) { Write-Host ('校验未通过（可能证书链不受信任）：' + $f) -ForegroundColor Yellow }
}
Write-Host '签名完成。' -ForegroundColor Green
