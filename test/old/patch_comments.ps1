$ErrorActionPreference='Stop'
# 目标 = 工程根的 assets/www/editor.js，按脚本自身位置解析（本脚本在 test/old/，故上两级）
$p=Join-Path $PSScriptRoot '..\..\assets\www\editor.js'
$t=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)

# 1) mojibake trailing comment on POCKET_EDGE line -> ASCII
$line = @(($t -split "`n") | Where-Object { $_ -match 'var POCKET_EDGE = MIN_EDGE;' })
if($line.Count -ne 1){ throw 'POCKET_EDGE line not unique' }
$t = $t.Replace($line[0], "        var POCKET_EDGE = MIN_EDGE;                 // fixed pocket arm width (160), independent of condition width")

# 2) section 4 comment
$t = [regex]::Replace($t, '        // 4\) [^\n]*', "        // 4) Statement pocket rows: fixed arm width POCKET_EDGE; statementEdge stays the narrow spine")

# 3) stale floor comment
$t = [regex]::Replace($t, '          var targetRowW = POCKET_EDGE - INSIDE_W;[^\n]*', "          var targetRowW = POCKET_EDGE - INSIDE_W;          // fixed pocket floor edge (one inside-corner inset)")

# 4) stale bottom-row comment
$t = [regex]::Replace($t, '        // 5\) [^\n]*', "        // 5) Bottom row uses the fixed pocket edge (thin trailing arm)")

[IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding($false)))
Write-Output 'comments cleaned'
