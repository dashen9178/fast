# -*- coding: utf-8 -*-
"""
FAST 账号 —— 邮箱验证码「发信 / 验码」阿里云函数计算(FC) Web 函数。

设计要点
1. Web 函数：进程内用 Python 标准库 http.server 监听 FC 指定端口(FC_SERVER_PORT，默认 9000)，
   不依赖 Flask / fc2 / nodemailer 等任何第三方库，直接上传即可运行。
2. 无状态验证码：FC 可能同时拉起多个实例，内存存码会出现「发码在 A、验码在 B」对不上的问题。
   因此发码时下发一个 HMAC 签名的 challenge 令牌（内含邮箱、过期时间、验证码哈希），
   验码时校验签名与时效即可，任何实例结果都一致，且令牌中不含明文验证码、无法被伪造或篡改。
3. 安全：
   - 调用方必须带 X-App-Token 头，值与环境变量 APP_TOKEN 一致（防止接口被陌生人盗刷）；
   - 同一邮箱/IP 两次发信有冷却时间（进程内最佳努力限流）；
   - 邮箱白名单校验、SMTP 超时、常量时间比较签名。

需要在 FC 配置的环境变量
   SMTP_USER   发信邮箱，默认 3457525474@qq.com
   SMTP_PASS   QQ 邮箱「SMTP 授权码」（不是 QQ 登录密码！在 QQ邮箱→设置→账号→POP3/IMAP 里生成）
   APP_TOKEN   客户端调用口令（随机字符串，App 端内置同一份）
   可选：SMTP_HOST / SMTP_PORT / CODE_TTL / SEND_COOLDOWN / SENDER_NAME / FC_SERVER_PORT
"""

import base64
import hashlib
import hmac
import json
import os
import re
import smtplib
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------- 配置（读环境变量）
SMTP_USER = os.environ.get("SMTP_USER", "3457525474@qq.com").strip()
SMTP_PASS = os.environ.get("SMTP_PASS", "").strip()
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.qq.com").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
# HMAC / 签名密钥：优先专用 HMAC_SECRET，没有就复用 APP_TOKEN
APP_TOKEN = os.environ.get("APP_TOKEN", "").strip()
SECRET = (os.environ.get("HMAC_SECRET", "").strip() or APP_TOKEN or "fast-dev-secret").encode("utf-8")
CODE_TTL = int(os.environ.get("CODE_TTL", "300"))           # 验证码有效期（秒），默认 5 分钟
SEND_COOLDOWN = int(os.environ.get("SEND_COOLDOWN", "60"))   # 同一邮箱两次发信最小间隔（秒）
SENDER_NAME = os.environ.get("SENDER_NAME", "FAST 积木编程").strip()
PORT = int(os.environ.get("FC_SERVER_PORT", "9000"))

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

# 进程内最佳努力限流：{标识: 上次发信时间戳}
_last_send = {}
_last_lock = threading.Lock()


