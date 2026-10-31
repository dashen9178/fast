﻿# build.sh 的 Windows 等价构建（JDK17 + Android build-tools，无需 Gradle）
# 关键：Windows 版 aapt2 link -A 对多层子目录会写出反斜杠条目名（assets\www\...），
# 故 -A 只放一层资产；www 多层目录用 ZipArchive 以正斜杠条目名追加，
# 且不整体重建 zip，保证 resources.arsc / png 等保持 aapt2 的 STORED 布局。
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

# 工具链位置：优先读环境变量，未设置时回退到本机默认路径（换机器无需改本文件）
#   JAVA_HOME                         JDK 根目录
#   ANDROID_SDK_ROOT / ANDROID_HOME   Android SDK 根目录（二者取其一）
$SDK = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
       elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME }
       else { 'D:\android-build\sdk' }
$JAVA_HOME = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'D:\android-build\jdk' }
$BT = Join-Path $SDK 'build-tools\34.0.0'
$ANDROID_JAR = Join-Path $SDK 'platforms\android-35\android.jar'
$APKSIG = Join-Path $BT 'lib\apksigner.jar'
$D8JAR = Join-Path $BT 'lib\d8.jar'
$AAPT2 = Join-Path $BT 'aapt2.exe'
$ZIPALIGN = Join-Path $BT 'zipalign.exe'
$JAVA = Join-Path $JAVA_HOME 'bin\java.exe'
$JAVAC = Join-Path $JAVA_HOME 'bin\javac.exe'

# 工具链缺失时立即失败并指明如何覆盖，避免后续出现难以定位的报错
foreach ($tool in @($JAVA, $JAVAC, $AAPT2, $ZIPALIGN, $APKSIG, $D8JAR, $ANDROID_JAR)) {
  if (-not (Test-Path -LiteralPath $tool)) {
    throw "缺少构建工具: $tool`n可用 JAVA_HOME / ANDROID_SDK_ROOT 覆盖工具链位置"
  }
}

# 签名密码：优先读环境变量 FAST_KS_PASS / FAST_KEY_PASS；
# 建议设好环境变量后，把下面的默认值删掉，密码就不再留在文件里。
$KS_PASS  = if ($env:FAST_KS_PASS)  { $env:FAST_KS_PASS }  else { 'CHANGE_ME' }
$KEY_PASS = if ($env:FAST_KEY_PASS) { $env:FAST_KEY_PASS } else { 'CHANGE_ME' }

$STAGE = Join-Path $PSScriptRoot 'stage'
# 原生工具（aapt2/zipalign）不认路径里的非 ASCII 字符（中文目录会报"找不到文件"），
# 故一律给它们传相对路径；cwd 已由 Set-Location 固定在工程根。
$STAGE_REL = 'stage'
# 成品目录：默认 D:\DSH工作\fastapk（不想写死可用 FAST_OUT_DIR 覆盖）
$OUT = if ($env:FAST_OUT_DIR) { $env:FAST_OUT_DIR } else { 'D:\DSH工作\fastapk' }
Remove-Item -Recurse -Force $STAGE -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$STAGE\classes", "$STAGE\dex", "$STAGE\shell_assets", "$STAGE\shell_www", "$STAGE\editor_assets", $OUT | Out-Null

# 版本号规则：
#   VERSION 第 1 行 = versionCode，每次打包自动 +1（保证能覆盖安装）
#   VERSION 第 2 行 = 上一次的 versionName，打包时把最后一段 +1（1.0.117.1 -> 1.0.117.2）
#   缺第 2 行时以 1.0.<versionCode>.1 起始；想换基准就把它改成 1.0.<新基准>.0
$vLines = @([System.IO.File]::ReadAllLines((Resolve-Path 'VERSION')))
$VC = ($vLines[0] -replace '\s', '')
if (-not $VC) { $VC = '1' }
$prevVN = if ($vLines.Count -ge 2) { $vLines[1].Trim() } else { '' }
if ($prevVN -match '^(.*\.)(\d+)$') { $VN = $Matches[1] + ([int]$Matches[2] + 1) } else { $VN = "1.0.$VC.1" }
# 正式版可以固定版本名（例如发布 1.0.0）：FAST_VERSION_NAME=1.0.0，只覆盖 versionName，versionCode 仍递增
if ($env:FAST_VERSION_NAME) { $VN = $env:FAST_VERSION_NAME }
Write-Host "== versionCode=$VC  versionName=$VN =="

function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

Write-Host '== [1/8] aapt2 compile res =='
& $AAPT2 compile --dir res -o "$STAGE_REL\res.zip"; Check 'aapt2 compile'

Write-Host '== [2/8] javac =='
Get-ChildItem -Recurse src -Filter *.java | ForEach-Object { $_.FullName.Substring($PSScriptRoot.Length + 1) -replace '\\','/' } | Set-Content -Encoding ASCII "$STAGE\srcs.txt"
& $JAVAC -source 8 -target 8 -nowarn -encoding UTF-8 -classpath "$ANDROID_JAR;$APKSIG" -d "$STAGE\classes" "@$STAGE\srcs.txt"
Check 'javac'
Get-ChildItem -Recurse "$STAGE\classes" -Filter *.class | ForEach-Object { $_.FullName.Substring($PSScriptRoot.Length + 1) -replace '\\','/' } | Set-Content -Encoding ASCII "$STAGE\classes.txt"
Write-Host "classes: $((Get-Content "$STAGE\classes.txt").Count)"

