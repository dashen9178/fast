# 积木编程（BlockBuilder）工程构建说明 v1.4

一个可在安卓手机上「拖积木做 App、并离线导出可安装 APK」的应用。

> v1.4 变更：说明与实现对齐（工具链版本、产物位置、目录结构）；补上「版本号规则」「Windows 打包命令」
> 「中文路径的坑」「git 使用与回退」；移除文档里的明文密钥密码，改为单独保管提示。

---

## 〇、开工前先知道三件事

1. **工程要放在纯英文路径下**。`aapt2`、`zipalign` 这类工具**不认路径里的中文**，
   遇到中文目录会报"找不到指定的文件"。打包脚本已改为给它们传相对路径来规避，
   但把工程放在英文路径（如 `D:\work\fast_project`）最省心。
2. **Windows 打包命令**（这台电脑默认禁止直接运行脚本，必须带 `-ExecutionPolicy Bypass`）：
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
   ```
3. **签名钥匙 = 你的印章，属于机密**。编辑器本身用 `keys/editor.p12` 签（**只在你电脑上，
   不会被打包进任何 APK**）；用户导出的作品用的是**每台手机自己生成**的钥匙（见「二」）。
   所以：`keys/editor.p12` 不要提交、不要外传；而**编辑器 APK 本身不含任何私钥，可以随意分发**
   （旧版本不是这样，那时 `assets/` 里装着共用私钥，APK 不能外传——那个坑已经修掉了）。

---

## 一、整体架构（双壳 + 编辑器）

- **编辑器 APK**（包名 `com.doubao.blockbuilder`，恒横屏）：
  - 首页「我的 App」：多作品本地管理（新建/打开/复制/删除，localStorage 键 `__bb_projects_v2`）。
  - Blockly 积木编辑器（`assets/www`）。
  - 内嵌两个运行时壳：`assets/shell.apk`（竖屏作品）、`assets/shell-land.apk`（横屏作品）。
  - 内嵌签名密钥（见「二、签名材料」）。
- **运行时壳**：与编辑器共用同一套 Java/前端；启动发现 `assets/project.json` 即运行该作品。
  - 清单中包名 `com.doubao.rt.a00000`、应用名 20 个 `X`、版本号 `0.00` 均为待替换值。
- **导出原理**（`Exporter.java`，全部手机本地完成）：
  1. 按作品方向选竖/横壳；
  2. `AxmlRewriter.java` 重建二进制 Manifest 的字符串池，**任意长度**替换包名/应用名/版本号（不再需要等长锚点）；
  3. 写入用户 `assets/project.json`；自定义图标按 mipmap 密度缩放替换 `ic_launcher.png`；
  4. `Exporter.packApk` 手写规范 ZIP：`resources.arsc` 与已压缩二进制资源 STORED 且 4 字节对齐，
     其余 DEFLATED，本地头写全 CRC/大小、**无 bit3 数据描述符**（最大化各 ROM 安装器兼容性）；
  5. 官方 apksig 做 v1+v2+v3 重签名，随后**在设备端用 ApkVerifier 自检**，不通过直接报错，
     绝不把坏包交给系统安装器（否则只会得到含糊的"安装包已损坏"）。

### 关于「作品分享 / 导入」

用户在首页可以把作品分享给别人，也可以导入别人发来的作品。**分享的不是 APK，而是一个
`.fast` 文件**（本质是 JSON，里面装着整个工程），微信/QQ 直接当文件发即可。

- **格式**：`{ fast:1, kind:"project", appName, exportedAt, project:{...}, media:{文件名: Base64} }`。
  导入端两种都认：这种包装，或者直接就是一份工程对象。
- **本地媒体**：工程里 `media://xxx` 引用到的视频/音频会转成 Base64 一起带走（上限 8MB
  Base64 字符，超出的跳过并在提示里如实告知），接收方导入时写回自己的私有目录，
  所以带视频的作品也能正常分享。
