# FAST 工程交接说明（给下一个会话的我自己）

> 用途：新开会话时，先读这个文件，就能接着干活，**不需要**翻之前那条超长对话。
> 读法建议：让助手先读本文件，再看需要改的具体代码。

## 1. 这是什么、在哪儿
- 安卓可视化编程编辑器 FAST（WebView + Blockly 10 UMD，`fastzelos` 渲染器），用户是非技术人员，**所有回复用中文、说人话**。
- **当前工程**：`D:\DSH工作\Fast\fast_project_v2`（唯一要改的目录）
- **旧工程备份**：`D:\DSH工作\Fast\fast_project`（**不要动**）
- 关键文件：`assets\www\editor.js`（单闭包，1.1 万行上下，账号页/社区都在这里）、`editor.html`、`editor.css`、`blocks.js`、`runtime.js/.html/.css`；原生：`src\com\doubao\blockbuilder\MainActivity.java`；导出链：`Exporter.java`、`AxmlRewriter.java`、`DerX509.java`、`DeviceKey.java`。

## 2. 常用命令（都在工程目录下跑）
- **⚠️ 2026-09-26 事故：`pc-sim\cdp-test.mjs` 被我写坏了。**
  我用 PowerShell 的 `Get-Content -Raw` + `Set-Content -Encoding utf8` 就地改这个文件 ——
  PS 5.1 读**无 BOM** 的 UTF-8 文件时按 **ANSI(936/GBK)** 解码，再按 UTF-8 写回，
  于是**全文中文变乱码**。而且这不是简单可逆的：中文 UTF-8 是 3 字节、GBK 是 2 字节，
  对不齐；遇到「中文后紧跟 ASCII」时 GBK 解码器会把那个 ASCII 字节当非法尾字节**吃掉**，
  表现为 `'` 变 `?`、`(` 消失 → 语法错误。全文约几百处。
  - 已回退成 **git HEAD 的干净版本**（`pc-sim\cdp-test.mjs`，377770 字节，语法 OK，跑出来 **153 通过 / 1 失败**）。
    坏的那份留档 `pc-sim\cdp-test.mjs.damaged`；研究/修复脚本 `pc-sim\recover*.mjs|ps1`、`patch-lines.mjs`、`autofix.mjs`、`check.mjs`、`dump-head.mjs`。
  - **本会话新增的那批用例（社区/发布/发码/原生桥并发）在 HEAD 版里没有，需要重写。**
    其中「中转打包规则」已经用更靠谱的方式补上了：`pc-sim\unit-pack.mjs`（见下）。
  - **规矩：改 `pc-sim\*.mjs`、`assets\www\*.js` 一律用文件编辑工具；绝不用 PowerShell 的
    `Get-Content`/`Set-Content`/`Out-File` 就地读写带中文的文件。**
    推论：`git show HEAD:<path> | Out-File` 同样会写成乱码 —— 用 `pc-sim\dump-head.mjs` 导出。
- **中转打包规则单测**：`node pc-sim\unit-pack.mjs assets\www\editor.js`（13 项，直接抽出
  `editor.js` 里的 `打包中转请求()` 跑真代码，不经浏览器）。
  为什么必须有它：浏览器回归的假网络装在 `authHttp` 那层，**比 `editorCloudHttp` 的打包更早**，
  永远看不到打包做了什么 —— 打包写错时所有用例照样全绿，而线上发码直接挂。这个盲区就是这么来的。
- 全回归：`powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-ui-test.ps1`
  - 结果看 `%TEMP%\fast-ui-test\test-output.txt` 的「通过/失败」计数；判断以「结果：全部通过 ✓」为准（脚本退出码 1 有时只是 javac 弃用提示）。
  - **最近一次（2026-10-27）：154 通过 / 0 失败，全绿。**
    - 原遗留失败项「导入成功后有提示弹窗」已查明并修好：分享早改成先弹选择面板（社区/社交平台/本地），
      用例却只点卡片分享钮就等 `__lastSharePayload`，永远等不到 → 补了一步点「分享到社交平台」（cdp-test.mjs）。
  - **⚠️ 2026-10-27 新踩的坑（ps1 的 BOM）**：`pc-sim\*.ps1` 一旦**丢了 UTF-8 BOM**，PowerShell 5.1 会按
    GBK 读中文注释 → 整行错位 → 脚本报 `Unexpected token '}'` 直接跑不起来（run-ui-test.ps1 就这样挂过）。
    已给所有含中文的 ps1 补回 BOM。**改/存这些 ps1 时务必保留 BOM**；排查时先看文件头 3 字节是不是 `EF BB BF`。
- 打 APK：`powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1` → 产物 `D:\DSH工作\fastapk\FAST_v<版本>.apk`（版本号自动 +1）
  - C 盘紧张会让构建失败：`%TEMP%` 下我自己的 `edge-probe*`、`edge-dbg-*`、`*.dmp` 可以直接删（实测腾出 ~2 GB）。
    `tuanjiehub-*`、`itwochug`、`FabLibrary`、`DefaultCompany` 是用户别的软件的，**别动**。
- 导出链路自测：`powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-export-test.ps1`（用真代码跑导出，验签名/对齐/清单）
- **线上中转函数自测**（三个，都应 0 失败）：
  - `node pc-sim\verify-v5-live.mjs`（22 项，按客户端真实请求形状打真表）
  - `node pc-sim\verify-v7-live.mjs`（10 项，**真实 HTTP 方法** PUT/DELETE 打真表）
  - `node pc-sim\verify-v9-live.mjs`（7 项，密码列已摘 + 发码全局限流真的拦得住）
- **全代码机械扫描**：`node pc-sim\audit.mjs`。只报"能确定是问题"的几类，不猜：
  重复 id、JS 引用了不存在的 id（**已自动跳过注释**，否则注释里提到的 id 会假阳性）、
  同名函数重复声明、动态执行代码位置、innerHTML 拼变量、硬编码凭据、JSON.parse 有没有 try。
  改完大改动后顺手跑一次。**注意：它用相对路径，必须在工程根目录跑，否则读不到文件全是假绿。**
- **🔴 2026-10-27「检查更新 / 社区都取不到数据」的根因 = 阿里云欠费停机，不是代码 bug。**
  实测：中转函数任何请求都回 `403 {"Code":"AccessDenied","Message":"Current user is in debt."}`，
  而 SeaTable 本身鉴权正常（200）。账号/社区/更新全走这一个函数，所以三处一起挂。
  **解决办法只有一个：给阿里云账号（15768018901）充值**，函数自动恢复，无需改代码、无需重新部署。
  已顺手做的：`editorCloudHttp.interpret` 现在认得阿里云 `{Code,Message}` 错误，欠费时给用户显示
  「云服务欠费停机，请联系开发者」而不是一句看不懂的「请求失败 HTTP 403」。
  排查口诀：先 `node pc-sim\probe-update.mjs` 打中转看状态码，403+in debt 就是欠费。
