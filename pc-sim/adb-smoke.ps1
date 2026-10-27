# FAST 真机自动化冒烟（ADB）
#
# 用法（手机用 USB 连上电脑、打开「USB 调试」后）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\adb-smoke.ps1
#   powershell ... -File pc-sim\adb-smoke.ps1 -Apk "D:\DSH工作\fastapk\FAST_v1.0.116.71.apk"
#
# 它做四件事：
#   1) 装最新 APK（-r 覆盖安装，不会丢数据）
#   2) 启动 App，看进程有没有活着（白屏/闪退在这一步就暴露）
#   3) 抓 logcat 里的崩溃(AndroidRuntime/FATAL) 与 WebView 控制台报错(chromium)
#   4) 截图留证
# 退出码：0 = 冒烟通过；1 = 发现问题；2 = 环境不具备（没 adb / 没设备）
param(
  [string]$Apk = '',
  [string]$Pkg = 'com.doubao.blockbuilder',
  [int]$WaitSec = 6,
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
function Say($t) { Write-Host $t }

# ---- 1. 找 adb ----
$adb = (Get-Command adb.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $adb) {
  $cands = @(
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:USERPROFILE\AppData\Local\Android\Sdk\platform-tools\adb.exe",
    'C:\Android\platform-tools\adb.exe',
    'D:\Android\platform-tools\adb.exe',
    'D:\platform-tools\adb.exe'
  )
  foreach ($c in $cands) { if (Test-Path $c) { $adb = $c; break } }
}
if (-not $adb) {
  Say '找不到 adb.exe。装上 Android 平台工具（platform-tools）后重试：'
  Say '  下载地址 https://developer.android.com/tools/releases/platform-tools'
  Say '  解压后把 adb.exe 所在目录加进 PATH，或用 -Apk 指定路径后手动 adb install'
  exit 2
}
Say "adb = $adb"

# ---- 2. 找 APK ----
if (-not $Apk) {
  $dir = 'D:\DSH工作\fastapk'
  if (Test-Path $dir) {
    $Apk = (Get-ChildItem "$dir\FAST_v*.apk" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName)
  }
}
if (-not $Apk -or -not (Test-Path $Apk)) { Say "找不到 APK（-Apk 指一个 .apk 路径）"; exit 2 }
Say "APK = $Apk  ($([math]::Round((Get-Item $Apk).Length/1MB,2)) MB)"

# ---- 3. 设备 ----
$devices = & $adb devices 2>&1 | Select-String -Pattern '\tdevice$'
if (-not $devices) {
  Say '没有检测到已授权的设备。请：'
  Say '  1) 手机「设置 → 开发者选项」打开 USB 调试'
  Say '  2) 用数据线连电脑；手机上弹出「允许 USB 调试」时点允许'
  Say '  3) 再跑一次（adb devices 应该能看到设备号）'
  if ($DryRun) { Say '（-DryRun：脚本与路径检查通过，跳过真机步骤）'; exit 0 }
  exit 2
}
$serial = ($devices | Select-Object -First 1).ToString().Split("`t")[0]
Say "设备 = $serial"
$env:ANDROID_SERIAL = $serial

if ($DryRun) { Say '（-DryRun：一切就绪，未执行安装/启动）'; exit 0 }

# ---- 4. 装 ----
Say '[1/4] 安装 APK …'
$install = & $adb install -r $Apk 2>&1
Say ($install -join "`n")
if ($install -notmatch 'Success') { Say '安装失败'; exit 1 }

# ---- 5. 清日志 → 启动 → 等 ----
Say '[2/4] 启动 App …'
& $adb logcat -c 2>&1 | Out-Null
& $adb shell monkey -p $Pkg -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
Start-Sleep -Seconds $WaitSec

# ---- 6. 进程活着吗 ----
Say '[3/4] 检查进程与崩溃 …'
$pid1 = (& $adb shell pidof $Pkg 2>&1) -join ''
$alive = ($pid1 -match '\d')
Say ("进程: " + ($(if ($alive) { "活着 (pid $pid1)" } else { '不在了（可能启动就崩了）' })))

$log = (& $adb logcat -d -t 4000 2>&1) -join "`n"
$crashes = ($log -split "`n" | Select-String -Pattern 'FATAL EXCEPTION|AndroidRuntime.*Process: ' )
$webErr  = ($log -split "`n" | Select-String -Pattern 'chromium.*(Uncaught|ERROR:CONSOLE|console\.error)' )
$anr     = ($log -split "`n" | Select-String -Pattern 'ANR in ' )

# ---- 7. 截图 ----
Say '[4/4] 截图留证 …'
$shotDir = Join-Path $env:TEMP 'fast-adb-smoke'
New-Item -ItemType Directory -Force -Path $shotDir | Out-Null
$shot = Join-Path $shotDir ("shot-{0:yyyyMMdd-HHmmss}.png" -f (Get-Date))
& $adb exec-out screencap -p > $shot 2>$null
Say "截图: $shot"

# ---- 8. 结论 ----
Say ''
Say '==== 冒烟结论 ===='
Say ("进程存活 : " + $(if ($alive) { '是 ✓' } else { '否 ✗' }))
Say ("崩溃条数 : " + $crashes.Count)
Say ("ANR 条数 : " + $anr.Count)
Say ("WebView 报错 : " + $webErr.Count)
if ($crashes.Count) { Say '--- 崩溃片段 ---'; $crashes | Select-Object -First 8 | ForEach-Object { Say $_.ToString() } }
if ($webErr.Count)  { Say '--- WebView 片段 ---'; $webErr  | Select-Object -First 8 | ForEach-Object { Say $_.ToString() } }

if (-not $alive -or $crashes.Count -or $anr.Count) { Say '结果：有问题 ✗'; exit 1 }
Say '结果：冒烟通过 ✓（白屏请直接看上面那张截图）'
exit 0
