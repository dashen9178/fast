$ErrorActionPreference='Stop'
# 目标 = 工程根的 assets/www/editor.js，按脚本自身位置解析（本脚本在 test/old/，故上两级）
$p=Join-Path $PSScriptRoot '..\..\assets\www\editor.js'
$t=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)

$clean=@'
drawRightSideRow_(row) {
        // controls_if right outline (ASCII comments to avoid encoding issues):
        //  - header rows (IFk/ELSEHDR) bulge out to their own condition-driven edge;
        //  - statement pockets keep a FIXED arm width (__ifPocketEdge);
        //  - spacer between a header and its pocket: convex corner then horizontal
        //    move back to the fixed pocket mouth, so a wide boolean condition only
        //    widens its own header bar and never the pocket/arm below it.
        if (this.block_.type === 'controls_if' && this.info_.__ifRowEdge) {
          var rowsAll = this.info_.rows;
          var ix = rowsAll.indexOf(row);
          var nextRow = ix >= 0 ? rowsAll[ix + 1] : null;
          var PE = this.info_.__ifPocketEdge;
          if (T.isSpacer(row) && nextRow && nextRow.hasStatement) {
            this.outlinePath_ += P.arc('a', '0 0,1', 8, P.point(-8, 8))
              + P.lineOnAxis('H', PE - 8);
            return;
          }
          if (!T.isSpacer(row) && !row.hasStatement && this.info_.__ifRowEdge.has(row)) {
            var edge = this.info_.__ifRowEdge.get(row);
            var ui = this.info_.__ifRowUnit.get(row);
            if (ui > 0 && edge - PE > 0.5) {
              this.outlinePath_ += P.lineOnAxis('H', edge - 8)
                + P.arc('a', '0 0,1', 8, P.point(8, 8));
            }
            this.outlinePath_ += P.lineOnAxis('V', row.yPos + row.height);
            return;
          }
          return super.drawRightSideRow_(row);
        }
        if (this.block_.outputConnection || this.block_.statementInputCount || T.isSpacer(row)) {
          return super.drawRightSideRow_(row);
        }
      }
'@
$clean = ($clean -replace "`r`n","`n")

$rx = [regex]'drawRightSideRow_\(row\) \{[\s\S]*?\n      \}\n      // '
$matches = $rx.Matches($t)
Write-Output ("method occurrences matched: " + $matches.Count)
if($matches.Count -ne 1){ throw 'method match not unique' }
$evaluator = [System.Text.RegularExpressions.MatchEvaluator]{ param($m) ($clean + "`n      // ") }
$t = $rx.Replace($t, $evaluator)

[IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding($false)))
Write-Output 'drawer method rewritten (ASCII) OK'
