# test/old —— 开发期一次性调试脚本（归档）

这里的脚本是开发过程中为了查某个具体问题临时写的，**不是可以一键跑的测试套件**。

## 它们需要什么才能跑

这些脚本绝大多数是"遥控浏览器"的类型，运行时需要：

1. **Node.js**（本机没装）；
2. `test/package.json` 里的 `ws` 依赖（在 `test/` 下执行 `npm i` 安装）；
3. 一个开着**调试端口**的浏览器：多数脚本连 `127.0.0.1:9222`，
   少数连 `9333`，还有连 `8931` 的（那是本地静态服务）。

所以现在直接 `node xxx.js` 是跑不起来的，属于"留着当参考"的状态。

## 内容大致分类

| 前缀 / 名字 | 用途 |
|---|---|
| `t_*.js` | 针对某个积木形状/交互的临时验证 |
| `win_*.js` | 齿轮/连接/缩放等窗口交互探针 |
| `gear_*.js` | 齿轮（mutation）相关 |
| `repro*.js` | 复现某个 bug 的最小场景 |
| `diag*.js` | 诊断输出 |
| `test_*.js` | 各版本的回归脚本 |
| `patch_*.ps1` | 当初用来直接改写 `assets/www/editor.js` 的一次性补丁脚本（**注意：改写会覆盖源文件**） |

## 关于 `patch_*.ps1`

这四个脚本会**直接改写** `assets/www/editor.js`。它们已经执行过了，正常情况下不需要再跑。
如果确实要跑，先提交一次 git，跑完用 `git diff` 看清它改了什么：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test\old\patch_arm_a.ps1
git diff assets/www/editor.js
```

想撤销：`git checkout -- assets/www/editor.js`
