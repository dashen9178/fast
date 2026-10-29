# FAST 工程交接说明（给下一个会话的我自己）

> 用途：新开会话时，先读这个文件，就能接着干活，\*\*不需要\*\*翻之前那条超长对话。
> 读法建议：让助手先读本文件，再看需要改的具体代码。

## 1\. 这是什么、在哪儿

* 安卓可视化编程编辑器 FAST（WebView + Blockly 10 UMD，`fastzelos` 渲染器），用户是非技术人员，**所有回复用中文、说人话**。
* **当前工程**：`D:\\DSH工作\\Fast\\fast\_project\_v2`（唯一要改的目录）
* **旧工程备份**：`D:\\DSH工作\\Fast\\fast\_project`（**不要动**）
* 关键文件：`assets\\www\\editor.js`（单闭包，1.1 万行上下，账号页/社区都在这里）、`editor.html`、`editor.css`、`blocks.js`、`runtime.js/.html/.css`；原生：`src\\com\\doubao\\blockbuilder\\MainActivity.java`；导出链：`Exporter.java`、`AxmlRewriter.java`、`DerX509.java`、`DeviceKey.java`。

## 2\. 常用命令（都在工程目录下跑）

* **⚠️ 2026-09-26 事故：`pc-sim\\cdp-test.mjs` 被我写坏了。**
我用 PowerShell 的 `Get-Content -Raw` + `Set-Content -Encoding utf8` 就地改这个文件 ——
PS 5.1 读**无 BOM** 的 UTF-8 文件时按 **ANSI(936/GBK)** 解码，再按 UTF-8 写回，
于是**全文中文变乱码**。而且这不是简单可逆的：中文 UTF-8 是 3 字节、GBK 是 2 字节，
对不齐；遇到「中文后紧跟 ASCII」时 GBK 解码器会把那个 ASCII 字节当非法尾字节**吃掉**，
表现为 `'` 变 `?`、`(` 消失 → 语法错误。全文约几百处。

  * 已回退成 **git HEAD 的干净版本**（`pc-sim\\cdp-test.mjs`，377770 字节，语法 OK，跑出来 **153 通过 / 1 失败**）。
坏的那份留档 `pc-sim\\cdp-test.mjs.damaged`；研究/修复脚本 `pc-sim\\recover\*.mjs|ps1`、`patch-lines.mjs`、`autofix.mjs`、`check.mjs`、`dump-head.mjs`。
  * **本会话新增的那批用例（社区/发布/发码/原生桥并发）在 HEAD 版里没有，需要重写。**
其中「中转打包规则」已经用更靠谱的方式补上了：`pc-sim\\unit-pack.mjs`（见下）。
  * **规矩：改 `pc-sim\\\*.mjs`、`assets\\www\\\*.js` 一律用文件编辑工具；绝不用 PowerShell 的
`Get-Content`/`Set-Content`/`Out-File` 就地读写带中文的文件。**
推论：`git show HEAD:<path> | Out-File` 同样会写成乱码 —— 用 `pc-sim\\dump-head.mjs` 导出。
* **中转打包规则单测**：`node pc-sim\\unit-pack.mjs assets\\www\\editor.js`（13 项，直接抽出
`editor.js` 里的 `打包中转请求()` 跑真代码，不经浏览器）。
为什么必须有它：浏览器回归的假网络装在 `authHttp` 那层，**比 `editorCloudHttp` 的打包更早**，
永远看不到打包做了什么 —— 打包写错时所有用例照样全绿，而线上发码直接挂。这个盲区就是这么来的。
* 全回归：`powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\\run-ui-test.ps1`

  * 结果看 `%TEMP%\\fast-ui-test\\test-output.txt` 的「通过/失败」计数；判断以「结果：全部通过 ✓」为准（脚本退出码 1 有时只是 javac 弃用提示）。
  * **最近一次（2026-10-27）：154 通过 / 0 失败，全绿。**

    * 原遗留失败项「导入成功后有提示弹窗」已查明并修好：分享早改成先弹选择面板（社区/社交平台/本地），
用例却只点卡片分享钮就等 `\_\_lastSharePayload`，永远等不到 → 补了一步点「分享到社交平台」（cdp-test.mjs）。
  * **⚠️ 2026-10-27 新踩的坑（ps1 的 BOM）**：`pc-sim\\\*.ps1` 一旦**丢了 UTF-8 BOM**，PowerShell 5.1 会按
GBK 读中文注释 → 整行错位 → 脚本报 `Unexpected token '}'` 直接跑不起来（run-ui-test.ps1 就这样挂过）。
已给所有含中文的 ps1 补回 BOM。**改/存这些 ps1 时务必保留 BOM**；排查时先看文件头 3 字节是不是 `EF BB BF`。
* 打 APK：`powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1` → 产物 `D:\\DSH工作\\fastapk\\FAST\_v<版本>.apk`（版本号自动 +1）

  * C 盘紧张会让构建失败：`%TEMP%` 下我自己的 `edge-probe\*`、`edge-dbg-\*`、`\*.dmp` 可以直接删（实测腾出 \~2 GB）。
`tuanjiehub-\*`、`itwochug`、`FabLibrary`、`DefaultCompany` 是用户别的软件的，**别动**。
* 导出链路自测：`powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\\run-export-test.ps1`（用真代码跑导出，验签名/对齐/清单）
* **线上中转函数自测**（三个，都应 0 失败）：

  * `node pc-sim\\verify-v5-live.mjs`（22 项，按客户端真实请求形状打真表）
  * `node pc-sim\\verify-v7-live.mjs`（10 项，**真实 HTTP 方法** PUT/DELETE 打真表）
  * `node pc-sim\\verify-v9-live.mjs`（7 项，密码列已摘 + 发码全局限流真的拦得住）
* **全代码机械扫描**：`node pc-sim\\audit.mjs`。只报"能确定是问题"的几类，不猜：
重复 id、JS 引用了不存在的 id（**已自动跳过注释**，否则注释里提到的 id 会假阳性）、
同名函数重复声明、动态执行代码位置、innerHTML 拼变量、硬编码凭据、JSON.parse 有没有 try。
改完大改动后顺手跑一次。**注意：它用相对路径，必须在工程根目录跑，否则读不到文件全是假绿。**
* **🔴 2026-10-27「检查更新 / 社区都取不到数据」的根因 = 阿里云欠费停机，不是代码 bug。**
实测：中转函数任何请求都回 `403 {"Code":"AccessDenied","Message":"Current user is in debt."}`，
而 SeaTable 本身鉴权正常（200）。账号/社区/更新全走这一个函数，所以三处一起挂。
**解决办法只有一个：给阿里云账号（15768018901）充值**，函数自动恢复，无需改代码、无需重新部署。
已顺手做的：`editorCloudHttp.interpret` 现在认得阿里云 `{Code,Message}` 错误，欠费时给用户显示
「云服务欠费停机，请联系开发者」而不是一句看不懂的「请求失败 HTTP 403」。
排查口诀：先 `node pc-sim\\probe-update.mjs` 打中转看状态码，403+in debt 就是欠费。
* **深色模式自测**：`powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\\run-dark.ps1`
→ `pc-sim\\verify-dark.mjs`：切深色后读**画布实际填充色**，断言不是白的。
（判定取色时一定把值取成**字符串** —— 之前返回对象，判了个 `\[object Object]`，等于没判，踩过。）
* **代码栏（分类栏）取证**：`powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\\run-shot.ps1`
→ `pc-sim\\shot-rail.mjs`：只拍分类栏并放大 4 倍，同时把选中项的计算样式打出来；
第 5 步专门走"点空白取消"那条路。**肉眼判断颜色不可靠，看它输出的 rgb。**
另外：**别用 CDP 注入鼠标事件去点画布**验这个，会触发 Blockly 其它交互把脚本卡死（踩过）。
* **账号页作品顺序自测**：`powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\\run-verify.ps1`
→ `pc-sim\\verify-mine.mjs`（假网络造 3 件分享，断言最新在最上）。
* 发文件给用户（**优先用 `share-file-to-phone` 技能**）：

  1. 起服务：`powershell -NoProfile -ExecutionPolicy Bypass -File "D:\\DSH-Data\\skills\\share-file-to-phone\\scripts\\share.ps1" -Path "<文件>"`（它会起 8899 静态服务并自动校验下载）
  2. **要稳定域名就再挂 cloudflared**：`\& D:\\DSH工作\\tools\\cloudflared.exe tunnel --url http://127.0.0.1:8899 --no-autoupdate`
（cloudflared 域名在进程存活期间不变；localhost.run 约 20 分钟掉线且换域名 —— **发 APK 别只给后者**）
  3. **发链接前必须完整下载比对**：`Invoke-WebRequest -OutFile` + `Get-FileHash … SHA256`，和本地一致才发。
局域网地址、未校验的链接都不要发（用户明确要求过）。
  4. 停："停掉所有后台任务" = 杀 cloudflared + `share.ps1 -Stop` + 无头 Edge（**别杀 DSH Desktop 主程序，那是界面本身**）
* 临时文件坑：`assets\\www` 下的 `\*.bak\_before\_fix`、`\*.syntaxchunk.js`、`\_syntaxcheck.js` 会被**打进 APK**（白胖 25 万字节），开工/收工都要清一遍。
* JS 语法自检：`node --check assets\\www\\editor.js`（便携 Node：`D:\\DSH工作\\tools\\node\\node-v22.14.0-win-x64\\node.exe`；机器上的 `node` 不一定在 PATH 里）

## 3\. 硬规矩（每次都要守）1. **改完必须自己跑一遍全回归，必须全绿**；再打 APK，并**完整下载比对 sha256**（公网 + 局域网两个链接都验）才发给用户。

2. **APK 直链发，不要套压缩包**（用户明确要求）。
3. **绝不往「Fast」那张 SeaTable 表（更新 / 工程）写任何东西**（放 APK/工程包）；社区/账号两张表允许写，但**测试数据用完必须删干净**。
4. 不碰 `keys\\`（签名密钥）、不改 `Exporter.java` / `DerX509.java` / `build.ps1` 的签名逻辑。
5. 文案用「代码」不用「积木」；**不加无意义提示**；界面中文。
6. 不变量：布局页 = 运行时 = 导出 三处坐标一致；AI 只改当前页面；API Key 只存本机。
7. 上下文省着用：日志只打尾部/条数；**大活儿交给空手 subagent**（它上下文小、更省），我这边只做验收 + 构建 + 交付。

## 4\. SeaTable 事实（都是真表实测出来的）

* 基础表 UUID：`712bc4e0-a7b0-48ff-b5ea-098ce7eb3252`；API Token：`66303f1bc…`（**完整值只存在函数环境变量
`SEATABLE\_TOKEN` 和 SeaTable 控制台里，本仓库是公开的，别再写全文**）；服务器 `https://cloud.seatable.cn`。
取令牌：`GET /api/v2.1/dtable/app-access-token/`（头 `Authorization: Token <token>`）→ 拿 `dtable\_server`（`/api-gateway/`）+ `access\_token`，后续用 `Bearer`。
* 表「账号」列：`用户邮箱`、`账号名`、`头像`(image)、`作品iD`(**小写 i 大写 D**)、`作品`(file)

  * 注意：账号表里还有一列 `用户密码`（老方案的加盐哈希），**代码里已经一次都不引用**。
中转 v8 起在出站处统一摘掉它（`\_strip\_secret\_cols`）。别再把它加回返回里。
* 表「社区」列：`用户名`、`作品`(file)、`作品图`(image)、`是否开源`(single-select)、`作品名`、`作品iD`、`用户邮箱`
* 读行**必须带 `\&convert\_keys=true`**，否则只回列 key（`row\['用户邮箱']` 会是 undefined → 登录会反复新建行、社区永远空）。
* 写行（新增）：`POST .../rows/`，body `{table\_name, rows:\[{列名:值}]}`（**必须用中文列名**，用 key 会插入 0 行）。
* 改行（唯一正确形状）：`PUT .../rows/`，body `{table\_name, updates:\[{ row\_id, row:{列名:值} }]}`。

  * 用 `rows` → 400 `missing updates field`；行号写 `\_id` → 400 `invalid row\_id field`；**值和 row\_id 平级 → 200 但一个字都不改**。
* 文件/图片列：写官方完整路径 `/workspace/<workspace\_id>/asset/<uuid>/{images|files}/2026-09/<文件名>`；`作品`(file) 必须写对象数组 `\[{name,size,type,url}]`，字符串数组会被丢空。
* **取文件/图片只认相对路径**（`files/2026-09/x.fast`），带 `/workspace/…`、`/asset/…` 前缀一律 "path not found"；显示图片改走 `app-download-link/?path=相对路径` 拿可访问地址。
* 上传：`GET /api/v2.1/dtable/app-upload-link/` → `POST {upload\_link}`（multipart，`parent\_dir`/`relative\_path`/`file`），返回只有 `{id,name,size}`，**url 要自己拼**。
* 阿里云 FC（邮箱验证码）：`MAIL\_BASE='https://fast-mail-code-uzzxqcntro.cn-hangzhou.fcapp.run'`、
`MAIL\_APP\_TOKEN='ed50ad9e…'`（**完整值在 `editor.js` 的 `MAIL\_APP\_TOKEN` 常量与函数环境变量里，
它是随 APK 分发的口令、不是账号密钥，但也别再往文档里写全**），`mailSend/mailVerify` 已在 `editor.js`。

## 5\. 产品口径（用户确认过的，别再猜）

* **登录**：邮箱 + 6 位验证码；**没有注册按钮**——表里没有这个邮箱就自动建档登录。登录态用表里的邮箱写法（大小写不会变两个账号）。
* **账号页**：点账号按钮（已登录）进独立页面：左侧窄列表「个人信息 / 社区」。

  * 个人信息：头像（上传，>100KB 先压）、账号名（可改，**重名不给改，大小写不同不算重复**）、用户邮箱（可改：**先给新邮箱发验证码**，作品不迁移）；下面「我分享到社区的作品」。
  * **退出登录要有二次确认**。
* **通知栏**：进软件 / 点运行都**先检查权限**，**只有在没有权限时**才弹（弹**系统**授权框）；系统框弹过还不行为才给「去设置」弹窗（按钮直达系统通知设置页）。有权限什么都不弹。
* **运行**：结束方式只有通知栏卡片（《作品名》正在运行中 + 终止运行）；**去掉 App 自己那套边缘侧滑退出运行**，但**不拦触摸**（作品里的滑屏照常）、**不禁系统返回手势/返回键**。

  * 从**编辑器**运行 → 结束回编辑器；从**社区**运行 → 结束回社区那一栏。
* **社区**：未登录也能浏览/运行；**只有登录才能发布**。卡片**两列**、**小卡**（左小图标 + 右详情）、最新在上、进社区**自动刷新**、底部加载更多。

  * `运行`：直接跑（运行前提示「如何结束运行？下滑通知栏点终止按钮即可」，带**不再提示**，独立 localStorage key）。
  * `保存本地`：**先弹二选一**——「保存到手机」/「在编辑器生成一个副本」（**不加说明小字**）。**未开源时置灰**；`运行` 不受开源限制。
  * **开源** = 别人能下载 `.fast`；不开源只能运行。
* **分享按钮**（作品卡片右上角）→ 弹窗：三个大框**横排一行**（分享到社区 / 分享到社交平台 / 保存在本地）+ **关闭按钮在右下角**，**弹窗不出现滚动条**。

  * 分享到社区 → 弹窗：**只允许用户自己上传图标**（没有"默认图标"那套；没上传不给发布）、作品名称、是否开源 → 发布。
  * 发布后卡片上分享按钮**左边出现「管理」**：改图标/名字/开源 + 「更新」（**覆盖社区同一条**）+ 「删除分享」（删社区那行 + 从账号行移除 + 本地作品保留 + 管理按钮隐藏）。
  * **作品iD**：首次发布生成，存在作品数据里，改名不变；**账号表一个账号永远只有一行**（多个作品只改这一行，绝不新增行）。
  * **作品图标和账号头像必须完全独立**；分享到社区时选的图标也用于导出作品。
  * **复制/导入别人的作品时，必须清掉带过来的 作品iD**（否则副本会冒「管理」按钮，还会覆盖原作者那一条）。
* **「分享到社交平台」**= 微信/QQ 系统分享面板（**不要**再弹「文件同时存到了…」那种提示；它内部必然往"下载/fast本地app"放一份副本，这是微信读不到私有目录导致的，改不掉）。
* **「保存在本地」**：只写一次文件、只提示一次（原生 `saveProject`，不弹分享面板）。

## 6\. 进行中 / 待办

* **✅ 2026-09-26 已解决：云中转函数部署上去了，账号/社区读写在真表上端到端全绿。**

  * 部署方式（终于走通，记下来别再折腾）：
`npm i -g @serverless-devs/s`（用便携 Node：`D:\\DSH工作\\tools\\node\\node-v22.14.0-win-x64`）
→ `s config add --AccessKeyID … --AccessKeySecret … -a fcdeploy -f`
→ 用 `s cli fc3 sync --region cn-hangzhou --function-name fast-mail-code --target-dir ./clone -a fcdeploy`
把**线上真实配置**拉成 s.yaml（省得手写漏配置 / 弄丢环境变量）
→ 工程在 `fc-deploy\\fast-mail-deploy\\`（`s.yaml` 的 `code:` 指向 `./code`，`code/index.py` 是待部署的代码）
→ `s deploy -a fcdeploy -y`。

    * **注意**：`s.yaml` 里的 `triggers:` 段要**删掉**，否则每次部署最后一步必报