- **深色模式自测**：`powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-dark.ps1`
  → `pc-sim\verify-dark.mjs`：切深色后读**画布实际填充色**，断言不是白的。
  （判定取色时一定把值取成**字符串** —— 之前返回对象，判了个 `[object Object]`，等于没判，踩过。）
- **代码栏（分类栏）取证**：`powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-shot.ps1`
  → `pc-sim\shot-rail.mjs`：只拍分类栏并放大 4 倍，同时把选中项的计算样式打出来；
  第 5 步专门走"点空白取消"那条路。**肉眼判断颜色不可靠，看它输出的 rgb。**
  另外：**别用 CDP 注入鼠标事件去点画布**验这个，会触发 Blockly 其它交互把脚本卡死（踩过）。
- **账号页作品顺序自测**：`powershell -NoProfile -ExecutionPolicy Bypass -File pc-sim\run-verify.ps1`
  → `pc-sim\verify-mine.mjs`（假网络造 3 件分享，断言最新在最上）。
- 发文件给用户（**优先用 `share-file-to-phone` 技能**）：
  1. 起服务：`powershell -NoProfile -ExecutionPolicy Bypass -File "D:\DSH-Data\skills\share-file-to-phone\scripts\share.ps1" -Path "<文件>"`（它会起 8899 静态服务并自动校验下载）
  2. **要稳定域名就再挂 cloudflared**：`& D:\DSH工作\tools\cloudflared.exe tunnel --url http://127.0.0.1:8899 --no-autoupdate`
     （cloudflared 域名在进程存活期间不变；localhost.run 约 20 分钟掉线且换域名 —— **发 APK 别只给后者**）
  3. **发链接前必须完整下载比对**：`Invoke-WebRequest -OutFile` + `Get-FileHash … SHA256`，和本地一致才发。
     局域网地址、未校验的链接都不要发（用户明确要求过）。
  4. 停："停掉所有后台任务" = 杀 cloudflared + `share.ps1 -Stop` + 无头 Edge（**别杀 DSH Desktop 主程序，那是界面本身**）
- 临时文件坑：`assets\www` 下的 `*.bak_before_fix`、`*.syntaxchunk.js`、`_syntaxcheck.js` 会被**打进 APK**（白胖 25 万字节），开工/收工都要清一遍。
- JS 语法自检：`node --check assets\www\editor.js`（便携 Node：`D:\DSH工作\tools\node\node-v22.14.0-win-x64\node.exe`；机器上的 `node` 不一定在 PATH 里）

## 3. 硬规矩（每次都要守）1. **改完必须自己跑一遍全回归，必须全绿**；再打 APK，并**完整下载比对 sha256**（公网 + 局域网两个链接都验）才发给用户。
2. **APK 直链发，不要套压缩包**（用户明确要求）。
3. **绝不往「Fast」那张 SeaTable 表（更新 / 工程）写任何东西**（放 APK/工程包）；社区/账号两张表允许写，但**测试数据用完必须删干净**。
4. 不碰 `keys\`（签名密钥）、不改 `Exporter.java` / `DerX509.java` / `build.ps1` 的签名逻辑。
5. 文案用「代码」不用「积木」；**不加无意义提示**；界面中文。
6. 不变量：布局页 = 运行时 = 导出 三处坐标一致；AI 只改当前页面；API Key 只存本机。
7. 上下文省着用：日志只打尾部/条数；**大活儿交给空手 subagent**（它上下文小、更省），我这边只做验收 + 构建 + 交付。

## 4. SeaTable 事实（都是真表实测出来的）
- 基础表 UUID：`712bc4e0-a7b0-48ff-b5ea-098ce7eb3252`；API Token：`66303f1bc…`（**完整值只存在函数环境变量
  `SEATABLE_TOKEN` 和 SeaTable 控制台里，本仓库是公开的，别再写全文**）；服务器 `https://cloud.seatable.cn`。
  取令牌：`GET /api/v2.1/dtable/app-access-token/`（头 `Authorization: Token <token>`）→ 拿 `dtable_server`（`/api-gateway/`）+ `access_token`，后续用 `Bearer`。
- 表「账号」列：`用户邮箱`、`账号名`、`头像`(image)、`作品iD`(**小写 i 大写 D**)、`作品`(file)
  - 注意：账号表里还有一列 `用户密码`（老方案的加盐哈希），**代码里已经一次都不引用**。
    中转 v8 起在出站处统一摘掉它（`_strip_secret_cols`）。别再把它加回返回里。
- 表「社区」列：`用户名`、`作品`(file)、`作品图`(image)、`是否开源`(single-select)、`作品名`、`作品iD`、`用户邮箱`
- 读行**必须带 `&convert_keys=true`**，否则只回列 key（`row['用户邮箱']` 会是 undefined → 登录会反复新建行、社区永远空）。
- 写行（新增）：`POST .../rows/`，body `{table_name, rows:[{列名:值}]}`（**必须用中文列名**，用 key 会插入 0 行）。
- 改行（唯一正确形状）：`PUT .../rows/`，body `{table_name, updates:[{ row_id, row:{列名:值} }]}`。
  - 用 `rows` → 400 `missing updates field`；行号写 `_id` → 400 `invalid row_id field`；**值和 row_id 平级 → 200 但一个字都不改**。
- 文件/图片列：写官方完整路径 `/workspace/<workspace_id>/asset/<uuid>/{images|files}/2026-09/<文件名>`；`作品`(file) 必须写对象数组 `[{name,size,type,url}]`，字符串数组会被丢空。
- **取文件/图片只认相对路径**（`files/2026-09/x.fast`），带 `/workspace/…`、`/asset/…` 前缀一律 "path not found"；显示图片改走 `app-download-link/?path=相对路径` 拿可访问地址。
- 上传：`GET /api/v2.1/dtable/app-upload-link/` → `POST {upload_link}`（multipart，`parent_dir`/`relative_path`/`file`），返回只有 `{id,name,size}`，**url 要自己拼**。
- 阿里云 FC（邮箱验证码）：`MAIL_BASE='https://fast-mail-code-uzzxqcntro.cn-hangzhou.fcapp.run'`、
  `MAIL_APP_TOKEN='ed50ad9e…'`（**完整值在 `editor.js` 的 `MAIL_APP_TOKEN` 常量与函数环境变量里，
  它是随 APK 分发的口令、不是账号密钥，但也别再往文档里写全**），`mailSend/mailVerify` 已在 `editor.js`。

## 5. 产品口径（用户确认过的，别再猜）
- **登录**：邮箱 + 6 位验证码；**没有注册按钮**——表里没有这个邮箱就自动建档登录。登录态用表里的邮箱写法（大小写不会变两个账号）。
- **账号页**：点账号按钮（已登录）进独立页面：左侧窄列表「个人信息 / 社区」。
  - 个人信息：头像（上传，>100KB 先压）、账号名（可改，**重名不给改，大小写不同不算重复**）、用户邮箱（可改：**先给新邮箱发验证码**，作品不迁移）；下面「我分享到社区的作品」。
  - **退出登录要有二次确认**。
