# FAST · OPPO 应用商店上架整改清单

| 项目 | 内容 |
| --- | --- |
| 分析对象 | `fast_project_v2`，构建产物 `FAST_v1.0.116.119.apk` |
| 目标渠道 | OPPO 软件商店（欢太，含一加 / realme） |
| 整理日期 | 2026-10-28 |
| 依据 | OPPO 开放平台审核规范、隐私检测要求、工信部《关于进一步提升移动互联网应用服务能力的通知》 |

---

## 一、总体结论

**技术上可正常出包，合规上不可直接提交。**

- 已通过：aapt2 + javac + d8 打包链路、PKCS12 签名、v1/v2 签名方案、apksigner 自检、`minSdkVersion 24`
- 必须整改：4 项 P0 阻断问题，不修必驳回
- 建议整改：6 项 P1 风险问题，影响一次过审概率
- 待准备：资质材料 3 项 + 特殊说明材料 2 项

按本文档第二部分改完并重新出包后，再提交审核才有实际意义。

---

## 二、P0 阻断项（必改，不修必驳回）

### P0-1 包名冒用他人品牌

- **现状**：`AndroidManifest.xml` 第 3 行 `package="com.doubao.blockbuilder"`
- **问题**：`doubao` 为字节跳动旗下产品品牌，属他人商标/品牌词。商店审核会判定冒用他人品牌，直接驳回，并有被投诉下架风险。
- **整改**：改为自有反向域名，例如 `com.yourdomain.fast`（须与后续所有版本一致，且不得再包含第三方品牌词）。
- **改包名的影响面**（必须全部同步，漏一处就出不了包）：
  1. `src/com/doubao/blockbuilder/` 目录整体改名，与新的 Java 包路径一致
  2. 所有 `.java` 文件首行 `package com.doubao.blockbuilder;` 与相互 `import`
  3. `AndroidManifest.xml` 的 `package`、`activity android:name`、`provider android:name`、`provider android:authorities`
  4. 全局搜索 `com.doubao` 兜底（`grep -r "com.doubao"`）
  5. `build.ps1` 递归收集 `src` 下的 `.java`，无需改路径；但需确认 `stage` 下的清单链接仍指向正确文件
- **注意**：改包名后应用 ID 无法复用，需在开放平台重新创建应用，越早改成本越低。
- **整改状态**：✅ 2026-10-28 已完成。主包 `com.fast.app`，导出作品壳 `com.fast.app.rt.*`；
  APK `FAST_v1.0.116.120` 经 `aapt2 dump badging` 复核 `package: name='com.fast.app'`，全量回归 156/156 通过。

### P0-2 应用名称使用特殊字符

- **现状**：`AndroidManifest.xml` 第 35 行 `android:label="𝑭𝑨𝑺𝑻"`（Unicode 数学斜体字符）
- **问题**：商店要求应用名称使用规范字符，不得使用花体字、特殊符号、空格占位等规避手段；同时影响搜索结果命中。
- **整改**：改为纯 ASCII 的 `FAST`。提交后台时的“应用名称”字段与包内 `android:label` 必须一致。

### P0-3 缺失隐私政策与首次启动同意弹窗

- **现状**：`MainActivity` 启动后直接 `web.loadUrl("file:///android_asset/www/editor.html")`，全程无隐私弹窗、无隐私政策入口。
- **问题**：这是当前国内商店驳回率最高的一项，隐私合规自动化检测会直接判不通过。
- **整改要求**：
  1. 准备可公网访问的隐私政策页面（建议 HTTPS，且与 ICP 备案主体一致）
  2. 首次启动弹出隐私政策摘要，提供“同意 / 不同意”，用户同意前不得初始化任何网络请求、不得申请权限
  3. 不同意时退出应用，不得进入主界面
  4. 应用内“设置 / 关于”页常驻隐私政策入口
  5. 隐私政策内容必须覆盖本项目实际行为：
     - 收集的信息：无账号体系，仅本地作品数据
     - 网络访问：SeaTable 云表格、DeepSeek 接口、云端检查更新
     - 用户自填凭据：SeaTable Token、DeepSeek API Key 的存储方式与用途
     - 申请的权限及用途：见 P1-4、P1-5
     - 第三方服务清单：SeaTable、DeepSeek、阿里云函数计算
     - 未成年人（面向中小学生）个人信息保护条款