`TriggerName is required but not provided`；删掉后不碰线上触发器，报错消失（代码其实已经更新成功，但别留这种噪音）。
    * 部署完先看 `https://fast-mail-code-uzzxqcntro.cn-hangzhou.fcapp.run/healthz` 的 `func\_version` 确认版本落地。
    * 手工签名 Aliyun OpenAPI 走不通（FC 2.0 只认 REST 路径签名，RPC 签名回 InvalidVersion；穷举 10 种 STS 格式均 400）。
**别再去手搓签名**，直接用 serverless-devs。
  * 函数版本演进：v4 = 只有读；v5 = 支持写行/上传 + `p/q` 解码；v6 = 修掉 convert\_keys 丢失；
**v7 = 补上 `do\_PUT` / `do\_DELETE` / `do\_PATCH`（当前线上）**。
  * **v7 修的真 bug（用户截图「发布到社区 请求失败 HTTP 501」的根因）**：
函数里只有 `do\_GET` / `do\_POST`，而 Python 的 `BaseHTTPRequestHandler` 对**没有 `do\_XXX` 的方法
直接回 `501 Unsupported method`，根本进不到我们的代码**（所以函数 `/echo` 的最近请求里
连一条写行都没有 —— 这就是定位线索）。
而 App 的 `editorCloudHttp` 是**用真实 HTTP 方法**发的（只把业务体打包进 `b`）：
新增行 POST ✅、**改行 PUT ❌ 501**、**删行/删除分享 DELETE ❌ 501**。
「发布到社区」新增社区那一行会成功，紧接着同步「账号」行的 PUT 就 501
—— 用户看到的就是那句「请求失败 HTTP 501」。
**自测为什么漏了**：v5 那次我是用「POST /api + body 里 `m=PUT`」验的，那条路当然通。
**教训：自测必须照客户端真实的 HTTP 方法发。** 已补 `pc-sim\\verify-v7-live.mjs`（10 项，真 PUT/DELETE 打真表）。
  * 线上实测脚本：`node pc-sim\\verify-v7-live.mjs`（真实 HTTP 方法）/ `node pc-sim\\verify-v5-live.mjs`（打包形状 22 项）
/ `node pc-sim\\unit-pack.mjs assets\\www\\editor.js`（打包规则 13 项）。三个都应为 0 失败。
  * **v6 修的真 bug（「社区卡片全是未命名/作者匿名」的根因，之前一直没找对）**：
客户端把「整条路径 + 查询串」放进 `p`（`/api?p=/api/v2/dtables/…/rows/?table\_name=社区\&limit=1000\&convert\_keys=true`），
而函数那边用 `parse\_qs` 解外层查询串 —— 里面的第一个 `\&` 被当成参数分隔符，`p` 被**截断**成 `…?table\_name=社区`，
`limit` / `convert\_keys` 全丢。SeaTable 于是按列 key 返回（`0000` / `020Y` 四位乱码），
`editor.js` 里 `row\['作品名']`、`row\['用户名']` 全是 undefined → 卡片一律「未命名 / 作者：匿名」。
对照实测：直达路径 `/api/v2/dtables/…` 正常、走 `/api?p=…` 就丢参数 —— 差别只在这里。
修法：新增 `\_raw\_p()`，`p` 按「`p=` 之后到结尾」命令式取（末尾的 `u=`/`t=` 切掉），不再过 `parse\_qs`。
**客户端故意不改成编码形式**：两端同时改会变成双重解码，只改函数最稳，而且**已装在手机上的旧版 App 不用重装就好了**。
  * 线上端到端实测脚本：`pc-sim\\verify-v5-live.mjs`（**22/22 通过，2026-09-26**）。
完全按 `editor.js` 的真实请求形状发，覆盖：换令牌 → 读「社区」（校验回的是**中文列名**）→ 读「账号」
→ 取上传地址 → 二进制 multipart 上传（`b` 走 latin-1 打包）→ 写行 → 读回校验 → 改行 → 删行 → 附件下载（`?t=` 口令）。

    * **踩坑记录**：写行/改行/删行的 `b` 必须是**对象**（`editorCloudHttp` 第 519 行打包的就是对象）；
传成**字符串**会走 latin-1 二进制通道，中文被 `encode("latin-1","ignore")` 丢掉
→ `{"error\_message":"table\_id or table\_name invalid"}`。测的时候别写错形状。
    * 实测完的临时行会在脚本里**自己删干净**（社区表跑完仍是原行数）。
* **2026-09-26 用户报的三件事（已改完并验证）**：

  1. **账号页「我分享到社区的作品」最新在最上** —— 原来按账号表「作品iD」的追加顺序画（=最老在上）。
排序放在 `画我的分享()` 里（不是数据源头）：正常路径和「读失败用本地缓存顶上」那条路都过它，
连旧缓存也会被排对。口径和社区列表一致（`timeOfRow` 倒序，兜底 `sidTime`）。
验证脚本：`pc-sim\\verify-mine.mjs`（造 3 件分享，断言渲染顺序 = 最新/中/最老）。
  2. **代码栏选中态不像 M3（我自己上一轮删错的）** —— 加滑块时我把三条 `.bb-cat.on` 样式整块替换掉了，
只剩一个底色：文字不变深不加粗、图标方块不变实心。已按 HEAD 原样补回：
`.bb-cat.on{background}` / `.bb-cat.on .bb-cat-lb{color;font-weight:700}` / `.bb-cat.on .bb-cat-ico{实心}`。
**别再把这三条删掉**（当时删了能过回归，因为老用例不查颜色）。
  3. **代码栏取消选中"还有一层，然后消失"** —— 滑块原来是把 `width` 缩到 0（从右往左收，看着像残留一层）。
改成**淡出**：保留几何、只把 `opacity` 归零。CSS/JS 都加了 opacity 过渡。
* **主题色「容器色」偏灰的根因（用户报"选中底色不符合 M3 风格"）**：
`tone()` 走 HSL，而 HSL 的饱和度在**浅色端撑不起 M3 需要的色度** ——
`tone(H,S,90)` 算出来是灰紫 `#E3E1EA`，M3 基线 `secondary-container` 是 `#E8DEF8`。
整个软件的"选中底色/浅色药丸"都受影响。
改法（`applyTheme` 里）：容器色（`-c` 那一族）**不再用 `tone()` 算**，
改成「拿 M3 官方基线色当模板，只按种子色相旋转」（`换色()`）：默认种子出来就是标准 M3 配色，
换别的主题色只是整片色相平移。**只改了容器族**，`--primary`/`--tertiary`/surface 维持原算法，
免得动了按钮和整页底色。
* **顺手发现（未修，测试脚本的事）**：`pc-sim\\cdp-test.mjs` 的用例「导入成功后有提示弹窗」
是**过期断言** —— `editor.html` 里根本没有导入弹窗节点（导入现在是 snackbar），这条永远红。
它是 HEAD 版用例里唯一的失败项（153 通过 / 1 失败），与本轮改动无关。
* **分类栏/账号页的取证脚本（以后调 UI 颜色直接用它）**：

  * `pc-sim\\shot-rail.mjs` + `run-shot.ps1`：新建 App → 进代码页 → 选中/取消选中分类，
**只拍分类栏并放大 4 倍**，同时把选中项的计算样式（标签色/字重、图标底色、滑块位置与透明度）打出来。
判断"颜色对不对"别靠肉眼猜，看它输出的 rgb 值。
  * `pc-sim\\verify-mine.mjs` + `run-verify.ps1`：账号页作品顺序验证（假网络，不碰真表）。
  * 三个 runner 都是由 `run-ui-test.ps1` 换脚本名生成的，改端口/截图目录照旧。
* **最近已交付：`1.0.116.110`**（`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.110.apk`，1813849 字节，
sha256 `1FAFBD111C93AEF3247036F6720775190F28587D5039D5194FA742BCCC723317`）。
备退：106 / 107 / 108 / 109。各版 build 自检「不含任何 SeaTable 凭据」都通过。
**⚠️ 判断"APK 里到底有没有装进去改动"不能只看字节数** —— 106\~110 五版**总字节数完全一样**，
但用 .NET `ZipFile` 抽出 `assets/www/editor.js` 比 sha256，是和源码一致的（字节数撞车纯属压缩巧合）。
以后打完包想确认，就跑这条：抽 `assets/www/editor.js` + `editor.css` 和源码比 sha256。
* **选中滑块的三种运动（1.0.116.110 定稿，别再混）**：

|情形|行为|
|-|-|
|之前**没有落点**（刚进来 / 刚取消过 / 位置不可知）|**原地淡入**，绝不许滑|
|之前**已经有落点**（从 A 换到 B）|**滑过去**|
|一个都没选（取消）|**立刻消失**|

  * 用户 2026-09-26 报的"未选中时点击会凭空划过来"就是第 1 种被当成了第 2 种：
当时用 `!中 || \_\_脏` 判"直接出现"，但**取消了之后再点**时 `!中` 不成立、`\_\_脏` 也是 false，
于是它从上次那条的位置一路划过来 —— 现在用一个闭包变量 `上次在某一条上`（取消时置 false）来判。
  * **配套改动（不能漏）**：`clearRailActive(保留)` 支持"保留某一条"，分类按钮的 click 里改成
**先给新的加 `.on`、再 `clearRailActive(b)` 清旧的**。原来是先清（那一瞬间"一个都没选中"，
滑块收到隐藏信号）再加新的 → 即使有落点也会退化成"凭空滑过来"。
  * 取证：`shot-rail.mjs` 第 8 步 —— 在**点击的同一个 tick** 里量滑块位置来判别是"淡入"还是"滑动"：
没落点时它必须已经在目标条目上；换分类时它必须还在旧条目上。
  * **踩坑**：`run-ui-test.ps1` 系列脚本已加"端口被占用就直接退出"的守卫。端口被上一轮残留的
无头 Edge 占着时，新一轮 Edge 会自己换随机端口，而脚本照旧连 9222 →
连到上一轮那个快死的页面，报满屏 `Blockly is not defined`，看起来像"改动把编辑器搞崩了"（实测被骗过一轮）。
见到这种情况先 `Get-Process msedge | Stop-Process -Force` 再跑。
* **1.0.116.108 相对 106 的两处补修（用户拿真机截图报的，106 还没完全修好）**：

  1. **点空白取消后灰底不消失** —— 取消选中其实有**两条**路径：①点分类自己（按钮 click 里会叫
`同步分段药丸()`）②点空白/拖出去，Blockly 自己关浮层（走 `document` 上的 pointerup 监听，
**它只调 `clearRailActive()`**）。第 ② 条以前不通知滑块 → 灰底一直留着。
修法：把 `同步分段药丸()` 放进 `clearRailActive()` 里 —— 「谁清高亮谁负责通知」，以后加新路径也不会漏。
  2. **取消的瞬间还能看到一层灰** —— 106 改成 140ms 淡出，用户第二次截图说"取消瞬间还是有一层"。
结论：**取消选中就该是瞬时的**。现在 `!中` 时临时关掉过渡再写 `opacity:0`（并强制回流），
不留任何过渡帧。（选中仍然是滑过去 + 淡入，那个观感是对的。）
  * 取证：`pc-sim\\shot-rail.mjs` 第 5 步专门走「点空白取消」那条路（调 Blockly 的 `clearSelection()`

    * 派发 `pointerup`），断言 `选中数=0` 且 `滑块 opacity=0`。
**注意别用 CDP 注入鼠标事件去点画布** —— 会触发 Blockly 其它交互把脚本卡死（踩过，整轮超时）。
* **选中滑块"跑偏"的全部情况（2026-09-26 用户报"把分类栏拉到下面就看不到选中提示了"，我把 9 种情况列全后逐个核过）**：

|情况|结果|
|-|-|
|**滚动容器滚动后**（分类栏 / 账号页窄列表都会滚）|❌→✅ **真因**：偏移没算滚动量|
|拖动重排分类之后|❌→✅ 重排完没通知滑块|
|横竖屏切换 / 窗口尺寸变化（含软键盘收起）|❌→✅ 没通知滑块|
|容器隐藏时选中（回首页 / 切页 / 切组）|✅ 早有"位置脏了"机制|
|积木栏重建（切回代码页）|✅ 早有脱离文档清理 + 重建|
|点空白取消 / 再点一次取消|✅ 上一轮已修（`clearRailActive` 里同步）|
|首帧容器还没量到宽高|✅ 早有脏标记|
|两组面板（常规 / 控件）切换|✅ 各自有滑块 + 显示时同步|
|滚动过程中要不要实时跟|✅ 不用：算进滚动量后滑块在**内容坐标**里固定，天然跟条目一起滚|

  * **根因写法**（改之前）：`上 = b.top - a.top`。绝对定位子元素的包含块是容器的 **padding box**，
而滚动容器的 padding box **跟着内容滚**，所以这两个 rect 相减得到的是"距可视区顶"的距离 ——
滚动之后比真实内容偏移小了一个 `scrollTop`，滑块整体上移，滚动越多偏得越多，
而条目还在屏幕上 → 用户看到的就是"选中提示不见了"。
**正确写法**：`上 = b.top - a.top + 容器.scrollTop`（左右同理 `scrollLeft`）。
  * 按下态（`:active` 那层灰）也一起改了：`.bb-cat` 和 `.acct-item` 都不再用 CSS `:active`，
改由 JS 在 `pointerdown` 加 `.按住`、`pointerup`/`pointercancel` 清掉 ——
安卓 WebView 会把 `:active` "粘住"，那就是用户先前报的"取消后还留一层灰"（取色 `#EAE9EE` = `--c-high`，
和滑块 `--secondary-c` = `#E7DDF8` 不是一个东西，别再去滑块那边找）。
  * 取证：`shot-rail.mjs` 第 7/7b 步 —— **先把视口改矮逼出真正的溢出**（不改矮的话 1280x720 放得下 13 个分类、
`scrollTop` 永远 0，用例会"空跑"，第一次就是这么假过的），再断言三种滚动位置下
`滑块与选中条的位置差 = 0`、以及"滚到底再点分类"时滑块仍在可见区内。
* **本轮第二处真 bug（我自己引入的）：发码请求被中转打包，登录发码整条链全挂。**
`MAIL\_BASE === CLOUD\_BASE`（发码接口和云中转是同一个阿里云函数），打包判定写的是
`url.indexOf(CLOUD\_BASE) === 0` —— 于是打函数**根路径**的发码请求也被包成
`{p:'',m:'POST',q:'',b:{action:'send'}}`，函数在顶层找不到 `action` → 一律回「未知 action（send / verify）」。
线上真函数实测过两种形状：原样 `{action:'verify'}` → 400「邮箱格式不正确」（认得 action）；
包一层 → 400「未知 action（send / verify）」。
修法：判定改成 `CLOUD\_BASE + '/api'`（真正的中转请求是 `/api?p=…` 和 `/api/download?…`），
并把打包抽成纯函数 `打包中转请求()`、暴露 `EditorApp.\_\_packProxy` 供单测。
防回归：`pc-sim\\unit-pack.mjs`（13 项全过）。
* **本轮加的动画：积木栏分类栏的选中滑块**（`.bb-cat-pill`）。两个滑块函数合并成一份
`建滑块(容器, 按钮们, 类名)`，顺手把积木栏缺的「容器隐藏后位置变脏 → 下次显示先归位」修正补上，
并清掉脱离文档的旧药丸（切回代码页会重搭积木栏）。只动 `transform/宽高`，不碰画布。
* **本轮修的真 bug（用户报「总是获取不到社区作品和我分享的作品」的根因）**：
App 内所有 HTTP 都走原生桥 `Native.httpRequest` → 回调 `window.\_\_nativeHttpResolve`。
原来的写法是**每个请求临时换掉这个全局回调槽、收到自己的结果再换回去**。
两个请求同时在飞时（进账号页就会：读「账号」表 + 读「我分享的作品」+ 读「社区」表），
先结束的那个会把槽**恢复成它进函数前的样子** → 另一个请求的结果再也没人认领，
界面永远停在「正在加载…」，直到 15/40 秒超时变成一句网络错误。
**改法**：`editor.js` 里装一个**常驻分发器 + 请求号表**（`var 原生待回 = {}`，约 363 行），
`editorCloudHttp` 与上传的 `uploadRawPost` 一并修，谁的结果回给谁。
同时把 `MainActivity.java` 的 `httpReadTimeout` 20s → 60s：原来 JS 侧统一 40s、原生 20s 先掐断，重试窗口根本用不上。
**验证方式（重要，别再走弯路）**：真表数据 + 无头 Edge + **模拟原生桥的假 Native** 跑真实代码路径。
PC 回归加了两条用例（`原生桥回调：多个请求一起飞…`、`两个附件一起传…`），
注意：`cdp-test.mjs` 的假网络走 `\_\_authSetHttp`、**绕开 Native 分支**，所以老用例永远抓不到这个 bug，
这两条新用例必须把假网络拆掉、装一个假 `window.Native` 才测得到。
* 用户能看到的旧 bug 记法：**"社区/我分享的作品一直在转圈，然后报网络错误"** → 先看 `原生待回` 那套是不是被改回单槽写法了。
* 上一轮（`1.0.116.93`）已完成：

  1. 副本/导入不再继承原作者的 `作品iD` → 副本**不显示「管理」**，也不会误覆盖原作者那一条；
  2. 「管理」显示条件改为**与社区表核对**（`用户邮箱==我 \&\& 作品iD==该作品`）；未登录/核对不出来不显示；
  3. 「我分享到社区的作品」：空清单→空状态；有清单→**一次**读社区表；超时 40s + **自动重试一次**；失败→本地缓存 `\_\_bb\_mine\_v1` 顶上 + 「重试」按钮；幽灵 ID **自愈清掉**（连带 `作品` 列）；
  4. 社区作品「运行/保存到手机/生成副本」：下载拆两步、各自放宽超时 + 重试，失败提示带**步名**；单卡失败不连累列表；
  5. **头像破图**：写入前校验附件路径（不写脏值）、显示走 `app-download-link` 并预加载确认，任何一步失败退回首字母占位；
  6. 顺带修：`idList` 分隔符不一致（写入用逗号、读取只认 `\\x01`）导致多件作品时误删有效记录；emoji 首字被截半。