- **通知栏**：进软件 / 点运行都**先检查权限**，**只有在没有权限时**才弹（弹**系统**授权框）；系统框弹过还不行为才给「去设置」弹窗（按钮直达系统通知设置页）。有权限什么都不弹。
- **运行**：结束方式只有通知栏卡片（《作品名》正在运行中 + 终止运行）；**去掉 App 自己那套边缘侧滑退出运行**，但**不拦触摸**（作品里的滑屏照常）、**不禁系统返回手势/返回键**。
  - 从**编辑器**运行 → 结束回编辑器；从**社区**运行 → 结束回社区那一栏。
- **社区**：未登录也能浏览/运行；**只有登录才能发布**。卡片**两列**、**小卡**（左小图标 + 右详情）、最新在上、进社区**自动刷新**、底部加载更多。
  - `运行`：直接跑（运行前提示「如何结束运行？下滑通知栏点终止按钮即可」，带**不再提示**，独立 localStorage key）。
  - `保存本地`：**先弹二选一**——「保存到手机」/「在编辑器生成一个副本」（**不加说明小字**）。**未开源时置灰**；`运行` 不受开源限制。
  - **开源** = 别人能下载 `.fast`；不开源只能运行。
- **分享按钮**（作品卡片右上角）→ 弹窗：三个大框**横排一行**（分享到社区 / 分享到社交平台 / 保存在本地）+ **关闭按钮在右下角**，**弹窗不出现滚动条**。
  - 分享到社区 → 弹窗：**只允许用户自己上传图标**（没有"默认图标"那套；没上传不给发布）、作品名称、是否开源 → 发布。
  - 发布后卡片上分享按钮**左边出现「管理」**：改图标/名字/开源 + 「更新」（**覆盖社区同一条**）+ 「删除分享」（删社区那行 + 从账号行移除 + 本地作品保留 + 管理按钮隐藏）。
  - **作品iD**：首次发布生成，存在作品数据里，改名不变；**账号表一个账号永远只有一行**（多个作品只改这一行，绝不新增行）。
  - **作品图标和账号头像必须完全独立**；分享到社区时选的图标也用于导出作品。
  - **复制/导入别人的作品时，必须清掉带过来的 作品iD**（否则副本会冒「管理」按钮，还会覆盖原作者那一条）。
- **「分享到社交平台」**= 微信/QQ 系统分享面板（**不要**再弹「文件同时存到了…」那种提示；它内部必然往"下载/fast本地app"放一份副本，这是微信读不到私有目录导致的，改不掉）。
- **「保存在本地」**：只写一次文件、只提示一次（原生 `saveProject`，不弹分享面板）。

## 6. 进行中 / 待办
- **✅ 2026-09-26 已解决：云中转函数部署上去了，账号/社区读写在真表上端到端全绿。**
  - 部署方式（终于走通，记下来别再折腾）：
    `npm i -g @serverless-devs/s`（用便携 Node：`D:\DSH工作\tools\node\node-v22.14.0-win-x64`）
    → `s config add --AccessKeyID … --AccessKeySecret … -a fcdeploy -f`
    → 用 `s cli fc3 sync --region cn-hangzhou --function-name fast-mail-code --target-dir ./clone -a fcdeploy`
    把**线上真实配置**拉成 s.yaml（省得手写漏配置 / 弄丢环境变量）
    → 工程在 `fc-deploy\fast-mail-deploy\`（`s.yaml` 的 `code:` 指向 `./code`，`code/index.py` 是待部署的代码）
    → `s deploy -a fcdeploy -y`。
    - **注意**：`s.yaml` 里的 `triggers:` 段要**删掉**，否则每次部署最后一步必报
      `TriggerName is required but not provided`；删掉后不碰线上触发器，报错消失（代码其实已经更新成功，但别留这种噪音）。
    - 部署完先看 `https://fast-mail-code-uzzxqcntro.cn-hangzhou.fcapp.run/healthz` 的 `func_version` 确认版本落地。
    - 手工签名 Aliyun OpenAPI 走不通（FC 2.0 只认 REST 路径签名，RPC 签名回 InvalidVersion；穷举 10 种 STS 格式均 400）。
      **别再去手搓签名**，直接用 serverless-devs。
  - 函数版本演进：v4 = 只有读；v5 = 支持写行/上传 + `p/q` 解码；v6 = 修掉 convert_keys 丢失；
    **v7 = 补上 `do_PUT` / `do_DELETE` / `do_PATCH`（当前线上）**。
  - **v7 修的真 bug（用户截图「发布到社区 请求失败 HTTP 501」的根因）**：
    函数里只有 `do_GET` / `do_POST`，而 Python 的 `BaseHTTPRequestHandler` 对**没有 `do_XXX` 的方法
    直接回 `501 Unsupported method`，根本进不到我们的代码**（所以函数 `/echo` 的最近请求里
    连一条写行都没有 —— 这就是定位线索）。
    而 App 的 `editorCloudHttp` 是**用真实 HTTP 方法**发的（只把业务体打包进 `b`）：
    新增行 POST ✅、**改行 PUT ❌ 501**、**删行/删除分享 DELETE ❌ 501**。
    「发布到社区」新增社区那一行会成功，紧接着同步「账号」行的 PUT 就 501
    —— 用户看到的就是那句「请求失败 HTTP 501」。
    **自测为什么漏了**：v5 那次我是用「POST /api + body 里 `m=PUT`」验的，那条路当然通。
    **教训：自测必须照客户端真实的 HTTP 方法发。** 已补 `pc-sim\verify-v7-live.mjs`（10 项，真 PUT/DELETE 打真表）。
  - 线上实测脚本：`node pc-sim\verify-v7-live.mjs`（真实 HTTP 方法）/ `node pc-sim\verify-v5-live.mjs`（打包形状 22 项）
    / `node pc-sim\unit-pack.mjs assets\www\editor.js`（打包规则 13 项）。三个都应为 0 失败。
  - **v6 修的真 bug（「社区卡片全是未命名/作者匿名」的根因，之前一直没找对）**：
    客户端把「整条路径 + 查询串」放进 `p`（`/api?p=/api/v2/dtables/…/rows/?table_name=社区&limit=1000&convert_keys=true`），
    而函数那边用 `parse_qs` 解外层查询串 —— 里面的第一个 `&` 被当成参数分隔符，`p` 被**截断**成 `…?table_name=社区`，
    `limit` / `convert_keys` 全丢。SeaTable 于是按列 key 返回（`0000` / `020Y` 四位乱码），
    `editor.js` 里 `row['作品名']`、`row['用户名']` 全是 undefined → 卡片一律「未命名 / 作者：匿名」。
    对照实测：直达路径 `/api/v2/dtables/…` 正常、走 `/api?p=…` 就丢参数 —— 差别只在这里。
    修法：新增 `_raw_p()`，`p` 按「`p=` 之后到结尾」命令式取（末尾的 `u=`/`t=` 切掉），不再过 `parse_qs`。
    **客户端故意不改成编码形式**：两端同时改会变成双重解码，只改函数最稳，而且**已装在手机上的旧版 App 不用重装就好了**。
  - 线上端到端实测脚本：`pc-sim\verify-v5-live.mjs`（**22/22 通过，2026-09-26**）。
    完全按 `editor.js` 的真实请求形状发，覆盖：换令牌 → 读「社区」（校验回的是**中文列名**）→ 读「账号」
    → 取上传地址 → 二进制 multipart 上传（`b` 走 latin-1 打包）→ 写行 → 读回校验 → 改行 → 删行 → 附件下载（`?t=` 口令）。
    - **踩坑记录**：写行/改行/删行的 `b` 必须是**对象**（`editorCloudHttp` 第 519 行打包的就是对象）；
      传成**字符串**会走 latin-1 二进制通道，中文被 `encode("latin-1","ignore")` 丢掉
      → `{"error_message":"table_id or table_name invalid"}`。测的时候别写错形状。
    - 实测完的临时行会在脚本里**自己删干净**（社区表跑完仍是原行数）。
