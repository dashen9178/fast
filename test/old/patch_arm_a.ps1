$ErrorActionPreference='Stop'
# 目标 = 工程根的 assets/www/editor.js，按脚本自身位置解析（本脚本在 test/old/，故上两级）
$p=Join-Path $PSScriptRoot '..\..\assets\www\editor.js'
$t=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)
function R1($src,$old,$new,$tag){
  $cnt=([regex]::Matches($src,[regex]::Escape($old))).Count
  if($cnt -ne 1){ throw "PATCH $tag matched $cnt times" }
  return $src.Replace($old,$new)
}
# A1: 声明固定臂宽
$t=R1 $t '        this.statementEdge = PAD_L;' "        var POCKET_EDGE = MIN_EDGE;                 // 固定臂宽 160`n        this.statementEdge = PAD_L;" 'A1'
# A2: 语句行外缘用固定臂宽
$t=R1 $t 'var targetRowW = un4.edge - INSIDE_W;' 'var targetRowW = POCKET_EDGE - INSIDE_W;' 'A2'
# A3: 语句行右缘映射为固定臂宽
$t=R1 $t 'rowEdge.set(un4.stmt, un4.edge);' 'rowEdge.set(un4.stmt, POCKET_EDGE);' 'A3'
# A4: 底行固定臂宽
$t=R1 $t 'var lastEdge = units[units.length - 1].edge;' 'var lastEdge = POCKET_EDGE;' 'A4'
$t=R1 $t 'growRow(this.bottomRow, lastEdge);' 'growRow(this.bottomRow, POCKET_EDGE);' 'A5'
# B: 导出固定臂宽
$t=R1 $t 'this.__ifEdges = units.map(function (un5) { return un5.edge; });' "this.__ifEdges = units.map(function (un5) { return un5.edge; });`n        this.__ifPocketEdge = POCKET_EDGE;" 'B'
[IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding($false)))
Write-Output 'measure patches A/B applied OK'
