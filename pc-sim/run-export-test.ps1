# FAST 导出流程 —— PC 端一键验证（不需要真机）
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-export-test.ps1
#
# 它做的是：用真实的 Exporter.java / AxmlRewriter.java（不是仿写的），
# 把上一步打包出来的壳 APK 当成模板，改写包名/应用名/版本号、重打 ZIP、用真实密钥签名，
# 产出两个成品 APK，再用 aapt2 / zipalign / apksigner 逐个校验。
#
# 前置条件：先成功跑过一次 build.ps1（脚本要用 stage\ 里刚生成的壳 APK）。
# 注意：过程中会在临时目录放一份密钥副本，脚本结束时会删掉整个临时目录。
#
# 实现备注：不要给原生程序加 2>&1 或 2>文件 —— PowerShell 会把它们的 stderr 包成
# “错误记录”，在本脚本的 Stop 策略下直接中断。javac 的弃用提示改用 -Xlint:none 关掉。

param(
  [string]$Work = (Join-Path $env:TEMP 'fast-sim')
)

$ErrorActionPreference = 'Stop'
$projDir = Split-Path $PSScriptRoot -Parent

$JAVA_HOME   = if ($env:JAVA_HOME)        { $env:JAVA_HOME }        else { 'D:\android-build\jdk' }
$SDK         = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\android-build\sdk' }
$BT          = Join-Path $SDK 'build-tools\34.0.0'
$ANDROID_JAR = Join-Path $SDK 'platforms\android-35\android.jar'
$JAVAC = Join-Path $JAVA_HOME 'bin\javac.exe'
$JAVA  = Join-Path $JAVA_HOME 'bin\java.exe'
$AAPT2 = Join-Path $BT 'aapt2.exe'
$ZIPALIGN = Join-Path $BT 'zipalign.exe'
$APKSIG = Join-Path $BT 'lib\apksigner.jar'

foreach ($t in @($JAVAC, $JAVA, $AAPT2, $ZIPALIGN, $APKSIG, $ANDROID_JAR)) {
  if (-not (Test-Path -LiteralPath $t)) { throw "缺少工具: $t（可用 JAVA_HOME / ANDROID_SDK_ROOT 覆盖）" }
}
$shellPortrait = Join-Path $projDir 'stage\shell.apk'
$shellLand     = Join-Path $projDir 'stage\shell-land.apk'
if (-not (Test-Path $shellPortrait) -or -not (Test-Path $shellLand)) {
  throw "找不到 stage\shell.apk / shell-land.apk —— 请先跑一次 build.ps1（它们在那里顺带产出）"
}

$exitCode = 0
try {
  Write-Host "== [1/4] 准备临时工作目录 =="
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force "$Work\src\com\fast\app", "$Work\assets", "$Work\classes", "$Work\out" | Out-Null
  Copy-Item (Join-Path $projDir 'src\com\fast\app\*.java') "$Work\src\com\fast\app\" -Force
  Copy-Item (Join-Path $PSScriptRoot 'com\fast\app\*.java') "$Work\src\com\fast\app\" -Force
  # 不再需要任何密钥文件：签名身份由被测代码在现场生成（DerX509 + DeviceKey 同一条路径）
  Copy-Item $shellPortrait, $shellLand "$Work\assets\" -Force

  Write-Host "== [2/4] 编译真实的导出代码 =="
  $srcs = Get-ChildItem "$Work\src" -Recurse -Filter *.java |
          ForEach-Object { $_.FullName.Substring($Work.Length + 1) -replace '\\', '/' }
  Set-Content -Encoding ASCII "$Work\srcs.txt" -Value $srcs
  Push-Location $Work
  & $JAVAC -encoding UTF-8 -Xlint:none -nowarn -classpath "$ANDROID_JAR;$APKSIG" -d classes "@srcs.txt"
  $javacExit = $LASTEXITCODE
  Pop-Location
  if ($javacExit -ne 0) { throw "javac 编译失败（退出码 $javacExit）" }

  Write-Host "== [3/4] 跑导出（改写包名/应用名/版本 -> 重打 ZIP -> 签名） =="
  & $JAVA -cp "$Work\classes;$APKSIG" com.fast.app.ExportSim "$Work\assets" "$Work\out"
  if ($LASTEXITCODE -ne 0) { throw "导出模拟失败（退出码 $LASTEXITCODE）" }

  Write-Host "== [4/4] 逐个校验成品 =="
  $fail = 0
  foreach ($c in @(@('todo.apk', '我的待办', '2.5'), @('land.apk', '横屏测试', '1.0'))) {
    $apk = Join-Path "$Work\out" $c[0]
    $bad = (& $AAPT2 dump badging $apk) -join "`n"
    $pkgOk    = $bad -match "versionName='$([regex]::Escape($c[2]))'"
    $labelOk  = $bad -match [regex]::Escape("application-label:'$($c[1])'")
    $launchOk = $bad -match 'launchable-activity'
    & $ZIPALIGN -c -p 4 $apk | Out-Null
    $alignOk = ($LASTEXITCODE -eq 0)
    $ver = (& $JAVA -cp $APKSIG com.android.apksigner.ApkSignerTool verify --verbose $apk) -join "`n"
    $signOk = ($ver -match 'Verifies') -and ($ver -match 'v2 scheme.*true')

    $ok = $pkgOk -and $labelOk -and $launchOk -and $alignOk -and $signOk
    if (-not $ok) { $fail++ }
    Write-Host ("  {0} {1,-9} 应用名={2} 版本={3} 签名v2={4} 对齐={5} 入口={6}" -f `
      $(if ($ok) { '✓' } else { '✗' }), $c[0], $(if ($labelOk) { 'OK' } else { '错' }), `
      $(if ($pkgOk) { 'OK' } else { '错' }), $(if ($signOk) { 'OK' } else { '错' }), `
      $(if ($alignOk) { 'OK' } else { '错' }), $(if ($launchOk) { 'OK' } else { '错' }))
  }
  if ($fail -gt 0) { $exitCode = 1; Write-Host "结果：有 $fail 个成品不合格 ✗" }
  else { Write-Host "结果：全部通过 ✓" }
} finally {
  # 清掉临时目录（这里已经没有密钥副本了，纯粹不留垃圾）
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
}
exit $exitCode