- **2026-09-26 用户报的三件事（已改完并验证）**：
  1. **账号页「我分享到社区的作品」最新在最上** —— 原来按账号表「作品iD」的追加顺序画（=最老在上）。
     排序放在 `画我的分享()` 里（不是数据源头）：正常路径和「读失败用本地缓存顶上」那条路都过它，
     连旧缓存也会被排对。口径和社区列表一致（`timeOfRow` 倒序，兜底 `sidTime`）。
     验证脚本：`pc-sim\verify-mine.mjs`（造 3 件分享，断言渲染顺序 = 最新/中/最老）。
  2. **代码栏选中态不像 M3（我自己上一轮删错的）** —— 加滑块时我把三条 `.bb-cat.on` 样式整块替换掉了，
     只剩一个底色：文字不变深不加粗、图标方块不变实心。已按 HEAD 原样补回：
     `.bb-cat.on{background}` / `.bb-cat.on .bb-cat-lb{color;font-weight:700}` / `.bb-cat.on .bb-cat-ico{实心}`。
     **别再把这三条删掉**（当时删了能过回归，因为老用例不查颜色）。
  3. **代码栏取消选中"还有一层，然后消失"** —— 滑块原来是把 `width` 缩到 0（从右往左收，看着像残留一层）。
     改成**淡出**：保留几何、只把 `opacity` 归零。CSS/JS 都加了 opacity 过渡。
- **主题色「容器色」偏灰的根因（用户报"选中底色不符合 M3 风格"）**：
  `tone()` 走 HSL，而 HSL 的饱和度在**浅色端撑不起 M3 需要的色度** ——
  `tone(H,S,90)` 算出来是灰紫 `#E3E1EA`，M3 基线 `secondary-container` 是 `#E8DEF8`。
  整个软件的"选中底色/浅色药丸"都受影响。
  改法（`applyTheme` 里）：容器色（`-c` 那一族）**不再用 `tone()` 算**，
  改成「拿 M3 官方基线色当模板，只按种子色相旋转」（`换色()`）：默认种子出来就是标准 M3 配色，
  换别的主题色只是整片色相平移。**只改了容器族**，`--primary`/`--tertiary`/surface 维持原算法，
  免得动了按钮和整页底色。
- **顺手发现（未修，测试脚本的事）**：`pc-sim\cdp-test.mjs` 的用例「导入成功后有提示弹窗」
  是**过期断言** —— `editor.html` 里根本没有导入弹窗节点（导入现在是 snackbar），这条永远红。
  它是 HEAD 版用例里唯一的失败项（153 通过 / 1 失败），与本轮改动无关。
- **分类栏/账号页的取证脚本（以后调 UI 颜色直接用它）**：
  - `pc-sim\shot-rail.mjs` + `run-shot.ps1`：新建 App → 进代码页 → 选中/取消选中分类，
    **只拍分类栏并放大 4 倍**，同时把选中项的计算样式（标签色/字重、图标底色、滑块位置与透明度）打出来。
    判断"颜色对不对"别靠肉眼猜，看它输出的 rgb 值。
  - `pc-sim\verify-mine.mjs` + `run-verify.ps1`：账号页作品顺序验证（假网络，不碰真表）。
  - 三个 runner 都是由 `run-ui-test.ps1` 换脚本名生成的，改端口/截图目录照旧。
- **最近已交付：`1.0.116.110`**（`D:\DSH工作\fastapk\FAST_v1.0.116.110.apk`，1813849 字节，
  sha256 `1FAFBD111C93AEF3247036F6720775190F28587D5039D5194FA742BCCC723317`）。
  备退：106 / 107 / 108 / 109。各版 build 自检「不含任何 SeaTable 凭据」都通过。
  **⚠️ 判断"APK 里到底有没有装进去改动"不能只看字节数** —— 106~110 五版**总字节数完全一样**，
  但用 .NET `ZipFile` 抽出 `assets/www/editor.js` 比 sha256，是和源码一致的（字节数撞车纯属压缩巧合）。
  以后打完包想确认，就跑这条：抽 `assets/www/editor.js` + `editor.css` 和源码比 sha256。
- **选中滑块的三种运动（1.0.116.110 定稿，别再混）**：
  | 情形 | 行为 |
  |---|---|
  | 之前**没有落点**（刚进来 / 刚取消过 / 位置不可知） | **原地淡入**，绝不许滑 |
  | 之前**已经有落点**（从 A 换到 B） | **滑过去** |
  | 一个都没选（取消） | **立刻消失** |
  - 用户 2026-09-26 报的"未选中时点击会凭空划过来"就是第 1 种被当成了第 2 种：
    当时用 `!中 || __脏` 判"直接出现"，但**取消了之后再点**时 `!中` 不成立、`__脏` 也是 false，
    于是它从上次那条的位置一路划过来 —— 现在用一个闭包变量 `上次在某一条上`（取消时置 false）来判。
  - **配套改动（不能漏）**：`clearRailActive(保留)` 支持"保留某一条"，分类按钮的 click 里改成
    **先给新的加 `.on`、再 `clearRailActive(b)` 清旧的**。原来是先清（那一瞬间"一个都没选中"，
    滑块收到隐藏信号）再加新的 → 即使有落点也会退化成"凭空滑过来"。
  - 取证：`shot-rail.mjs` 第 8 步 —— 在**点击的同一个 tick** 里量滑块位置来判别是"淡入"还是"滑动"：
    没落点时它必须已经在目标条目上；换分类时它必须还在旧条目上。
  - **踩坑**：`run-ui-test.ps1` 系列脚本已加"端口被占用就直接退出"的守卫。端口被上一轮残留的
    无头 Edge 占着时，新一轮 Edge 会自己换随机端口，而脚本照旧连 9222 →
    连到上一轮那个快死的页面，报满屏 `Blockly is not defined`，看起来像"改动把编辑器搞崩了"（实测被骗过一轮）。
    见到这种情况先 `Get-Process msedge | Stop-Process -Force` 再跑。