* **仍待用户拍板**：

  1. 「管理」需要在线核对社区表 → **离线时管不了自己的分享**（要不要退化成"本地记过的已发布 iD 也算"，用本地缓存判断）；
  2. 账号页进「个人信息」会读 3 次表（账号×2 + 社区×1），可合并缓存省一次（未做，怕影响用例时序）。
* 交付流程（每次）：复跑回归 → 构建 → 完整下载校验 → 直链发给用户。
* 未做的未来规划：扫码、云后端发布闭环/排行榜/存档积木、多段修复+多页面生成、文件读写/正则/数组对象/定时任务、多文件工程、协作、导出体积优化、教学体系。（详见 `ROADMAP.md`。）
* 已废弃：早期"要不要通知卡片"的自制确认弹窗（`#runTipMask` 的 HTML 还在，但已不再打开）。

## 6.5 2026-10-27 这一轮（APK 1.0.116.114，回归 156/156）

* **用户报「检查更新/社区取不到数据」的真因不是代码，是阿里云函数「免费试用到期」**。
函数对任何请求都回 `403 {"Code":"AccessDenied","Message":"Current user is in debt."}`；
SeaTable 本身正常。用户充 1 元后立刻恢复（网关欠费/试用到期这一层不需要重新部署）。
⚠️ **遗留隐患**：该函数 `scalingConfig.minInstances = 1`（常驻实例），按量计费约 **55 元/月**，
1 元余额约 13 小时烧完 → 会再次停机。**待用户在控制台把「最小实例数」改成 0**（冷启动 1–3 秒，
客户端读表超时是 40 秒，够用）。这就是"每月固定开销"的唯一来源，单次请求成本约 0.000006 元。
* **检查更新改版（用户要求）**：不再列出版本列表（表里混着已删除的测试版，会误导用户装旧包）。
打开只显示**最后一行**（云表 1A 2B 3C 递增，最后一行即最新），点「下载并安装」只装这一个。
提示文案三态：有新版本 / 已是最新 / **云端比本地还旧**（明确说"开发者还没上传新包"，防止用户降级）。
纯函数 `取最新版本()`、`校验更新提示()`，暴露 `EditorApp.\_\_updatePick` / `\_\_updateHint` 供单测。
* **社区刷新按钮**：从社区列表头部挪到账号页**顶栏右上角**（退出登录右边），顶栏不参与滚动，
怎么滚都在；默认 `hidden`，`showAcctPane('comm')` 才显示。以后加顶栏控件都走这个开关，别再放进滚动区。
* **中转加固（index.py → `FUNC\_VERSION = v15`，⚠️ 尚未部署）**：
① 按来源 IP 滑动窗口限流（读 600/分、写 120/分，`RELAY\_PER\_MIN` / `RELAY\_WRITE\_PER\_MIN` 可调）。
阈值故意宽松：国内移动网大量用户共享出口 IP（CGNAT），设小会误杀。
② 社区表 POST/PUT 必须带「用户邮箱」，且该邮箱在「账号」表里注册过；查不到时**强制刷新一次缓存**
（刚注册就发布的场景），读不到账号表则**放行**（加固不能把正常发布搞挂）。
规则背景：`X-App-Token` 写死在 APK 里，等于对拿到包的人公开，以前读写接口完全不设防。
**部署方式**：`powershell -File pc-sim\\deploy-func.ps1`（需要 `s` 口令）或 `ALI\_AK/ALI\_SK` 跑
`node pc-sim\\fc-deploy-sdk.mjs`；本机两者都没有，所以这一轮**只改了代码，线上还是 v14**。
不部署也不影响客户端（限流/校验都在服务端）。
* **`editor.js` 拆分：评估后推迟**（用户提的"拆成 account.js/community.js/ai.js"实际不可行）。
13031 行**全在一个 IIFE 闭包**里（文件头自己写着"内部变量都是私有的，所以不能拆成多个文件"），
按功能拆需要把成千上万处内部引用改名，风险远大于收益；而且 `pc-sim\\audit.mjs`、
`pc-sim\\unit-pack.mjs` 都按路径**直接读 `assets/www/editor.js`**，拆了就一起坏。
两条可行路线（留给以后单独做）：

  1. **构建期拼接**：源码分片放 `assets/www/js/\*.js`，`build.ps1` / 测试脚本先拼接生成 `editor.js`。
语义零风险（拼接结果与原文逐字节一致可验证），代价是"改完忘了拼接就测旧代码"。
  2. **命名空间重构**：真正模块化，工期大、回归成本高，需要单独一轮。
现阶段替代做法：保持单文件，但新增功能按目录索引的位置就近放、注释写清入口函数名。

## 6.6 2026-10-27 第二轮（APK 1.0.116.116，回归 156/156 + 改名专项 1/1）

* **用户报「账号改名后，后台（SeaTable）是新的，App 里还是原名」的真因**：
`drawCommunity()` 的「内容指纹」只算了 作品iD / 作品名 / 条数，**作者名不在指纹里**。
改名时这三样一个都没变 → 判定「内容没变」直接 `return`，新读回来的行根本没画，
**点「刷新」也一样**（刷新会重读表，但重画还是被指纹挡掉）；只有重启 App 才会好。
→ 这解释了为什么"后台正确、App 一直不对"，也是上一轮只做服务端同步（`同步社区作者名`）却没修好的原因。
* 修法（`editor.js`）：

  1. 指纹改成 `作品iD + 作品名 + 用户名 + 时间`（用 `\\u0002/\\u0001` 分隔，避免和名字里的字符打架）；
  2. `同步社区作者名` 写成功后，顺手把 `commState.rows` 里自己的行改成新名字并 `drawCommunity()`，
社区栏正开着时当场就变，不用等下次进页面。
* **专项用例**：`pc-sim\\verify-comm-rename.mjs`（`run-ui-test.ps1 -Script verify-comm-rename.mjs`）。
走真人流程：进社区 → 后台换作者名 → 点刷新 → 断言卡片变成新名字。
**已反向验证**：把指纹退回旧写法时它是 FAIL（卡片停在原名），修好后 OK —— 以后别再把这个字段从指纹里拿掉。
* 交付：`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.116.apk`（1817945 字节，
sha256 `2C34DCBE73DDA8A8EDEAA24B1B317E7430F9A662CA49942021A5E887244E5A43`），
已部署到 FC（`/healthz` = v15）并实测下载哈希一致；「更新」表新增第 8 行
`1.0.116.116（26.10.27.23:38）` + APK 附件（下载链接 200、1817945 字节）。
* 上传附件踩坑（更正以前的记法）：`app-upload-link/` 返回的 `parent\_path`（`/asset/<uuid>`）才该当
`parent\_dir`，`relative\_path` 用返回的 `file\_relative\_path`；填 `/files/2026-10` 会报
`Parent dir doesn't exist`，填 `/` 会报 `Parent dir doesn't match`。

## 6.7 2026-10-27 第三轮（GitHub 仓库清理：明文凭据 + 历史重写）

* 远端 `dashen9178/Fast` 是 **public**。上一轮只清了 `fast\_project\_v2`，**漏了根下的旧版 `fast\_project/`**：
它的 `assets/www/editor.js` 里明文写着两个 SeaTable 全权 Token（账号/社区 + 更新表）。
* 本轮处理：

  1. 旧版 `fast\_project/assets/www/editor.js` 的两个 Token → `REDACTED-BY-OWNER`；
  2. `fast\_project\_v2` 的 `aliyun-fc-mail/README-部署说明.md`、`pc-sim/deploy-func.ps1`、
`pc-sim/verify-v5/v7/v9-live.mjs` 里的 App 下载口令 → 改为读 `FAST\_APP\_TOKEN` 环境变量；
  3. 历史压平为**单个无父提交**并强推 main（`14de9852`），旧提交不再挂在任何 ref 上。
* ⚠️ **force push 不等于删除**：GitHub 仍保留不可达对象，按 SHA 直查 API 仍返回明文
（已实测 `07223608` / `0fe4d18c` 均 200 且含 token）。彻底根治只有三条路：
转 private、删库重建（需 `delete\_repo` 授权）、或联系 GitHub Support 清除。
* 目前仓库里唯一剩下的口令是 `fast\_project\_v2/assets/www/editor.js` 的 `MAIL\_APP\_TOKEN`：
它是 APK 内置的下载口令（与 APK 一同公开分发），不是数据密钥；若要源码零口令，
可改成打包时由 `build.ps1` 从环境变量注入（同 `\_\_BUILD\_\_` 的做法）。
* **实际处置（用户决定：改名 + 锁门 + 另开公开库）**：

  * 旧库 `dashen9178/Fast` → 改名 **`dashen9178/fastbeifen`** 并转 **private**（旧历史仍在那里面，只有本人可访问）；
  * 新建公开库 **`dashen9178/fast`**：只放 `fast\_project\_v2` 的 235 个文件（平铺到根，无 `fast\_project\_v2/` 这层），
单提交 `1a522cf8`，历史里没有旧令牌；
  * GitHub 仓库名大小写不敏感 → `github.com/dashen9178/Fast` 现在直接解析到新公开库，旧链接不会失效；
  * 新库扫描结果：0 个 SeaTable Token / 0 个 SMTP 授权码，仅 `assets/www/editor.js` 的 `MAIL\_APP\_TOKEN`（APK 内置下载口令）。
  * ⚠️ 以后同步公开库用 `C:\\...\\Temp\\gh-split.mjs` 的同款思路（Git Data API），**不要再把 v1 旧工程带进去**。

## 6.8 2026-10-28 第四轮（APK 1.0.116.117：社区开源状态不刷新）

* 用户报：发布时选了开源，之后改成不开源再更新，「云列表」里已经是“否”，但社区卡片还挂着“开源”。
* 根因：`drawCommunity()` 的“内容指纹”只比 `作品iD/作品名/用户名/时间`，**没比「是否开源」和「封面图」**
→ 判定“内容没变”直接 return，新读回来的行根本没重画（只有重启 App 才会变）。
* 修复：指纹改为 作品iD + 作品名 + 作者 + 是否开源 + 封面图 + 时间（+ 条数），见 `assets/www/editor.js` `drawCommunity()`。
* 回归：新增 `pc-sim/verify-comm-open.mjs`（开源→不开源，断言标签 2→0、保存本地按钮禁用 0→2）；
反向拿旧指纹跑会 FAIL（证明用例真能抓住这个 bug）；全量 156/156 通过。
* 交付：`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.117.apk`（1817945 字节，
sha256 `047856F149701422AAE34E64C446EE429D2A29F23047990CA4748D6C5D0F3EF1`），FC `/healthz` = v15，
`/dl/…` 与 App 实际走的 `/api/download?path=files/2026-10/…\&u=<更新库uuid>` 两条链路都实测 200 且哈希一致。
* 「更新」表第 9 行 `1.0.116.117（26.10.28.01:04）` 的 `程序` 附件已补上（`/workspace/600134/asset/<uuid>/files/2026-10/FAST\_v1.0.116.117.apk`）。
* **教训**：

  1. 改行必须用 `updates:\[{ row\_id, row:{列名:值} }]`（第 4 节早写了）；我这次先试 `\_id`、再试把列名平铺在 updates 项上，
两种都回 `200 {"success":true}` 但**值根本没写进去** —— PUT 成功 ≠ 写成功，**必须读回核对**。
  2. 同一张表上存在**两个** API 令牌：只读的那个走写接口一律 403 `You don't have permission…`，
别把它当成“权限被改/服务端故障”。用户给的 `5ada09e1…` 才是可读写的那枚。
* 同步：公开库 `dashen9178/fast` 提交 `10bd5a8d`（`editor.js` + 新用例 + `VERSION`）。
* 「工程」子表（列：`名称` / `文件` / `备份`）同一轮补齐：

  * 117 行 → `文件` = `FAST-full-1.0.116.117.zip`（21,257,126B，1026 条目，
排除了 `fast-cloud/node\_modules`、`fast-cloud/.wrangler`、`stage`、`out`、`keys`——`keys` 里是签名私钥，绝不能进附件）、
`备份` = `FAST\_v1.0.116.117.apk`；
  * 116 行 → 只补了 `备份`（APK），`文件` 仍为空：116 发版时没打工程包，没有快照。
  * 两条下载链路都用 `/api/download?path=files/2026-10/…\&u=<更新库uuid>` 验过 200。

## 6.9 2026-10-28 第五轮（APK 1.0.116.119：选图后可裁剪）

* 用户需求：「图片选择器增加裁剪功能，选择图片后可以裁剪」；
第二轮补充定调：「裁剪只允许正方形，固定大小的正方形，只能放大缩小图片调整选择范围」。
* 实现（`assets/www/editor.js`）：`pickImage()` 读到图后不再直接缩，而是 `openCropper(img, cb)`；
新增 `openCropper()` —— 动态建 `#cropMask` 弹窗（标题 + 黑底舞台 + **固定正方形方块** + 取消/完成）。

  * 方块边长 = `round(min(舞台宽, 高) \* 0.82)`，**固定不变**；没有可拉角，改不了形状/大小；
  * 调整方式只有两种：拖动图片平移（`偏`）、双指捏合或滚轮缩放（`倍`，范围 `最小倍 \~ 6×最小倍`）；
`最小倍 = max(方/原图宽, 方/原图高)`，保证任何时候图片都盖满方块（不会露黑边）；
  * 坐标全按**布局像素**算，确认时按 `方 / 倍` 反推原图边长，天然是正方形；
出口仍压到 ≤256 的 PNG（工程体积口径不变）；
  * 框外半透明黑用 `box-shadow: 0 0 0 9999px rgba(0,0,0,.55)` 铺（不用四块遮罩，不会露缝）；
  * 「取消」不回调，调用方什么都不改。
  * 三处入口自动都生效（图片控件属性面板 / 头像 / 应用图标）——它们本来就都走 `pickImage`。
* 样式（`assets/www/editor.css`）：`.crop-stage img` 改绝对定位（宽高由 JS 写），新增 `.crop-sq`
（固定方块，`pointer-events:none`），删掉上一版的 `.crop-h` 四角手柄。
* 专项用例 `pc-sim/verify-crop.mjs`：真人路径（导出弹窗 → 给 `#iconFile` 塞 400×200 图 → change）→
断言弹窗出现、无角手柄、方块宽=高且等于 `min(舞台)\*0.82`、拖图时方块纹丝不动而图片动了、
滚轮放大后图片显示变大且裁出来的预览更小（200 → 102）、预览一律正方形且 ≤256、取消不改图。
* **踩坑（写用例时）**：首页按钮是 `#btnNewApp`（不是 `#btnNew`）、确认建是 `#createGo`（不是 `#createOk`）、
名字输入是 `#newAppName`、编辑器视图是 `#viewEditor`（`#editorPage` 这个 id 不存在）。
* **踩坑（量尺寸时）**：弹窗有 `pop` 进场动画，动画期间 `getBoundingClientRect()` 拿到的是**被 transform 缩过**的尺寸，
用它算方块边长会永久偏小（398 vs 407）——量舞台一律用 `clientWidth/clientHeight`。
* **踩坑（跑脚本时）**：PowerShell 里 `\& 'xxx.exe' script.mjs` 这种 GUI 子系统程序**不会等待、输出也丢**，
必须加 `| Out-String`（或 `\*>\&1 | Tee-Object`），否则会看到"退出码 0、什么都没发生"。
* 回归：全量 `pc-sim\\run-ui-test.ps1` **156/156 通过**；裁剪专项 `-Script verify-crop.mjs` 通过。
* 交付：`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.119.apk`（1822041 字节，
sha256 `41B314A13FD5B44C8D3CF1335FD2DB9BA319294E475636F5B1CDEBEF72BDE5F2`）。
* 「更新」表第 11 行 `1.0.116.119（26.10.28.07:49）`（row `OQ6coqMYT7eouV1l4sEYvg`）+ `程序` 附件；
「工程」表新增 `1.0.116.119`（row `cPZRYgIYR4GPIbDxCdzQBw`）：
`文件` = `FAST-full-1.0.116.119.zip`（21,268,703B，1027 条目），`备份` = 119 APK。
附件下载（`/api/download?path=files/2026-10/…\&u=<更新库uuid>`）实测 200，APK 哈希与本地一致。
（第 10 行 `1.0.116.118` 是"可拖方框"那版，已被用户否掉，留作记录。）
* 同步：公开库 `dashen9178/fast` 提交 `2ca273a4`（第一版）→ `af55bdd7`（改成固定正方形这版）。

## 6.10 2026-10-28 第六轮（APK 1.0.116.120：包名改为 com.fast.app）

