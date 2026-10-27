# FAST

安卓上的积木式图形化编程工具。编辑器本体是 WebView + Blockly 10 前端，外壳是原生 Java；
作品可导出、发布到社区，支持云端检查更新。

## 目录

| 路径 | 说明 |
| --- | --- |
| `assets/www/` | 编辑器前端（`editor.js` / `editor.html` / 运行时页面） |
| `src/` | 安卓外壳（WebView 宿主、作品导出、设备密钥） |
| `res/`、`shell/` | 资源与竖屏 / 横屏清单模板 |
| `aliyun-fc-mail/` | 阿里云函数计算里的中转服务（发验证码 + SeaTable 代理 + APK 分发） |
| `pc-sim/` | 在浏览器里跑编辑器的仿真环境与回归测试 |
| `build.ps1` / `build.sh` | 打包脚本（不依赖 Gradle，直接 aapt2 + javac + d8） |
| `NEXT.md` | 开发交接文档：踩过的坑、设计取舍 |

## 打包

需要 JDK 17 和 Android SDK（build-tools 34.0.0、platform android-35），路径用环境变量指定：

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk'
$env:ANDROID_SDK_ROOT = 'C:\path\to\sdk'
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
```

产物默认输出到 `D:\DSH工作\fastapk`，可用 `FAST_OUT_DIR` 改。

## 注意

- 仓库**不含**签名密钥（`keys/editor.p12`）。自行构建需要生成自己的密钥，并设置
  `FAST_KS_PASS` / `FAST_KEY_PASS`；不设置会用脚本里的默认口令，仅供本地调试。
- 部署云函数需要 `FAST_APP_TOKEN`（App 下载口令）和阿里云访问密钥，均由环境变量传入，不写进仓库。
- 未声明开源许可证，默认保留所有权利。
