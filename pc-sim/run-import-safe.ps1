# FAST 编辑器 —— PC 端一键回归测试
#
# 用法（在本目录或工程根目录都可以）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-ui-test.ps1
#
# 它会自动：
#   1) 起一个静态服务，把 assets/www 挂在 http://127.0.0.1:8931/
#   2) 起一个无头 Edge（独立 user-data-dir，不会碰你正在用的 Edge）
#   3) 跑 verify-import-safe.mjs：模拟真人点界面，走完「建作品 -> 设计页 -> 加组件 -> 积木页 -> 放积木 -> 返回首页」
#   4) 全程截图，结束后自动关掉服务和浏览器
#
# 退出码 0 表示全部通过。

param(
  [string]$Shots = (Join-Path $env:TEMP 'fast-ui-test'),
  [int]$Port = 8931,
  [int]$CdpPort = 9222,
  [string]$Electron = 'D:\DSH\DSH Desktop\DSH Desktop.exe'
)

$ErrorActionPreference = 'Stop'
$simDir  = $PSScriptRoot
$projDir = Split-Path $simDir -Parent
$wwwDir  = Join-Path $projDir 'assets\www'

if (-not (Test-Path $wwwDir)) { throw "找不到前端目录: $wwwDir" }
if (-not (Test-Path $Electron)) { throw "找不到 Electron（用来当 Node 跑测试脚本）: $Electron" }

# 端口守卫：**先看端口有没有被残留的无头 Edge 占着**。
# 为什么必须加（2026-09-26 踩过，浪费了一整轮）：上一轮脚本超时被强杀时，它起的 Edge 有时没被收掉，
# 还占着 $CdpPort；这一轮的 Edge 绑不上就自己换个随机端口，而测试脚本照旧去连 $CdpPort —— 于是连到
# **上一轮那个已经要死的页面**，报一堆 `Blockly is not defined` / `找不到 editor.html 页面目标`，
# 一整轮 154 条用例几乎全红，看起来像"改动把编辑器搞崩了"。其实代码没问题。
foreach ($p in @($Port, $CdpPort)) {
  $busy = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    Write-Host "端口 $p 已被占用（pid $($busy[0].OwningProcess)）—— 多半是上一轮残留的无头 Edge。"
    Write-Host "先执行：Get-Process msedge | Stop-Process -Force   然后再跑本脚本。"
    exit 1
  }
}

$edge = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw '找不到 msedge.exe' }

$udd = Join-Path $env:TEMP 'edge-cdp-fast'
Remove-Item -Recurse -Force $udd -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $Shots -ErrorAction SilentlyContinue

Write-Host "== [1/4] 起静态服务 http://127.0.0.1:$Port/ =="
$server = Start-Job -ArgumentList $wwwDir, $Port -ScriptBlock {
  param($root, $port)
  $mime = @{ '.html'='text/html; charset=utf-8'; '.js'='application/javascript; charset=utf-8';
             '.css'='text/css; charset=utf-8'; '.svg'='image/svg+xml'; '.png'='image/png';
             '.gif'='image/gif'; '.mp3'='audio/mpeg'; '.ogg'='audio/ogg'; '.wav'='audio/wav';
             '.cur'='image/x-icon'; '.json'='application/json; charset=utf-8' }
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://127.0.0.1:$port/")
  $l.Start()
  while ($l.IsListening) {
    try {
      $c = $l.GetContext(); $r = $c.Response
      $rel = $c.Request.Url.AbsolutePath.TrimStart('/')
      if ($rel -eq '') { $rel = 'editor.html' }
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or
          -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $r.StatusCode = 404; $b = [Text.Encoding]::UTF8.GetBytes('404')
        $r.ContentLength64 = $b.Length; $r.OutputStream.Write($b,0,$b.Length); $r.OutputStream.Close(); continue
      }
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $r.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $r.ContentLength64 = $bytes.Length
      $r.OutputStream.Write($bytes, 0, $bytes.Length)
      $r.OutputStream.Close()
    } catch { }
  }
}
Start-Sleep -Seconds 2

$exitCode = 1
try {
  Write-Host "== [2/4] 起无头 Edge（调试端口 $CdpPort） =="
  Start-Process -FilePath $edge -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    "--remote-debugging-port=$CdpPort", '--remote-allow-origins=*', "--user-data-dir=$udd",
    "http://127.0.0.1:$Port/editor.html"
  ) | Out-Null
  Start-Sleep -Seconds 5

  Write-Host "== [3/4] 跑测试 =="
  New-Item -ItemType Directory -Force -Path $Shots | Out-Null
  $logFile = Join-Path $Shots 'test-output.txt'
  $env:ELECTRON_RUN_AS_NODE = '1'
  # 合并所有输出流并同时写到控制台与日志文件，否则测试脚本的报错会被吞掉
  & $Electron (Join-Path $simDir 'verify-import-safe.mjs') $Shots *>&1 | Tee-Object -FilePath $logFile
  $exitCode = $LASTEXITCODE
  Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Write-Host "(测试脚本退出码 $exitCode，完整输出见 $logFile)"
} finally {
  Write-Host "== [4/4] 清理 =="
  Stop-Job $server -ErrorAction SilentlyContinue
  Remove-Job $server -Force -ErrorAction SilentlyContinue
  # 只关掉本次启动的 Edge（按 user-data-dir 精确匹配，不动你自己开的 Edge）
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($udd) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $udd -ErrorAction SilentlyContinue
}

Write-Host ""
if ($exitCode -eq 0) { Write-Host "结果：全部通过 ✓   截图在 $Shots" }
else { Write-Host "结果：有失败项 ✗   截图在 $Shots" }
exit $exitCode