* 起因：`OPPO上架整改清单.md` 的 P0-1 —— 包名 `com.doubao.blockbuilder` 含字节跳动品牌词，商店必驳回。
用户决定**这一轮只改包名**，其余 P0/P1 项（应用名、隐私弹窗、安装收敛、targetSdk 等）暂不动。
* 主包：`com.doubao.blockbuilder` → **`com.fast.app`**

  * `src/com/doubao/blockbuilder/` 整体移到 `src/com/fast/app/`（6 个 java 的 `package` 行同步）；
  * `AndroidManifest.xml`：`package`、`activity android:name`、`provider android:name`、`authorities`（→ `com.fast.app.fileprovider`）；
  * `SimpleFileProvider.AUTHORITY` 常量与清单保持一致。
* 导出链也一并去掉品牌词（作品壳模板原本是 `com.doubao.rt.a00000`）：

  * `shell/AndroidManifest.xml` 包名 → `com.fast.app.rt.a00000`，activity 名 → `com.fast.app.MainActivity`；
  * `Exporter.OLD\_PACKAGE` 必须与 shell 模板**一字不差**（AxmlRewriter 靠它做二进制替换基准），
同步改成 `com.fast.app.rt.a00000`，`newPackage` 前缀改为 `com.fast.app.rt.`；
  * `pc-sim/com/doubao/blockbuilder/` 两个模拟类随源码移到 `pc-sim/com/fast/app/`，包名与 `npkg` 同步；
  * `run-export-test.ps1`、`diag-export.ps1` 的源路径与主类名、`adb-smoke.ps1` 的默认 `-Pkg` 同步。
* 验证：

  * `build.ps1` 出 `FAST\_v1.0.116.120.apk`（1822041 字节）；`aapt2 dump badging` 显示
`package: name='com.fast.app' versionCode='236' versionName='1.0.116.120'`；
  * `pc-sim\\run-export-test.ps1` 全绿：两个作品包名分别为 `com.fast.app.rt.ih8ohd` / `com.fast.app.rt.je8t4k`，
说明替换基准没写错（写错的话 AxmlRewriter 会替换不动，成品还是旧包名）；
  * 全量回归 `pc-sim\\run-ui-test.ps1` **156/156 通过**。
* **必须知道的两件事**：

  1. 包名变了 = 全新应用，旧版 `com.doubao.blockbuilder` 不会被覆盖，会装成第二个 App；
旧版 localStorage 里的作品在新包里读不到（Android 按包名隔离数据），老用户只能先导出作品再重装。
  2. OPPO 后台要按新包名 `com.fast.app` 建档，软著名称仍须与 `android:label`（当前还是 `𝑭𝑨𝑺𝑻`）一致 ——
P0-2 改名还没做。
* 交付：`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.120.apk`（1822041 字节，
sha256 `2BCCF920F54AEB47C76E661AF2F9303CEBFF63A1600B3E770BEDF1150E66FA85`）。

  * 「更新」表第 12 行 `1.0.116.120（26.10.28.11:17）`（row `ckNCiQzQQrSy\_fMfkiWkAQ`）+ `程序` 附件；
  * 「工程」表第 12 行 `1.0.116.120`（row `NHh8FSdeQOOwzT3AafXhww`）：`文件` = `FAST-full-1.0.116.120.zip`
（21,276,184B，1028 条目），`备份` = 120 APK；
  * App 实际走的 `/api/download?path=files/2026-10/FAST\_v1.0.116.120.apk\&u=<更新库uuid>` 实测 200，
下载哈希与本地一致。
* 公开库 `dashen9178/fast` 提交 `076be3ea`（含删除旧路径 `src/com/doubao/` 与 `pc-sim/com/doubao/`）。
* **遗留（只影响网页 `/dl/` 短链，不影响 App 内更新）**：`/dl/FAST\_v1.0.116.120.apk` 仍返回 117 的包
（1817945B / `047856F1…`）。`s deploy` 这次又卡死（node 进程 CPU 满载 5 分钟、零输出，与 119 那轮同一症状），
已 kill；`pc-sim/fc-deploy-sdk.mjs` 需要明文 AK/SK，而 `\~/.s/access.yaml` 里存的是 64 字符密文，
取不出明文，所以 SDK 通道也不通。**下次要么在 FC 控制台手动上传 `code/`（index.py + fast.apk），
要么先修好 `s`。**
* **2026-10-28 用户决定：目前没有任何外部用户，公网 `/dl/` 短链与公开库同步都不用再弄**，
日后不要再为这条花时间；App 内更新走 SeaTable 附件（`/api/download`）即可。

## 6.11 2026-10-28 阶段 0：控件注册表收敛（APK 1.0.116.121，回归 156/156）

**为什么做**：同一个控件的信息原本散在 5 个地方（`TYPE\_META` / `COMPONENT\_DEFAULTS` / `naturalSize` /
`defaultSize` / runtime `defaultBox`），已经跑偏过两次 —— audio 编辑器 44、运行时 40；
container/table/chart 在运行时缺项，兜底成 220×40。以后每加一个控件都要改 5 处，必然再错。

**做了什么**（对应 `新增代码块与控件规划.md` 阶段 0）：