Write-Host '== [3/8] d8 classes.dex (with apksig) =='
& $JAVA -cp $D8JAR com.android.tools.r8.D8 --release --min-api 24 --lib $ANDROID_JAR --output "$STAGE\dex" "@$STAGE\classes.txt" $APKSIG
Check 'd8'

Write-Host '== [4/8] stage assets（-A 只放一层；www 稍后追加） =='
Copy-Item shell_assets\project.json "$STAGE\shell_assets\project.json"
Copy-Item assets\www\runtime.html, assets\www\runtime.css, assets\www\runtime.js, assets\www\comp-spec.js, assets\www\qr.js "$STAGE\shell_www\"
# 这里刻意不再往编辑器 assets 里放任何签名密钥：
# 导出的作品改由「设备端自己生成的密钥」签名（见 DeviceKey.java），
# 编辑器 APK 里从此不含任何秘密，可以随意分发。

function Add-ZipFiles($apk, $srcDir, $entryPrefix) {
  $zip = [System.IO.Compression.ZipFile]::Open($apk, [System.IO.Compression.ZipArchiveMode]::Update)
  try {
    Get-ChildItem $srcDir -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($srcDir.Length + 1) -replace '\\', '/'
      $name = "$entryPrefix/$rel"
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name,
        [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $zip.Dispose() }
}
function Add-Dex($apk) {
  $zip = [System.IO.Compression.ZipFile]::Open($apk, [System.IO.Compression.ZipArchiveMode]::Update)
  try {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$STAGE\dex\classes.dex", 'classes.dex',
      [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  } finally { $zip.Dispose() }
}

function Link-Pkg($manifest, $assetsDir, $outApk) {
  & $AAPT2 link -o $outApk -I $ANDROID_JAR --manifest $manifest -A $assetsDir `
    --min-sdk-version 24 --target-sdk-version 30 --version-code $VC --version-name $VN "$STAGE_REL\res.zip"
  Check "aapt2 link $outApk"
}
function Build-Shell($manifest, $name) {
  Link-Pkg $manifest "$STAGE_REL\shell_assets" "$STAGE_REL\$name.base.apk"
  Add-Dex "$STAGE\$name.base.apk"
  Add-ZipFiles "$STAGE\$name.base.apk" "$STAGE\shell_www" 'assets/www'
  & $ZIPALIGN -f -p 4 "$STAGE_REL\$name.base.apk" "$STAGE_REL\$name"; Check "zipalign $name"
}

# 竖/横两个壳清单都由 shell\AndroidManifest.xml 这一份模板生成，唯一差别是 screenOrientation，
# 免得两份几乎一样的文件各改一处、漏改一处。
function New-ShellManifest($orientation, $outName) {
  $tpl = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'shell\AndroidManifest.xml'))
  $txt = $tpl.Replace('@ORIENTATION@', $orientation)
  [System.IO.File]::WriteAllText((Join-Path $STAGE $outName), $txt, (New-Object System.Text.UTF8Encoding($false)))
}
New-ShellManifest 'portrait'  'shell-manifest.xml'
New-ShellManifest 'landscape' 'shell-land-manifest.xml'

Write-Host '== [5/8] shell.apk (portrait, unsigned) =='
Build-Shell "$STAGE_REL\shell-manifest.xml" 'shell.apk'
Write-Host '== [6/8] shell-land.apk (landscape) =='
Build-Shell "$STAGE_REL\shell-land-manifest.xml" 'shell-land.apk'
Copy-Item "$STAGE\shell.apk", "$STAGE\shell-land.apk" "$STAGE\editor_assets\"

Write-Host '== [7/8] editor apk + sign =='
Link-Pkg 'AndroidManifest.xml' "$STAGE_REL\editor_assets" "$STAGE_REL\editor_base.apk"
Add-Dex "$STAGE\editor_base.apk"
# 把 assets\www 复制一份到 stage，在副本里把 __BUILD__ 占位符换成真实版本号，再打进包。
# 为什么必须这么做：页面脚本以前带的是写死的版本串，装了新包 WebView 仍可能用旧脚本，
# 表现就是「改了代码却看不到变化」（这轮排查里真踩过，白费很多时间）。
$WWW = Join-Path $STAGE 'editor_www'
Remove-Item -Recurse -Force $WWW -ErrorAction SilentlyContinue
Copy-Item (Join-Path $PSScriptRoot 'assets\www') $WWW -Recurse
Get-ChildItem -Path $WWW -Recurse -Include *.html -File | ForEach-Object {
  $t = [System.IO.File]::ReadAllText($_.FullName)
  if ($t.Contains('__BUILD__')) {
    $t = $t.Replace('__BUILD__', $VN)
    [System.IO.File]::WriteAllText($_.FullName, $t, (New-Object System.Text.UTF8Encoding($false)))
  }
}
Write-Host ('== 版本号已注入页面: ?v=' + $VN + ' ==')
# 兜底常量也同步成正式版本号：桌面壳没有 ?v= 参数时首页/检查更新都用它
Get-ChildItem -Path $WWW -Recurse -Include *.js -File | ForEach-Object {
  $t = [System.IO.File]::ReadAllText($_.FullName)
  if ($t -match "内置版本号 = '(\d+(\.\d+)+)'") {
    $t = $t -replace "内置版本号 = '(\d+(\.\d+)+)'", ("内置版本号 = '" + $VN + "'")
    [System.IO.File]::WriteAllText($_.FullName, $t, (New-Object System.Text.UTF8Encoding($false)))
  }
}
Add-ZipFiles "$STAGE\editor_base.apk" $WWW 'assets/www'
& $ZIPALIGN -f -p 4 "$STAGE_REL\editor_base.apk" "$STAGE_REL\editor_aligned.apk"; Check 'zipalign editor'
& $JAVA -cp $APKSIG com.android.apksigner.ApkSignerTool sign --ks keys\editor.p12 --ks-type PKCS12 `
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KEY_PASS" --v1-signing-enabled true --v2-signing-enabled true `
  "$STAGE\editor_aligned.apk"; Check 'apksigner'
$APK_NAME = "FAST_v$VN.apk"
Copy-Item "$STAGE\editor_aligned.apk" "$OUT\$APK_NAME" -Force

Write-Host '== [8/8] verify =='
# 安全性质断言：编辑器 APK 里绝不能出现任何密钥材料。
# 导出的作品改由每台设备自己生成的密钥签名，因此这个 APK 可以随意分发。
$zip = [System.IO.Compression.ZipFile]::OpenRead("$OUT\$APK_NAME")
try {
  $leaked = @($zip.Entries | Where-Object { $_.FullName -match '(?i)signkey|signcert|\.pk8$|\.p12$|\.pem$' } | ForEach-Object { $_.FullName })
} finally { $zip.Dispose() }
if ($leaked.Count -gt 0) { throw "编辑器 APK 内仍含密钥材料：$($leaked -join ', ')" }
Write-Host 'ok: APK 内不含任何密钥材料'

# 安全性质断言（2026-09-25 加）：APK 里绝不能出现 SeaTable 凭据。
# 背景：这些 token 以前硬编码在 editor.js 里，谁拿到 APK 就能读写整张「账号」表和「社区」表。
# 现在账号/社区/更新的云请求都走云中转（editor.js 的 CLOUD_BASE），密钥只存在服务端。
# 这条断言是**硬门槛**：一旦有人又把 token 填回去，打包直接失败，不会悄悄发出去。
# 只查**密钥**（token）。表 UUID 不是密钥（中转会强制换成服务端白名单里的 UUID，
# 光有 UUID 什么也做不了），所以不拦，免得误报。
$凭据特征 = @(
  '66303f1bc',   # 账号/社区 API Token 的前缀（**故意只留前缀**：仓库是公开的，不能写完整值；
                 # 完整 token 见函数环境变量 SEATABLE_TOKEN。Contains 查前缀照样能扫出整串泄露）
  'fb7817a1d4f5' # 「更新」表 API Token 的前缀（同上）
)
$zip2 = [System.IO.Compression.ZipFile]::OpenRead("$OUT\$APK_NAME")
$命中 = @()
try {
  foreach ($e in $zip2.Entries) {
    if ($e.Length -eq 0 -or $e.Length -gt 4MB) { continue }
    if ($e.FullName -notmatch '(?i)\.(js|html|css|json|txt|xml|java|kt)$') { continue }
    $sr = New-Object System.IO.StreamReader($e.Open())
    try { $txt = $sr.ReadToEnd() } finally { $sr.Dispose() }
    foreach ($k in $凭据特征) { if ($txt.Contains($k)) { $命中 += "$($e.FullName) ← $($k.Substring(0,8))…" } }
  }
} finally { $zip2.Dispose() }
if ($命中.Count -gt 0) {
  throw "编辑器 APK 里出现了 SeaTable 凭据，禁止发布！应改走云中转（editor.js 的 CLOUD_BASE）。命中：$($命中 -join '; ')"
}
Write-Host 'ok: APK 内不含任何 SeaTable 凭据（账号/社区/更新 均已走云中转）'
& $JAVA -cp $APKSIG com.android.apksigner.ApkSignerTool verify --verbose "$OUT\$APK_NAME"
Check 'verify'
Get-Item "$OUT\$APK_NAME" | Select-Object FullName, Length

$next = [int]$VC + 1
[System.IO.File]::WriteAllLines((Join-Path $PSScriptRoot 'VERSION'), @("$next", $VN), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "== 成品: $OUT\$APK_NAME =="
Write-Host "== VERSION advanced: next versionCode=$next  (本次 versionName=$VN) =="