- **1.0.116.108 相对 106 的两处补修（用户拿真机截图报的，106 还没完全修好）**：
  1. **点空白取消后灰底不消失** —— 取消选中其实有**两条**路径：①点分类自己（按钮 click 里会叫
     `同步分段药丸()`）②点空白/拖出去，Blockly 自己关浮层（走 `document` 上的 pointerup 监听，
     **它只调 `clearRailActive()`**）。第 ② 条以前不通知滑块 → 灰底一直留着。
     修法：把 `同步分段药丸()` 放进 `clearRailActive()` 里 —— 「谁清高亮谁负责通知」，以后加新路径也不会漏。
  2. **取消的瞬间还能看到一层灰** —— 106 改成 140ms 淡出，用户第二次截图说"取消瞬间还是有一层"。
     结论：**取消选中就该是瞬时的**。现在 `!中` 时临时关掉过渡再写 `opacity:0`（并强制回流），
     不留任何过渡帧。（选中仍然是滑过去 + 淡入，那个观感是对的。）
  - 取证：`pc-sim\shot-rail.mjs` 第 5 步专门走「点空白取消」那条路（调 Blockly 的 `clearSelection()`
    + 派发 `pointerup`），断言 `选中数=0` 且 `滑块 opacity=0`。
    **注意别用 CDP 注入鼠标事件去点画布** —— 会触发 Blockly 其它交互把脚本卡死（踩过，整轮超时）。
- **选中滑块"跑偏"的全部情况（2026-09-26 用户报"把分类栏拉到下面就看不到选中提示了"，我把 9 种情况列全后逐个核过）**：
  | 情况 | 结果 |
  |---|---|
  | **滚动容器滚动后**（分类栏 / 账号页窄列表都会滚） | ❌→✅ **真因**：偏移没算滚动量 |
  | 拖动重排分类之后 | ❌→✅ 重排完没通知滑块 |
  | 横竖屏切换 / 窗口尺寸变化（含软键盘收起） | ❌→✅ 没通知滑块 |
  | 容器隐藏时选中（回首页 / 切页 / 切组） | ✅ 早有"位置脏了"机制 |
  | 积木栏重建（切回代码页） | ✅ 早有脱离文档清理 + 重建 |
  | 点空白取消 / 再点一次取消 | ✅ 上一轮已修（`clearRailActive` 里同步） |
  | 首帧容器还没量到宽高 | ✅ 早有脏标记 |
  | 两组面板（常规 / 控件）切换 | ✅ 各自有滑块 + 显示时同步 |
  | 滚动过程中要不要实时跟 | ✅ 不用：算进滚动量后滑块在**内容坐标**里固定，天然跟条目一起滚 |
  - **根因写法**（改之前）：`上 = b.top - a.top`。绝对定位子元素的包含块是容器的 **padding box**，
    而滚动容器的 padding box **跟着内容滚**，所以这两个 rect 相减得到的是"距可视区顶"的距离 ——
    滚动之后比真实内容偏移小了一个 `scrollTop`，滑块整体上移，滚动越多偏得越多，
    而条目还在屏幕上 → 用户看到的就是"选中提示不见了"。
    **正确写法**：`上 = b.top - a.top + 容器.scrollTop`（左右同理 `scrollLeft`）。
  - 按下态（`:active` 那层灰）也一起改了：`.bb-cat` 和 `.acct-item` 都不再用 CSS `:active`，
    改由 JS 在 `pointerdown` 加 `.按住`、`pointerup`/`pointercancel` 清掉 ——
    安卓 WebView 会把 `:active` "粘住"，那就是用户先前报的"取消后还留一层灰"（取色 `#EAE9EE` = `--c-high`，
    和滑块 `--secondary-c` = `#E7DDF8` 不是一个东西，别再去滑块那边找）。
  - 取证：`shot-rail.mjs` 第 7/7b 步 —— **先把视口改矮逼出真正的溢出**（不改矮的话 1280x720 放得下 13 个分类、
    `scrollTop` 永远 0，用例会"空跑"，第一次就是这么假过的），再断言三种滚动位置下
    `滑块与选中条的位置差 = 0`、以及"滚到底再点分类"时滑块仍在可见区内。
- **本轮第二处真 bug（我自己引入的）：发码请求被中转打包，登录发码整条链全挂。**
  `MAIL_BASE === CLOUD_BASE`（发码接口和云中转是同一个阿里云函数），打包判定写的是
  `url.indexOf(CLOUD_BASE) === 0` —— 于是打函数**根路径**的发码请求也被包成
  `{p:'',m:'POST',q:'',b:{action:'send'}}`，函数在顶层找不到 `action` → 一律回「未知 action（send / verify）」。
  线上真函数实测过两种形状：原样 `{action:'verify'}` → 400「邮箱格式不正确」（认得 action）；
  包一层 → 400「未知 action（send / verify）」。
  修法：判定改成 `CLOUD_BASE + '/api'`（真正的中转请求是 `/api?p=…` 和 `/api/download?…`），
  并把打包抽成纯函数 `打包中转请求()`、暴露 `EditorApp.__packProxy` 供单测。
  防回归：`pc-sim\unit-pack.mjs`（13 项全过）。
- **本轮加的动画：积木栏分类栏的选中滑块**（`.bb-cat-pill`）。两个滑块函数合并成一份
  `建滑块(容器, 按钮们, 类名)`，顺手把积木栏缺的「容器隐藏后位置变脏 → 下次显示先归位」修正补上，
  并清掉脱离文档的旧药丸（切回代码页会重搭积木栏）。只动 `transform/宽高`，不碰画布。
- **本轮修的真 bug（用户报「总是获取不到社区作品和我分享的作品」的根因）**：
  App 内所有 HTTP 都走原生桥 `Native.httpRequest` → 回调 `window.__nativeHttpResolve`。
  原来的写法是**每个请求临时换掉这个全局回调槽、收到自己的结果再换回去**。
  两个请求同时在飞时（进账号页就会：读「账号」表 + 读「我分享的作品」+ 读「社区」表），
  先结束的那个会把槽**恢复成它进函数前的样子** → 另一个请求的结果再也没人认领，
  界面永远停在「正在加载…」，直到 15/40 秒超时变成一句网络错误。
  **改法**：`editor.js` 里装一个**常驻分发器 + 请求号表**（`var 原生待回 = {}`，约 363 行），
  `editorCloudHttp` 与上传的 `uploadRawPost` 一并修，谁的结果回给谁。
  同时把 `MainActivity.java` 的 `httpReadTimeout` 20s → 60s：原来 JS 侧统一 40s、原生 20s 先掐断，重试窗口根本用不上。
  **验证方式（重要，别再走弯路）**：真表数据 + 无头 Edge + **模拟原生桥的假 Native** 跑真实代码路径。
  PC 回归加了两条用例（`原生桥回调：多个请求一起飞…`、`两个附件一起传…`），
  注意：`cdp-test.mjs` 的假网络走 `__authSetHttp`、**绕开 Native 分支**，所以老用例永远抓不到这个 bug，
  这两条新用例必须把假网络拆掉、装一个假 `window.Native` 才测得到。