- **原生桥接**：`Native.shareProject(json, fileName)` 落盘后唤起系统分享面板；
  `Native.readMediaBase64(name)` / `Native.writeMedia(name, base64)` 负责媒体进出。
  `.fast` 对外按 `application/octet-stream` 暴露——微信对 `application/json` 过滤较严，
  会发不出去。
- **导入必须严格校验**：解析失败、结构不全的文件只弹提示，**绝不写进作品列表**，
  否则一个坏文件就能把整个编辑器搞坏。同名作品导入时自动改成「原名 (2)」，不覆盖。
- **PC 上没有 Native** 时，分享退化为浏览器下载 `.fast` 文件（自动化测试走的就是这条分支）。

真机上踩到并修掉的两个坑（都只有真机能发现，PC 测试测不到）：

- **微信报「获取资源失败」**：分享必须用公共「下载/fast本地app」里**系统 MediaStore** 的
  content:// 地址，**不能**用自建的 `SimpleFileProvider` —— 微信读自建 Provider 的 Uri
  会报这个错（安装器当年踩的是同一个坑，见 `launchInstaller` 的注释）。
  并且 Android 11+ 必须在清单 `<queries>` 里声明 `ACTION_SEND`，否则
  `queryIntentActivities` 会被包可见性过滤成空列表，逐个授权那一步等于没跑。
- **导入时文件选择框停在无关目录**：`params.createIntent()` 会沿用系统记住的上次位置
  （实测停在「通话录音」），改用 `ACTION_OPEN_DOCUMENT` + `EXTRA_INITIAL_URI`。
  初始目录按情况选：`下载/fast本地app` 里已有文件就直接打开它（作品都放那儿，用户不用再翻），
  否则退回「下载」—— 那个目录只有写过至少一个文件之后才存在，直接指过去会导航失败。

### 关于「联网」

编辑器**不需要账号、可完全离线使用**；但应用声明了联网权限，因为：
- 导出的作品里可以用「云表格」积木（连接 SeaTable）和联网类积木；
- 编辑器里创建/测试云表格时也会联网。

也就是说：**不上网也能正常做 App 和导出**，只有用到云表格功能时才需要网络。

---

## 二、签名材料（重要）

本工程有**两把互不相干的钥匙**，各自的作用域完全不同：

### 1. 编辑器签名钥匙 `keys/editor.p12`（只签编辑器本体）

- **只在你电脑上**，只被 `build.ps1` 用来给「编辑器 APK」本身签名；
- **永远不会被打包进任何 APK**（`build.ps1` 第 8 步有一条断言在守这件事）；
- 它仍然是机密：泄露出去别人能签出假的「FAST 编辑器更新」，所以别提交、别外传；
- 换它的代价：已经装了编辑器的人无法覆盖安装，必须先卸载。

> **密码不写在本文件里。** 请单独保管（记在密码管理器里）。
> 打包脚本支持用环境变量 `FAST_KS_PASS` / `FAST_KEY_PASS` 传入，见「四」。

### 2. 设备签名钥匙（签用户导出的作品）—— 不在这台电脑上

用户导出的作品，用的是**每台手机自己生成**的钥匙：

- 首次导出时由 `DeviceKey.java` 现场生成一对 RSA 2048 密钥，
  并用 `DerX509.java`（手写的最小 X.509 编码器）造一张配套自签证书；
- 存在应用私有目录 `<filesDir>/signing/`，其他应用读不到；
- **编辑器 APK 里不含任何私钥**，所以这个 APK 可以随意分发、传网盘、发群里。

> **为什么改成这样**：旧版本把一份「人人相同」的私钥（`assets/signkey.pk8`）
> 连同 APK 一起分发，而 APK 就是个 ZIP —— 拿到它的人两条命令就能把私钥抠出来，
> 进而以作者名义签出假的「官方更新」，装过你作品的人会被静默覆盖。
> 只要"离线导出"这个能力要求在设备上签名，私钥就必须在设备上，所以唯一
> 真正的解法就是"不再共用一把钥匙"。

> **代价（必须让用户知道）**：清除应用数据 / 卸载重装 / 换手机之后，这把钥匙会丢，
> 此前导出的作品将无法再被覆盖更新，必须先卸载旧版再装新的。
> 系统云备份也刻意排除了这个目录（见 `res/xml/backup_rules.xml`），
> 以免密钥离开设备。

