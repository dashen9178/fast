# 导出诊断：把导出流程在 PC 上跑一遍，重点看"手机上装不上"的那些地方
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\diag-export.ps1
$ErrorActionPreference = 'Continue'
$projDir = Split-Path $PSScriptRoot -Parent
$JAVA_HOME = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'D:\android-build\jdk' }
$SDK = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\android-build\sdk' }
$BT = Join-Path $SDK 'build-tools\34.0.0'
$JAVA = Join-Path $JAVA_HOME 'bin\java.exe'
$JAVAC = Join-Path $JAVA_HOME 'bin\javac.exe'
$APKSIG = Join-Path $BT 'lib\apksigner.jar'
$AAPT2 = Join-Path $BT 'aapt2.exe'
$ZIPALIGN = Join-Path $BT 'zipalign.exe'

$Work = Join-Path $env:TEMP 'expdbg'
if (Test-Path $Work) { Remove-Item $Work -Recurse -Force }
New-Item -ItemType Directory -Path "$Work\classes" -Force | Out-Null
New-Item -ItemType Directory -Path "$Work\assets" -Force | Out-Null
New-Item -ItemType Directory -Path "$Work\out" -Force | Out-Null

# 壳 APK（build.ps1 产出）
Get-ChildItem (Join-Path $projDir 'stage') -Filter 'shell*.apk' | ForEach-Object { Copy-Item $_.FullName "$Work\assets\" -Force; "壳: $($_.Name) $($_.Length)" }
Copy-Item (Join-Path $projDir 'shell_assets\project.json') "$Work\assets\" -Force -ErrorAction SilentlyContinue

Write-Host '== 编译导出代码 =='
$srcs = @()
'Exporter.java','AxmlRewriter.java','DerX509.java','DeviceKey.java' | ForEach-Object { $srcs += (Join-Path $projDir "src\com\fast\app\$_") }
$srcs += (Join-Path $projDir 'pc-sim\com\fast\app\ExportSim.java')
& $JAVAC -nowarn -cp $APKSIG -d "$Work\classes" $srcs 2>&1 | Select-Object -Last 3

Write-Host '== ExportSim 用的应用名/包名 =='
Select-String -Path (Join-Path $projDir 'pc-sim\com\fast\app\ExportSim.java') -Pattern 'appName|作品|args\[|rt\.' | Select-Object -First 8 | ForEach-Object { "   $($_.LineNumber): $($_.Line.Trim())" }

Write-Host '== 跑导出 =='
& $JAVA -cp "$Work\classes;$APKSIG" com.fast.app.ExportSim "$Work\assets" "$Work\out" 2>&1 | Select-Object -Last 6
Get-ChildItem "$Work\out" -Filter '*.apk' | ForEach-Object { "  成品: $($_.Name)  $($_.Length) 字节" }

$apk = (Get-ChildItem "$Work\out" -Filter '*.apk' | Select-Object -First 1).FullName
if (-not $apk) { Write-Host '没产出 APK，停止'; exit 1 }

Write-Host '== ZIP 结构体检（本地头 vs 中央目录）=='
$b = [System.IO.File]::ReadAllBytes($apk)
$eocd = -1
for ($i = $b.Length - 22; $i -ge 0; $i--) { if ($b[$i] -eq 0x50 -and $b[$i+1] -eq 0x4b -and $b[$i+2] -eq 0x05 -and $b[$i+3] -eq 0x06) { $eocd = $i; break } }
if ($eocd -lt 0) { Write-Host '  找不到 EOCD —— ZIP 结构就有问题'; exit 1 }
$cnt = [BitConverter]::ToUInt16($b, $eocd + 10); $cdOff = [BitConverter]::ToUInt32($b, $eocd + 16)
"  条目数=$cnt 中央目录偏移=$cdOff 文件大小=$($b.Length) EOCD=$eocd"
$p = $cdOff; $bad = 0
for ($n = 0; $n -lt $cnt; $n++) {
  if ([BitConverter]::ToUInt32($b, $p) -ne 0x02014b50) { "  中央目录第 $n 条签名不对"; $bad++; break }
  $verNeed = [BitConverter]::ToUInt16($b, $p + 6)
  $flags = [BitConverter]::ToUInt16($b, $p + 8)
  $method = [BitConverter]::ToUInt16($b, $p + 10)
  $crc = [BitConverter]::ToUInt32($b, $p + 16)
  $csize = [BitConverter]::ToUInt32($b, $p + 20)
  $usize = [BitConverter]::ToUInt32($b, $p + 24)
  $fnLen = [BitConverter]::ToUInt16($b, $p + 28); $exLen = [BitConverter]::ToUInt16($b, $p + 30); $cmLen = [BitConverter]::ToUInt16($b, $p + 32)
  $lOff = [BitConverter]::ToUInt32($b, $p + 42)
  $name = [System.Text.Encoding]::UTF8.GetString($b, $p + 46, $fnLen)
  if ([BitConverter]::ToUInt32($b, $lOff) -ne 0x04034b50) { "  [$name] 本地头签名不对 @$lOff"; $bad++; }
  else {
    $lFlags = [BitConverter]::ToUInt16($b, $lOff + 6); $lMethod = [BitConverter]::ToUInt16($b, $lOff + 8)
    $lCrc = [BitConverter]::ToUInt32($b, $lOff + 14); $lCsize = [BitConverter]::ToUInt32($b, $lOff + 18); $lUsize = [BitConverter]::ToUInt32($b, $lOff + 22)
    $lFn = [BitConverter]::ToUInt16($b, $lOff + 26); $lEx = [BitConverter]::ToUInt16($b, $lOff + 28)
    $dataOff = $lOff + 30 + $lFn + $lEx
    $问题 = @()
    if ($crc -ne $lCrc) { $问题 += 'CRC不一致' }
    if ($csize -ne $lCsize -or $usize -ne $lUsize) { $问题 += '大小不一致' }
    if (($flags -band 0x08) -ne 0) { $问题 += '用了数据描述符' }
    if ($method -eq 0 -and ($dataOff % 4) -ne 0) { $问题 += "未压缩但没4字节对齐(偏移%4=$($dataOff % 4))" }
    if ($name -eq 'resources.arsc' -and ($dataOff % 4) -ne 0) { $问题 += 'resources.arsc 没对齐' }
    if ($问题.Count) { "  [$name] " + ($问题 -join '，'); $bad++ }
  }
  $p += 46 + $fnLen + $exLen + $cmLen
}
if ($bad -eq 0) { '  ZIP 结构：本地头/中央目录一致，未压缩项都 4 字节对齐 ✅' }

Write-Host '== apksigner verify =='
& $JAVA -cp $APKSIG com.android.apksigner.ApkSignerTool verify --verbose $apk 2>&1 | Select-String -Pattern 'Verified using|Number of signers|WARNING|ERROR' | ForEach-Object { "  $($_.Line.Trim())" }
Write-Host '== 证书（openssl 解析，看有没有非法 DER）=='
$ossl = 'C:\Program Files\Git\usr\bin\openssl.exe'
if (Test-Path $ossl) {
  $f = [System.IO.File]::ReadAllBytes($apk)
  # 从 APK 里抽第一张证书：找 ZIP 里的 META-INF/*.RSA (PKCS7) 太麻烦，改用 apksigner --print-certs 的指纹对比
  & $JAVA -cp $APKSIG com.android.apksigner.ApkSignerTool verify --print-certs $apk 2>&1 | Select-String -Pattern 'Signer #1 certificate DN|SHA-256 digest|SHA-1 digest|Valid from|Valid until' | ForEach-Object { "  $($_.Line.Trim())" }
} else { '  （没找到 openssl）' }
Write-Host '== aapt2 dump badging（手机安装器也要过这一关）=='
& $AAPT2 dump badging $apk 2>&1 | Select-Object -First 8 | ForEach-Object { "  $_" }
Write-Host "工作目录: $Work"