- 用户能看到的旧 bug 记法：**"社区/我分享的作品一直在转圈，然后报网络错误"** → 先看 `原生待回` 那套是不是被改回单槽写法了。
- 上一轮（`1.0.116.93`）已完成：
  1. 副本/导入不再继承原作者的 `作品iD` → 副本**不显示「管理」**，也不会误覆盖原作者那一条；
  2. 「管理」显示条件改为**与社区表核对**（`用户邮箱==我 && 作品iD==该作品`）；未登录/核对不出来不显示；
  3. 「我分享到社区的作品」：空清单→空状态；有清单→**一次**读社区表；超时 40s + **自动重试一次**；失败→本地缓存 `__bb_mine_v1` 顶上 + 「重试」按钮；幽灵 ID **自愈清掉**（连带 `作品` 列）；
  4. 社区作品「运行/保存到手机/生成副本」：下载拆两步、各自放宽超时 + 重试，失败提示带**步名**；单卡失败不连累列表；
  5. **头像破图**：写入前校验附件路径（不写脏值）、显示走 `app-download-link` 并预加载确认，任何一步失败退回首字母占位；
  6. 顺带修：`idList` 分隔符不一致（写入用逗号、读取只认 `\x01`）导致多件作品时误删有效记录；emoji 首字被截半。
- **仍待用户拍板**：
  1. 「管理」需要在线核对社区表 → **离线时管不了自己的分享**（要不要退化成"本地记过的已发布 iD 也算"，用本地缓存判断）；
  2. 账号页进「个人信息」会读 3 次表（账号×2 + 社区×1），可合并缓存省一次（未做，怕影响用例时序）。
- 交付流程（每次）：复跑回归 → 构建 → 完整下载校验 → 直链发给用户。
- 未做的未来规划：扫码、云后端发布闭环/排行榜/存档积木、多段修复+多页面生成、文件读写/正则/数组对象/定时任务、多文件工程、协作、导出体积优化、教学体系。（详见 `ROADMAP.md`。）
- 已废弃：早期"要不要通知卡片"的自制确认弹窗（`#runTipMask` 的 HTML 还在，但已不再打开）。

## 6.5 2026-10-27 这一轮（APK 1.0.116.114，回归 156/156）

- **用户报「检查更新/社区取不到数据」的真因不是代码，是阿里云函数「免费试用到期」**。
  函数对任何请求都回 `403 {"Code":"AccessDenied","Message":"Current user is in debt."}`；
  SeaTable 本身正常。用户充 1 元后立刻恢复（网关欠费/试用到期这一层不需要重新部署）。
  ⚠️ **遗留隐患**：该函数 `scalingConfig.minInstances = 1`（常驻实例），按量计费约 **55 元/月**，
  1 元余额约 13 小时烧完 → 会再次停机。**待用户在控制台把「最小实例数」改成 0**（冷启动 1–3 秒，
  客户端读表超时是 40 秒，够用）。这就是"每月固定开销"的唯一来源，单次请求成本约 0.000006 元。
- **检查更新改版（用户要求）**：不再列出版本列表（表里混着已删除的测试版，会误导用户装旧包）。
  打开只显示**最后一行**（云表 1A 2B 3C 递增，最后一行即最新），点「下载并安装」只装这一个。
  提示文案三态：有新版本 / 已是最新 / **云端比本地还旧**（明确说"开发者还没上传新包"，防止用户降级）。
  纯函数 `取最新版本()`、`校验更新提示()`，暴露 `EditorApp.__updatePick` / `__updateHint` 供单测。
- **社区刷新按钮**：从社区列表头部挪到账号页**顶栏右上角**（退出登录右边），顶栏不参与滚动，
  怎么滚都在；默认 `hidden`，`showAcctPane('comm')` 才显示。以后加顶栏控件都走这个开关，别再放进滚动区。
- **中转加固（index.py → `FUNC_VERSION = v15`，⚠️ 尚未部署）**：
  ① 按来源 IP 滑动窗口限流（读 600/分、写 120/分，`RELAY_PER_MIN` / `RELAY_WRITE_PER_MIN` 可调）。
  阈值故意宽松：国内移动网大量用户共享出口 IP（CGNAT），设小会误杀。
  ② 社区表 POST/PUT 必须带「用户邮箱」，且该邮箱在「账号」表里注册过；查不到时**强制刷新一次缓存**
  （刚注册就发布的场景），读不到账号表则**放行**（加固不能把正常发布搞挂）。
  规则背景：`X-App-Token` 写死在 APK 里，等于对拿到包的人公开，以前读写接口完全不设防。
  **部署方式**：`powershell -File pc-sim\deploy-func.ps1`（需要 `s` 口令）或 `ALI_AK/ALI_SK` 跑
  `node pc-sim\fc-deploy-sdk.mjs`；本机两者都没有，所以这一轮**只改了代码，线上还是 v14**。
  不部署也不影响客户端（限流/校验都在服务端）。
- **`editor.js` 拆分：评估后推迟**（用户提的"拆成 account.js/community.js/ai.js"实际不可行）。
  13031 行**全在一个 IIFE 闭包**里（文件头自己写着"内部变量都是私有的，所以不能拆成多个文件"），
  按功能拆需要把成千上万处内部引用改名，风险远大于收益；而且 `pc-sim\audit.mjs`、
  `pc-sim\unit-pack.mjs` 都按路径**直接读 `assets/www/editor.js`**，拆了就一起坏。
  两条可行路线（留给以后单独做）：
  1. **构建期拼接**：源码分片放 `assets/www/js/*.js`，`build.ps1` / 测试脚本先拼接生成 `editor.js`。
     语义零风险（拼接结果与原文逐字节一致可验证），代价是"改完忘了拼接就测旧代码"。
  2. **命名空间重构**：真正模块化，工期大、回归成本高，需要单独一轮。
  现阶段替代做法：保持单文件，但新增功能按目录索引的位置就近放、注释写清入口函数名。

## 6.6 2026-10-27 第二轮（APK 1.0.116.116，回归 156/156 + 改名专项 1/1）

- **用户报「账号改名后，后台（SeaTable）是新的，App 里还是原名」的真因**：
  `drawCommunity()` 的「内容指纹」只算了 作品iD / 作品名 / 条数，**作者名不在指纹里**。
  改名时这三样一个都没变 → 判定「内容没变」直接 `return`，新读回来的行根本没画，
  **点「刷新」也一样**（刷新会重读表，但重画还是被指纹挡掉）；只有重启 App 才会好。
  → 这解释了为什么"后台正确、App 一直不对"，也是上一轮只做服务端同步（`同步社区作者名`）却没修好的原因。
- 修法（`editor.js`）：
  1. 指纹改成 `作品iD + 作品名 + 用户名 + 时间`（用 `\u0002/\u0001` 分隔，避免和名字里的字符打架）；
  2. `同步社区作者名` 写成功后，顺手把 `commState.rows` 里自己的行改成新名字并 `drawCommunity()`，
     社区栏正开着时当场就变，不用等下次进页面。