* 新增 [comp-spec.js](file:///d:/DSH工作/Fast/fast_project_v2/assets/www/comp-spec.js)：26 个控件的
`label/ico/desc`、`size`（兜底尺寸）、`nat`（新增时的紧凑尺寸，`mode:'text'` 时按文字实测宽）、`def`（默认属性）。
导出 `window.FAST\_COMPONENTS` 与 `window.FAST\_COMP = {sizeOf, defaultsOf, naturalOf, types}`。
* `editor.js`：`TYPE\_META` 改为派生；`COMPONENT\_DEFAULTS` 改为从 `def` 压平（保留 `input2: {}` 兼容旧数据）；
`naturalSize` 改为读 `nat`（switch/checkbox/button/text 的字号·内边距·最小宽都在表里）；
`defaultSize` → `FAST\_COMP.sizeOf(c.type)`。
* `runtime.js`：`defaultBox` → `FAST\_COMP.sizeOf(c.type)`。**从此设计页与运行时不可能再对不上。**
* `editor.html`、`runtime.html`：`comp-spec.js` 必须先于 `blocks.js` / `runtime.js` 加载。
* `build.ps1` 第 77 行：导出壳复制清单加上 `comp-spec.js`（**这条最容易漏**，漏了导出作品运行时白屏）。
* `blankProject()` 写入 `fmt: 2`（工程数据格式版本；本次不做旧数据迁移，用户已确认没有外部用户）。
* 新增单测 [unit-comp-spec.mjs](file:///d:/DSH工作/Fast/fast_project_v2/pc-sim/unit-comp-spec.mjs)（19 项）：
校验字段齐全/尺寸正整数/兜底行为、编辑器与运行时确实接了注册表、两个页面加载顺序、build.ps1 清单、
以及「每个 type 都要在 editor.js 与 runtime.js 里出现」—— 这条是给后面加控件用的，漏写渲染分支会立刻红。

**验证**：

* `node --check` 三个 js 通过；`node pc-sim/unit-comp-spec.mjs` **19/19**；
* 全量回归 `pc-sim\\run-ui-test.ps1` **156/156**，JS 报错 0；
* `pc-sim\\run-export-test.ps1` 全绿（`com.fast.app.rt.ih8ohd` / `com.fast.app.rt.je8t4k`）；
* 打包：`aapt2 dump badging` → `package: name='com.fast.app' versionCode='237' versionName='1.0.116.121'`；
`stage\\shell.apk` 的 `assets/www/` 里确认有 `comp-spec.js`。
* 交付：`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.121.apk`（1826206 字节，
sha256 `CAD4D225DEE2AA6F7F9C82DB213534D1EF51796853F6218B01AC4CA48AB11E19`）。
按用户要求**不发 SeaTable、不传公开库、不碰 `/dl/`**。

**下一步**：阶段 1 —— 块第一批 7 个（文字/运算/列表/JSON），每块一条用例。

## 6.12 2026-10-28 试运行体验修正（APK 1.0.116.122，回归 156/156）

用户反馈两件事，都在这一轮修掉：

1. **点运行先说明怎么结束 + 关掉侧滑返回**

   * `editor.js` 的 `onRun()` 改为先走 `运行前提示(mode)`：弹 M3 对话框「点击运行后，若要结束请下滑停止栏，
点击终止即可。」，下面带 **不再提示** 勾选（`localStorage.\_\_bb\_runTipNever\_v1 = '1'`，勾过以后不再弹）。
只有在**真机有通知卡片**（`Native.startRunNotice`）时才弹；电脑/浏览器里没有通知栏，弹了是干扰，
而且 UI 回归会因此多一步点击。
   * `runtime.js` 的 `window.\_\_rtSystemBack()`：预览时若通知卡片可用，**直接吃掉返回**（返回 true），
所以侧滑返回 / 返回键都不再关掉运行；结束只剩通知栏卡片的「终止运行」（`\_\_nativeStopRun`）。
电脑预览没有卡片，保留返回，避免退不出去。
2. **横屏运行不显示 / 要等好几秒**

   * 根因：方向口径在两处不一致。`loadProject` 请求的是 `startSc.orientation || 'portrait'`，
而方向门 `aiOrientGate` 比较的是 `project.orientation`。起始页方向是横屏、项目方向是竖屏时：
运行时会先把屏幕转回竖屏 → 门一直等不到 → 直到 2 秒兜底才画（期间 `#screen` 是空的）。
   * 修法：`loadProject` 先算 `startOrient = 起始页方向 || 项目方向 || portrait`，**请求方向与方向门都用它**；
门改成 `aiOrientGate(want, fn)`，兜底从 2000ms 收到 1200ms（`setTimeout` 也同步改 1200）；
没有 `Native.setOrientation`（电脑/浏览器）时**不进门**、直接画 —— 那种环境屏幕根本不会转，干等没意义。
   * 顺手把 `runtime.js` 顶部注释里"2 秒后兜底"一起改成 1.2 秒。

**验证**：`node --check` 两个 js 通过；`unit-comp-spec.mjs` 19/19；全量回归 **156/156**，JS 报错 0；
`aapt2 dump badging` → `package: name='com.fast.app' versionCode='238' versionName='1.0.116.122'`。
**本轮机器上没有连接安卓设备**（`adb devices` 为空），侧滑/通知栏/横屏这三项需要在真机上复验：
点运行看提示框 → 勾不再提示 → 再点运行不再弹 → 运行中左/右边缘侧滑不复位 → 下滑通知栏点终止能回编辑器；
另建一个横屏作品，点运行应当立刻是横屏画面（不再空白等待）。

交付：`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.122.apk`（1830302 字节）。

## 6.13 2026-10-28 阶段 1 修正：只补真正缺的 3 个数据代码（APK 1.0.116.124，回归 158/158）

规划文档里的块第一批最初做成了 16 个“一句话 + 空槽”的取值代码，当天被用户指出：
**其中 12 个跟 Blockly 自带分类重复**（转大小写/去空格/取子串/查找/替换、四舍五入/取整/绝对值、
排序/求和/随机取、随机整数本来就有），属于把已有功能换个说法又摆一遍，只会让工具箱变长、更难找。
按“方案 1”删掉那 12 个，只留 3 个真缺的：

|分类|保留的代码（type）|说明|
|-|-|-|
|数据列表|列表去重 `val\_list\_unique`|自带分类没有；保留第一次出现的顺序|
|数据列表|解析 JSON `val\_json\_parse`|JSON 文字 → 能取字段的数据；坏格式返回 null，不抛错|
|数据列表|生成 JSON `val\_json\_stringify`|数据 → JSON 文字|

* 三个块都走 `C\_VAL` 青色，排在「数据列表」分类最前面；帮助页对应 3 条带 `t` 的真积木条目。
* `runtime.js` 只留 `listUnique / jsonParse / jsonStringify` 三个 RT 方法，外加 `rtText / rtList` 两个兜底工具。
* 删干净了：`val\_str\_\*`、`val\_num\_\*`、`val\_list\_sort/sum/random` 及其 RT 方法、工具箱项、帮助条目
（全局 grep 只剩文档里的历史引用）。
* **教训（同时写进规划文档 2.4）**：加块前先翻一遍自带工具箱，按“能力”列清单，别按“分类名”列。

**验证**：

* `node --check` 通过；`node pc-sim/unit-comp-spec.mjs` **19/19**；
* 全量回归 `pc-sim\\run-ui-test.ps1` **158/158**（新增 2 条：列表去重、JSON 解析/生成），JS 报错 0；
工具箱代码块 **308 种**。
* `pc-sim\\run-export-test.ps1` 全绿（`com.fast.app.rt.ih8ohd` / `com.fast.app.rt.je8t4k`）。
* 打包：`aapt2 dump badging` → `package: name='com.fast.app' versionCode='240' versionName='1.0.116.124'`。
* 交付：`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.124.apk`（1834398 字节）。
* **已发布到「更新」库**（用户纠正：只不许碰 `/dl/`，SeaTable 更新库照常发）：
「更新」表第 13 行 `1.0.116.124（26.10.28.15:13）`，`程序` 附件 = `FAST\_v1.0.116.124.apk`（1834398 字节），
row\_id `SU\_G0imiSLmNDyqOZL\_yzA`，附件地址
`/workspace/600134/asset/5ded0202-…/files/2026-10/FAST\_v1.0.116.124.apk`；
App 实际走的 `/api/download?path=files/2026-10/FAST\_v1.0.116.124.apk\&u=<更新库uuid>` 实测 **200**、字节一致。
* **发布链路两个坑（都记进 6.8 那条教训旁边）**：

  1. `POST /api` 的中转只从 **JSON 体**取 `p`（`\_relay\_api`），把 `p` 放在 URL 上会 403 `path not allowed`；
写行必须照 App 的 `打包中转请求()` 发 `{p,m,q,b}`。
  2. 中转环境变量里的「更新」库令牌是**只读**的，写行回
`You don't have permission to perform this operation on this base.` —— 写行改用可读写令牌
`5ada09e1…` 直接打 SeaTable 网关；读/附件仍走中转。
  3. 文件列必须传**对象数组** `\[{name,size,type,url}]`，只传 `\[url]` 字符串会被静默忽略（行插进去但附件为空）。
  4. 每次跑生成的时间戳不同 → 满表找“同版本行”会漏；本次首跑插了一行空附件（`ME6JSCO1…`），已删除，表内只剩 1 行 124。
* 遗留：`files/2026-10/` 里有一份上传失败重试产生的 `FAST\_v1.0.116.124 (1).apk` 孤儿文件（没被任何行引用），不影响更新。

**下一步**：阶段 2 —— 控件第一批 4 个（标签页、折叠面板、评分、进度环）。
开工前先按 3.1 的 12 个触点核对，并**先确认这些控件是不是本来就有**（别重犯这次的错）。
真机复验项仍挂着 6.12 那三条（运行提示框/不再提示、侧滑不复位、横屏立即出画面）。

## 6.14 2026-10-28 阶段 2：控件第一批 4 个（APK 1.0.116.125，回归 159/159）

按规划文档第 5 节做第一批：**标签页 `tabs` / 折叠面板 `collapse` / 评分 `rating` / 进度环 `ring`**。
开工前先核对过：这四个**本来没有**（`FAST\_COMPONENTS` 26 种里确实没有），不是重复造轮子。

* 注册表 `comp-spec.js` 26 → **30 种**；`editor.html`「展示」组补 4 个添加按钮；设计页卡片说明走 `compDesc`。
* 运行时 `runtime.js`：4 个 `renderComp` 分支 + `.rt-\*` 样式；点页签/星星/折叠头都改 `wrap.\_\_val` 并触发 change 事件；
新增 `RT.setTabs / setRating / setCollapse`，`setProgress` 兼容圆环（改 `stroke-dashoffset` 与中间文字）；
`setComponent` 按 `r.className` 分流（`tabs / collapse / rating / ring`，都排在 `input` 分支之前）。
* 布局页 `layVisual`：4 个 `lv-\*` 分支。**坑**：布局页只搬 `layVisual` 返回根节点的子元素，
所以容器型控件（tabs/collapse/rating）的样式要另写 `.litem.t-xxx`；环的尺寸写死像素。
* 代码块 `blocks.js`：4 个专属分类（显/隐/透明度/旋转/启用/禁用；不放 change 变体，`change` 不在事件帽白名单），
头尾块用通用真事件帽 `ev\_change`；`act\_set\_progress` / `val\_get\_progress` 的过滤放宽到 `progress|ring`。
* **本轮唯一真 bug**：AI 建的控件属性会过 `aiCleanProp()`，`value` 不在数值白名单里 → 被 `String(v)` 成字符串；
布局页 `validN('30')` 判 false → 环显示 0%、评分初始 0 星，与运行时不一致。
修法：`ring` / `rating` 在**渲染侧**统一 `Number()` 归一化（`runtime.js` + `editor.js` 各一处）。

**验证**：

* `node pc-sim/unit-comp-spec.mjs` 19/19（含"控件类型数量为 30"）。
* 全量回归 `pc-sim\\run-ui-test.ps1` **159/159**、失败 0、JS 报错 0；新增用例
「新控件①：标签页/折叠面板/评分/进度环 三处渲染一致，运行时能交互」。
* `pc-sim\\run-export-test.ps1` 全绿（`com.fast.app.rt.ih8ohd` / `com.fast.app.rt.je8t4k`）。
* 打包：`package: name='com.fast.app' versionCode='241' versionName='1.0.116.125'`，入口 `com.fast.app.MainActivity`。
* 交付：`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.125.apk`（1,842,590 字节，
sha256 `6A50CF0879B23ED32BA47C2D3A7F258814794B489042A6BDB4415D7F5C1DF6DA`）。
* **已发布到「更新」库**：「更新」表第 14 行 `1.0.116.125（26.10.28.16:17）`，
row\_id `BU354uy8S1u4MdPRx9-rZw`，`程序` 附件 = `FAST\_v1.0.116.125.apk`；
`/api/download?path=files/2026-10/FAST\_v1.0.116.125.apk\&u=<更新库uuid>` 实测 **200**，
1,842,590 字节、sha256 与本地**完全一致**。
* **「工程」表同步**：新增 `1.0.116.125`（row `fi0lDRvyTaGNAp--jrgfiw`），
`文件` = `FAST-full-1.0.116.125.zip`（21,301,881B，1031 条目，排除 `node\_modules` / `.wrangler` / `stage` / `out` / `keys`），
`备份` = 125 APK；两条下载链路均实测 200、字节一致。
* 发布链路的坑再补两条：

  1. 附件下载接口**必须带 `X-App-Token`**，不带会回 401 `{"error":"未授权：X-App-Token 不正确"}`（46 字节），
别误判成"文件没传上去"。
  2. 同一 `parent\_dir` + `relative\_path` 再传同名文件时，SeaTable 会自动改名成 `xxx (1).apk`
（行里引用的是原文件，仍有效）；`files/2026-10/` 因此多一份 125 的 `(1)` 孤儿副本，不影响更新。
* 版本号已自增到 `242 / 1.0.116.125`（下次打包出 1.0.116.126）。

**下一步**：阶段 2 余下控件（规划文档 3.2 候选里挑），或先做真机复验 ——
6.12 那三条（运行提示框/不再提示、侧滑不复位、横屏立即出画面）+ 本轮 4 个控件在真机上的点击手感。

## 6.15 2026-10-28 阶段 3 第一批：控件第二批 3 个（APK 1.0.116.126，回归 160/160）

按规划文档阶段 3 做交互控件第一批：**多选下拉 `multiSelect` / 日期范围 `dateRange` / 颜色选择器 `colorPicker`**。
开工前核对过：这三个**本来没有**，不是重复造轮子（和 6.14 一样先查再动手）。

* 注册表 `comp-spec.js` 30 → **33 种**；单测断言同步改成 33；`editor.html`「输入与选择」组补 3 个添加按钮。
* 运行时 `runtime.js`：

  * `multiSelect`：自绘下拉（`.rt-select.rt-multi` + `.rt-multi-menu/.rt-multi-item/.rt-multi-box`），
`wrap.\_\_val` 存**字符串数组**；`多变数组()` 兼容 AI 传过来的数组或 `,，、\\n` 分隔串。点选项切换勾选并触发 change。
  * `dateRange`：两个 `input.rt-date` + `.rt-dr-sep`，各自记 `\_\_start` / `\_\_end`，`拼范围()` 回写 `\_\_val="开始\~结束"`。
  * `colorPicker`：`.rt-color` + `.rt-color-sw`（色块）+ `.rt-color-t`（色值文字）+ 12 色 `.rt-color-dot` 调色板；
点色块开合、点色点选色，都改 `\_\_val` 并触发 change。
  * 新增 `RT.setMultiSelect / setDateRange / setColorPicker`；`setComponent` 最前面插 3 个分支
（**必须排在 `select` / `date` 之前**，否则 `dateRange` 会被 `date` 分支截走）。
* 布局页 `editor.js`：`layVisual` 3 个分支 + `editor.css` 的 `lv-\*`；
**容器型控件**（多选/颜色）另写 `.litem.t-multiSelect / .t-colorPicker / .t-dateRange`。
属性面板补 3 段（多选 items + 默认选中多行；日期起止两列；颜色 `colorInput`）；
`AI\_COMP\_PROPS` 加 `'start','end'`，`AI\_PROP\_LABEL` 加中文名。
* 代码块 `blocks.js`：3 个专属分类 + 示例（`ev\_change` 头 + `val\_comp\_value` / `act\_comp\_set`）。
`change` 形状不在事件帽白名单，别为它单独做帽子。

**验证**：

* 4 个 JS 文件 `node --check` 全过；`node pc-sim/unit-comp-spec.mjs` **19/19**（含"控件类型数量为 33"）。
* 全量回归 `pc-sim\\run-ui-test.ps1` **160/160**、失败 0、JS 报错 0；新增用例
「新控件②：多选下拉/日期范围/颜色选择器 三处渲染一致，运行时能交互」。
* `pc-sim\\run-export-test.ps1` 全绿（`com.fast.app.rt.ih8ohd` / `com.fast.app.rt.je8t4k`）。
* 打包：`versionCode='242' versionName='1.0.116.126'`；
产物 `D:\\DSH工作\\fastapk\\FAST\_v1.0.116.126.apk`（**1,850,782 字节**，
sha256 `9162810A568B635A036B8A5240591CFAB6CFE1B78E296EF9FA88A991564CA407`，v2/v3 签名 OK）。
* **「更新」表**：第 15 行 `1.0.116.126（26.10.28.17:36）`，row\_id `XQ2a8hzwT9y\_NC0OvWREMQ`，
`程序` 附件 = `FAST\_v1.0.116.126.apk`；`/api/download` **带 `X-App-Token`** 实测 **200**、1,850,782 字节、哈希与本地一致。
* **「工程」表**：新增 `1.0.116.126`（row\_id `WbcojN4iQg69\_cglucLI9g`），
`文件` = `FAST-full-1.0.116.126.zip`（**21,309,237B / 1031 条目**），`备份` = 126 APK
（SeaTable 自动改名成 `FAST\_v1.0.116.126 (1).apk`，行内引用仍有效）。
两个附件都已实测 200：zip 21,309,237B（sha256 `DFBDE817…BD184C`）、APK 1,850,782B（`9162810A…4CA407`）。
* 版本号已自增到 `243 / 1.0.116.126`（下次打包出 1.0.116.127）。

**三条教训（下次别再踩）**：

1. **布局页断言只能看子元素，不能断言视觉根 class**：布局页只搬 `layVisual` 返回根节点的**子元素**，
`lv-multi` / `lv-color` 这个根节点的 class 到了舞台上是丢的（和标签页 6.14 同一套做法）。
断言要写 `.lv-label` / `.lv-caret` / `.lv-color-sw` 这类**子元素**。
2. **模板字符串（含注释）里绝不能出现反引号**：`cdp-test.mjs` 里我把 `.lv-multi` 写成带反引号的形式塞进注释，
反引号提前终止了 Node 的模板字面量 → 浏览器表达式被截断成残缺 JS → 报 `multi is not defined`，
连查两轮才定位。写测试表达式时**只用单/双引号**。
3. 日期范围断言要"改一个、dispatch、再改另一个"：两个 input 一起赋值再 dispatch，
第一次 change 的 `拼范围()` 会把第二个框回写成旧值（`2025-03-01\~2025-01-31` 就是这么来的）。

**下一步**：阶段 3 剩余 —— 动作块第二批；真机复验项仍挂 6.12 那三条 + 新控件点击手感（当前无真机，不主动 adb）。

## 6.16 2026-10-28 阶段 3 第二批：动作块 3 个 + 两处 UI 修正（APK 1.0.116.127，回归 162/162）

**做了什么**

* **文案修正**（用户报写错）：点击运行后的提示框由「下滑停止栏」改成「下滑通知栏」
（`assets/www/editor.js` 的运行提示 + 上方注释同步）。
* **代码栏灰底板**（用户报的"点了弹一个灰块然后消失"）：`.blocklyFlyoutBackground` 改成
`fill: var(--surface); fill-opacity: 1` —— 底板留着（不能删，删了画布代码会从浮层下透上来重叠），
但颜色和画布一致，所以看不见了。
* **动作块第二批**：新增 3 个**通用块**，放进新通用分类「控件」（紫色 `#8E24AA`，图标 `⊞`）：

  * `act\_set\_pos` → `RT.setPos(id, x, y)`（X/Y 数值；自动排列的控件执行后转自由定位，`cx` 锁解除）
  * `act\_set\_size` → `RT.setSize(id, w, h)`
  * `act\_set\_options` → `RT.setOptions(id, 文本)`（逗号/顿号/换行分隔；下拉/单选/多选/标签页）
  * 运行时 API 早在 `runtime.js` 里就绪；这次补上 `renderComp` 的 `wrap.\_\_c = c`（改数据能写回）

    * `RT.setOptions` 会就地重绘并校正选中值（select/radio 落第一项，tabs 越界归 0）。
  * 同步：工具箱示例（带 shadow 数值/文本）、`BB\_GROUPS.general`、`BB\_CAT\_ICON`、`BB\_HELP.general`
新增「控件」组（3 条，带 `t` 可跳到真积木）、`块名表`（帮助配图的兜底名字）。
* **上下文预算重调**（见教训 1）：`aiCompressHistory` 由「最近 6 条 × 700 字」收到「最近 4 条 × 500 字」，
`aiBuildMessages` 同步传 4。压缩用例从 82% 回到 **78%**（上限 80%）。

**验证**

* `node --check` editor/blocks/runtime/cdp-test 全过；`unit-comp-spec.mjs` **19/19**（33 类型）。
* 全量回归 **162/162**、失败 0、JS 报错 0；新增 2 条用例：

  * 「动作块②：位置/大小/选项 三块在「控件」分类、生成代码正确」——
断言块定义/生成器都在、工具箱有 3 个块、分类栏/帮助有「控件」组，
并用**无头 Workspace** 生成 `RT.setPos("select1", 66, 208);` / `RT.setSize(..., 180, 64);` /
`RT.setOptions(..., '苹果,香蕉');`（不污染主画布）。
  * 「动作块②：设置位置/大小/选项 运行时生效并写回数据」——
自造工程进 runtime，断言 DOM `left/top/width/height`、`\_\_c` 写回、选项换 3 项后点选生效。
* `pc-sim\\run-export-test.ps1` 全绿（`com.fast.app.rt.ih8ohd` / `com.fast.app.rt.je8t4k`）。
* `node pc-sim\\audit.mjs`：无新增问题（同名函数/凭据那几条是老的，未动）。
* 打包：`versionCode='243' versionName='1.0.116.127'`；
产物 `D:\\DSH工作\\fastapk\\FAST\_v1.0.116.127.apk`（**1,854,878 字节**，
sha256 `55D720D4EA0C58D9E5FE9DD829516AA77E8A7D1AAAE55945786E37AE18FA3B88`，v2/v3 签名 OK）。
* **「更新」表**：第 16 行 `1.0.116.127（26.10.28.21:22）`，row\_id `f7LXlnD9QX6zL5ZHnDcl4w`；
`/api/download` **带 `X-App-Token`** 实测 **200**、1,854,878 字节、哈希与本地一致。
* **「工程」表**：新增 `1.0.116.127`（row\_id `Goe7Tt6zS5alT-TQcvrPJg`），
`文件` = `FAST-full-1.0.116.127.zip`（**21,314,763B / 1031 条目**），`备份` = 127 APK
（SeaTable 自动改名成 `FAST\_v1.0.116.127 (1).apk`，行内引用仍有效）。
* 版本号已自增到 `244 / 1.0.116.127`（下次打包出 1.0.116.128）。

**三条教训（下次别再踩）**

1. **加代码块前先估 AI 代码清单体积**：这次最初按控件类型拆 `v\_<控件>\_pos/size`（+66 块）并给 4 类加
`options`，工具箱代码块从 350 涨到 **420**，`aiCatalog()` 从约 21.6k 涨到 35.7k 字节，
「上下文压缩」用例直接 121% 爆掉。改成 3 个**通用块**后只 +3（353 种 / 21,639 字节）。
结论：**能力优先做成通用块，别按控件类型复制**；顺带把压缩预算收到 4 条 × 500 字留出余量。
2. **测试里造块要先确保工程已打开**：控件下拉 `compField()` 在 block 初始化时就会调
`\_\_compOptions()` → 读 `state.project.screens`；工程没开时直接 `Cannot read properties of null`。
这个用例所以放在 `ensureProject()` 之后；运行时用例则自造 `\_\_previewProject`，互不依赖。
3. **工具箱里带 shadow 的示例块才会进 AI 代码清单**：`aiCatalog()` 是序列化工具箱 XML 去重的结果，
想让 AI 会用新块，示例必须写进 `buildToolboxXml`（否则 AI 只能瞎猜块名）。

**下一步**：阶段 3 剩余（规划文档里动作块后续项）+ 真机复验（6.12 那三条、新控件点击手感、动作块拖拽手感）；
当前无真机，不主动 adb。



## 6.17 2026-10-28 分类行按下灰底（6.16 那次改错了）+ APK 1.0.116.128

**先说 6.16 的错**：用户说的「灰块」**不是浮层底板**（`.blocklyFlyoutBackground`），改了之后用户回
「怎么还在／你是不是理解错了」。真正的灰块是**分类行自己的按下态**。

**定位（有实测，不是猜）**：在分类条里先选中「设备」，再按「控件」——
`pointerdown` 那一瞬间，控件那一行的 `background-color` = `rgb(234,233,237)`（`#EAE9EE` = `--c-high`），
`pointerup` 后清掉，再接着紫色滑块（`rgb(231,221,248)`，`--secondary-c`）从 y=286 滑到 y=245。
也就是用户看到的：**灰块出现 → 灰块消失 → 紫块才滑动**。
（取证脚本：临时 `%TEMP%\\fast-probe-gray.mjs` + `.ps1`，无头 Edge 真下发 pointerdown/up。）

**改了什么**（`assets/www/editor.css`）

* `.bb-cat.按住` 由 `background: var(--c-high)` 改成 `transparent`；`.acct-item.按住` 保持原样
（账号页没报这个问题，不动）。选中表达只由滑块承担。
* 改完复验：按下「控件」时该行底色 = `rgba(0,0,0,0)`，滑块仍从「设备」正常滑上去（+30ms y=267 → +130ms y=245）。

**验证**

* 全量回归 **162/162**、失败 0、JS 报错 0（`run-ui-test.ps1`）。
* `run-export-test.ps1` 全绿；`audit.mjs` 无新增问题（同名函数/硬编码口令是老的）。
* 打包：`versionCode='244' versionName='1.0.116.128'`；
`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.128.apk`（**1,854,878 字节**，
sha256 `3082DF6A701FFF4BCC40FBD346154CB2A9A271818FB81D995CBE1E27D89F83B9`，v2/v3 签名 OK）。
* **「更新」表**：`1.0.116.128（26.10.28.21:50）`，row\_id `Js8ixFE7Ta-WGQG\_tRijOA`；
`/api/download` 带 `X-App-Token` 实测 **200**、1,854,878 字节、哈希一致。
* **「工程」表**：新增 `1.0.116.128`（row\_id `BwericwFSVK1w4GzwhkHdw`），
`文件` = `FAST-full-1.0.116.128.zip`（**21,316,836B / 1031 条目**），`备份` = 128 APK
（自动改名 `FAST\_v1.0.116.128 (1).apk`）。
* 版本号已自增到 `245 / 1.0.116.128`。

**教训**

1. **用户说"灰块/底板"时，先量再说**：分类行这类"按下反馈"和浮层底板长得完全不一样，
靠猜会改错地方（这次白改了一版 CSS 还多发了一个 APK）。
量法固定：`pointerdown` 后立刻读 `getComputedStyle(行).backgroundColor`，别靠肉眼截图。
2. 需要真机手感的问题（按下反馈、点按灵敏度）**在 PC 无头环境只能验"颜色/几何"**，
"看着还闪不闪"最终还得用户看一眼——所以这类改动要尽量小、要给出明确的"改前/改后"数值。

**下一步**：阶段 3 剩余（规划文档里动作块后续项）+ 真机复验（6.12 那三条、新控件点击手感、动作块拖拽手感、本次灰底）；当前无真机，不主动 adb。



## 6.18 2026-10-28 AI 模型固定 + 布局「如何预览」+ 换页方向 bug（APK 1.0.116.129，回归 163/163）

**1. AI 模型选择器删掉，固定 DeepSeek-V4.1 flash**

* `editor.html`：AI 面板顶栏的 `#aiModelTop` 按钮删除（顶栏右侧只剩 看报错 / 🧠 / ＋ / ✕ 共 4 个）；
设置页原来那句「模型切换只在面板顶栏提供」的注释同步改掉。**密钥输入框保留**。
* `editor.js`：删掉 `AI\_MODELS` / `AI\_DEFAULT\_MODEL` / `aiSetModel` / 模型下拉整套
（`aiOpenModelMenu` / `aiCloseModelMenu` / 全局 pointerdown 关菜单 / `aiWireModelSelects`），
只留 `AI\_MODEL = 'deepseek-flash'`、`AI\_MODEL\_LABEL = 'DeepSeek-V4.1 flash'`，`aiModel()` 恒返回它。
深度思考仍是**另一根独立的轴**（`thinking: enabled/disabled`），🧠 开关不受影响。
* 导出 API 去掉 `\_\_aiSetModel`；`\_\_aiModel` / `\_\_aiThink` / `\_\_aiSetThink` / `\_\_aiParams` 保留。
* 回归用例改写：「模型固定为 DeepSeek-V4.1 flash（界面里没有模型选择器）」「深度思考可单独开关，模型固定不变」；
两处按钮数量断言同步：「AI 顶栏控件数」6 → **5**（☰ + 看报错 + 🧠 + ＋ + ✕），右侧组保持 **4**（看报错/🧠/＋/✕）。

**2. 布局预览加「如何预览」下拉（自动 / 竖屏 / 横屏）**

* 顶栏「布局」右侧加窄箭头 `#btnLayoutCaret`（`.layout-split`，箭头 26px）；
菜单 `#layoutOrientMenu`：标题「如何预览？」+ 三项，当前项高亮并带 ✓，存
`localStorage.\_\_bb\_layout\_orient`（跨工程记住，默认 `auto`）。
* 语义：**自动** = 跟当前页面自己的 `orientation`；**竖屏/横屏** = 强制，即使页面设的是另一边。
只影响**布局页预览**，不改页面方向、不影响运行/导出。
* `layoutOrient()/applyLayoutOrient()`：方向没变不重复下发 `Native.setOrientation`；
`openLayout()` 每次把 `state.layoutOriented` 置空，进来按当前模式重定一次。
* `fitStage()` 的舞台类名与设计尺寸改用 `layoutOrient()`；`captureDesign()` 仍用 `curOrient()`，
**物理方向 ≠ 页面方向时不捕获**，避免强制预览把 `project.design` 写成错方向的尺寸。

**3. bug：横屏预览下切到竖屏页面，画面还是横的**

* 根因：`switchScreen()` 只换控件/代码，**完全没管布局页的方向与舞台**，于是停在上一页的横屏。
* 修法：`switchScreen()` 末尾若 `state.inLayout` → `applyLayoutOrient()` + `renderLayout()` + `requestAnimationFrame(fitStage)`；
物理旋转是异步的，后续 resize 监听还会再补一次 fit。

**验证**

* `node --check editor.js` / `cdp-test.mjs` 通过；`audit.mjs` 无新增问题。
* 全量回归 **163/163**、失败 0、JS 报错 0；新增用例
「布局预览方向：自动跟随页面（换页重算），也能强制竖/横」——造「横屏页 + 新建竖屏页」，
断言 `#layStage` 在换页后 `portrait` 类、宽 390；再换回横屏；退出后检查下拉三项/默认勾「自动」；
强制竖/横各验一次，并断言**页面自身 orientation 未被改**；结束时还原页面、design、临时页。
* `run-export-test.ps1` 全绿（`com.fast.app.rt.ih8ohd` / `com.fast.app.rt.je8t4k`）。
* 打包：`versionCode='246' versionName='1.0.116.129'`；
`D:\\DSH工作\\fastapk\\FAST\_v1.0.116.129.apk`（**1,854,878 字节**，
sha256 `B25BF0EFC184791CA44B941150AFA11589FAA385AD109D1040BAB0CADCFC597C`，v2/v3 签名 OK）。
* **「更新」表**：`1.0.116.129（26.10.28.22:29）`，row\_id `fD035iCVQsWIn-quO9B5iw`；
`/api/download` 带 `X-App-Token` 实测 **200**、1,854,878 字节、哈希一致。
* **「工程」表**：新增 `1.0.116.129`（row\_id `FMu3PQ6AQrmZPHobODyLoA`），
`文件` = `FAST-full-1.0.116.129.zip`（**21,319,010B / 1031 条目**），`备份` = 129 APK
（自动改名 `FAST\_v1.0.116.129 (1).apk`）。
* **GitHub 公开库提供安装包**（用户本轮要求；与 6.17 之前"不用再弄公开库"的说法不冲突，只发安装包、不同步源码）：
在 `dashen9178/fast` 建 Release **v1.0.116.129**，资产 `FAST\_v1.0.116.129.apk`；
公网下载实测 **200**、1,854,878 字节、sha256 与本地一致：
[https://github.com/dashen9178/fast/releases/download/v1.0.116.129/FAST\_v1.0.116.129.apk](https://github.com/dashen9178/fast/releases/download/v1.0.116.129/FAST_v1.0.116.129.apk)
* 版本号已自增到 `247 / 1.0.116.129`（下次打包出 1.0.116.130）。

**三条教训**

1. **"预览方向"和"设计画布尺寸"是两件事**：舞台可以按强制方向摆，但 `project.design` 必须只按页面自身方向捕获
（否则强制竖屏会把横屏页面写坏，运行/导出跟着错）。所以 `fitStage` 用 `layoutOrient()`、`captureDesign` 用 `curOrient()`，
两个函数**不能合并**。
2. **换页路径要逐个收口**：这个 bug 不是方向算错，而是 `switchScreen()` 根本没通知布局页。
凡是"全屏子页 + 全局状态"的组合（布局页、运行页），换页后都要显式重算并重排，不能指望 resize 兜底。
3. **删功能要连测试里的"数量断言"一起改**：删模型下拉后两处「顶栏按钮数」还停在旧值，
第一次全绿跑出 **162 通过 / 1 失败** 就是它；这类硬编码计数在增删按钮时最容易漏。

**下一步**：阶段 3 剩余（规划文档里动作块后续项）+ 真机复验（6.12 那三条、新控件点击手感、动作块拖拽手感、本次灰底、布局预览方向）。



## 6.19 2026-10-28 纠正「如何预览」口径：预览框方向 ≠ 页面方向（APK 1.0.116.130）

**用户更正（原话）**：「这个如何预览方向选择 这个横屏竖屏 你搞错了……如果选择页面为横屏，在"如何预览方向"选择了竖屏，
则在竖屏展示横屏的画面。」

**6.18 错在哪**：把「强制竖屏」实现成了**连画面也按竖屏重新排版**（`stage` 用 `layoutOrient()` 的尺寸当画布），
结果横屏页面的控件被塞进 390 宽的竖屏坐标里，等于换了个页面布局，不是用户要的「竖框看横屏」。

**正确口径（本次已改）**：

* 预览 = **两层**：外层 `#layShell` 是"设备框"，方向由「如何预览」决定；内层 `#layStage` **永远是页面自己的设计画布**
（尺寸/排版仍按 `curOrient()`，和运行/导出严格一致）。
* 方向一致（自动，或强制值 = 页面方向）：框和画面重合，外观跟以前完全一样。
* 方向不一致：框按所选方向（竖 390×827 / 横 693×390），画面**等比缩进框里居中**——
横屏页面选竖屏 = 竖框上下留边、中间显示完整的横屏画面；竖屏页面选横屏同理（左右留边）。
* 强制预览只画外面这层框（`.lay-shell.forced`），**不改页面 orientation、不改 `project.design`、不影响运行/导出**。
* 指针换算：`stage.dataset.scale` 记的是**画面**缩放比（`kc`），`shell.dataset.scale` 记框缩放比（`kf`）；
拖拽/缩放手柄全部继续按 `stage` 的 rect ÷ `kc` 算，所以强制缩放后拖控件仍然准。

**改动文件**

* `editor.html`：`.lay-stage-wrap` 里加 `#layShell` 包住 `#layStage`。
* `editor.css`：新增 `.lay-shell` / `.lay-shell.forced`（设备框只在方向不一致时显示）；`.lay-stage` 改为 `position:absolute`。
* `editor.js`：`fitStage()` 重写——`frame = designSize(layoutOrient())`、`content = designSize(curOrient())`，
`kc = kf × min(frame.w/content.w, frame.h/content.h)`；`stage.left/top` 按两者尺寸差居中。
`renderLayStage()` 仍用 `designSize()`（页面方向），未动。
* `pc-sim/cdp-test.mjs`：布局预览用例改为同时断言**框**和**画面**：
自动横屏页 → 框横/画面横；换竖屏页 → 框竖/画面竖（宽 390）；
竖屏页 + 强制横屏 → 框横 693×390、画面仍竖 390×827；
横屏页 + 强制竖屏 → 框竖 390×827、画面仍横 693×390（正是用户要的那句）。

**验证**

* `node --check` 两份都过；全量回归 **163/163**（新用例输出：强制横「框 693x390，画面 390x827」、强制竖「框 390x827，画面 693x390」）。
* 导出回归全绿（todo/land 两个包名、签名、对齐、入口均 OK）；`audit.mjs` 与 6.18 相同基线，无新增项。
* APK：`versionCode=247 / versionName=1.0.116.130`，`FAST\_v1.0.116.130.apk`
（**1,854,878 字节**，sha256 `A49067396F926C0A411EB47FDF621B4B311E2067BE937D1BE5A5FBF21DB23520`，v2/v3 签名 OK）。
* 「更新」表 row `GSp4R5iiScyrileoTs8UAw`（下载 200、大小/哈希一致）；「工程」表 row `Kqf2Ub\_tQXu7BEzrMitxgQ`
（zip **21,322,219B / 1031 条目**，备份 APK 已自动改名 `FAST\_v1.0.116.130 (1).apk`）。
* GitHub Release **v1.0.116.130**（公开库 `dashen9178/fast`）：
[https://github.com/dashen9178/fast/releases/download/v1.0.116.130/FAST\_v1.0.116.130.apk](https://github.com/dashen9178/fast/releases/download/v1.0.116.130/FAST_v1.0.116.130.apk)
* 版本号已自增到 `248 / 1.0.116.130`。

**教训**

1. **"预览方向"是镜框方向，不是内容方向**：用户要的是"竖着拿手机看横屏画面"，不是"把横屏页面重排成竖屏"。
以后遇到"方向/比例"类需求，先问一句"是换框，还是重排内容"，别自己脑补。
2. 双层结构（`shell` 框 + `stage` 画面）比"一个元素两种含义"稳：框归预览模式管，画面归页面管，
`project.design`/运行时/导出只认画面，三者天然不会互相污染。
3. 缩放比必须**分层记录**：外层 `kf`、内层 `kc`；只记一个的话，强制预览下拖控件会偏（差一个 `min(框/画面)`）。

**勘误（2026-10-28 晚补）**：130 版虽然结构对了，但居中仍用**未缩放**的设计像素算（`stage.left = (frame.w - content.w)/2`），
真机上强制翻转会整体偏左上（用户截图）。131 已改为按缩放后尺寸居中，详见 6.20。

**下一步**：阶段 3 剩余（规划文档里动作块后续项）+ 真机复验（6.12 那三条、新控件点击手感、动作块拖拽手感、本次灰底、两种强制预览的实际观感）。



## 6.20 2026-10-28 修「强制翻转时画面偏左上」（APK 1.0.116.131）

**用户反馈（原话）**：「强制翻转的时候位置偏了」，附两张真机截图：竖框里横屏画面贴在左上角、横框里画面也没居中。

**根因**：`fitStage()` 里居中是按**设计像素**算的——
`stage.left = (frame.w - content.w) / 2`，但画面自身已经 `transform: scale(kc/kf)`，
视觉宽度是 `content.w × kc/kf`（小于 `content.w`）。用没缩放的尺寸去减，差值偏大 → 左/上各多推一截，
表现就是整体偏左上（方向差得越多偏得越多）。

**修法**（只改 `fitStage()` 三行）：

```js
var cw = content.w \* (kc / kf), ch = content.h \* (kc / kf);   // 画面缩放后的视觉尺寸
stage.style.left = Math.round((frame.w - cw) / 2) + 'px';
stage.style.top  = Math.round((frame.h - ch) / 2) + 'px';
```

等价说法：**居中一律在"框的未缩放坐标系"里用视觉尺寸做**，`left/top` 本身会被外层 `kf` 再缩一次。

**回归补强**（`pc-sim/cdp-test.mjs`）：布局预览用例新增 `量()` 读 `getBoundingClientRect` 四边距，
`居中()` 断言左右差、上下差都 ≤ 3px；出现在 ①自动横屏、⑤竖页强制横屏、⑥横页强制竖屏 三处。
这条断言在旧代码下会直接 FAIL，属于真能拦住回归的用例。

**验证 / 发布**

* `node --check` OK；全量回归 **163/163**（关键行：`强制横：框 693x390，画面 390x827` / `强制竖：框 390x827，画面 693x390`，居中 ✓）。
* 导出回归全绿；`audit.mjs` 与 6.19 同基线（4 类已知项，无新增）。
* APK：`versionCode=248 / versionName=1.0.116.131`，`FAST\_v1.0.116.131.apk`
（**1,854,878 字节**，sha256 `153DB29CDB4FD32896324F9DCCF8813A969D7B777CF4435A1E70D4D3FD561919`，v2/v3 签名 OK）。
* 「更新」表 row `YgNAMJhTRtq8kHGUv7IR7A`（`/api/download` 200、大小/哈希一致）；
「工程」表 row `PvHOy6ahTbSIbzWDSnZpbw`（`FAST-full-1.0.116.131.zip` **21,324,228B / 1031 条目**，
备份 APK 自动改名 `FAST\_v1.0.116.131 (1).apk`）。
* GitHub Release **v1.0.116.131**（`dashen9178/Fast`），资产 digest `sha256:153db29c…561919`、1,854,878B，与本地一致；
源码同步提交 `e1e88da`（3 个文件：editor.js / cdp-test.mjs / VERSION）。
* 版本号已自增到 `249 / 1.0.116.131`（下次打包出 1.0.116.132）。

**教训**

1. **`transform: scale()` 之后的尺寸要自己算**：任何"居中/偏移/命中判定"用的都必须是视觉尺寸（`设计尺寸 × 实际缩放比`），
不能再拿 CSS 的 `width/height` 去减；嵌套 transform 时尤其容易漏乘 `kc/kf`。
2. **肉眼截图能发现、代码看不出**的 bug，用 `getBoundingClientRect` 四边距断言固化成用例，比人眼复核可靠。
3. 130 那次"回归全绿"其实是**用例没量位置**，只比了宽高——几何类改动必须同时断言位置。

**下一步**：阶段 3 剩余（规划文档里动作块后续项）+ 真机复验（6.12 那三条、新控件点击手感、动作块拖拽手感、本次灰底、131 两种强制预览的实际观感）。



## 6.21 2026-10-29 全面检查 + 阶段 2 收尾：徽章/时钟/二维码（APK 1.0.116.132）

**这次做了什么**（用户原话：「对项目做一次全面检查，看看有没有漏洞并修复。然后开始阶段 2 开发」）

### 一、全面检查（结论：无新增高危，修了 2 处原生边界）

按四条线自查：WebView 配置与原生桥、路径/文件名、XSS/动态执行、导出链。

|项|结论|
|-|-|
|外来作品代码注入|仍然有效：`洗掉外来代码(proj)` 按 blocksXml 重生成 `code`（导入、社区运行、生成副本三处都过）|
|文件名 / 媒体名路径穿越|`saveProject/shareProject` 过滤 `\[\\\\/:\*?"<>\|]`；`mediaUrl/readMediaBase64/writeMedia` 拒 `/\\`、`..`|
|innerHTML 拼变量|4 处，全是数字/固定文案/`authEsc` 转义，无云端可控串|
|导出包密钥|`build.ps1` 断言 APK 内无密钥/无 SeaTable 凭据，签名 v2/v3 OK|
|**`Native.installApk(path)`**|**已修**：纯路径（非 `content://`）只接受本 App 私有目录内的文件，且必须 `.apk` 后缀 + ZIP 魔数 `PK\\x03\\x04`。以前网页控件里的第三方页面理论上能直接把任意本地文件递进安装器|
|**`Native.downloadApk(url)`**|**已修**：只允许 `http://` / `https://`。以前 `file://` 能把本机任意文件复制成 `.apk` 再走安装流程|
|`usesCleartextTraffic=true`|低危、**保留**：云表格服务允许用户填 http 地址，关掉会直接破坏老作品|

### 二、阶段 2 收尾（3 个新控件，注册表 33 → 36）

* **徽章 `badge`**：小圆点 + 文字，用于状态提示；属性面板可改文字与圆点颜色。
* **时钟 `clock`**：默认按真实时间走秒（全局 1 个 interval，销毁节点自动剔除）；
格式 `hm` / `hms` / `mdhm`；代码赋值后停走秒，赋空串恢复走秒。
* **二维码 `qr`**：新增 `assets/www/qr.js`（纯 ES5、单 IIFE、字节模式 UTF-8、ECC M、版本 1\~10 自动），
离线出 SVG，不联网；内容 > 213 字节时属性面板红字提示、运行时显示占位文案。
* 三处渲染：设计页卡片（`compDesc`）、布局页舞台（`layVisual`）、运行时（`renderComp`）。
* 代码侧不新增块：复用通用「控件赋值」`act\_comp\_set`，`RT.setComponent` 按 wrap 类名分流到
`setBadge / setClock / setQR`；工具箱按控件类型自动出现「徽章 / 时钟 / 二维码」分类（含显示/隐藏/透明度/旋转/启用/禁用）。
* `build.ps1` 的导出壳复制清单补了 `qr.js`；`editor.html` / `runtime.html` 都加载它。

**踩到的坑（已修）**：`renderComp` 的徽章分支建好了文字 `span` 却忘了 `appendChild`，
真机/浏览器里表现是"只有红点没有字"，而 `\_\_val` 一切正常 —— 单测只比数据就查不出来，
是新加的端到端用例（断言 `.rt-badge-t` 的文本）把它抓出来的。

**验证 / 发布**

* `node --check` 5 个 JS 全过；`unit-comp-spec.mjs` **21/21**（新增「qr.js 引用与打包」2 项）。
* 全量回归 **164/164**（新增「新控件③：徽章/时钟/二维码 三处渲染一致，运行时能读写」）；导出回归全绿。
* `audit.mjs` 与 6.19 同基线（4 类已知项，无新增）；`MainActivity.java` 改动通过导出链真编译验证。
* APK：`versionCode=249 / versionName=1.0.116.132`，`FAST\_v1.0.116.132.apk`
（**1,879,516 字节**，sha256 `850E201649188B5FB2E0504FDD590C64DACCAF6DADEAFA547BC7042CBCAE9048`，v2/v3 签名 OK）。
* 「更新」表 row `d0i-md43QBOfcmEhNCJ8Bg`（`/api/download` 200、大小/哈希一致）；
「工程」表 row `T-4WFm3-SreOWOgYrjwsFA`（`FAST-full-1.0.116.132.zip` **21,335,566B / 1032 条目**，
备份 APK 自动改名 `FAST\_v1.0.116.132 (1).apk`）。
* GitHub Release **v1.0.116.132**（`dashen9178/Fast`），资产 digest `sha256:850e2016…ae9048`、1,879,516B，与本地一致；
源码同步提交 `c55d753`（14 个文件，含 `qr.js`、`comp-spec.js`、`runtime.\*`、`MainActivity.java`、两个测试）。
* 版本号已自增到 `250 / 1.0.116.132`（下次打包出 1.0.116.133）。
* 规划文档第 5 节进度已更正：阶段 2、阶段 3 第一批实际都已完成，只剩阶段 4～5。

**下一步**：阶段 4（滚动区 / 底部导航）与阶段 5（设备能力块）；真机冒烟：新控件三种、安装/更新流程（本次动了 install/download 门槛）。



## 6.22 2026-10-29 检查更新红点 + 布局按钮连体 + 阶段 4/5（APK 1.0.116.133）

**这次做了什么**（用户原话：「那个检查更新那个按钮，如果有新版本，就会在这个按钮右上显示一个红点。把布局按钮和它的右边那个向下箭头的按钮连在一起」；「把阶段4、5开始吧，搞完这些再交付给我」）

### 一、检查更新红点

* `editor.html` 的 `#btnUpdate` 里加了 `<span id="updDot" class="upd-dot hidden"></span>`；
`editor.css` 里 `.upd-dot` 绝对定位在按钮**右上角**（top/right 5px，直径 8px，`#e5484d`，`pointer-events:none` 不挡点击）。
* 逻辑在 `editor.js`（`本地版本号 / 比版本 / 取最新版本 / 校验更新提示 / 设更新红点 / 有新版本 / 拉更新最新行 / 后台查更新红点`）：

  * 开机 **1.5 秒后**后台查一次（`更新红点已查` 防重入），**有新版本才亮**；
  * 断网 / 中转欠费一律**静默**，绝不打扰用户；
  * 用户点开「检查更新」时立刻**熄灭**（`openUpdateDialog()` 开头 `设更新红点(false)`）；
  * 开发版（`buildVersion()` 返回「开发版」）永不亮，避免本地调试时天天闪。
* 抽了 `拉更新最新行()`，弹窗与红点共用同一套「只取最新一行」逻辑，不会两处判断不一致。
* 测试出口 `EditorApp.\_\_updateDot(on)` 供用例开/关红点。

### 二、布局按钮与 ▾ 连体

照抄 `.run-split` 拆分按钮的做法（不动 HTML 结构、不动两个按钮各自的点击逻辑）：
`.layout-split` 外层 `gap:0; overflow:hidden; box-shadow`，`#btnLayout` 左侧圆角 20px、
`.layout-caret` 右侧圆角 20px + `border-left:1px solid` 当分隔线 → 看起来是一颗按钮、中间一条细线。

### 三、阶段 4：容器类控件（滚动区 `scroll`、底部导航 `bottomNav`，注册表 36 → 38）

* **滚动区**：直接复用容器的「子控件存相对坐标」机制。父子关系全部收敛成一个 `是容器(c)`
（`找控件 / 所有容器 / 移入容器 / 移出容器 / 放进容器` 五处都用它），滚动区不用另写一套。
运行时 `overflow:auto` + `overscroll-behavior:contain` + `-webkit-overflow-scrolling:touch`，
滑到边界不会把整页带走（触摸冲突就是这么解决的）。
* **底部导航**：设计页卡片、布局页舞台、运行时三处都渲染成「一排可点的栏 + 当前项高亮」。
⚠️ 布局页 `renderLayStage` 只搬视觉节点的**子元素**（根节点的 class 会被丢弃），
所以横排必须做成真实子元素 `.lv-navbar`，否则舞台上排版整个塌掉。
运行时点击切高亮并跑 `runHandlers(changeMap\[c.id])`；代码侧用通用「控件赋值」块读写选中序号（0 开始），
`RT.getValue(id)` 读 `r.\_\_val`，`RT.setComponent(id, v)` 会夹到 `0..钮数-1`。
* 用例「阶段4：滚动区/底部导航 三处渲染一致，运行时能滑动、能切换」覆盖：顶层数、卡片文案、
布局页 `.litem-kid` 与三栏高亮、运行时 `overflowY/overscrollBehaviorY`、点第三项变「我的」、
`RT.getValue===2`、`setComponent(id,99)` 夹到 2。

### 四、阶段 5：设备能力块（读剪贴板 / 打开网址 / 发通知）

* 三个块：`val\_clipboard`（值块）、`act\_open\_url`（值输入 URL）、`act\_notify`（标题 + 内容），
工具箱「设备」分类、帮助页「设备」分类、AI 块名映射与帮助关键词全部补齐。
* 运行时 `RT.readClipboard / RT.openUrl / RT.notify`，**原生优先、网页回退**：

  * `readClipboard`：`Native.readClipboard()` 同步返回；网页里拿不到就给空串（不抛错）；
  * `openUrl`：只认 `http/https`（否则提示「网址要以 http:// 或 https:// 开头」），
原生走 `ACTION\_VIEW` + `FLAG\_ACTIVITY\_NEW\_TASK`，网页回退 `window.open('\_blank')`；
  * `notify`：Android 13+ **默认不给通知权限** —— 先 `notifAllowed()`，没授权就 `askNotif()`
并提示「请在弹窗里允许通知，之后才会显示在通知栏」，避免用户以为「发了但没反应」；
通道「作品通知」、`setAutoCancel(true)`、点击回到 App；网页版退回页面内 toast。
* `MainActivity.java` 的 `NativeBridge` 新增 `readClipboard() / openUrl(String) / notify(String,String)`；
导出壳复用同一份 `classes.dex`，**导出的作品同样能用这三个能力**。
* 用例「阶段5：剪贴板/打开网址/发通知 三块定义、生成代码、工具箱、帮助齐全」覆盖：
生成的代码、工具箱 3 块、帮助 9 条、运行时三方法存在且不抛错。

**踩到的坑（已修）**

* 第一轮回归 165/166，唯一失败是「上下文压缩」用例报 81% > 80%。查下来是**用例自身的口径错**：
它把末条消息里的「当前页面控件 / 已有代码」等**动态上下文**也算进了压缩比，而当前工程代码变长了，
老历史其实已从 31179 字压到 905 字。修法是把末条上下文从「发出」里扣掉再算比例，业务代码不动。

**验证 / 发布**

* `node --check` 5 个 JS 全过；`unit-comp-spec.mjs` **23/23**（新增「滚动区」「底部导航」2 项）。
* 全量回归 **168/168**（新增 4 条：阶段4、阶段5、检查更新红点、布局按钮连体）；导出回归全绿。
* `audit.mjs` 与 6.21 同基线（4 类已知项，无新增）。
* APK：`versionCode=250 / versionName=1.0.116.133`，`FAST\_v1.0.116.133.apk`
（**1,887,708 字节**，sha256 `45AAF0D391707B07279311ECF2F3FE68BE1FEA75E4A38DCE4F01949C0F6BC100`，v2/v3 签名 OK）。
* 「更新」表 row `BLMFY-YHQlqfhEe5Vmav3w`（`/api/download` 200、大小/哈希一致）；
「工程」表 row `HLMBvwIERYaNaWIj2ZVXrg`（`FAST-full-1.0.116.133.zip` **1032 条目 / 约 21.3 MB**，
备份 APK 自动改名 `FAST\_v1.0.116.133 (1).apk`）。
* GitHub Release **v1.0.116.133**（`dashen9178/Fast`），资产 digest `sha256:45aaf0d3…6bc100`、1,887,708B，与本地一致；
源码同步提交 `25fcb86`（12 个文件：`blocks.js`、`comp-spec.js`、`editor.\*`、`runtime.\*`、
`MainActivity.java`、`cdp-test.mjs`、`unit-comp-spec.mjs`、`VERSION`、规划文档）。
* 版本号已自增到 `251`（下次打包出 1.0.116.134）。

**下一步**：真机冒烟这三件——滚动区里放长内容能不能滑、底部导航点着切不切、
发通知有没有弹权限；之后按 `新增代码块与控件规划.md` 第 5 节继续往后排（阶段 6 起）。



## 6.23 2026-10-29 拖拽进容器 + 通知权限三态 + 布局按钮去阴影（APK 1.0.116.134）

**这次做了什么**（用户原话：「容器和滚动区是不是要拖动别的控件进来，但好像不行」→「设计页」→「我觉得可以都做」；
另两条：「关闭通知权限，进入后没有系统询问是否允许通知，而是弹出：请在弹窗里允许通知…」；
「布局按钮周围为什么有阴影」）

### 一、拖拽进容器（设计页 + 布局页都做了）

原来的唯一入口是卡片右边那个 **⇲**（「放进容器」）小按钮，用户根本不知道，而且拖不动。

* **设计页**（`bindCardReorder`）：长按卡片起拖后，被拖的卡片临时 `pointer-events:none`，
每帧用 `elementFromPoint` 看指针底下是哪张卡片（`拖到哪个容器`）：
命中容器卡片 **或容器里的子卡片** 都算落在这个容器上 → 给容器加 `.drop-in` 高亮（`标容器高亮`），
此时**不排位**（不参与换位动画），松手直接 `移入容器()`。松手后清高亮，`cardReorder.stop()` 防止残余 click 选中。
* **布局页**（`bindLitemDrag`）：同理（`指到的容器` / `高亮容器`）。松手时把手指位置按 `stageScale()` 换成舞台坐标，
以指针为中心放进容器（`移入容器()` 内部再减容器原点 + 按容器大小夹住），所以控件就落在松手的地方，
而不是留在原来的屏幕坐标。只在顶层控件上生效（子控件仍只在容器内移动）。
* CSS：`.compcard.drop-in`（淡紫底 + 2px 主色内描边）、`.litem.drop-in`（3px 实线主色 + 淡紫底）。

### 二、修了一个真 bug：容器里的控件会被生成重复 id

回归第二次跑出来的：把 `button1` 放进容器后再新建按钮，新按钮**还叫 `button1`**（同 id 撞车 → 事件/代码全串）。
根因：`genId()` 只遍历 `s.components`，**没进 `children`**。已改成递归扫子控件；
用例里加了「建一个新按钮，所有 id 去重后数量必须一致」的断言。

### 三、通知权限：不再一律说"去弹窗里允许"

用户报的现象：权限被关掉后点发通知，**没有系统弹窗**，只有那句"请在弹窗里允许通知，之后才会显示在通知栏"。
原因是安卓 13+ 被拒过一次（或勾了不再询问）后，系统**再也不会弹框**，那句话等于骗人。

* `MainActivity.askNotif()` 返回三种结果：

  * `allowed` —— 其实已经有权限了；
  * `dialog` —— 还能弹，`requestPermissions(...)` 已发出，并把这条通知存进 `pendingNotifTitle/Text`，
用户在 `onRequestPermissionsResult` 里点"允许"后**自动补发**；
  * `settings` —— 永久拒绝，直接 `openNotifSettings()` 跳到本应用的通知设置页。
  * 用 `PREF\_NOTIF` 里记一个 `asked` 标记来区分"从没问过"和"永久拒绝"（`shouldShowRequestPermissionRationale`）。
* `runtime.js` 的 `RT.notify` 按这三种回执分别处理：`allowed` 直接发、`dialog` 发出去并提示"允许后会补发"、
`settings` 提示"系统不会再弹授权框，已打开通知设置页，打开后回来再试一次"。
* 用例「阶段5」里加了假原生桥，三种回执各验一遍（settings 不许发、dialog 必须存待发、allowed 必须直接发）。

### 四、布局按钮去阴影

上一版把 `.run-split`（主色运行按钮，M3 里带投影）的样式整套抄给了 `.layout-split`，
于是顶栏只有「布局 + ▾」浮着一层投影，旁边「代码 / 导出 / 设置」都是平的。已删掉 `box-shadow` 那一行。

### 验证 / 发布

* `node --check`：`editor.js` / `runtime.js` / `cdp-test.mjs` 全过；`unit-comp-spec.mjs` **23/23**；导出回归全绿；
`audit.mjs` 与 6.22 同基线（4 类已知项，无新增）。
* 全量回归 **169/169 全绿**（新增 1 条：拖拽进容器，含 id 不重名断言）。
* APK：`versionCode=251 / versionName=1.0.116.134`，`FAST\_v1.0.116.134.apk`
（**1,891,804 字节**，sha256 `3E085BDC9F1A119440D5D2A051B9F1793B89CCCFBBE2341E8A64A002772580A4`，v2/v3 签名 OK）。
* 「更新」表 row `FOOp4StsQ6KDI9Y\_Ob\_bKw`（下载 200、大小/哈希一致）；
「工程」表 row `BmezD9tkS2COIQtK2MKmTg`（`FAST-full-1.0.116.134.zip` **1032 条目 / 21,354,477 字节**，
备份 APK 自动改名 `FAST\_v1.0.116.134 (1).apk`）。
* GitHub Release **v1.0.116.134**（`dashen9178/Fast`，资产 1,891,804 字节 / digest 与本地一致）；
源码同步提交 `cd0bcca`（8 个文件：`editor.css`、`editor.js`、`runtime.js`、`cdp-test.mjs`、
`MainActivity.java`、`VERSION`、`NEXT.md`、规划文档）。
* 版本号已自增到 `252`（下次打包出 1.0.116.135）。

**下一步**：真机试三件——设计页长按卡片拖到容器上、布局页把控件拖进容器框、通知权限被关时点发通知
（应能弹系统框并补发，或跳到设置页）；之后按规划文档第 5 节往阶段 6 排。



## 6.24 2026-10-29 第四轮（控件默认尺寸 / 容器内外拖动 / 回首页查更新）

**用户原话**：「可以。把我发现拖进容器或者滚动区就无法拉出了。滚动区或容器里的控件建议可以长按对应控件，
拖动以改变在容器或者滚动区的位置。我发现有些控件一创建就占用大量画面，请你检查所有控件看看有没有开局就占用巨大的」

### 一、默认尺寸整体缩小（`comp-spec.js`）

* 38 种控件的 `nat`（新建时的初始尺寸）整体收紧：宽度上限 320、高度上限 160，最大的也只有 **320×160**；
`size`（兜底尺寸，编辑器 `defaultSize` / 运行时 `defaultBox` 共用）不动，保证布局页=运行时=导出仍一致。
* 回归里加了断言：真建 38 种控件，实测每种初始宽 ≤343 / 高 ≤207（含文字实测的误差余量）。

### 二、容器/滚动区里的控件能长按拖动改位置（设计页 + 布局页）

* 设计页：子卡片与顶层卡片是 `#compList` 的平级节点（`.compcard.is-child` 靠缩进表示层级），
`bindCardReorder(card, id, 父)` 支持兄弟换位、拖到另一张卡片上换位、拖出块边界回顶层（`移出容器`）。
* 布局页：子 `.litem` 的 `pointerdown` **必须 `stopPropagation`**，否则冒泡到父容器、父容器先 `setPointerCapture`
抢走指针 —— 现象就是「拖子控件，动的却是整个容器」（这轮抓到的）。
* 布局页拖出父框时**不再换父节点**：元素一旦离开文档，浏览器会立刻收回指针捕获，`pointerup` 就收不到
（用户看到「拖出去松手没反应」）。改成父框临时 `overflow:visible` + 抬层级（父 30 / 子 31），
DOM 不动、坐标继续相对父框（可为负），松手时加回父原点换算成舞台坐标，再 `移出容器`。
* `移出容器(childId, at)` 支持插入下标。

### 三、修了一个真 bug：默认属性被同类控件共用

`comp-spec.js` 里容器/滚动区的 `def` 是 `{ text:'容器', children: \[] }`，`addComponent` /
`aiApplyComponents` 直接 `base\[k] = def\[k]` → **所有容器共用一个 children 数组**，
新建的第二个容器会凭空带上第一个容器里的全部子控件。两处都改成 `clone(COMPONENT\_DEFAULTS\[...])`，
用例里加了「新建容器必须是 0 个子控件」的断言。

### 四、回首页按节流重查更新红点

`showHome()` 调 `后台查更新红点()`：10 分钟内不重复查；`openUpdateDialog()` 记「已看过这个版本」，
已看过的不再点亮。

### 验证 / 发布

* 全量回归 **171/171 全绿**；`unit-comp-spec.mjs` 23/23；导出回归全绿；`audit.mjs` 0 项待处理。
* APK：`versionCode=252 / versionName=1.0.116.135`，`FAST\_v1.0.116.135.apk`
（**1,895,900 字节**，sha256 `541BA9F100383F92A7C6A4E3F6EF829A94F7C6B9AADA24B3FDF24BE8D947E939`，v2/v3 签名 OK）。
* 「更新」表 row `E45wXVV3Tt2w5O9yziGFbw`（行文 `1.0.116.135（26.10.29.17:17）`，下载 200、大小/哈希一致）；
「工程」表 row `DQan5hRLTZuWPmNJtNU5BQ`（`FAST-full-1.0.116.135.zip` **1039 条目 / 21,330,039 字节**，下载大小一致）。
* GitHub Release **v1.0.116.135**（`dashen9178/fast`，资产 1,895,900 字节 / digest 一致）；源码同步提交 `1b21561e`。
* 版本号已自增到 `253`（下次打包出 1.0.116.136）。

### 发布链路这轮踩的坑（重要，别再绕）

* `app-upload-link/` 只认**主站 + `Token`**：走网关 / 用 `Bearer` 是 404 / 403（这轮实测）。
* 直连「更新」库那份令牌是**只读**的（写行 403），中转函数里的 `SEATABLE\_TOKEN\_UPDATE` 同样只读；
能写的是**账号库令牌**（`fc-deploy/fast-mail-deploy/s.yaml` 里 `SEATABLE\_TOKEN` 那一串；
脚本用环境变量 `FAST\_WRITE\_TOKEN` 传入，不落盘）。
* 同样是这个令牌，**PUT / DELETE 对「更新」库回 `403 invalid token`**（只有 POST 插入行能成）。
结果：验探时插入的一行 `\_\_probe\_\_`（row `bEnKaJ9cSjWNhGdu9WsP6Q`）删不掉，留在「工程」表最上面，
**下次去 SeaTable 网页里手工删一下**。
* 脚本：`pc-sim/publish-135.mjs`（读表直连、写行直连、下载校验走中转，参数化版本号）。

**下一步**：真机验三件事——新建容器不再带别人的子控件、容器内外互相拖、拖出容器后松手位置对得上；
然后去 SeaTable 手工删那行 `\_\_probe\_\_`。

## 6.25 2026-10-29 第五轮（容器透明 / 预览边框开关 / 预览菜单文案与顺序）

**用户原话**：「更改：容器控件颜色默认是透明的。在预览那个箭头选项栏增加一栏：控件在预览时是否显示边框？
是/否。更改那个如何预览那一栏的文案：选择你的预览方向，自动调整/强制横屏/强制竖屏，
我把横屏竖屏的选项调换了 因为我觉得这样更顺手。」

### 一、容器默认透明

* 设计页：`.litem.t-container` 不再白底，只留 1px 淡边（`#e0e0e0`）方便看出范围；空容器是虚线。
* 布局页/预览：`.lv-container` 同样透明 + 淡边。
* 运行时：`.comp.container` 透明、看不见边框，但**必须保留 `1px solid transparent`** ——
  子控件是按容器内容框定位的，去掉边框会让子控件整体偏 2px，「布局页 = 运行时 = 导出」的
  坐标一致性用例当场就挂（这轮亲手验过：14,14 vs 期望 16,16）。

### 二、预览下拉新增「控件在预览时是否显示边框？」（是 / 否）

* 新键 `__bb_preview_border`（localStorage），默认「否」；实现在 `editor.js`：
  `previewBorderOn / setPreviewBorder / syncPreviewBorderMenu / applyPreviewBorder`。
* 给 `#layStage` 加 `.show-border`，`editor.css` 里 `.lay-stage.show-border .litem` 描 1px 细线；
  **选中 / 拖动提示 / 隐藏控件仍然优先**（用 `:not()` 排掉）。
* 只影响布局页预览，不进运行时、不进导出。每次进布局页 `renderLayout()` 都会对齐一次开关。

### 三、预览下拉文案与顺序

* 标题改为「选择你的预览方向」，三项顺序改为 **自动调整 / 强制横屏 / 强制竖屏**（横屏在前，用户习惯）。
* 下方新增分隔线 + 「控件在预览时是否显示边框？」标题，选项 是 / 否。

### 验证 / 发布

* 全量回归 **171/171 全绿**（含新增的边框开/关断言、菜单顺序断言）；
  `unit-comp-spec.mjs` 23/23；导出回归全绿；`audit.mjs` 退出码 0（确定项仍是既有 4 类基线）。
* APK：`versionCode=253 / versionName=1.0.116.136`，`FAST\_v1.0.116.136.apk`
（**1,895,900 字节**，sha256 `AE4D21798482A74CF5415FC2E4A9E22CD5AE6249B434EA19D69ADF3CD3A89D3E`，v2/v3 签名 OK）。
* 「更新」表 row `aeDg7EFbSbafVFOZhqfNWg`（行文 `1.0.116.136（26.10.29.18:26）`，下载 200、大小/哈希一致）；
「工程」表 row `LQJkifFOQre6JZLqKeyAZA`（`FAST-full-1.0.116.136.zip` **1033 条目 / 21,336,401 字节**，下载大小一致）。
* GitHub Release **v1.0.116.136**（`dashen9178/fast`，资产 1,895,900 字节 / digest 与本地一致）；源码同步提交 `86b6849e`。
* 版本号已自增到 `254`（下次打包出 1.0.116.137）。

**下一步**：真机看三件事——容器透明后叠在别的控件上是否还看得清边界（需要的话开「显示边框」）、
预览下拉里横屏在前的顺手程度、导出后容器里子控件位置是否与布局页完全对齐。

## 6.26 2026-10-29 第六轮（预览边框默认开 / 设置改整页 / 首页长按排序 / 更新日志，APK 1.0.116.137）

**用户原话**：「布局预览是否显示边框 默认为是。布局预览中，如果我选择了不显示边框，发现容器控件有边框显示，
请你检查全部控件，看看还有没有控件有类似的问题。在布局页面点击空白处后取消选中。在所有app这个页面中，
增加长按卡片调整位置。把"所有app"这个文字删了。设置修改：点击设置按钮后，进入一个全新页面，不再用小窗，
在设置页面左侧增加可选择的栏目分类来切换：常规/AI/反馈，增加更多界面个性化选择。加个设置：作品如何排序？
自动调整/不调整排序，默认自动调整。在检查更新页面，右上角增加更新日志，用于展示更新的内容。」

### 一、预览边框默认「是」+ 排查全部控件的幽灵边框

* `previewBorderOn()` 改成「只认显式存下的 `'0'` 才是关，没存过一律开」（原来默认否）。
* 用户报的根因：`.litem.t-container` 自己带 `1px #e0e0e0`，而 `.show-border` 只管 `outline` ——
  所以开关关掉后容器照样有框。现在 `.litem.t-container` 改成 `border: 1px solid transparent`，
  只有 `.lay-stage.show-border` 时才把边框色改成 `#e0e0e0`；空容器仍是虚线。
* 顺带查出并修掉的同类问题：徽章（`.lv-badge` / `.litem.t-badge`）原先自带灰框 + 白底，
  而运行时 `.rt-badge` 是透明无框 —— 预览和运行时不一致，已对齐。
* 其余带边框的控件（输入框、图片、标签页、折叠面板、多选、取色器、日期区间、卡片、表格、画布）
  在 `runtime.css` 里都有对应实体边框，属真实外观，**保持不动**（关掉的是"预览辅助线"，不是控件本身的样子）。

### 二、布局页点空白处取消选中

`bindLayoutChrome()` 给 `#viewLayout` 挂 `pointerdown`：目标不是 `.litem / .li-rs / button / 菜单 / 输入框`
就把 `selectedCompId` 清掉、删掉八向控制点、去掉 `.sel`、收起 `#layFab`、重画右侧面板。
用 `pointerdown` 而不是 `click`：拖控件松手会补一个 `click`，那样会误取消刚选中的控件。

### 三、首页长按卡片调整顺序 + 去掉「所有 App」文字

* 新键 `__bb_proj_sort`（`auto` / `manual`，默认 `auto`）。`renderHome()` 按它决定是否按 `updatedAt` 倒序。
* `bindHomeReorder(card, id)`：`pointerdown` 起 480ms 定时器 → 长按起拖；拖动中卡片 `position:fixed` 跟手，
  原位放 `.proj-slot` 占位，其余卡片用 2D FLIP 让位；松手读回 DOM 顺序写进 `items`、把排序切成 `manual` 并重画，
  第一次从自动转手动时 `snack` 提示「设置 → 常规 可改回自动调整」。
* 拖动期间必须挂非 passive 的 `touchmove` + `preventDefault()`，否则手指一动页面就跟着滚（`pointermove` 拦不住滚屏）。
* 删掉 `<div class="home-sub">所有 App</div>`，`#projectList` 补 `margin-top:16px` 保持间距；`#btnHome` 的 title 改成「回到首页」。

### 四、设置改成整页（常规 / AI / 反馈）

* 删掉 `#settingsMask` 小窗，换成 `#viewSettings.acct.set-page`（复用账号页的 `.acct` 布局：顶栏返回 + 左侧药丸分类 + 右侧内容）。
* 左侧 `#setRail` 三项 `data-cat=general|ai|feedback`，`setSettingsCat()` 切 pane 并同步滑块；
  右侧三个 pane：常规（主题色 / 明暗 / **作品如何排序** / **界面动画**）、AI（Key + 测试 + 状态）、反馈（诊断导出 / 联系方式 / 当前版本）。
* 新增「作品如何排序？自动调整 / 不调整排序」，默认自动调整（`__bb_proj_sort`）。
* 新增「界面动画 开启 / 关闭」，默认开启（`__bb_ui_anim`；关掉给 `body` 挂 `.no-anim`，老手机更跟手）。
* 打开时记住来源（首页 / 编辑器），返回回到原处；`__rtSystemBack` 先关设置页。

### 五、检查更新右上角「更新日志」

`#updateMask` 标题行加 `#updateLog` 按钮，点开 `#updLogMask` 弹窗，内容来自 `editor.js` 里的 `CHANGELOG`
（最近 5 版，新的在上；云端「更新」表没有正文列，所以写死在前端最省事，发版时加一条即可）。

### 验证 / 发布

* 全量回归 **174/174 全绿**（新增：设置整页分类切换 / 容器在「不显示边框」下无边框 / 首页长按拖动排序 /
  布局页点空白取消选中 / 更新日志弹窗）；`unit-comp-spec.mjs` 23/23；导出回归全绿；`audit.mjs` 退出码 0（确定项仍是既有 4 类基线）。
* APK：`versionCode=254 / versionName=1.0.116.137`，`FAST\_v1.0.116.137.apk`
（**1,899,996 字节**，sha256 `A7F5D1FDE57309FCB90E8CEDB091B10DC46EED905B1D3149410C4576BB4B8CEF`，v2/v3 签名 OK）。
* 「更新」表 row `I3TDXRssR9iJ0ybnPcSwlg`（行文 `1.0.116.137（26.10.29.19:30）`，下载 200、大小/哈希一致）；
「工程」表 row `MYOqBGjWTVGf5ZiCu_jwlg`（`FAST-full-1.0.116.137.zip` **1033 条目 / 21,345,768 字节**，下载大小/哈希一致）。
* GitHub Release **v1.0.116.137**（`dashen9178/fast`）；源码同步提交 `334e737d`（代码）+ `58776e5a`（NEXT.md 本文）。
* 版本号已自增到 `255`（下次打包出 1.0.116.138）。

## 6.27 2026-10-29 第七轮（首页拖动重做 / 设置页重排 / 诊断按钮 / 更新日志按钮 / 头像去预设，APK 1.0.116.138）

**用户原话**：「首页作品拖动，不要改变这个自动调整/手动调整。为什么首页作品拖动放下后会闪一下屏。
如果首页作品拖动卡片碰底就不能向下滑动。感觉首页拖动作品，手感很奇怪，那些卡片移动也非常奇怪。
在设置页面里面点其中一项，然后返回去，再点回设置页面，发现标签还是返回前的那一选中，但是页面变成了常规。
点击查看诊断信息发现没有反应。重新设计设置页面的UI布局，你简直就是直接生搬过来了，你能不能好好调整这些UI大小长度宽度。
更新那里，那个更新日志按钮是放在联系开发者的左边的，为什么你放在中间。个人信息那里更换头像，把那几个默认头像删了。」

### 一、首页拖动：不改排序设置 / 不闪屏 / 拖到边缘能滚 / 手感重做

`bindHomeReorder()` 整段重写（`editor.js` 约 1903-2050）：

* **不改设置**：松手只读 DOM 顺序写回 `s.items` 再 `saveStore`，**不再**把 `__bb_proj_sort` 改成 `'manual'`，也不再弹「设置里可改回自动」的提示。
* **不闪屏**：原来松手会 `renderHome()` 整页重画（错峰动画重播 = 闪一下）。现在改成「把卡片 `insertBefore` 插回占位块的位置 → 删占位 → 清掉所有 `.proj-shift`/内联 transform」，一次布局不重画。
* **边缘自动滚屏**：`滚一步()` 用 `requestAnimationFrame` 循环，`#viewHome` 作滚动容器，上下边距 `边 = clamp(70..130, 高*.16)`、速度 6~22px/帧；手指停在边缘就持续滚，同时重算插入点。以前卡片一到底就顶住了，因为那个算法只在 `pointermove` 里算，手指不动就不再触发。
* **手感**：新插入点算法改成「先找中心离手指最近的卡（纵向权重 1.4），再按它上下/左右决定插在它前还是后」，替掉原来逐张判「上半部分 / 同一行左半边」——那个算法在同一行时总被第一张卡吃掉，表现为「卡片乱跳、位置对不上手指」。
* **移动动画**：其余卡片让位走 2D FLIP，只给 `transform` 加 `.proj-shift { transition: transform .16s cubic-bezier(.2,0,0,1) }`，量完前后位置差直接写 transform，双 rAF 后清掉内联 transform 换回过渡类；原位占位块 `.proj-slot` 改成淡底色 + 虚线（原来是和卡片一样的实心块，看着像多了一张卡）。

### 二、设置页：左侧标签与右侧内容不再错位

* 新增 `上次设置分类`（默认 `general`）：`setSettingsCat()` 每次切换记一笔，`openSettings()` 不带参数时回到上次那一栏；所以「点反馈 → 返回 → 再进设置」标签和内容都是反馈。
* 根因是滑块在页面 `hidden` 时量不到尺寸（`位置()` 返回 null，药丸停在旧坐标）。现在 `openSettings()` 显示页面后补一次 `同步分段药丸()`，再在下一帧补一次。

### 三、「查看诊断信息」点了没反应

`wireDiag()` 原来只在「打开工程、初始化画布」那条路径里被调用，从首页直接进设置时按钮根本没绑上事件。抽出幂等的 `wireDiagBtn()`（`btn.__diagWired` 防重复绑），`init` 里也调一次。点它现在会先收起设置页再弹诊断浮层。

### 四、设置页 UI 重新排版（不再照搬账号页）

`.set-page` 单独一套尺寸，全部写进 `editor.css`：顶栏 56px；左栏 128px（窄屏 92px）、条目 44px（窄屏 40px）、圆角 12、条目间距 6；右内容区 `padding 22px 26px 40px`、`max-width 680` 居中；每个分组变成 16px 圆角的卡片（`--c-low` 底、内边距 16/18），分组间距 16；分段按钮高 40、圆角 999；窄屏（≤560px）和矮屏（≤480px）各有一档降级。回归里加了「各组宽度一致（max-min ≤ 1）」「没有分组被挤扁（宽<150 或 高<20）」的断言，防止再退化成硬搬。

### 五、检查更新：更新日志按钮回到联系开发者左边

`#updateMask` 标题行把两个按钮包进 `.upd-title-btns`（`margin-left:auto`、`gap:8px`、`flex:0 0 auto`）。原来是两个按钮各占 `space-between` 的一格，所以「更新日志」被顶到了中间。回归断言 `更新日志.right <= 联系开发者.left` 且「联系开发者」右边距弹窗右边 ≤48px。

### 六、个人信息更换头像去掉默认头像

删掉 `PICK_PRESETS` 与那几个色块按钮，`openPick()` 只保留「从相册选」和「清除头像」（清除只对头像显示），弹窗标题改成「更换头像」。

### 验证 / 发布

* 全量回归 **176/176 全绿**（新增：设置重新进入时左侧标签/右侧内容/滑块三者对齐、设置里点「查看/导出诊断信息」能弹出内容；更新日志用例补「按钮位置」断言、排序用例改成「拖动**不许**改 `__bb_proj_sort`」）。
* `node --check editor.js` / `cdp-test.mjs` 通过；`unit-comp-spec.mjs` 23/23；导出回归全绿（todo/land 包名、签名、对齐、入口均 OK）；`audit.mjs` 与 6.26 同基线（4 类已知项，无新增）。
* APK：`versionCode=255 / versionName=1.0.116.138`，`FAST\_v1.0.116.138.apk`
（**1,904,092 字节**，sha256 `88B4C9BE2BDF56BEDA207D8DF07ECEA1191D3285D17EDA362D0051F7BB62535E`，v2/v3 签名 OK）。
* 「更新」表 row `ZqfmXGMPT8y2oSNFp1letQ`（行文 `1.0.116.138（26.10.29.20:39）`，下载 200、大小/哈希一致）；
「工程」表 row `DsXxbuVTRDGjS9UdC66MVQ`（`FAST-full-1.0.116.138.zip` **1033 条目 / 21,351,248 字节**，下载大小/哈希一致，zip sha256 `176FA7DDE6A63564F30384CC503AE88979788954B60523EE1BFE3BAF949621DF`）。
* GitHub Release **v1.0.116.138**（`dashen9178/fast`）；源码同步提交 `7ad11b69`（代码 + 本文初稿），NEXT.md 的最后一次修订单独提交。
* 版本号已自增到 `256`（下次打包出 1.0.116.139）。

## 7\. 新会话怎么开口（给用户的话）

> 读 `D:\\DSH工作\\Fast\\fast\_project\_v2\\NEXT.md`，然后接着干：<你要做的事>