> **关于 Android Keystore**：把设备密钥放进 TEE/StrongBox（硬件安全区）会更进一步，
> 但 apksig 是否接受 AndroidKeyStore 的密钥需要真机验证（它用默认 provider 初始化
> 签名器），且证书生成仍绕不开 `DerX509`。属于后续可选加固。

---

## 三、目录结构

```
fast_project/
├─ build.ps1                 Windows 一键构建
├─ build.sh                  Linux/macOS 一键构建（与 build.ps1 等价）
├─ AndroidManifest.xml       编辑器清单（方向由代码控制；FileProvider）
├─ shell/AndroidManifest.xml 运行时壳清单模板（竖屏用 portrait，横屏用 landscape）
├─ src/com/doubao/blockbuilder/
│  ├─ MainActivity.java      唯一 Activity：编辑器全屏沉浸+挖孔适配（作品保留浅色状态栏）、
│  │                          方向切换、WebView 文件选择、系统返回键交运行时、直装用一次性副本、编辑器/壳双形态
│  ├─ AxmlRewriter.java      二进制 AXML 字符串池重建（任意长度替换）
│  ├─ Exporter.java          导出：选壳/改写/图标/规范 ZIP/apksig 签名
│  ├─ DeviceKey.java         设备签名密钥：首次导出时现场生成，存应用私有目录
│  ├─ DerX509.java           手写的最小 X.509 自签证书生成器（纯 Java，零依赖）
│  └─ SimpleFileProvider.java content:// FileProvider（调起安装器，不依赖 AndroidX）
├─ assets/www/               前端：editor.* / runtime.* / blocks.js / blockly/
├─ shell_assets/project.json 壳占位资产
├─ res/mipmap-*/             编辑器与壳共用的默认图标
├─ res/xml/backup_rules.xml  系统云备份排除规则（把设备密钥排除在外）
├─ keys/editor.p12           编辑器签名钥匙（机密，.gitignore 已排除，不进 APK）
├─ pc-sim/                   PC 上等价验证导出流程（不随 APK 发布）
├─ test/old/                 开发期一次性调试脚本（归档保留，需要 Node 才能跑）
├─ VERSION                   版本号（见「五」）
├─ .gitignore / .gitattributes
└─ BUILD.md                  本文件
```

---

## 四、构建依赖与工具链

需要的工具：

1. **JDK 17**（必须含 `javac`，不能只有 JRE）。
2. **Android build-tools 34.0.0**：`aapt2 / d8 / zipalign / apksigner / lib/apksigner.jar / lib/d8.jar`。
3. **Android platform android-35**：`android.jar`。

工具链位置**优先读环境变量，没设就回退到本机默认路径**：

| 环境变量 | 含义 | 缺省回退 |
|---|---|---|
| `JAVA_HOME` | JDK 根目录 | `D:\android-build\jdk` |
| `ANDROID_SDK_ROOT`（或 `ANDROID_HOME`） | Android SDK 根目录 | `D:\android-build\sdk` |

签名密码同样可用环境变量提供（不设则用脚本内默认值）：

| 环境变量 | 含义 |
|---|---|
| `FAST_KS_PASS` | 签名库密码 |
| `FAST_KEY_PASS` | 私钥密码 |

产物输出目录：

| 环境变量 | 含义 | 缺省值 |
|---|---|---|
| `FAST_OUT_DIR` | APK 输出目录 | `D:\DSH工作\fastapk` |

脚本会在启动时检查上述工具是否齐全，缺哪个直接报错并提示用哪个变量覆盖。

---

## 五、一键构建

### Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
```

### Linux / macOS

```bash
cd fast_project && bash build.sh
```

### 版本号规则

`VERSION` 文件是两行：

```
第 1 行 = versionCode，每次打包自动 +1   → 保证新包能覆盖安装旧包
第 2 行 = 上一次的 versionName，打包时把最后一段 +1
```

实际效果（连续打包）：

| 第几次 | versionCode | versionName |
|---|---|---|
| 第 1 次 | 117 | 1.0.116.1 |
| 第 2 次 | 118 | 1.0.116.2 |
| 第 3 次 | 119 | 1.0.116.3 |

想换基准（比如进入 1.0.117 这一轮）：把第 2 行改成 `1.0.117.0`，下次打包即为 `1.0.117.1`。

### 产物

```
<FAST_OUT_DIR>\FAST_v<versionName>.apk
例：D:\DSH工作\fastapk\FAST_v1.0.116.2.apk
```

流程：aapt2 编译图标 → javac → d8（含 apksig）→ 分别构建竖/横壳
（未签名，导出时重签）→ 构建编辑器并 zipalign + apksigner 签名 → 自检。

---

## 六、约束（踩过的坑，勿回退）

- d8 不能加 `--no-desugaring`（apksig 含 Java8 invokedynamic，minApi24 需脱糖）。
- `resources.arsc` 必须 STORED 且 4 字节对齐；壳必须带真实 res（空资源表 packageCount=0 在部分 ROM 判损坏）。
- 导出 ZIP 不使用数据描述符（bit3=0），本地头写全 CRC/压缩后大小/原始大小。
- Blockly 10 的 `blockly.min.js` 是全量 bundle，不要再叠加 blocks/javascript 压缩包。
- 编辑器清单不要锁死方向（fullSensor），由 `setRequestedOrientation` 控制：编辑器横屏、预览跟随作品。
- **给 aapt2 / zipalign 传的路径里不能有中文**：脚本已改为传相对路径（`$STAGE_REL`）。改脚本时不要退回绝对路径。
- **javac / d8 的 `@清单文件` 不能写带中文的绝对路径**：那两个清单用 `-Encoding ASCII` 写出，
  中文会变成 `?` 导致"无效文件名"。脚本已改为写相对路径 + 正斜杠。
- **含中文的 `.ps1` 必须存成 UTF-8 带 BOM**：本机只有 Windows PowerShell 5.1，
  无 BOM 时它按 GBK 读，中文字面量会变乱码写进 `editor.js`。
  **注意**：不少编辑器/工具（含 AI 助手的改写工具）保存时会丢掉 BOM，
  改完 `build.ps1` / `pc-sim\run-export-test.ps1` 后务必确认前 3 字节是
  `EF BB BF`，否则脚本会以 "Unexpected token" 之类的语法错误直接挂掉。
- **编辑器 APK 内不得出现任何密钥材料**：导出的作品由设备端自己生成的密钥签名
  （`DeviceKey.java` + `DerX509.java`），编辑器 APK 里从此不含秘密、可以随意分发。
  `build.ps1` 第 8 步有一条断言在守这个性质（扫描 APK 条目名里的
  `signkey`/`signcert`/`.pk8`/`.p12`/`.pem`），**不要为了让构建通过而删掉它**。
- **`editor.html` 改完要数一遍 `<div>` 平衡**：应为 0（最低点也是 0），并且
  「松手删除」只应出现 **1** 次。真机上踩过一次：把 AI 悬浮球/面板从 `#viewBlocks`
  挪到编辑器外壳时（`d916624`），`#delZone` 的 `<svg>` + `<span>松手删除</span>`
  在原处留下了一份孤儿标记，于是屏幕底部多出一条横着的白条，还把画布底部那条的
  点击/拖动吃掉了 —— 用户描述为"多了些不可描述的屏障"。
  `pc-sim\cdp-test.mjs` 里有用例守着（孤儿标记 + 屏幕底部中间必须属于 `#blocklyDiv`）。
- **`.ai-body` 不要再加 `max-height`**：积木预览已经搬到面板的"页二"，
  聊天区再限高只会留出一大块空白（用户看到的"一个白色块占大半"），
  还会把「打开积木画布」按钮顶到看不见的地方。那个按钮也**必须放在 `.ai-body` 外面**，
  否则聊天记录一长就被顶走。