# ---------------------------------------------------------------- 无状态 challenge 令牌
def _b64u(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64u(txt):
    pad = "=" * (-len(txt) % 4)
    return base64.urlsafe_b64decode(txt + pad)


def make_challenge(email, code, ttl):
    """生成签名令牌：payload(含验证码哈希) + HMAC 签名。"""
    now = int(time.time())
    payload = {
        "e": email.lower(),
        "i": now,
        "x": now + ttl,
        "h": hashlib.sha256((code + SECRET.decode("utf-8")).encode("utf-8")).hexdigest(),
    }
    p = _b64u(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = _b64u(hmac.new(SECRET, p.encode("ascii"), hashlib.sha256).digest())
    return p + "." + sig


def parse_challenge(token, email, code):
    """校验令牌签名、时效、邮箱与验证码；通过返回 True，否则返回 False。"""
    try:
        p, sig = token.split(".", 1)
        expect_sig = _b64u(hmac.new(SECRET, p.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expect_sig):
            return False
        payload = json.loads(_unb64u(p).decode("utf-8"))
        if int(payload.get("x", 0)) < int(time.time()):
            return False
        if payload.get("e") != email.lower():
            return False
        expect_h = hashlib.sha256((code.strip() + SECRET.decode("utf-8")).encode("utf-8")).hexdigest()
        return hmac.compare_digest(str(payload.get("h", "")), expect_h)
    except Exception:
        return False


# ---------------------------------------------------------------- 发信
def _check_cooldown(key):
    """最佳努力冷却限流：冷却期内返回剩余秒数，否则记为现在并返回 0。"""
    now = time.time()
    with _last_lock:
        # 顺手清理超过 1 小时的旧记录，避免无限增长
        for k in [k for k, t in _last_send.items() if now - t > 3600]:
            _last_send.pop(k, None)
        last = _last_send.get(key, 0)
        wait = SEND_COOLDOWN - int(now - last)
        if wait > 0:
            return wait
        _last_send[key] = now
        return 0


# 全局限流：不管是谁、发什么邮箱，一分钟内最多发这么多封。
# 为什么需要（2026-09-26 全代码扫描）：中转口令是写死在 APK 里的（发码接口和中转同址，
# 没法只靠服务端认证），所以拿到 APK 的人就能直接调这个函数发信。
# 只有"同一邮箱 60 秒冷却"是挡不住批量刷的 —— 换着邮箱发就能把你 QQ 邮箱的发信额度刷爆、
# 甚至被封。加一条全局上限，最坏情况下也只是"这一分钟发不出去"，不会把邮箱搞死。
SEND_PER_MIN_GLOBAL = int(os.environ.get("SEND_PER_MIN_GLOBAL", "8"))
# 再加一道每小时总上限：个人 QQ 邮箱一天的额度本来就有限，
# 只限"每分钟"的话慢慢刷一样能刷爆（12/分 = 720/小时）。60/小时 对真实使用完全够。
SEND_PER_HOUR_GLOBAL = int(os.environ.get("SEND_PER_HOUR_GLOBAL", "60"))
_GLOBAL_SENDS = []
_GLOBAL_LOCK = threading.Lock()


def _check_global_rate():
    """超过每分钟 / 每小时上限就返回要等待的秒数，否则记一笔并返回 0。"""
    now = time.time()
    with _GLOBAL_LOCK:
        while _GLOBAL_SENDS and now - _GLOBAL_SENDS[0] > 3600:
            _GLOBAL_SENDS.pop(0)
        if len(_GLOBAL_SENDS) >= SEND_PER_HOUR_GLOBAL:
            return max(1, int(3600 - (now - _GLOBAL_SENDS[0])) + 1)
        recent = [t for t in _GLOBAL_SENDS if now - t <= 60]
        if len(recent) >= SEND_PER_MIN_GLOBAL:
            return max(1, int(60 - (now - recent[0])) + 1)
        _GLOBAL_SENDS.append(now)
        return 0


def send_code(email):
    email = email.strip().lower()
    if not EMAIL_RE.match(email):
        raise ValueError("邮箱格式不正确")
    if not SMTP_PASS:
        raise RuntimeError("服务器未配置 SMTP_PASS（QQ邮箱授权码），无法发信")

    wait = _check_global_rate()
    if wait > 0:
        raise CooldownError(wait)

    wait = _check_cooldown("mail:" + email)
    if wait > 0:
        raise CooldownError(wait)

    # 6 位数字（000000-999999，%06d 自动补前导 0）
    code = "%06d" % (int.from_bytes(os.urandom(4), "big") % 1000000)

    subject = "来自𝑭𝑨𝑺𝑻，你的码为 %s" % code
    html = (
        '<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;'
        'padding:24px;color:#1f2329">'
        '<p style="font-size:16px;margin:0 0 16px">欢迎使用 <b>𝑭𝑨𝑺𝑻</b>，你码在下面👇</p>'
        '<p style="font-size:14px;color:#8a8f99;margin:0 0 6px">验证码</p>'
        '<div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#2b5cff;'
        'margin:0 0 18px">%s</div>'
        '<p style="font-size:14px;margin:0">请赶紧填写，不然你的码要失效了🤓</p>'
        "</div>"
    ) % code
    text = "欢迎使用 𝑭𝑨𝑺𝑻，你码在下面👇\n验证码：%s\n请赶紧填写，不然你的码要失效了🤓" % code

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    # 发件人显示名含中文，需按 RFC2047 编码，否则 QQ 会判 From 头非法(550)
    msg["From"] = formataddr((Header(SENDER_NAME, "utf-8").encode(), SMTP_USER))
    msg["To"] = email
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15)
    try:
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_USER, [email], msg.as_string())
    finally:
        try:
            server.quit()
        except Exception:
            pass

    return {"ok": True, "challenge": make_challenge(email, code, CODE_TTL),
            "ttl": CODE_TTL, "cooldown": SEND_COOLDOWN}


def verify_code(email, code, challenge):
    email = (email or "").strip().lower()
    code = (code or "").strip()
    challenge = (challenge or "").strip()
    if not EMAIL_RE.match(email):
        raise ValueError("邮箱格式不正确")
    if not code or not challenge:
        raise ValueError("缺少验证码或令牌")
    if not parse_challenge(challenge, email, code):
        raise ValueError("验证码不正确或已过期，请重新获取")
    return {"ok": True, "email": email}


class CooldownError(Exception):
    def __init__(self, wait):
        super().__init__("发送太频繁，请 %d 秒后再试" % wait)
        self.wait = wait


# ---------------------------------------------------------------- 云中转（SeaTable 代理）
# 为什么要有这段：以前编辑器把 SeaTable 的 API Token 硬编码在 editor.js 里，
# 而 editor.js 会被打进 APK —— 谁拿到安装包都能抠出来读写整张「账号」表和「社区」表。
# 现在账号/社区/更新的云请求全部打到这里，Token 只作为函数环境变量存在（SEATABLE_TOKEN），
# APK 里一个凭据都没有。下面的白名单保证这个函数**不会变成开放代理**。
# 函数版本号：/healthz 里会回出来。用来远程确认"手机上跑的那一版函数"是不是最新的。
#   v1 只有验证码
#   v2 加了云中转（读表）
#   v3 网关地址 + Bearer（修 404）
#   v4 附件下载允许 ?t= 口令（修卡片不显示图片）
#   v5 中转支持一切方法（含 POST 写行/上传），并把 p/q 里的百分号编码还原
#   v6 /api?p= 分支不再用 parse_qs 取 p —— 查询串里的 & 曾把 p 截断，
#      导致 convert_keys=true 丢失、社区卡片全变「未命名 / 作者：匿名」
#   v7 补上 do_PUT / do_DELETE / do_PATCH —— 以前没实现，BaseHTTPRequestHandler
#      对没有 do_XXX 的方法直接回 501，App 改行(PUT)/删行(DELETE) 全都失败
#   v8 出站统一摘掉「用户密码」列（代码里已无人引用；中转口令写在 APK 里，
#      等于对拿到包的人公开，不能再让它读走密码哈希）
#   v15 加两道闸（2026-10-27）：按 IP 限流 + 社区写入校验已注册邮箱
FUNC_VERSION = "v15"
SEATABLE_TOKEN = os.environ.get("SEATABLE_TOKEN", "").strip()
SEATABLE_UUID = os.environ.get("SEATABLE_UUID", "712bc4e0-a7b0-48ff-b5ea-098ce7eb3252").strip()
SEATABLE_SRV = os.environ.get("SEATABLE_SRV", "https://cloud.seatable.cn").rstrip("/")
# 允许客户端指定的基础表（只认这两张，别的会被换成默认的）
OK_UUIDS = (
    "712bc4e0-a7b0-48ff-b5ea-098ce7eb3252",   # 账号 / 社区
    "5ded0202-5402-4176-bde2-69a5f7c14af6",   # 更新 / 工程
)
# 「更新」库用的是**另一个** SeaTable API 令牌 —— 账号库那个令牌对它没有权限
# （2026-09-26 实测：拿账号令牌读更新表回 `403 invalid token`，这就是用户报的
#  "检查更新获取不到信息"的根因。以前 App 里单独存着这个令牌，
#  为了不让凭据进 APK 把它清空了，于是这条链断了 —— 现在挪到服务端环境变量里。）
UPDATE_UUID = "5ded0202-5402-4176-bde2-69a5f7c14af6"
SEATABLE_TOKEN_UPDATE = os.environ.get("SEATABLE_TOKEN_UPDATE", "").strip()


def _token_for(uuid_: str) -> str:
    """按目标库选 SeaTable API 令牌。"""
    if uuid_ == UPDATE_UUID and SEATABLE_TOKEN_UPDATE:
        return SEATABLE_TOKEN_UPDATE
    return SEATABLE_TOKEN

ALLOW = (
    "/api/v2.1/dtable/app-access-token/",
    "/api/v2.1/dtable/app-upload-link/",
    "/api/v2.1/dtable/app-download-link/",
    "/api/v2/dtables/",
    "/seafhttp/",
    "/files/",
)


_SSL = ssl.create_default_context()

# 绝不下发给客户端、也不允许被写回的列。
# 为什么要有这个（2026-09-26 全代码扫描发现的问题）：
#   中转的口令（X-App-Token）是**写死在 editor.js 里**的（发码接口和它同址，没法只靠服务端认证），
#   所以任何拿到 APK 的人都能把这个口令抠出来直接调中转 —— 也就是说这个中转对拿到包的人等于公开。
#   而「账号」表原来是**整行**返回的，里面有一列「用户密码」（老方案的加盐哈希）。
#   实测这列现在**代码里一次都没被引用**（登录已经改成邮箱 + 验证码），留着它只有坏处没有好处
#   —— 白白让拿到口令的人能读走所有人的密码哈希。所以这里统一在出站处摘掉。
# 注意：邮箱本身仍是账号查重/登录必需的，摘不掉；要彻底解决得把登录搬到服务端（已记进 NEXT.md）。
_SECRET_COLS = ("用户密码",)


def _strip_secret_cols(body: bytes) -> bytes:
    """把 rows 里不该外发的列摘掉。解析不了就原样返回（绝不因为加固把接口弄挂）。"""
    if not body:
        return body
    try:
        data = json.loads(body.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return body
    if not isinstance(data, dict):
        return body
    changed = False
    for key in ("rows", "first_row"):
        v = data.get(key)
        rows = v if isinstance(v, list) else ([v] if isinstance(v, dict) else [])
        for r in rows:
            if isinstance(r, dict):
                for c in _SECRET_COLS:
                    if c in r:
                        r.pop(c, None)
                        changed = True
    if not changed:
        return body
    return json.dumps(data, ensure_ascii=False).encode("utf-8")

# SeaTable 的两种认证头别用错（踩过一次，整个社区列表读不出来）：
#   /api/v2.1/dtable/app-access-token/ 和附件接口 → Authorization: Token <API密钥>
#   /api/v2/dtables/<uuid>/…（读写行、表结构）   → Authorization: Bearer <access_token>
# 所以中转要自己先换一次令牌并缓存，再带 Bearer 转发数据请求。
_TOKEN_CACHE = {}          # SeaTable API 令牌 -> {"acc","gw","exp"}（两个库各缓存一份）
_TOKEN_LOCK = threading.Lock()


def _access_token(uuid_: str = ""):
    """按目标库换访问令牌，顺便记住网关地址。

    关键：数据接口（/api/v2/dtables/…）**必须打在换令牌返回的 dtable_server 上**
    （实测是 https://cloud.seatable.cn/api-gateway/），不是直接打 cloud.seatable.cn ——
    打错会返回一个 HTML 的 404「对不起，你访问的页面不存在」，
    真机上表现成「社区加载失败：读取表格：404」。这个坑我踩过一次，记在这里。
    """
    now = time.time()
    tok = _token_for(uuid_ or "")
    with _TOKEN_LOCK:
        c = _TOKEN_CACHE.get(tok)
        if c and c["acc"] and c["exp"] > now:
            return c["acc"], c["gw"]
        req = urllib.request.Request(SEATABLE_SRV + "/api/v2.1/dtable/app-access-token/")
        req.add_header("Authorization", "Token " + tok)
        with urllib.request.urlopen(req, timeout=20, context=_SSL) as r:
            d = json.loads(r.read().decode("utf-8"))
        acc = d.get("access_token") or ""
        if not acc:
            raise RuntimeError("换令牌失败：%s" % d)
        gw = (d.get("dtable_server") or "").rstrip("/")
        if not gw:
            gw = SEATABLE_SRV + "/api-gateway"
        # 按令牌分别缓存：两个库的 access_token 不通用
        _TOKEN_CACHE[tok] = {"acc": acc, "gw": gw, "exp": now + 540}   # 服务端给 10 分钟，留点余量
        return acc, gw


def _allowed(path: str) -> bool:
    return any(path.startswith(a) for a in ALLOW)


# ---------------------------------------------------------------- 加固（2026-10-27）
# 背景：中转口令（X-App-Token）**写死在 APK 里**，拆包就能拿到 —— 拿到安装包的人
# 可以任意调这个中转。以前只有「发验证码」有冷却和全局限流，**读写接口完全不设防**：
# 谁都能拿它批量拉社区、往社区表灌垃圾行。这里补两道闸，原则是「宁可放过、不能误伤」：
#   ① 按来源 IP 的滑动窗口限流（读 600/分、写 120/分，可用环境变量调）。
#      阈值故意给得宽松：国内移动网络大量用户共享出口 IP（CGNAT），设小了会误杀真实用户。
#   ② 社区表写入必须带「用户邮箱」，且这个邮箱确实在「账号」表里注册过。
#      读不到账号表时一律放行 —— 加固绝不能把正常发布搞挂。
RELAY_PER_MIN = int(os.environ.get("RELAY_PER_MIN", "600"))
RELAY_WRITE_PER_MIN = int(os.environ.get("RELAY_WRITE_PER_MIN", "120"))
_IP_HITS = {}
_IP_LOCK = threading.Lock()

COMM_TABLE = "社区"
COMM_EMAIL_COL = "用户邮箱"
_ACCT_CACHE = {"t": 0.0, "emails": frozenset()}
_ACCT_LOCK = threading.Lock()


def _client_ip(handler):
    """取真实来源 IP：FC 在 X-Forwarded-For 里给，取最左边那个。"""
    try:
        xff = handler.headers.get("x-forwarded-for") or ""
        if xff:
            return xff.split(",")[0].strip()
        return (handler.client_address[0] if handler.client_address else "") or "?"
    except Exception:  # noqa: BLE001
        return "?"


def _check_ip_rate(ip, write):
    """滑动窗口限流：超限返回建议等待秒数，否则记一笔返回 0。"""
    limit = RELAY_WRITE_PER_MIN if write else RELAY_PER_MIN
    now = time.time()
    with _IP_LOCK:
        # 字典别无限长：桶太多就清掉 5 分钟没动静的
        if len(_IP_HITS) > 5000:
            for k in [k for k, v in _IP_HITS.items() if not v or now - v[-1] > 300]:
                _IP_HITS.pop(k, None)
        hits = _IP_HITS.setdefault(ip, [])
        while hits and now - hits[0] > 60:
            hits.pop(0)
        if len(hits) >= limit:
            return max(1, int(60 - (now - hits[0])) + 1)
        hits.append(now)
        return 0


def _acct_emails(force=False):
    """「账号」表里注册过的邮箱集合（缓存 60 秒：表很小，省一次往返）。

    force=True 时绕过缓存重新拉一次 —— 新建账号的人可能刚注册就发布，
    缓存还是旧的会把他误判成"未注册"，所以查不到时要强制刷新一次。
    """
    now = time.time()
    with _ACCT_LOCK:
        if not force and _ACCT_CACHE["emails"] and now - _ACCT_CACHE["t"] < 60:
            return _ACCT_CACHE["emails"]
    acc, gw = _access_token()
    url = "%s/api/v2/dtables/%s/rows/?table_name=%s&limit=1000&convert_keys=true" % (
        gw, SEATABLE_UUID, urllib.parse.quote("账号"))
    req = urllib.request.Request(url)
    req.add_header("Authorization", "Bearer " + acc)
    with urllib.request.urlopen(req, timeout=20, context=_SSL) as r:
        d = json.loads(r.read().decode("utf-8"))
    out = set()
    for row in (d.get("rows") or []):
        if isinstance(row, dict):
            e = str(row.get(COMM_EMAIL_COL) or "").strip().lower()
            if e:
                out.add(e)
    with _ACCT_LOCK:
        _ACCT_CACHE["t"] = now
        _ACCT_CACHE["emails"] = frozenset(out)
    return _ACCT_CACHE["emails"]


def _check_community_write(method, path, query, body_raw):
    """社区表写入校验：返回 (放行?, 说明)。

    只拦 POST/PUT（新增行 / 改行）—— DELETE 必须先拿到行 id，滥用成本高，不在这里拦。
    """
    if method not in ("POST", "PUT") or not body_raw:
        return True, ""
    # ⚠️ table_name 可能藏在 path 里的查询串：客户端把「路径+查询串」整条塞进 p
    raw_q = path.split("?", 1)[1] if "?" in path else (query or "")
    table = (urllib.parse.parse_qs(raw_q).get("table_name") or [""])[0]
    if table != COMM_TABLE:
        return True, ""
    try:
        data = json.loads(body_raw.decode("utf-8"))
        rows = data.get("rows") if isinstance(data, dict) else None
    except Exception:  # noqa: BLE001
        return True, ""
    if not isinstance(rows, list):
        return True, ""
    try:
        known = _acct_emails()
    except Exception:  # noqa: BLE001
        return True, ""          # 读不到账号表 → 放行（不能因为加固把发布搞挂）
    for r in rows:
        if not isinstance(r, dict):
            continue
        email = str(r.get(COMM_EMAIL_COL) or "").strip().lower()
        if not email:
            return False, "发布到社区必须带「用户邮箱」"
        if email not in known:
            # 可能是"刚注册就发布"，本地缓存还没刷新 —— 强制重拉一次再判
            try:
                known = _acct_emails(force=True)
            except Exception:  # noqa: BLE001
                return True, ""
            if email not in known:
                return False, "这个邮箱还没注册账号，不能发布到社区"
    return True, ""


def _raw_p(raw_query: str, name: str = "p") -> str:
    """从**原始**查询串里取值，不用 parse_qs。

    为什么不能用 parse_qs（2026-09-26 定位到的真 bug）：
      客户端把**整条**「路径 + 查询串」塞进 p（见 editor.js 的 中转链接），
      于是外层查询串长这样：
        p=/api/v2/dtables/<uuid>/rows/?table_name=%E7%A4%BE%E5%8C%BA&limit=1000&convert_keys=true
      parse_qs 按 & 切分，会把 p 截成 "…?table_name=社区"，
      后面的 limit / convert_keys 全被当成中转自己的参数丢掉。
      后果：SeaTable 收不到 convert_keys=true，行按列 key 返回（0000 / 020Y 这种四位乱码），
      editor.js 里 row['作品名']、row['用户名'] 全是 undefined
      → 社区卡片一律显示「未命名 / 作者：匿名」。用户在 2026-09-25 报的就是这个。
      对照实验（拿真表跑过）：直达路径 /api/v2/dtables/…?…&convert_keys=true 正常回中文列名，
      走 /api?p=… 这条就把参数丢了 —— 差别只在这里。

    这一分支里 p 永远是唯一的参数，所以「p= 之后到结尾」就是完整的值；
    末尾若跟了中转自己的 u=/t= 参数，切掉。命令式取值恰好还原客户端原意，
    而且**已装在手机上的旧版 App 不用重装**就跟着好。
    """
    m = re.search(r"(?:^|&)" + re.escape(name) + "=", raw_query or "")
    if not m:
        return ""
    val = raw_query[m.end():]
    # 切掉中转自己的收尾参数。q/m/u/t 是这条分支上中转认识的参数名；
    # 本 App 用到的 SeaTable 路径（…/rows/?table_name=…&limit=…&convert_keys=true、
    # app-upload-link、app-download-link、seafhttp、files）里都不含 &q= / &m=，
    # 所以这样切不会误伤真实查询串。
    val = re.split(r"&(?=(?:q|m|u|t)=)", val)[0]
    return val


def _json(status: int, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    return status, {"Content-Type": "application/json; charset=utf-8"}, body


_RECENT = []          # 最近几次请求的"路径 + 查询串"，用 /echo 读出来排查（最多 20 条）
_RECENT_LOCK = threading.Lock()


def _remember(path: str, query: str, raw: str = ""):
    """记一笔最近的请求，出问题时能直接看到客户端到底发了什么。
    用法：POST 时把原始请求体的前 300 字符也记下来（排查"发过来的 p 是空的"这类问题）。"""
    try:
        with _RECENT_LOCK:
            _RECENT.append({"path": path, "query": query, "t": int(time.time()), "raw": (raw or "")[:300]})
            del _RECENT[:-20]
    except Exception:  # noqa: BLE001
        pass


def _iri(url: str) -> str:
    """把 URL 里的非 ASCII 字符按 UTF-8 百分号编码。
    为什么必须做：Python 的 urllib 拼请求行时只接受 ASCII，
    URL 里只要有一个中文（表名 "账号"/"社区" 被解码回来就会出现）就抛
    "'ascii' codec can't encode characters ..."，表现就是真机上
    「加载失败：读取表格：上游连不上：'ascii' codec can't encode…」。"""
    out = []
    for ch in url:
        if ord(ch) < 128:
            out.append(ch)
        else:
            out.extend("%%%02X" % b for b in ch.encode("utf-8"))
    return "".join(out)


def relay(method: str, path: str, query: str, body_raw: bytes, content_type: str, use_uuid: str = ""):
    """把请求原样转给 SeaTable，再把响应原样带回来（云中转的核心）。"""
    if not SEATABLE_TOKEN:
        return _json(500, {"error": "服务端还没配置 SEATABLE_TOKEN"})
    _remember(path, query)          # 留痕：/echo 能看到最近请求
    # 客户端把路径/查询串 **编码** 后放进 JSON 或外层查询串（encodeURIComponent），
    # 透过 JSON 时编码不会自动还原 —— 这里必须自己解开，否则白名单认不出来，
    # 直接回 403 path not allowed（2026-09-25 用户报的"发布到社区失败"就是这条）。
    try:
        if "%" in path:
            path = urllib.parse.unquote(path)
    except Exception:  # noqa: BLE001
        pass
    try:
        if "%" in query:
            query = urllib.parse.unquote(query)
    except Exception:  # noqa: BLE001
        pass
    if not path.startswith("/"):
        path = "/" + path
    if not _allowed(path):
        return _json(403, {"error": "path not allowed"})
    # 社区表写入必须是一个已注册账号（见 _check_community_write 的说明）
    _ok, _why = _check_community_write(method, path, query, body_raw)
    if not _ok:
        return _json(403, {"error": _why})
    # 表 UUID 一律以服务端白名单为准：客户端就算传了别的库也会被换回来
    target_uuid = use_uuid if use_uuid in OK_UUIDS else SEATABLE_UUID
    parts = path.split("/")
    # /api/v2/dtables/<uuid>/...
    if len(parts) > 4 and parts[1] == "api" and parts[2] == "v2" and parts[3] == "dtables":
        parts[4] = target_uuid
        path = "/".join(parts)
    # 数据接口：用网关地址 + Bearer 访问令牌（见 _access_token 的说明）
    is_data = path.startswith("/api/v2/dtables/")
    base = SEATABLE_SRV
    if is_data:
        try:
            acc, gw = _access_token(target_uuid)
            base = gw
            req = urllib.request.Request(_iri(base + path + (("?" + query.lstrip("?")) if query else "")),
                                         data=body_raw if method in ("POST", "PUT", "DELETE", "PATCH") else None,
                                         method=method)
            req.add_header("Authorization", "Bearer " + acc)
            req.add_header("Accept", "application/json")
            if content_type:
                req.add_header("Content-Type", content_type)
            elif body_raw:
                req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=55, context=_SSL) as resp:
                return resp.status, {"Content-Type": resp.headers.get("Content-Type", "application/json")}, _strip_secret_cols(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, {"Content-Type": e.headers.get("Content-Type", "application/json") if e.headers else "application/json"}, e.read()
        except Exception as e:  # noqa: BLE001
            return _json(502, {"error": "读取表格失败：%s" % e})

    url = _iri(base + path + (("?" + query.lstrip("?")) if query else ""))
    req = urllib.request.Request(url, data=body_raw if method in ("POST", "PUT", "DELETE", "PATCH") else None, method=method)
    # 换令牌/附件接口走 Token —— 也要**按目标库**选令牌（附件下载链接必须用有权限的那个令牌换）
    req.add_header("Authorization", "Token " + _token_for(target_uuid))
    req.add_header("Accept", "application/json")
    if content_type:
        req.add_header("Content-Type", content_type)
    elif body_raw:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=55, context=_SSL) as resp:
            data = resp.read()
            ctype = resp.headers.get("Content-Type", "application/json")
            return resp.status, {"Content-Type": ctype}, data
    except urllib.error.HTTPError as e:
        data = e.read()
        ctype = e.headers.get("Content-Type", "application/json") if e.headers else "application/json"
        return e.code, {"Content-Type": ctype}, data
    except Exception as e:  # noqa: BLE001
        return _json(502, {"error": "上游连不上：%s" % e})

# ---------------------------------------------------------------- HTTP 服务
class Handler(BaseHTTPRequestHandler):
    server_version = "FastMailFC/1.0"

    def _send(self, status, obj, headers=None, raw=None):
        body = raw if raw is not None else json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", (headers or {}).get("Content-Type", "application/json; charset=utf-8"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-App-Token,Authorization,X-Fast-Ct")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _guard(self, write=False):
        """限流闸：所有中转入口先过这里（放在鉴权/读请求体之前，被刷时最省资源）。"""
        wait = _check_ip_rate(_client_ip(self), write)
        if wait > 0:
            self._send(429, {"error": "请求太频繁，请 %d 秒后再试" % wait, "wait": wait})
            return False
        return True

    def _authed(self):
        # 未配置 APP_TOKEN 时不拦截（建议务必配置）
        if not APP_TOKEN:
            return True
        got = self.headers.get("X-App-Token", "")
        if not got:
            # 附件下载允许把口令放在查询串里（?t=…）：<img> 直接加载没法加自定义请求头，
            # 否则社区卡片的作品图一律 401，表现就是"卡片全都不显示图片"。
            try:
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                got = (qs.get("t") or [""])[0]
            except Exception:  # noqa: BLE001
                got = ""
        return hmac.compare_digest(got, APP_TOKEN)

    def do_OPTIONS(self):
        self._send(204, {"ok": True})

    def do_HEAD(self):
        self._send(200, {"ok": True})

    # ---- 云中转：附件下载（/api/download?path=相对路径）----
    def _relay_download(self):
        if not self._guard():
            return
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        rel = (qs.get("path") or [""])[0]
        if not rel or "//" in rel or ".." in rel:
            self._send(400, {"error": "bad path"})
            return
        if not self._authed():
            self._send(401, {"error": "未授权：X-App-Token 不正确"})
            return
        # 附件属于哪个库由 `u=` 指定（和读表一条规矩）：不传就是账号/社区库。
        # 「更新」库的文件用账号库的令牌换链接会 403，所以这里必须按库选令牌。
        u = (qs.get("u") or [""])[0]
        tok = _token_for(u if u in OK_UUIDS else SEATABLE_UUID)
        if not tok:
            self._send(500, {"error": "服务端还没配置 SeaTable 令牌"})
            return
        url = "%s/api/v2.1/dtable/app-download-link/?path=%s" % (SEATABLE_SRV, urllib.parse.quote(rel, safe=""))
        req = urllib.request.Request(url)
        req.add_header("Authorization", "Token " + tok)
        try:
            with urllib.request.urlopen(req, timeout=55, context=ssl.create_default_context()) as r:
                link = json.loads(r.read().decode("utf-8")).get("download_link") or ""
        except Exception as e:  # noqa: BLE001
            self._send(502, {"error": "取下载地址失败：%s" % e})
            return
        if not link:
            self._send(502, {"error": "没拿到下载地址"})
            return
        if link.startswith("/"):
            link = SEATABLE_SRV + link
        if "token=" not in link:
            link += ("&" if "?" in link else "?") + "token=" + urllib.parse.quote(tok, safe="")
        try:
            with urllib.request.urlopen(link, timeout=55, context=ssl.create_default_context()) as fr:
                data = fr.read()
                ctype = fr.headers.get("Content-Type", "application/octet-stream")
        except Exception as e:  # noqa: BLE001
            self._send(502, {"error": "下载失败：%s" % e})
            return
        self._send(200, None, {"Content-Type": ctype}, raw=data)

    # ---------------------------------------------------------------- 云中转入口
    def _relay_apk(self):
        """把随函数代码一起上传的安装包发出去（GET /apk）。

        口令走 X-App-Token 头或 `?t=`（和附件下载一套，`<a>`/浏览器直接点没法带头）。
        包放在 `code/fast.apk`（相对 index.py 的目录）。
        找不到时明确说清楚——多半是部署时忘了拷包进去。
        """
        if not self._authed():
            self._send(401, {"error": "未授权：口令不对"})
            return
        if not self._guard():
            return
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fast.apk")
        try:
            with open(path, "rb") as f:
                data = f.read()
        except Exception as e:  # noqa: BLE001
            self._send(404, {"error": "函数里还没有安装包（部署时要把 fast.apk 一起放进去）：%s" % e})
            return
        name = "FAST.apk"
        # 版本号写进文件名，方便用户确认下到的是哪一版
        m = re.search(rb"1\.0\.\d+\.\d+", data[:400000])
        if m:
            name = "FAST_v%s.apk" % m.group(0).decode("ascii", "ignore")
        # ⚠️ Content-Type 必须是通用二进制，**不能**声明成安卓安装包类型：
        # 阿里云 FC 对公网 HTTP 触发器有一条硬策略 —— 响应声明成 APK 就直接 400
        # `ApkDownloadForbidden`（"The APK file is not allowed to be distributed in a
        # public network using the HTTP Trigger public endpoint"）。平台策略，不是我们代码的问题。
        # 用 octet-stream + attachment 文件名，浏览器下来仍是 .apk，能直接点装。
        self._send(200, None, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": 'attachment; filename="%s"' % name,
        }, raw=data)

    def _read_raw(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n > 0 else None

    def _relay_api(self, default_method):
        """把 /api 上的中转请求转给 SeaTable（POST / PUT / DELETE / PATCH 共用）。

        ⚠️ 为什么要专门把 PUT/DELETE 接上（2026-09-26 用户截图「发布到社区 请求失败 HTTP 501」的根因）：
        BaseHTTPRequestHandler 对**没有 do_XXX 的方法**一律回 `501 Unsupported method`，
        根本进不到我们的代码里（所以函数日志里连一条请求都看不到 —— 这就是定位线索）。
        而 App 里 editorCloudHttp 是**用真实 HTTP 方法**发的（把业务体打包进 b）：
          · 新增行       → POST  ✅ 一直能用
          · 改行/同步账号行 → PUT   ❌ 501
          · 删行/删除分享   → DELETE ❌ 501
        于是「发布到社区」新增那一行成功、紧接着同步「账号」行就 501，
        用户看到的就是那句「请求失败 HTTP 501」。
        自测为什么漏了：我当初是用「POST /api + body 里 m=PUT」验的，那条路当然通。
        **教训：自测必须照客户端真实的 HTTP 方法发，别自己换一种形状。**
        """
        if not self._guard(write=True):
            return
        if not self._authed():
            self._send(401, {"error": "未授权：X-App-Token 不正确"})
            return
        data = self._read_json()
        pth = str(data.get("p") or "")
        # b 是**原样对象**时按 JSON 转发；b 是**字符串**时是附件上传的 multipart 体
        # （客户端按"一字符=一字节"传过来），这里按 latin-1 还原成二进制原样转发。
        m = str(data.get("m") or default_method).upper()
        b = data.get("b")
        body_raw, ctype = None, ""
        if b is not None and m != "GET":
            if isinstance(b, str):
                body_raw = b.encode("latin-1", "ignore")
                ctype = str(data.get("ct") or self.headers.get("X-Fast-Ct") or "multipart/form-data")
            else:
                body_raw = json.dumps(b, ensure_ascii=False).encode("utf-8")
                ctype = "application/json"
        status, headers, body = relay(m, pth, str(data.get("q") or ""), body_raw, ctype,
                                      str(data.get("u") or ""))
        self._send(status, None, headers, raw=body)

    def _relay_direct(self, method):
        """直达式中转：METHOD /api/v2/dtables/…?table_name=…（不打 ?p= 包的那种写法）"""
        if not self._guard(write=(method != "GET")):
            return
        if not self._authed():
            self._send(401, {"error": "未授权：X-App-Token 不正确"})
            return
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        raw = self._read_raw() if method in ("POST", "PUT", "DELETE", "PATCH") else None
        status, headers, body = relay(method, parsed.path, parsed.query, raw,
                                      str(self.headers.get("Content-Type") or ""),
                                      str((qs.get("u") or [""])[0]))
        self._send(status, None, headers, raw=body)

    def do_GET(self):
        raw_path = self.path.split("?")[0]
        p = raw_path.rstrip("/")
        if p == "/api/download":
            self._relay_download()
            return
        # 直达式中转：注意 /api、/api/download 已经单独处理过了，这里只接 /api/ 开头的真实路径。
        if raw_path.startswith("/api/") and not raw_path.startswith("/api/download"):
            self._relay_direct("GET")
            return
        # APK 直发：GET /apk（或 /apk?t=<口令>）
        # 为什么把安卓包挂到这里（2026-09-26）：
        #   以前每次发版都靠临时隧道（cloudflared quick tunnel / localhost.run）——
        #   前者进程一挂域名就作废，后者大约 20 分钟断一次**还会换域名**，
        #   用户每次拿到的链接很快失效，反复要新链接。这个函数是常驻的、国内访问也稳，
        #   把包放进来就得到一个**永不变的下载地址**。
        #   `code/fast.apk` 随函数代码一起上传（部署脚本会把当前构建的 APK 拷进去）。
        if p in ("/apk", "/download", "/fast.apk") or raw_path.startswith("/dl/"):
            # `/dl/<文件名>` 这种走法是为了让**浏览器按 URL 末段保存文件名**：
            # 阿里云会把我们发的 Content-Disposition 里的 filename 抹掉（只剩 attachment），
            # 所以文件名只能靠 URL 带，例如 /dl/FAST_v1.0.116.110.apk
            self._relay_apk()
            return
        if p == "/api":
            if not self._guard():
                return
            if not self._authed():
                self._send(401, {"error": "未授权：X-App-Token 不正确"})
                return
            # 关键：p/q 必须从**原始**查询串取，不能用 parse_qs ——
            # 客户端把「路径+查询串」整条放进 p，里面的 & 会被 parse_qs 截断
            # （convert_keys=true 就是这么丢的 → 社区卡片全变「未命名/匿名」）。
            # 详见 _raw_p 的说明。
            _rawq = urllib.parse.urlparse(self.path).query
            _qs = urllib.parse.parse_qs(_rawq)
            status, headers, body = relay(
                (str((_qs.get("m") or ["GET"])[0]).upper()),
                _raw_p(_rawq, "p"),
                _raw_p(_rawq, "q"),
                None,
                "",
                (str((_qs.get("u") or [""])[0])),
            )
            self._send(status, None, headers, raw=body)
            return
        if p == "/echo":
            if not self._guard():
                return
            # 调试用：把这次请求的路径/查询串原样回显（部署后用它看客户端到底发了什么）
            parsed = urllib.parse.urlparse(self.path)
            self._send(200, {"path": parsed.path, "query": parsed.query, "最近请求": list(_RECENT[-10:]),
                             "qs": {k: v for k, v in urllib.parse.parse_qs(parsed.query).items()},
                             "headers": {k: v for k, v in self.headers.items() if k.lower() in ("x-app-token", "host")}})
            return
        if p in ("/healthz", "/health", ""):
            if not self._guard():
                return
            # 自检：顺带报一下"函数能不能连到 SeaTable"，省得靠猜（部署后先看这个）
            info = {"ok": True, "func_version": FUNC_VERSION, "smtp_user": SMTP_USER, "seatable_srv": SEATABLE_SRV,
                    "has_token": bool(SEATABLE_TOKEN), "uuid": SEATABLE_UUID}
            try:
                req = urllib.request.Request(SEATABLE_SRV + "/api/v2.1/dtable/app-access-token/")
                req.add_header("Authorization", "Token " + SEATABLE_TOKEN)
                with urllib.request.urlopen(req, timeout=15, context=_SSL) as r:
                    info["seatable"] = "OK HTTP %d" % r.status
            except urllib.error.HTTPError as e:
                info["seatable"] = "HTTP %d（能连上，只是这个探测请求本身的问题）" % e.code
            except Exception as e:  # noqa: BLE001
                info["seatable"] = "连不上：%s" % e
            self._send(200, info)
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        raw_path = self.path.split("?")[0]
        p = raw_path.rstrip("/")
        if p == "/api":
            self._relay_api("POST")
            return
        if raw_path.startswith("/api/") and not raw_path.startswith("/api/download"):
            self._relay_direct("POST")
            return
        try:
            if not self._authed():
                self._send(401, {"error": "未授权：X-App-Token 不正确"})
                return
            data = self._read_json()
            try:
                _RECENT.append({"RAW": json.dumps(data, ensure_ascii=False)[:600], "t": int(time.time())})
                del _RECENT[:-20]
            except Exception:  # noqa: BLE001
                pass
            action = (data.get("action") or "").strip().lower()
            if action == "send":
                result = send_code(str(data.get("email") or ""))
                self._send(200, result)
            elif action in ("verify", "login"):
                result = verify_code(str(data.get("email") or ""),
                                     str(data.get("code") or ""),
                                     str(data.get("challenge") or ""))
                self._send(200, result)
            else:
                self._send(400, {"error": "未知 action（send / verify）"})
        except CooldownError as e:
            self._send(429, {"error": str(e), "wait": e.wait})
        except ValueError as e:
            self._send(400, {"error": str(e)})
        except smtplib.SMTPAuthenticationError:
            self._send(500, {"error": "发信邮箱登录失败：请检查 SMTP 授权码是否正确、是否已开启 SMTP 服务"})
        except Exception as e:
            self._send(500, {"error": "服务器开小差了，请稍后再试"})

    # ---- 这三个方法以前压根没实现 —— BaseHTTPRequestHandler 对没有 do_XXX 的方法
    #      直接回 501 Unsupported method，代码根本进不来（函数日志里连请求都看不到）。
    #      而 App 改行是 PUT、删行是 DELETE，所以「发布到社区」到「同步账号行」那一步必挂 501。
    def do_PUT(self):
        raw_path = self.path.split("?")[0]
        p = raw_path.rstrip("/")
        if p == "/api":
            self._relay_api("PUT")
            return
        if raw_path.startswith("/api/"):
            self._relay_direct("PUT")
            return
        self._send(404, {"error": "not found"})

    def do_DELETE(self):
        raw_path = self.path.split("?")[0]
        p = raw_path.rstrip("/")
        if p == "/api":
            self._relay_api("DELETE")
            return
        if raw_path.startswith("/api/"):
            self._relay_direct("DELETE")
            return
        self._send(404, {"error": "not found"})

    def do_PATCH(self):
        raw_path = self.path.split("?")[0]
        p = raw_path.rstrip("/")
        if p == "/api":
            self._relay_api("PATCH")
            return
        if raw_path.startswith("/api/"):
            self._relay_direct("PATCH")
            return
        self._send(404, {"error": "not found"})

    def log_message(self, *args):
        # FC 日志里保持安静，避免刷屏
        return


def main():
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("FAST mail function listening on 0.0.0.0:%d" % PORT, flush=True)
    httpd.serve_forever()


# FC Web 函数以 `python index.py` 启动；同时保留本地直接运行能力
if __name__ == "__main__":
    main()