### P0-4 应用内下载并安装 APK（应用分发风险）

- **现状**：
  - 权限：`android.permission.REQUEST_INSTALL_PACKAGES`
  - 能力：`installApk(path, downloadUri)`、`downloadApk(cbId, url, saveName)`，可从任意 URL 下载 APK 到私有目录并拉起安装
  - 另有 `aliyun-fc-mail/` 中的 APK 分发服务
- **问题**：普通工具类 App 提供“下载并安装安装包”的能力，商店会按应用分发行为审查，需具备分发资质与明示信息，否则驳回。
- **整改（二选一，建议选 A）**：
  - **A. 收敛为“仅安装本机导出的作品”**：移除远程 `downloadApk` 通道；`installApk` 只接受 `Download/fast本地app/` 目录下由本机刚导出的文件；对路径做前缀校验，拒绝任意 URL 与外部路径。
  - **B. 保留远程分发**：需在应用内做分发明示界面（应用名称、开发者、版本、权限、隐私规则），并准备分发相关资质说明，过审难度显著更高。
- **同时**：`REQUEST_INSTALL_PACKAGES` 属高敏感权限，隐私政策与后台权限说明里必须写清“用于安装用户自己创建并导出的作品”。

---

## 三、P1 风险项（建议整改）

| 编号 | 项目 | 现状 | 风险 | 整改建议 |
| --- | --- | --- | --- | --- |
| P1-1 | 生成式 AI 功能 | `assets/www/editor.js` 第 7026 行 `AI_ENDPOINT = https://api.deepseek.com/chat/completions`，用户自填 Key | 含 AIGC 功能的应用通常需提供模型备案说明与内容安全机制，否则被要求补充材料 | 准备模型服务备案说明；对生成内容做输入输出过滤与违规词拦截；隐私政策写明数据出境/传输对象 |
| P1-2 | targetSdkVersion 偏低 | `AndroidManifest.xml` 第 6 行 `targetSdkVersion="30"` | 仅达到主流商店 2024-01 起的收录下限；Android 15/16 行为变更可能引发兼容问题 | 升到 33 或 34，重跑 pc-sim 回归与真机冒烟 |
| P1-3 | 明文流量 | 第 40 行 `android:usesCleartextTraffic="true"` | 安全检测扣分，可能要求整改 | 改为 `false`；确保 SeaTable / DeepSeek / 自建服务器全部走 HTTPS |
| P1-4 | 允许备份 | 第 38 行 `android:allowBackup="true"` + `fullBackupContent` | 作品数据与用户凭据可被备份导出，个人信息保护检测常要求关闭或限制范围 | 改为 `false`，或在 `res/xml/backup_rules.xml` 中显式排除凭据与作品目录 |
| P1-5 | WebView 配置 | `MainActivity` 第 136–158 行：JS 开启、`allowFileAccess`、`allowContentAccess`、`addJavascriptInterface`，且 Web 组件可加载任意 URL | 安全检测会提风险；混合内容与任意远程页面加载是常见扣分点 | 远程加载走 HTTPS 域名白名单；对 `Native` 接口做调用来源校验；不必要时关闭 `allowContentAccess` |
| P1-6 | 密钥与口令 | `build.ps1` 第 36–37 行默认口令 `（已脱敏）` | 默认口令随脚本留存，发布包若沿用存在安全风险 | 出正式包必须通过 `FAST_KS_PASS` / `FAST_KEY_PASS` 环境变量提供独立口令；密钥文件不入库 |
| P1-7 | UGC / 社区 | README 提到“发布到社区” | 若保留社区、分享、评论能力，需内容审核、举报入口、未成年人保护机制 | 首版建议隐藏社区入口，仅保留本地作品与文件分享 |

---

## 四、已达标项（无需改动）