- **布局页的舞台必须等于"设计画布"，再等比缩放到可用区里居中**（`fitStage`）。
  曾经写成"舞台直接铺满外层可用区、不缩放"，后果很致命：设计画布 390 宽、舞台却是整块屏幕，
  组件按设计像素摆上去只占左上角一块，**拖动布局里看到的样子和运行时/导出完全不是一回事**
  （用户："布局这里有致命问题"）。改回去会再次破坏所见即所得。
- **布局页顶栏的两个按钮不要删**：`#layBack`（返回编辑器）和 `#layPageBtn`（页面切换）。
  它们曾经在 `editor.html` 里整段丢失（JS 里还在找 `#layPageBtn`、CSS 也在），
  结果布局页顶栏空着 —— 进得去出不来、也换不了页面，只能靠系统返回键。
  `pc-sim\cdp-test.mjs` 里有用例守着（舞台尺寸=设计尺寸、返回键可见可用、页面按钮在）。
- **运行时的 `fitScreen` 也必须按"设计画布"缩放**（`runtime.js`）：`#screen` = `project.design`
  的尺寸，再按 `min(vw/dw, vh/dh)` 等比缩放居中。它曾经写成"直接铺满窗口、不缩放、用真实像素"，
  而组件坐标是**设计像素** —— 结果"布局页摆好、导出后位置大小全不对、按钮跑出屏幕"
  （真机反馈）。这和编辑器布局页 `fitStage` 是**同一条规矩**，两边必须一致；
  `pc-sim\cdp-test.mjs` 里有一条端到端用例守着（布局页量一遍、runtime.html 里再量一遍，逐项比对）。
- **不要给运行时再加整屏的启动遮罩**：`runtime.html` 里原来的 `#splash`（"启动中…"，
  `position:fixed;inset:0;z-index:9999`）已被用户要求删掉。点运行/打开 App 要**直接看到画面**。
  方向没转过来的那一小段空档，由 `runtime.js` 的 `aiOrientGate` 控制（方向到位或最多 1 秒后再渲染），
  这样不会再出现"先按竖屏排好版、再突然转横屏"的跳动。
- **AI 面板关闭时不要把面板宽高动画到球的圆形**：面板底色是白的，缩到最后就是一个"白球"，
  再换成紫色悬浮球，看起来非常怪（用户反馈两次）。现在是面板**原地缩小+淡出**（永远矩形），
  紫色球在淡出后半段从原位置长出来。

---

## 七、版本与兼容

- minSdk 24（Android 7.0），targetSdk 30。
- 系统栏纯色（非 edge-to-edge），网页内容始终在系统栏安全区内，状态栏区域不显示内容。
- 作品方向由工程设置决定（默认竖屏），预览与导出一致；编辑器始终横屏。

> **关于升级 targetSdk**：暂时保持 30。升到 35 会触发 Android 15 的强制 edge-to-edge，
> 而本工程自己做了系统栏/挖孔适配，很可能出现界面错位——**必须先有真机验证再动**。
> 若哪天要上应用商店（商店会强制要求较高 targetSdk），提前留出调试时间。

---

## 八、版本管理与回退（git）

工程已建立 git 仓库（`.git`）。常用操作：

```bash
git log --oneline              # 看历史（每次改动一条）
git status                     # 看现在改了什么
git diff                       # 看具体改了哪几行
git checkout -- <文件>          # 把某个文件恢复成上次提交的样子
git stash                      # 暂时收起当前改动
```

- 基线提交：`f6f2749`（整理前的可用状态）。想整体回到基线：`git checkout f6f2749 -- .`
- **签名钥匙刻意没有纳入 git**（见 `.gitignore`）——请单独备份，否则换台电脑就构建不出签名包了。
- 打包中间产物 `stage/`、`out/` 也已排除，不会污染历史。
- **每次打包后 `VERSION` 都会变**（版本号自动 +1），所以 `git status` 会显示 `VERSION` 被修改，
  这是正常的：想记录就提交，不想记录就 `git checkout -- VERSION` 还原。
