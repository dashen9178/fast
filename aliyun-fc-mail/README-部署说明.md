# FAST 邮箱验证码 —— 阿里云函数计算(FC) 部署说明

这套代码给 App 的「登录 / 注册」提供**邮箱验证码**能力：点「获取验证码」→ 函数用 QQ 邮箱
`3457525474@qq.com` 把 6 位验证码发到用户邮箱 → 用户填码 → 函数校验通过即登录。

- `index.py`：函数本体（Python 标准库，**零第三方依赖**），是一个监听 9000 端口的 Web 服务。
- `s.yaml`：Serverless Devs 部署配置（函数 + HTTP 触发器 + 环境变量）。
- `test_local.py`：本地测试（已全部通过，可重复运行）。

验证码用 HMAC 签名令牌做**无状态校验**，FC 同时开多个实例也不会出现「发了码却验不过」。

---

## 第一步：拿到 QQ 邮箱「SMTP 授权码」（必须，不是 QQ 密码）

1. 电脑浏览器登录 QQ 邮箱 <https://mail.qq.com>（用 `3457525474` 这个号）。
2. 顶部 **设置 → 账号**，找到「POP3/IMAP/SMTP/Exchange/CardDAV 服务」。
3. 开启 **IMAP/SMTP 服务**（按提示用手机发短信验证）。
4. 生成并**复制那串 16 位授权码**（类似 `abcdefghijklmnop`）。这就是函数要用的 `SMTP_PASS`。

---

## 第二步：部署到阿里云（账号 15768018901）

> 说明：函数部署走的是 **AccessKey（程序密钥）**，不需要、也不应该提供账号登录密码；
> 网页登录需要你手机短信/刷脸，AI 无法代收。给我 AccessKey，我就能直接帮你部署好。

### 方式 A（推荐）：把 AccessKey 给我，我来部署

1. 登录阿里云控制台 → 右上角头像 → **访问控制(RAM)** → 用户 → 创建用户（勾选
   「OpenAPI 调用访问」），或用已有 RAM 用户。
2. 给该用户授予权限 **AliyunFCFullAccess**（函数计算全部权限）。
3. 复制该用户的 **AccessKey ID** 和 **AccessKey Secret**，连同第一步的 **QQ 授权码** 一起发给我。
4. 我会执行：配置密钥 → `export SMTP_PASS=授权码` → `s deploy`，然后把**函数访问地址**回填到 App。

> 安全提示：AccessKey 等同该账号的程序登录凭证，部署完成后你可以在 RAM 里随时禁用/删除这个密钥。

### 方式 B：自己用命令行部署

1. 安装 Node.js 后执行：`npm i -g @serverless-devs/s`
2. 配置密钥：`s config add`（按提示填 AccessKey ID / Secret，别名填 `default`）
3. 在本目录执行：
   ```bash
   export SMTP_PASS=你的QQ授权码
   s deploy
   ```
4. 部署结束会打印 HTTP 触发器地址，形如
   `https://fast-mail-code-xxxx.cn-shenzhen.fcapp.run`（或 `fcapp.run` / `run` 域名）。

### 方式 C：完全用网页控制台（不装任何工具）

1. 控制台搜索 **函数计算 FC** → 进入对应地域（如华南1·深圳）→ **创建函数**。
2. 选 **Web 函数**；运行时选 **Python 3.10**；函数名填 `fast-mail-code`。
3. 上传方式选「直接上传代码」，把 `index.py` 传上去（代码包根目录就是 index.py）。
4. 「启动命令」填 `python3 index.py`，监听端口 `9000`。
5. 在 **配置 → 环境变量** 里加：
   `SMTP_USER=3457525474@qq.com`、`SMTP_PASS=QQ授权码`、
   `APP_TOKEN=<App 下载口令>`（这个仓库是公开的，口令不写在这里，向开发者取），
   （可选）`SMTP_HOST=smtp.qq.com`、`SMTP_PORT=465`、`CODE_TTL=300`、`SEND_COOLDOWN=60`。
6. **触发器**确认是 HTTP 触发器、认证方式「匿名」、允许 GET/POST/OPTIONS。
7. 复制触发器「公网访问地址」。

---

## 第三步：把函数地址填进 App

打开 `assets/www/editor.js`，找到顶部「邮箱验证码」配置区，把 `MAIL_BASE` 改成你的函数地址：

```js
var MAIL_BASE = 'https://fast-mail-code-xxxx.cn-shenzhen.fcapp.run';
var MAIL_APP_TOKEN = '<与函数 APP_TOKEN 一致，向开发者取>';
```

然后正常 `build.sh` / `build.ps1` 打包即可（构建会自动把 `assets/www` 打进 APK）。

---

## 验证

- 浏览器/接口工具 POST 函数地址，Header 带 `X-App-Token: ed50ad9e...`，
  Body：`{"action":"send","email":"你的邮箱@qq.com"}`，应收到验证码邮件。
- 再发 `{"action":"verify","email":"...","code":"收到的码","challenge":"上一步返回的challenge"}`，
  返回 `{"ok":true}` 即成功。
- App 里：输邮箱 → 点「获取验证码」→ 填码 → 登录/注册。