- **专项用例**：`pc-sim\verify-comm-rename.mjs`（`run-ui-test.ps1 -Script verify-comm-rename.mjs`）。
  走真人流程：进社区 → 后台换作者名 → 点刷新 → 断言卡片变成新名字。
  **已反向验证**：把指纹退回旧写法时它是 FAIL（卡片停在原名），修好后 OK —— 以后别再把这个字段从指纹里拿掉。
- 交付：`D:\DSH工作\fastapk\FAST_v1.0.116.116.apk`（1817945 字节，
  sha256 `2C34DCBE73DDA8A8EDEAA24B1B317E7430F9A662CA49942021A5E887244E5A43`），
  已部署到 FC（`/healthz` = v15）并实测下载哈希一致；「更新」表新增第 8 行
  `1.0.116.116（26.10.27.23:38）` + APK 附件（下载链接 200、1817945 字节）。
- 上传附件踩坑（更正以前的记法）：`app-upload-link/` 返回的 `parent_path`（`/asset/<uuid>`）才该当
  `parent_dir`，`relative_path` 用返回的 `file_relative_path`；填 `/files/2026-10` 会报
  `Parent dir doesn't exist`，填 `/` 会报 `Parent dir doesn't match`。

## 6.7 2026-10-27 第三轮（GitHub 仓库清理：明文凭据 + 历史重写）

- 远端 `dashen9178/Fast` 是 **public**。上一轮只清了 `fast_project_v2`，**漏了根下的旧版 `fast_project/`**：
  它的 `assets/www/editor.js` 里明文写着两个 SeaTable 全权 Token（账号/社区 + 更新表）。
- 本轮处理：
  1. 旧版 `fast_project/assets/www/editor.js` 的两个 Token → `REDACTED-BY-OWNER`；
  2. `fast_project_v2` 的 `aliyun-fc-mail/README-部署说明.md`、`pc-sim/deploy-func.ps1`、
     `pc-sim/verify-v5/v7/v9-live.mjs` 里的 App 下载口令 → 改为读 `FAST_APP_TOKEN` 环境变量；
  3. 历史压平为**单个无父提交**并强推 main（`14de9852`），旧提交不再挂在任何 ref 上。
- ⚠️ **force push 不等于删除**：GitHub 仍保留不可达对象，按 SHA 直查 API 仍返回明文
  （已实测 `07223608` / `0fe4d18c` 均 200 且含 token）。彻底根治只有三条路：
  转 private、删库重建（需 `delete_repo` 授权）、或联系 GitHub Support 清除。
- 目前仓库里唯一剩下的口令是 `fast_project_v2/assets/www/editor.js` 的 `MAIL_APP_TOKEN`：
  它是 APK 内置的下载口令（与 APK 一同公开分发），不是数据密钥；若要源码零口令，
  可改成打包时由 `build.ps1` 从环境变量注入（同 `__BUILD__` 的做法）。
- **实际处置（用户决定：改名 + 锁门 + 另开公开库）**：
  - 旧库 `dashen9178/Fast` → 改名 **`dashen9178/fastbeifen`** 并转 **private**（旧历史仍在那里面，只有本人可访问）；
  - 新建公开库 **`dashen9178/fast`**：只放 `fast_project_v2` 的 235 个文件（平铺到根，无 `fast_project_v2/` 这层），
    单提交 `1a522cf8`，历史里没有旧令牌；
  - GitHub 仓库名大小写不敏感 → `github.com/dashen9178/Fast` 现在直接解析到新公开库，旧链接不会失效；
  - 新库扫描结果：0 个 SeaTable Token / 0 个 SMTP 授权码，仅 `assets/www/editor.js` 的 `MAIL_APP_TOKEN`（APK 内置下载口令）。
  - ⚠️ 以后同步公开库用 `C:\...\Temp\gh-split.mjs` 的同款思路（Git Data API），**不要再把 v1 旧工程带进去**。

## 6.8 2026-10-28 第四轮（APK 1.0.116.117：社区开源状态不刷新）

- 用户报：发布时选了开源，之后改成不开源再更新，「云列表」里已经是“否”，但社区卡片还挂着“开源”。
- 根因：`drawCommunity()` 的“内容指纹”只比 `作品iD/作品名/用户名/时间`，**没比「是否开源」和「封面图」**
  → 判定“内容没变”直接 return，新读回来的行根本没重画（只有重启 App 才会变）。
- 修复：指纹改为 作品iD + 作品名 + 作者 + 是否开源 + 封面图 + 时间（+ 条数），见 `assets/www/editor.js` `drawCommunity()`。
- 回归：新增 `pc-sim/verify-comm-open.mjs`（开源→不开源，断言标签 2→0、保存本地按钮禁用 0→2）；
  反向拿旧指纹跑会 FAIL（证明用例真能抓住这个 bug）；全量 156/156 通过。
- 交付：`D:\DSH工作\fastapk\FAST_v1.0.116.117.apk`（1817945 字节，
  sha256 `047856F149701422AAE34E64C446EE429D2A29F23047990CA4748D6C5D0F3EF1`），FC `/healthz` = v15，
  `/dl/…` 与 App 实际走的 `/api/download?path=files/2026-10/…&u=<更新库uuid>` 两条链路都实测 200 且哈希一致。
- 「更新」表第 9 行 `1.0.116.117（26.10.28.01:04）` 的 `程序` 附件已补上（`/workspace/600134/asset/<uuid>/files/2026-10/FAST_v1.0.116.117.apk`）。
- **教训**：
  1. 改行必须用 `updates:[{ row_id, row:{列名:值} }]`（第 4 节早写了）；我这次先试 `_id`、再试把列名平铺在 updates 项上，
     两种都回 `200 {"success":true}` 但**值根本没写进去** —— PUT 成功 ≠ 写成功，**必须读回核对**。
  2. 同一张表上存在**两个** API 令牌：只读的那个走写接口一律 403 `You don't have permission…`，
     别把它当成“权限被改/服务端故障”。用户给的 `5ada09e1…` 才是可读写的那枚。
- 同步：公开库 `dashen9178/fast` 提交 `10bd5a8d`（`editor.js` + 新用例 + `VERSION`）。
- 「工程」子表（列：`名称` / `文件` / `备份`）同一轮补齐：
  - 117 行 → `文件` = `FAST-full-1.0.116.117.zip`（21,257,126B，1026 条目，
    排除了 `fast-cloud/node_modules`、`fast-cloud/.wrangler`、`stage`、`out`、`keys`——`keys` 里是签名私钥，绝不能进附件）、
    `备份` = `FAST_v1.0.116.117.apk`；
  - 116 行 → 只补了 `备份`（APK），`文件` 仍为空：116 发版时没打工程包，没有快照。
  - 两条下载链路都用 `/api/download?path=files/2026-10/…&u=<更新库uuid>` 验过 200。

## 6.9 2026-10-28 第五轮（APK 1.0.116.119：选图后可裁剪）

- 用户需求：「图片选择器增加裁剪功能，选择图片后可以裁剪」；
  第二轮补充定调：「裁剪只允许正方形，固定大小的正方形，只能放大缩小图片调整选择范围」。