- 顺手一提：给 `.java` 文件增删行（哪怕只是注释）会改变编译后的调试行号表，
  所以 `classes.dex` 的体积会有几十字节浮动——**这不代表功能变了**。
  想确认功能是否变化，看 `git diff` 里的源码，而不是看 APK 体积。

---

## 九、PC 端自测（不用真机）

有两套可以在电脑上直接跑的自动测试。**改完代码先跑这两个**，能挡掉大部分低级错误。

### 1. 编辑器界面回归测试

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-ui-test.ps1
```

自动完成：起静态服务 → 起无头 Edge（独立配置目录，**不影响你正在用的浏览器**）→
模拟真人操作走完「建作品 → 设计页 → 加组件 → 积木页 → 放积木 → 返回首页 →
分享作品 → 导入作品 → 用坏文件试导入」→ 全程截图 → 自动清理。

其中分享/导入这一段是真走完整链路的：点分享按钮拿到 `.fast` 内容写成临时文件，
再用 CDP 把它塞进真实的 `<input type=file>`，和真人选文件完全同一条路径；
最后还会验证坏文件被拒绝且作品列表没被污染。

- **能测到**：网页部分的报错、界面是否正常、积木是否正常渲染（截图可肉眼确认外形）、
  分享产出的 `.fast` 结构是否合法、导入是否严格校验。
- **测不到**：一切和安卓系统有关的——安装、权限、系统栏/挖孔适配、读手机文件、原生接口
  （分享面板、读手机里的视频音频）。

### 2. 导出流程验证（在 PC 上跑真实导出代码）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-export-test.ps1
```

用**真实的** `Exporter.java` / `AxmlRewriter.java` / `DerX509.java`（不是仿写），拿 `stage\shell.apk` 当模板，
改写包名/应用名/版本号 → 重打规范 ZIP → **现场生成设备身份并签名**，产出两个成品 APK，
再用 aapt2 / zipalign / apksigner 逐项校验：应用名、版本号、入口 Activity、4 字节对齐、v2/v3 签名。

它同时断言两件事：

- 每个成品都能被官方 `apksigner` 验签通过 —— 证明手写的 `DerX509` 产出的证书是合规的；
- 两次构建的签名证书**不同** —— 证明"每台设备自己一把钥匙"这个性质真的成立。

- **前置**：先成功跑过一次 `build.ps1`（要用它顺带产出的壳 APK）。
- **注意**：全过程不再需要任何密钥文件；临时目录用完即删。

### 3. 仍然测不到的（还需要你在手机上确认）

- 真机 / 模拟器上的运行表现（本机没有安卓模拟器，也没装系统镜像）
- 导出后的 APK 在真实手机上的安装与运行
- 手机专属行为：状态栏、挖孔、触摸手势、返回键、媒体选择、调用安装器

- **AI 面板里往外拖积木的三条硬要求**（`wireAiPreviewDrag`）：
  1. **必须按在积木上**才起拖（`aiPreviewBlockAt` 命中判断），按空白处不接管；
  2. 命中的是**影子块**（输入框里那个默认小积木）时要**上溯到真实父块** ——
     影子块不能作为顶层插出去，否则主画布直接报 "Shadow block cannot be a top-level block"；
  3. 拖的是**那一块 + 沿 next 往下的那一串**（`aiChainXml`），不是预览里的全部积木。
  命中判断只能用 `[data-id]`：readOnly 工作区里 Blockly 会**摘掉 `.blocklyDraggable` 类**，
  用那个类名永远匹配不到。
- **AI 一次给多组积木时必须竖排摆开**（`aiStackBlocks`）：以前插入只按序号错开 8 像素，
  多组积木会几乎完全重叠（用户反馈）。预览区和插入到画布都走同一个竖排函数。
- **AI 面板里的预览画布是 `readOnly` 的**，`Blockly.Xml.workspaceToDom` 会给积木写上
  `movable/editable/deletable="false"`。这些 XML 灌进主画布后积木是"冻住"的：
  拖不动、手指按上去等于按空白，整个画布跟着跑（用户反馈的原话）。
  插入前必须 `aiUnfreezeXml` 清一遍，**载入作品时也要清**（治好已经存脏的老作品）。