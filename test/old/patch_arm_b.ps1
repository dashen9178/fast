$ErrorActionPreference='Stop'
# 目标 = 工程根的 assets/www/editor.js，按脚本自身位置解析（本脚本在 test/old/，故上两级）
$p=Join-Path $PSScriptRoot '..\..\assets\www\editor.js'
$t=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)
function Norm($s){ return ($s -replace "`r`n","`n") }
function R1($src,$old,$new,$tag){
  $old=Norm $old; $new=Norm $new
  $cnt=([regex]::Matches($src,[regex]::Escape($old))).Count
  if($cnt -ne 1){ throw "PATCH $tag matched $cnt times" }
  return $src.Replace($old,$new)
}

$oldC=@'
        if (this.block_.type === 'controls_if' && !T.isSpacer(row) && !row.hasStatement
            && this.info_.__ifRowEdge && this.info_.__ifRowEdge.has(row)) {
'@
$newC=@'
        var __rows = this.info_.rows;
        var __ix = __rows.indexOf(row);
        var __next = __ix >= 0 ? __rows[__ix + 1] : null;
        var __PE = this.info_.__ifPocketEdge;
        // 条件标题行 → 口袋 的间隔行：在标题外缘画 r=8 外凸圆角，再横移【收回】
        // 到固定口袋口（P-8）。布尔条件只撑宽标题横条，口袋口/托臂始终固定臂宽。
        if (this.block_.type === 'controls_if' && this.info_.__ifRowEdge
            && T.isSpacer(row) && __next && __next.hasStatement) {
          this.outlinePath_ += P.arc('a', '0 0,1', 8, P.point(-8, 8))
            + P.lineOnAxis('H', __PE - 8);
          return;
        }
        if (this.block_.type === 'controls_if' && this.info_.__ifRowEdge
            && !T.isSpacer(row) && !row.hasStatement && this.info_.__ifRowEdge.has(row)) {
'@
$t=R1 $t $oldC $newC 'C'

$oldD="          if (ui > 0 && Math.abs(edge - this.info_.__ifEdges[ui - 1]) > 0.5) {"
$newD="          if (ui > 0 && edge - this.info_.__ifPocketEdge > 0.5) {"
$t=R1 $t $oldD $newD 'D'

[IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding($false)))
Write-Output 'drawer patches C/D applied OK'