- 签名方案：`apksigner --v1-signing-enabled true --v2-signing-enabled true`，并有 `verify --verbose` 自检
- 编译产物稳定：`FAST_v1.0.116.119.apk` 约 1.8 MB，体积优势明显
- 权限面窄：仅 INTERNET、ACCESS_NETWORK_STATE、REQUEST_INSTALL_PACKAGES、VIBRATE、POST_NOTIFICATIONS、WRITE_EXTERNAL_STORAGE(max 28)
- 无广告、无统计类第三方 SDK，无设备标识（IMEI/OAID）采集
- 无账号体系、无登录注册，不涉及实名与账号合规
- 无内嵌密钥：签名私钥由设备本地生成，APK 内不含私钥材料

---

## 五、资质与材料清单

| 材料 | 是否必需 | 说明 |
| --- | --- | --- |
| 企业营业执照 / 个人身份证 | 必需 | 开发者实名或企业认证，认证通过后才能创建应用 |
| 《计算机软件著作权证书》或《APP 电子版权认证证书》 | 必需 | 登记名称须与应用名称 `FAST` 一致 |
| ICP 备案 | 必需 | 涉及云端服务（阿里云函数计算、self-hosted 域名）时需提供 |
| 应用承诺函 | 必需 | 开放平台提供模板，需盖章 / 签字 |
| 隐私政策 URL | 必需 | 公网可访问、内容与实际采集行为一致 |
| 生成式 AI 模型备案说明 | 视功能保留情况 | 保留 AI 生成功能时提供 |
| 儿童 / 未成年人个人信息保护说明 | 建议 | 应用面向中小学生，需说明保护措施 |
| 应用截图（≥3 张，含主界面） | 必需 | 若涉及通讯类界面需一并提供 |
| 测试说明 / 测试账号 | 按需 | 本应用无登录，需在后台备注“无需账号即可完整体验”，并说明导出作品的操作路径 |

---

## 六、整改顺序与验收

1. **改包名 + 改应用名**（P0-1、P0-2）：一次改到位，避免二次返工
2. **加隐私弹窗 + 上线隐私政策**（P0-3）：本地先验证“拒绝即退出、同意前无网络请求”
3. **收敛 APK 安装能力**（P0-4）：确认只能装本机导出目录下的文件
4. **配置合规项**（P1-2 ~ P1-4）：targetSdk 33+、关闭明文流量、关闭/限制备份
5. **收紧 WebView 与密钥**（P1-5、P1-6）
6. **重新出包 → 真机冒烟 → 提交审核**

**出包后自检命令参考**

```powershell
# 确认实际包名 / 版本 / 权限
& "$env:ANDROID_SDK_ROOT\build-tools\34.0.0\aapt2.exe" dump badging "D:\DSH工作\fastapk\FAST_vX.Y.Z.apk"

# 确认签名方案与证书
& "$env:JAVA_HOME\bin\java.exe" -cp "$env:ANDROID_SDK_ROOT\build-tools\34.0.0\lib\apksigner.jar" `
  com.android.apksigner.ApkSignerTool verify --verbose --print-certs "D:\DSH工作\fastapk\FAST_vX.Y.Z.apk"
```

**提交前人工核对**

- [ ] 包名不含任何第三方品牌词
- [ ] `android:label` 与后台应用名称完全一致，且为纯 ASCII
- [ ] 首次启动有隐私弹窗，拒绝可退出，同意前无网络请求
- [ ] 隐私政策可公网访问，内容覆盖 SeaTable / DeepSeek / 阿里云 FC / 权限用途
- [ ] 应用内不再能从任意 URL 下载并安装 APK
- [ ] `usesCleartextTraffic=false`、`allowBackup=false`
- [ ] 软著、承诺函、ICP 备案齐全
- [ ] 后台填写“无需账号即可完整体验”，并附导出作品的操作说明

---

## 七、参考

- [OPPO 移动应用发布上架软件商店](https://open.oppomobile.com/documentation/page/info?id=10035)
- [主流商店 TargetSdkVersion ≥ 30 收录标准答疑](https://open.oppomobile.com/bbs/forum.php?mod=viewthread&tid=6274&page=1)
- [工信部关于进一步提升移动互联网应用服务能力的通知](https://www.gov.cn/zhengce/zhengceku/2023-03/02/content_5744106.htm)