- 实现（`assets/www/editor.js`）：`pickImage()` 读到图后不再直接缩，而是 `openCropper(img, cb)`；
  新增 `openCropper()` —— 动态建 `#cropMask` 弹窗（标题 + 黑底舞台 + **固定正方形方块** + 取消/完成）。
  - 方块边长 = `round(min(舞台宽, 高) * 0.82)`，**固定不变**；没有可拉角，改不了形状/大小；
  - 调整方式只有两种：拖动图片平移（`偏`）、双指捏合或滚轮缩放（`倍`，范围 `最小倍 ~ 6×最小倍`）；
    `最小倍 = max(方/原图宽, 方/原图高)`，保证任何时候图片都盖满方块（不会露黑边）；
  - 坐标全按**布局像素**算，确认时按 `方 / 倍` 反推原图边长，天然是正方形；
    出口仍压到 ≤256 的 PNG（工程体积口径不变）；
  - 框外半透明黑用 `box-shadow: 0 0 0 9999px rgba(0,0,0,.55)` 铺（不用四块遮罩，不会露缝）；
  - 「取消」不回调，调用方什么都不改。
  - 三处入口自动都生效（图片控件属性面板 / 头像 / 应用图标）——它们本来就都走 `pickImage`。
- 样式（`assets/www/editor.css`）：`.crop-stage img` 改绝对定位（宽高由 JS 写），新增 `.crop-sq`
  （固定方块，`pointer-events:none`），删掉上一版的 `.crop-h` 四角手柄。
- 专项用例 `pc-sim/verify-crop.mjs`：真人路径（导出弹窗 → 给 `#iconFile` 塞 400×200 图 → change）→
  断言弹窗出现、无角手柄、方块宽=高且等于 `min(舞台)*0.82`、拖图时方块纹丝不动而图片动了、
  滚轮放大后图片显示变大且裁出来的预览更小（200 → 102）、预览一律正方形且 ≤256、取消不改图。
- **踩坑（写用例时）**：首页按钮是 `#btnNewApp`（不是 `#btnNew`）、确认建是 `#createGo`（不是 `#createOk`）、
  名字输入是 `#newAppName`、编辑器视图是 `#viewEditor`（`#editorPage` 这个 id 不存在）。
- **踩坑（量尺寸时）**：弹窗有 `pop` 进场动画，动画期间 `getBoundingClientRect()` 拿到的是**被 transform 缩过**的尺寸，
  用它算方块边长会永久偏小（398 vs 407）——量舞台一律用 `clientWidth/clientHeight`。
- **踩坑（跑脚本时）**：PowerShell 里 `& 'xxx.exe' script.mjs` 这种 GUI 子系统程序**不会等待、输出也丢**，
  必须加 `| Out-String`（或 `*>&1 | Tee-Object`），否则会看到"退出码 0、什么都没发生"。
- 回归：全量 `pc-sim\run-ui-test.ps1` **156/156 通过**；裁剪专项 `-Script verify-crop.mjs` 通过。
- 交付：`D:\DSH工作\fastapk\FAST_v1.0.116.119.apk`（1822041 字节，
  sha256 `41B314A13FD5B44C8D3CF1335FD2DB9BA319294E475636F5B1CDEBEF72BDE5F2`）。
- 「更新」表第 11 行 `1.0.116.119（26.10.28.07:49）`（row `OQ6coqMYT7eouV1l4sEYvg`）+ `程序` 附件；
  「工程」表新增 `1.0.116.119`（row `cPZRYgIYR4GPIbDxCdzQBw`）：
  `文件` = `FAST-full-1.0.116.119.zip`（21,268,703B，1027 条目），`备份` = 119 APK。
  附件下载（`/api/download?path=files/2026-10/…&u=<更新库uuid>`）实测 200，APK 哈希与本地一致。
  （第 10 行 `1.0.116.118` 是"可拖方框"那版，已被用户否掉，留作记录。）
- 同步：公开库 `dashen9178/fast` 提交 `2ca273a4`（第一版）→ `af55bdd7`（改成固定正方形这版）。

## 6.10 2026-10-28 第六轮（APK 1.0.116.120：包名改为 com.fast.app）

- 起因：`OPPO上架整改清单.md` 的 P0-1 —— 包名 `com.doubao.blockbuilder` 含字节跳动品牌词，商店必驳回。
  用户决定**这一轮只改包名**，其余 P0/P1 项（应用名、隐私弹窗、安装收敛、targetSdk 等）暂不动。
- 主包：`com.doubao.blockbuilder` → **`com.fast.app`**
  - `src/com/doubao/blockbuilder/` 整体移到 `src/com/fast/app/`（6 个 java 的 `package` 行同步）；
  - `AndroidManifest.xml`：`package`、`activity android:name`、`provider android:name`、`authorities`（→ `com.fast.app.fileprovider`）；
  - `SimpleFileProvider.AUTHORITY` 常量与清单保持一致。
- 导出链也一并去掉品牌词（作品壳模板原本是 `com.doubao.rt.a00000`）：
  - `shell/AndroidManifest.xml` 包名 → `com.fast.app.rt.a00000`，activity 名 → `com.fast.app.MainActivity`；
  - `Exporter.OLD_PACKAGE` 必须与 shell 模板**一字不差**（AxmlRewriter 靠它做二进制替换基准），
    同步改成 `com.fast.app.rt.a00000`，`newPackage` 前缀改为 `com.fast.app.rt.`；
  - `pc-sim/com/doubao/blockbuilder/` 两个模拟类随源码移到 `pc-sim/com/fast/app/`，包名与 `npkg` 同步；
  - `run-export-test.ps1`、`diag-export.ps1` 的源路径与主类名、`adb-smoke.ps1` 的默认 `-Pkg` 同步。
- 验证：
  - `build.ps1` 出 `FAST_v1.0.116.120.apk`（1822041 字节）；`aapt2 dump badging` 显示
    `package: name='com.fast.app' versionCode='236' versionName='1.0.116.120'`；
  - `pc-sim\run-export-test.ps1` 全绿：两个作品包名分别为 `com.fast.app.rt.ih8ohd` / `com.fast.app.rt.je8t4k`，
    说明替换基准没写错（写错的话 AxmlRewriter 会替换不动，成品还是旧包名）；
  - 全量回归 `pc-sim\run-ui-test.ps1` **156/156 通过**。
- **必须知道的两件事**：
  1. 包名变了 = 全新应用，旧版 `com.doubao.blockbuilder` 不会被覆盖，会装成第二个 App；
     旧版 localStorage 里的作品在新包里读不到（Android 按包名隔离数据），老用户只能先导出作品再重装。
  2. OPPO 后台要按新包名 `com.fast.app` 建档，软著名称仍须与 `android:label`（当前还是 `𝑭𝑨𝑺𝑻`）一致 ——
     P0-2 改名还没做。

## 7. 新会话怎么开口（给用户的话）
> 读 `D:\DSH工作\Fast\fast_project_v2\NEXT.md`，然后接着干：<你要做的事>
