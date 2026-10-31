# -*- coding: utf-8 -*-
"""
FAST 云函数（阿里云函数计算 FC · Web 函数）—— 邮箱验证码 + 云中转 v16。

这一版把云中转的后端从 SeaTable 换成了「阿里云 OSS 为主、GitHub 为备」，
但**对客户端的接口形状一个字节都没变**（editor.js 不需要改任何一行）：
  · GET  /api?p=/api/v2.1/dtable/app-access-token/   → 假令牌（"oss"）
  · GET  /api?p=/api/v2/dtables/<uuid>/rows/?table_name=…&convert_keys=true → {"rows":[…]}
  · POST 同路径 {table_name, rows:[…]}                → {"inserted_row_count":n,"first_row":{…}}
  · PUT  同路径 {table_name, updates:[{row_id,row}]}  → {"success":true}
  · DELETE 同路径 {table_name, row_ids:[…]}           → {"success":true}
  · GET  /api?p=/api/v2.1/dtable/app-upload-link/     → 本函数自己的上传地址
  · POST /api/upload（multipart/form-data）           → [{"id","name","size"}]
  · GET  /api/download?path=…&t=…                     → 文件二进制

为什么这么设计
--------------
SeaTable 是第三方服务，配额/账单/接口变动都不由自己控制；换成 OSS 之后数据在自己桶里，
再加一份 GitHub 私有仓库做备份。读写规则：
  · 读：先 OSS（8 秒超时），任何异常（网络、403、超时）→ 改读 GitHub；
  · 写：先 OSS，失败 → 改写 GitHub；OSS 写成功后顺带把同一份内容镜像到 GitHub（备份要新）。
  · 附件只走 OSS（GitHub 不适合存大文件），所以附件上传/下载在 OSS 不可用时直接报错。
/healthz 会回最近一次实际用的是哪个后端（backend=oss / github），方便线上判断。

数据格式（两张后端完全一致，便于互相顶替）
------------------------------------------
  键：db/accounts.json（账号）、db/community.json（社区）、db/updates.json（更新）
  内容：{"rows": [{"_id": "…", 列名: 值, …}]}

邮件验证码部分（challenge HMAC、SMTP、冷却、错误形状）保持原样：
FC 可能同时拉起多个实例，内存存码会出现「发码在 A、验码在 B」对不上的问题，
所以发码下发 HMAC 签名令牌（内含邮箱、过期时间、验证码哈希），验码只校验签名+时效。

环境变量（在 FC 控制台配，别写进代码）
   APP_TOKEN         客户端调用口令（必填；下载允许 ?t= 形式）
   SMTP_USER / SMTP_PASS  QQ 邮箱发信账号与授权码
   OSS_AK / OSS_SK    阿里云 AccessKey（只用于这个私有桶）
   可选：OSS_HOST / OSS_BUCKET / GH_TOKEN / GH_REPO / GH_BRANCH
"""

import base64
import email.utils
import hashlib
import hmac
import json
import mimetypes
import os
import re
import smtplib
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------- 配置
SMTP_USER = os.environ.get("SMTP_USER", "3457525474@qq.com").strip()
SMTP_PASS = os.environ.get("SMTP_PASS", "").strip()
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.qq.com").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
APP_TOKEN = os.environ.get("APP_TOKEN", "").strip()
SECRET = (os.environ.get("HMAC_SECRET", "").strip() or APP_TOKEN or "fast-dev-secret").encode("utf-8")
CODE_TTL = int(os.environ.get("CODE_TTL", "300"))
SEND_COOLDOWN = int(os.environ.get("SEND_COOLDOWN", "60"))
SENDER_NAME = os.environ.get("SENDER_NAME", "FAST 积木编程").strip()
PORT = int(os.environ.get("FC_SERVER_PORT", "9000"))

# OSS（虚拟主机风格）：URL 路径 /key，但签名用的 CanonicalizedResource 是 /<bucket>/<key>
OSS_AK = (os.environ.get("OSS_AK") or os.environ.get("ALI_AK") or "").strip()
OSS_SK = (os.environ.get("OSS_SK") or os.environ.get("ALI_SK") or "").strip()
OSS_HOST = os.environ.get("OSS_HOST", "oss-cn-beijing.aliyuncs.com").strip()
OSS_BUCKET = os.environ.get("OSS_BUCKET", "fast-cloud-1512689308105776").strip()
OSS_TIMEOUT = float(os.environ.get("OSS_TIMEOUT", "8"))

# GitHub 备份：只用 Contents API 读写 JSON 表
GH_TOKEN = os.environ.get("GH_TOKEN", "").strip()
GH_REPO = os.environ.get("GH_REPO", "dashen9178/fast-cloud").strip()
GH_BRANCH = os.environ.get("GH_BRANCH", "main").strip()

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
_SSL = ssl.create_default_context()

# 中文表名 → 后端键。客户端只用这几张表，其它表名一律 404。
TABLE_FILES = {
    "账号": "db/accounts.json",
    "社区": "db/community.json",
    "更新": "db/updates.json",
    # v17：社区评论（作品iD / 评论iD / 父评论iD / 作者 / 用户邮箱 / 内容 / 时间）
    "评论": "db/comments.json",
}

# 函数版本号：/healthz 回出来，用来远程确认线上跑的是哪一版。
#   v15 邮件 + SeaTable 中转
#   v16 中转后端换成 OSS(主) + GitHub(备)，客户端接口形状不变
#   v17 新增「评论」表（db/comments.json），社区评论区用
FUNC_VERSION = "v20"


# ---------------------------------------------------------------- 无状态 challenge 令牌（原样保留）
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
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------- 发信（原样保留）
_last_send = {}
_last_lock = threading.Lock()


def _check_cooldown(key):
    """最佳努力冷却限流：冷却期内返回剩余秒数，否则记为现在并返回 0。"""
    now = time.time()
    with _last_lock:
        for k in [k for k, t in _last_send.items() if now - t > 3600]:
            _last_send.pop(k, None)
        last = _last_send.get(key, 0)
        wait = SEND_COOLDOWN - int(now - last)
        if wait > 0:
            return wait
        _last_send[key] = now
        return 0


# 全局限流：中转口令写死在 APK 里，拿到包的人就能调发信接口，必须防批量刷邮箱额度。
SEND_PER_MIN_GLOBAL = int(os.environ.get("SEND_PER_MIN_GLOBAL", "8"))
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


class CooldownError(Exception):
    def __init__(self, wait):
        super().__init__("发送太频繁，请 %d 秒后再试" % wait)
        self.wait = wait


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
        except Exception:  # noqa: BLE001
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


# ---------------------------------------------------------------- 存储层：OSS（主）
class StorageError(Exception):
    pass


def _oss_auth(verb, resource, ctype=""):
    """OSS V1 签名（HMAC-SHA1）：VERB\\nContent-MD5\\nContent-Type\\nDate\\nCanonicalizedResource。"""
    date = email.utils.formatdate(usegmt=True)
    sts = "%s\n\n%s\n%s\n%s" % (verb, ctype, date, resource)
    sig = base64.b64encode(hmac.new(OSS_SK.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    return "OSS %s:%s" % (OSS_AK, sig), date


def _oss_req(verb, key, body=None, ctype="", timeout=None):
    """虚拟主机风格：URL 路径 /key，签名资源 /<bucket>/<key>（两回事，别混）。"""
    timeout = OSS_TIMEOUT if timeout is None else timeout
    k = "/".join(urllib.parse.quote(seg, safe="") for seg in key.lstrip("/").split("/"))
    resource = "/%s/%s" % (OSS_BUCKET, key.lstrip("/"))
    auth, date = _oss_auth(verb, resource, ctype)
    req = urllib.request.Request("https://%s.%s/%s" % (OSS_BUCKET, OSS_HOST, k), data=body, method=verb)
    req.add_header("Date", date)
    req.add_header("Authorization", auth)
    if ctype:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _oss_get(key):
    """读对象：不存在返回 None；其它非 200 抛异常（交给 GitHub 兜底）。"""
    if not (OSS_AK and OSS_SK):
        raise StorageError("没配置 OSS_AK / OSS_SK")
    st, b = _oss_req("GET", key)
    if st == 200:
        return b
    if st in (404, 405):  # 405 是「对象不存在」的变体，同样按空表处理
        return None
    raise StorageError("OSS GET %s HTTP %d" % (key, st))


def _oss_put(key, data, ctype="application/octet-stream"):
    if not (OSS_AK and OSS_SK):
        raise StorageError("没配置 OSS_AK / OSS_SK")
    st, b = _oss_req("PUT", key, data, ctype)
    if st not in (200, 201):
        raise StorageError("OSS PUT %s HTTP %d" % (key, st))
    return True


def _oss_signed_url(key, expires=604800):
    """OSS 预签名 GET 直链（虚拟主机风格）。用来绕开 FC 公网端点禁止分发 APK 的限制。"""
    if not (OSS_AK and OSS_SK):
        raise StorageError("没配置 OSS_AK / OSS_SK")
    k = "/".join(urllib.parse.quote(seg, safe="") for seg in key.lstrip("/").split("/"))
    resource = "/%s/%s" % (OSS_BUCKET, key.lstrip("/"))
    ts = int(time.time()) + int(expires)
    sts = "GET\n\n\n%d\n%s" % (ts, resource)
    sig = base64.b64encode(hmac.new(OSS_SK.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    return "https://%s.%s/%s?OSSAccessKeyId=%s&Expires=%d&Signature=%s" % (
        OSS_BUCKET, OSS_HOST, k,
        urllib.parse.quote(OSS_AK, safe=""), ts, urllib.parse.quote(sig, safe=""))


# ---------------------------------------------------------------- 存储层：GitHub（备）
def _gh_req(method, key, body=None):
    if not GH_TOKEN:
        raise StorageError("没配置 GH_TOKEN")
    url = "https://api.github.com/repos/%s/contents/%s" % (GH_REPO, urllib.parse.quote(key, safe="/"))
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + GH_TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "fast-cloud-fc")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10, context=_SSL) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _gh_get(key):
    """返回 (bytes|None, sha|None)。不存在返回 (None, None)。"""
    st, b = _gh_req("GET", key)
    if st in (404, 409):
        return None, None
    if st != 200:
        raise StorageError("GitHub GET %s HTTP %d" % (key, st))
    d = json.loads(b.decode("utf-8"))
    sha = d.get("sha")
    content = d.get("content") or ""
    if content:
        data = base64.b64decode("".join(str(content).split("\n")))
    else:
        # 文件超过 1MB 时 contents API 不回 content，只给 download_url
        dl = d.get("download_url")
        if not dl:
            return b"", sha
        req = urllib.request.Request(dl, headers={"Authorization": "Bearer " + GH_TOKEN})
        with urllib.request.urlopen(req, timeout=15, context=_SSL) as r:
            data = r.read()
    return data, sha


def _gh_put(key, data, message):
    """新建或更新文件。更新必须带 sha，所以先 GET 一次；冲突(409)就重取一次再试。"""
    last = 0
    for attempt in (0, 1):
        _, sha = _gh_get(key)
        body = {"message": message, "content": base64.b64encode(data).decode("ascii"), "branch": GH_BRANCH}
        if sha:
            body["sha"] = sha
        st, _ = _gh_req("PUT", key, body)
        if st in (200, 201):
            return True
        last = st
        if st != 409:
            break
    raise StorageError("GitHub PUT %s HTTP %d" % (key, last))


# ---------------------------------------------------------------- 存储层：统一入口
_STATE = {"read": "", "write": "", "error": "", "at": 0}
_STATE_LOCK = threading.Lock()
_STORE_LOCK = threading.RLock()   # 读-改-写必须是原子的，否则并发发布会互相覆盖


def _set_state(kind, backend, error=""):
    with _STATE_LOCK:
        _STATE[kind] = backend
        if error:
            _STATE["error"] = error[:160]
        _STATE["at"] = int(time.time())


def _store_read_json(key):
    """读一张表：先 OSS（8 秒），异常/超时就改 GitHub。返回 (obj, backend)。"""
    oss_err = ""
    if OSS_AK and OSS_SK:
        try:
            raw = _oss_get(key)
            obj = json.loads(raw.decode("utf-8")) if raw else {"rows": []}
            _set_state("read", "oss")
            return obj, "oss"
        except Exception as e:  # noqa: BLE001
            oss_err = "OSS 读失败：%s" % e
    if GH_TOKEN:
        try:
            raw, _sha = _gh_get(key)
            obj = json.loads(raw.decode("utf-8")) if raw else {"rows": []}
            _set_state("read", "github", oss_err)
            return obj, "github"
        except Exception as e:  # noqa: BLE001
            raise StorageError("%s；GitHub 读失败：%s" % (oss_err or "OSS 未配置", e))
    raise StorageError(oss_err or "OSS / GitHub 都没配置")


def _store_write_json(key, obj):
    """写一张表：先 OSS；失败改 GitHub。OSS 成功后顺带镜像一份到 GitHub（备份要新）。"""
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    oss_err = ""
    if OSS_AK and OSS_SK:
        try:
            _oss_put(key, data, "application/json; charset=utf-8")
            _set_state("write", "oss")
            _mirror_to_github(key, data)
            return "oss"
        except Exception as e:  # noqa: BLE001
            oss_err = "OSS 写失败：%s" % e
    if GH_TOKEN:
        try:
            _gh_put(key, data, "fast-cloud: 更新 " + key)
            _set_state("write", "github", oss_err)
            return "github"
        except Exception as e:  # noqa: BLE001
            raise StorageError("%s；GitHub 写失败：%s" % (oss_err or "OSS 未配置", e))
    raise StorageError(oss_err or "OSS / GitHub 都没配置")


def _mirror_to_github(key, data):
    """备份镜像：失败只记状态，绝不影响主链路（OSS 已经写成功）。"""
    if not GH_TOKEN:
        return
    try:
        _gh_put(key, data, "fast-cloud: 备份 " + key)
    except Exception as e:  # noqa: BLE001
        with _STATE_LOCK:
            _STATE["error"] = ("GitHub 备份失败：%s" % e)[:160]


def _table_read(table):
    key = TABLE_FILES.get(table)
    if not key:
        raise StorageError("未知表：%s" % table)
    obj, _backend = _store_read_json(key)
    rows = obj.get("rows") if isinstance(obj, dict) else None
    return rows if isinstance(rows, list) else []


def _table_mutate(table, fn):
    key = TABLE_FILES.get(table)
    if not key:
        raise StorageError("未知表：%s" % table)
    with _STORE_LOCK:
        obj, _backend = _store_read_json(key)
        rows = obj.get("rows") if isinstance(obj, dict) else []
        if not isinstance(rows, list):
            rows = []
        result = fn(rows)
        _store_write_json(key, {"rows": rows})
    if table == "账号":
        # 账号表变了 → 社区写入校验用的邮箱缓存必须失效
        with _ACCT_LOCK:
            _ACCT_CACHE["t"] = 0.0
            _ACCT_CACHE["emails"] = frozenset()
    return result


_ACCT_CACHE = {"t": 0.0, "emails": frozenset()}
_ACCT_LOCK = threading.Lock()


def _acct_emails(force=False):
    """「账号」表里注册过的邮箱集合（缓存 60 秒，省一次远端读取）。"""
    now = time.time()
    with _ACCT_LOCK:
        if not force and _ACCT_CACHE["emails"] and now - _ACCT_CACHE["t"] < 60:
            return _ACCT_CACHE["emails"]
    rows = _table_read("账号")
    out = set()
    for row in rows:
        if isinstance(row, dict):
            e = str(row.get("用户邮箱") or "").strip().lower()
            if e:
                out.add(e)
    with _ACCT_LOCK:
        _ACCT_CACHE["t"] = now
        _ACCT_CACHE["emails"] = frozenset(out)
    return _ACCT_CACHE["emails"]


# ---------------------------------------------------------------- 表的行操作
_SECRET_COLS = ("用户密码",)   # 绝不外发的列（历史遗留，代码已无人使用）


def _clean_row(row):
    if not isinstance(row, dict):
        return {}
    return {k: v for k, v in row.items() if k not in _SECRET_COLS}


def _new_id():
    return uuid.uuid4().hex


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _first_col(row):
    for k in row:
        if not str(k).startswith("_"):
            return k
    return ""


def _rel_of(value):
    """附件列里的值 → 相对路径（files/2026-09/x.apk）。兼容字符串/数组/对象三种写法。"""
    v = value
    if isinstance(v, list) and v:
        v = v[0]
    name = ""
    if isinstance(v, dict):
        name = str(v.get("name") or "")
        v = str(v.get("url") or v.get("file_path") or v.get("path") or "")
    s = str(v or "").strip()
    if not s:
        return "", name
    s = re.sub(r"^https?://[^/]+", "", s)
    s = re.sub(r"^/workspace/[^/]+", "", s)
    s = re.sub(r"^/asset/[^/]+", "", s)
    s = s.lstrip("/")
    if not name:
        name = s.rsplit("/", 1)[-1]
    return s, name


def _add_short_keys(row, host_base, uuid_):
    """「更新」表按列 key 返回时的形状：0000 = 第一列（版本），etRB = 安装包附件。

    为什么还要这个（v16 后端已经换了）：editor.js 读更新表**故意不带 convert_keys**
    （line 8211），它直接取 r['0000'] / r['etRB']，所以这里必须补出这两个 key，
    否则「检查更新」永远显示"暂无更新包"。
    """
    out = dict(_clean_row(row))
    cols = [k for k in row if not str(k).startswith("_")]
    out["0000"] = row.get(cols[0]) if cols else ""
    rel, name = _rel_of(row.get("APK程序"))
    if not rel and name:
        rel = "files/2026-09/" + name
    if rel:
        out["etRB"] = [{"name": name or rel.rsplit("/", 1)[-1],
                        "url": "%s/asset/%s/%s" % ((host_base or "").rstrip("/"), uuid_ or "fast", rel)}]
    else:
        out["etRB"] = []
    return out


def _rows_dispatch(method, table, query, body_raw, content_type, host_base, uuid_):
    if table not in TABLE_FILES:
        return _json(404, {"error": "table not found: %s" % table})
    qs = urllib.parse.parse_qs(query.lstrip("?"), keep_blank_values=True)
    convert = str((qs.get("convert_keys") or [""])[0]).lower() in ("true", "1")

    if method == "GET":
        try:
            rows = _table_read(table)
        except Exception as e:  # noqa: BLE001
            return _json(500, {"error": "读取表格失败：%s" % e})
        out = [_clean_row(r) for r in rows if isinstance(r, dict)]
        if table == "更新" and not convert:
            out = [_add_short_keys(r, host_base, uuid_) for r in rows if isinstance(r, dict)]
        return _json(200, {"rows": out})

    data = {}
    if body_raw:
        try:
            parsed = json.loads(body_raw.decode("utf-8"))
            data = parsed if isinstance(parsed, dict) else {}
        except Exception:  # noqa: BLE001
            return _json(400, {"error": "bad json"})

    if method == "POST":
        rows_in = data.get("rows")
        if not isinstance(rows_in, list):
            return _json(400, {"error": "missing rows field"})
        ok, why = _check_community_write(table, rows_in)
        if not ok:
            return _json(403, {"error": why})

        def fn(rows):
            added = []
            for r in rows_in:
                if not isinstance(r, dict):
                    continue
                nr = {k: v for k, v in r.items() if k != "_id"}
                nr["_id"] = _new_id()
                nr["_ctime"] = _now_iso()
                nr["_mtime"] = nr["_ctime"]
                rows.append(nr)
                added.append(nr)
            return added

        try:
            added = _table_mutate(table, fn)
        except Exception as e:  # noqa: BLE001
            return _json(500, {"error": "写入表格失败：%s" % e})
        first = _clean_row(added[0]) if added else {}
        return _json(200, {"inserted_row_count": len(added), "first_row": first})

    if method == "PUT":
        updates = data.get("updates")
        if not isinstance(updates, list):
            return _json(400, {"error": "missing updates field"})

        def fn(rows):
            idx = {r.get("_id"): r for r in rows if isinstance(r, dict)}
            n = 0
            for u in updates:
                if not isinstance(u, dict):
                    continue
                rid = str(u.get("row_id") or u.get("_id") or "")
                target = idx.get(rid)
                if not target:
                    continue
                patch = u.get("row") if isinstance(u.get("row"), dict) else {}
                for k, v in patch.items():
                    if k == "_id":
                        continue
                    target[k] = v
                target["_mtime"] = _now_iso()
                n += 1
            return n

        try:
            n = _table_mutate(table, fn)
        except Exception as e:  # noqa: BLE001
            return _json(500, {"error": "更新表格失败：%s" % e})
        return _json(200, {"success": True, "updated_row_count": n})

    if method == "DELETE":
        ids = data.get("row_ids")
        if ids is None:
            ids = data.get("rows")
        if isinstance(ids, str):
            ids = [ids]
        if not isinstance(ids, list):
            return _json(400, {"error": "missing row_ids field"})
        wanted = {str(x) for x in ids if x}

        def fn(rows):
            keep = [r for r in rows if str(r.get("_id") or "") not in wanted]
            n = len(rows) - len(keep)
            rows[:] = keep
            return n

        try:
            n = _table_mutate(table, fn)
        except Exception as e:  # noqa: BLE001
            return _json(500, {"error": "删除表格失败：%s" % e})
        return _json(200, {"success": True, "deleted_row_count": n})

    return _json(405, {"error": "method not allowed"})


# ---------------------------------------------------------------- 社区写入门槛（沿用 v15）
COMM_TABLE = "社区"
COMM_EMAIL_COL = "用户邮箱"


def _check_community_write(table, rows_in):
    """社区表新增行必须带「用户邮箱」，且这个邮箱确实在「账号」表里注册过。

    读不到账号表时一律放行 —— 加固绝不能把正常发布搞挂。
    """
    if table != COMM_TABLE:
        return True, ""
    try:
        known = _acct_emails()
    except Exception:  # noqa: BLE001
        return True, ""
    for r in rows_in:
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


# ---------------------------------------------------------------- IP 限流（沿用 v15）
RELAY_PER_MIN = int(os.environ.get("RELAY_PER_MIN", "600"))
RELAY_WRITE_PER_MIN = int(os.environ.get("RELAY_WRITE_PER_MIN", "120"))
_IP_HITS = {}
_IP_LOCK = threading.Lock()


def _client_ip(handler):
    try:
        xff = handler.headers.get("x-forwarded-for") or ""
        if xff:
            return xff.split(",")[0].strip()
        return (handler.client_address[0] if handler.client_address else "") or "?"
    except Exception:  # noqa: BLE001
        return "?"


def _check_ip_rate(ip, write):
    limit = RELAY_WRITE_PER_MIN if write else RELAY_PER_MIN
    now = time.time()
    with _IP_LOCK:
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


# ---------------------------------------------------------------- multipart 解析
def _parse_multipart(body, ctype):
    """按 boundary 手工解析 multipart/form-data。

    为什么自己写：Python 3.13 起 cgi 模块被移除，3.14 上 `import cgi` 直接失败；
    标准库再没有现成解析器，只能按字节切（注意**不能**按文本处理，附件是二进制）。
    返回 (fields, files)：fields 是普通字段文本，files 是 {字段名: (文件名, 字节)}。
    """
    m = re.search(r"boundary=([^;\s]+)", ctype or "", re.I)
    if not m:
        return None, None
    boundary = m.group(1).strip().strip('"')
    delim = b"--" + boundary.encode("utf-8")
    fields, files = {}, {}
    for seg in body.split(delim)[1:]:
        if seg.startswith(b"--"):
            break                      # 结束标记
        if seg.startswith(b"\r\n"):
            seg = seg[2:]
        head, sep, payload = seg.partition(b"\r\n\r\n")
        if not sep:
            continue
        if payload.endswith(b"\r\n"):
            payload = payload[:-2]
        name, filename = "", ""
        for line in head.split(b"\r\n"):
            if line.lower().startswith(b"content-disposition:"):
                txt = line.decode("utf-8", "replace")
                mm = re.search(r'name="([^"]*)"', txt)
                if mm:
                    name = mm.group(1)
                fm = re.search(r'filename="([^"]*)"', txt)
                if fm:
                    filename = fm.group(1)
        if filename:
            files[name or "file"] = (os.path.basename(filename), payload)
        else:
            fields[name] = payload.decode("utf-8", "replace")
    return fields, files


def _norm_key(*parts):
    segs = []
    for p in parts:
        for s in str(p or "").replace("\\", "/").split("/"):
            if s and s != ".":
                segs.append(s)
    return "/".join(segs)


def _attachment_disp(rel):
    """附件下载的 Content-Disposition。

    ⚠️ filename= 里只能放 ASCII：中文 / 其它非 ASCII 文件名直接塞进响应头会让
    send_header 编码失败，整个请求崩掉（FC 只回一句 "Process exited unexpectedly"，
    客户端看到的就是 502 —— 2026-10-31 用户报的"社区作品点运行下载失败 HTTP 502"）。
    真实文件名一律走 filename*=UTF-8''（RFC 5987），filename= 只留 ASCII 兜底。
    """
    name = os.path.basename(rel) or "download"
    safe = name.encode("ascii", "ignore").decode("ascii").strip() or "download"
    return 'attachment; filename="%s"; filename*=UTF-8\'\'%s' % (
        safe.replace('"', ""), urllib.parse.quote(name))


def _handle_upload(body_raw, content_type):
    """把上传的附件写进 OSS（附件不走 GitHub），回 SeaTable 上传接口的形状。"""
    if not body_raw:
        return _json(400, {"error": "empty body"})
    fields, files = _parse_multipart(body_raw, content_type)
    if fields is None:
        return _json(400, {"error": "不是 multipart/form-data（缺 boundary）"})
    if not files:
        return _json(400, {"error": "没收到 file 字段"})
    name, data = list(files.values())[0]
    key = _norm_key(fields.get("parent_dir"), fields.get("relative_path"), name)
    if not key or ".." in key:
        return _json(400, {"error": "bad path"})
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    try:
        _oss_put(key, data, ctype)
        _set_state("write", "oss")
    except Exception as e:  # noqa: BLE001
        return _json(502, {"error": "上传失败（附件只存 OSS）：%s" % e})
    return _json(200, [{"id": key, "name": name, "size": len(data)}])


def _json(status: int, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    return status, {"Content-Type": "application/json; charset=utf-8"}, body


# ---------------------------------------------------------------- /api 中转分发
def _public_base(handler):
    """本函数的公网地址（上传链接、更新包地址要用），按请求头推，本地测试也能用。"""
    host = (handler.headers.get("x-forwarded-host") or handler.headers.get("host") or "").strip()
    proto = (handler.headers.get("x-forwarded-proto") or "").strip()
    if not proto:
        ip = host.split(":")[0].strip("[]")
        proto = "http" if ip in ("127.0.0.1", "localhost", "0.0.0.0", "::1") else "https"
    return ("%s://%s" % (proto, host)) if host else ""


def relay(method, path, query, body_raw, content_type, host_base="", use_uuid=""):
    """云中转的唯一入口：把 SeaTable 形状的请求翻译成 OSS/GitHub 的读写。"""
    try:
        if "%" in path:
            path = urllib.parse.unquote(path)
        if "%" in query:
            query = urllib.parse.unquote(query)
    except Exception:  # noqa: BLE001
        pass
    if "?" in path:            # 客户端把「路径+查询串」整条塞进 p（见 editor.js 中转链接）
        path, _q2 = path.split("?", 1)
        query = (query + "&" + _q2) if query else _q2
    if not path.startswith("/"):
        path = "/" + path
    clean = path.rstrip("/") or "/"
    query = query.lstrip("?")

    if clean == "/api/v2.1/dtable/app-access-token":
        # 客户端只要求有 access_token 字段；真正鉴权由 X-App-Token 完成
        return _json(200, {"access_token": "oss", "dtable_uuid": "fast",
                           "dtable_server": "", "workspace_id": ""})

    if clean == "/api/v2.1/dtable/app-upload-link":
        return _json(200, {
            "upload_link": (host_base or "").rstrip("/") + "/api/upload",
            "parent_path": "",
            "img_relative_path": "images/2026-09",
            "file_relative_path": "files/2026-09",
            "workspace_id": "",
        })

    if clean == "/api/upload":
        return _handle_upload(body_raw, content_type)

    if clean.startswith("/api/v2/dtables/"):
        parts = clean.split("/")
        if len(parts) >= 6 and parts[5] == "rows":
            qs = urllib.parse.parse_qs(query, keep_blank_values=True)
            table = str((qs.get("table_name") or [""])[0])
            if "%" in table:      # 双重编码时再解一次
                table = urllib.parse.unquote(table)
            # 写行时表名在 **JSON body** 里（SeaTable 就是这样：POST {table_name, rows}），
            # 以前只从查询串取，导致写入永远 404 table not found（本地实测踩到）
            if not table and body_raw:
                try:
                    _d = json.loads(body_raw.decode("utf-8"))
                    if isinstance(_d, dict):
                        table = str(_d.get("table_name") or "")
                except Exception:  # noqa: BLE001
                    pass
            return _rows_dispatch(method, table, query, body_raw, content_type,
                                  host_base, parts[4] if len(parts) > 4 else "")

    return _json(404, {"error": "not found"})


# ---------------------------------------------------------------- HTTP 服务
_RECENT = []
_RECENT_LOCK = threading.Lock()


def _remember(path: str, query: str):
    try:
        with _RECENT_LOCK:
            _RECENT.append({"path": path, "query": query, "t": int(time.time())})
            del _RECENT[:-20]
    except Exception:  # noqa: BLE001
        pass


def _safe_err():
    """/healthz 里的错误摘要：把 AccessKey / Token 从文本里抠掉，绝不回密钥。"""
    try:
        with _STATE_LOCK:
            err = _STATE["error"]
    except Exception:  # noqa: BLE001
        err = ""
    for s in (OSS_AK, OSS_SK, GH_TOKEN, APP_TOKEN):
        if s:
            err = err.replace(s, "***")
    return err


class Handler(BaseHTTPRequestHandler):
    server_version = "FastCloudFC/1.0"

    def _send(self, status, obj, headers=None, raw=None):
        body = raw if raw is not None else json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        h = dict(headers or {})
        h.setdefault("Content-Type", "application/json; charset=utf-8")
        # 所有传进来的头都要发（Location / Content-Disposition / Cache-Control 以前被丢掉了）
        for k, v in h.items():
            self.send_header(k, v)
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
        except Exception:  # noqa: BLE001
            return {}

    def _read_raw(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n > 0 else None

    def _guard(self, write=False):
        wait = _check_ip_rate(_client_ip(self), write)
        if wait > 0:
            self._send(429, {"error": "请求太频繁，请 %d 秒后再试" % wait, "wait": wait})
            return False
        return True

    def _authed(self):
        if not APP_TOKEN:
            return True
        got = self.headers.get("X-App-Token", "")
        if not got:
            # 附件下载允许口令放查询串（<img> 没法加自定义请求头）
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

    # ---- 附件下载（/api/download?path=相对路径，文件在 OSS） ----
    def _download(self):
        if not self._guard():
            return
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        rel = (qs.get("path") or [""])[0]
        rel = urllib.parse.unquote(rel)
        if not rel or "//" in rel or ".." in rel or rel.startswith("/"):
            self._send(400, {"error": "bad path"})
            return
        if not self._authed():
            self._send(401, {"error": "未授权：X-App-Token 不正确"})
            return
        try:
            data = _oss_get(rel)
        except Exception as e:  # noqa: BLE001
            self._send(502, {"error": "读取附件失败：%s" % e})
            return
        if data is None:
            self._send(404, {"error": "附件不存在"})
            return
        ctype = mimetypes.guess_type(rel)[0] or "application/octet-stream"
        # 没有 Content-Disposition 时浏览器会用 URL 最后一段当文件名（就是那个 `download`），
        # 下载下来没有 .exe 后缀、双击打不开（用户 2026-10-31 的截图）。这里把真名带上。
        disp = _attachment_disp(rel)
        self._send(200, None, {"Content-Type": ctype, "Content-Disposition": disp}, raw=data)

    # ---- /api/apk：302 到 OSS 预签名直链 ----
    # FC 公网端点禁止直接分发 APK（403 "APK file is not allowed to be distributed ..."），
    # 所以这里只回一个 302，真正的 APK 文件从 OSS 签名地址下载。二维码/手机端都走这条短链。
    def _apk_rel(self):
        try:
            rows = _table_read("更新")
            for r in rows:
                v = r.get("APK程序")
                rel = ""
                if isinstance(v, str):
                    rel = v
                elif isinstance(v, list) and v:
                    x = v[0]
                    rel = str(x.get("file_path") or x.get("path") or x.get("url") or "") if isinstance(x, dict) else str(x)
                elif isinstance(v, dict):
                    rel = str(v.get("file_path") or v.get("path") or "")
                if rel:
                    m = re.search(r"/files/\d{4}-\d{2}/[^\s\"']+", rel)
                    if m:
                        return m.group(0).lstrip("/")
                    return rel.lstrip("/")
        except Exception:  # noqa: BLE001
            pass
        return ""

    def _serve_apk(self):
        if not self._guard():
            return
        if not self._authed():
            self._send(401, {"error": "未授权：X-App-Token 不正确"})
            return
        key = self._apk_rel()
        if not key:
            self._send(404, {"error": "还没有上传手机版安装包"})
            return
        # 阿里云 OSS / FC 都禁止用默认域名直接分发 .apk（ApkDownloadForbidden）。
        # APK 在 OSS 里存成 `.apk.bin`，这里引导浏览器到 /api/apkfile，
        # 那个端点回二进制 + Content-Disposition(.apk)，浏览器保存下来就是能装的 APK。
        dl = "/api/apkfile?t=%s" % urllib.parse.quote(APP_TOKEN)
        html = ("<!doctype html><html><head><meta charset=\"utf-8\">"
                "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                "<title>FAST 手机版下载</title></head><body>"
                "<p style=\"font-family:sans-serif;padding:20px\">正在下载安装包…</p>"
                "<p style=\"padding:0 20px\"><a href=%r>如果没有自动开始，点此下载</a></p>"
                "<script>location.href=%r;</script></body></html>") % (dl, dl)
        self._send(200, None, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"},
                   raw=html.encode("utf-8"))

    def _serve_apkfile(self):
        """把云端 `.apk.bin` 以真正的 `.apk` 文件名下发（URL 不带 .apk，绕开平台限制）。"""
        if not self._guard():
            return
        if not self._authed():
            self._send(401, {"error": "未授权：X-App-Token 不正确"})
            return
        key = self._apk_rel()
        if not key:
            self._send(404, {"error": "还没有上传手机版安装包"})
            return
        try:
            data = _oss_get(key)
        except Exception as e:  # noqa: BLE001
            self._send(502, {"error": "读取安装包失败：%s" % e})
            return
        if data is None:
            self._send(404, {"error": "安装包不存在"})
            return
        name = os.path.basename(key)
        if name.endswith(".bin"):
            name = name[:-4]
        disp = _attachment_disp(name)
        self._send(200, None, {"Content-Type": "application/octet-stream",
                               "Content-Disposition": disp}, raw=data)

    # ---- /apk、/dl/<文件名>（原样保留） ----
    def _relay_apk(self):
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
        m = re.search(rb"1\.0\.\d+\.\d+", data[:400000])
        if m:
            name = "FAST_v%s.apk" % m.group(0).decode("ascii", "ignore")
        # Content-Type 必须是通用二进制：FC 公网触发器对声明成 APK 的响应直接 400 ApkDownloadForbidden
        self._send(200, None, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": 'attachment; filename="%s"' % name,
        }, raw=data)

    def _relay_api(self, default_method):
        """POST /api：客户端把整条业务请求包在 JSON 里（{p,m,q,b,ct,u}）。"""
        if not self._guard(write=True):
            return
        if not self._authed():
            self._send(401, {"error": "未授权：X-App-Token 不正确"})
            return
        data = self._read_json()
        pth = str(data.get("p") or "")
        m = str(data.get("m") or default_method).upper()
        b = data.get("b")
        body_raw, ctype = None, ""
        if b is not None and m != "GET":
            if isinstance(b, str):
                # 附件上传：JS 侧把二进制体按「一字符=一字节」（Latin-1）传过来，这里原样还原
                body_raw = b.encode("latin-1", "ignore")
                ctype = str(data.get("ct") or self.headers.get("X-Fast-Ct")
                            or self.headers.get("Content-Type") or "multipart/form-data")
            else:
                body_raw = json.dumps(b, ensure_ascii=False).encode("utf-8")
                ctype = "application/json"
        _remember(pth, str(data.get("q") or ""))
        status, headers, body = relay(m, pth, str(data.get("q") or ""), body_raw, ctype,
                                      _public_base(self), str(data.get("u") or ""))
        self._send(status, None, headers, raw=body)

    def _relay_direct(self, method):
        """直达式：METHOD /api/v2/dtables/…?table_name=…（不走 ?p= 包的写法）。"""
        if not self._guard(write=(method != "GET")):
            return
        if not self._authed():
            self._send(401, {"error": "未授权：X-App-Token 不正确"})
            return
        parsed = urllib.parse.urlparse(self.path)
        raw = self._read_raw() if method in ("POST", "PUT", "DELETE", "PATCH") else None
        ctype = str(self.headers.get("Content-Type") or "")
        _remember(parsed.path, parsed.query)
        status, headers, body = relay(method, parsed.path, parsed.query, raw, ctype,
                                      _public_base(self))
        self._send(status, None, headers, raw=body)

    def do_GET(self):
        raw_path = self.path.split("?")[0]
        p = raw_path.rstrip("/")
        if p == "/api/download":
            self._download()
            return
        if p == "/api/apk":
            self._serve_apk()
            return
        if p == "/api/apkfile":
            self._serve_apkfile()
            return
        if raw_path.startswith("/api/") and not raw_path.startswith("/api/download"):
            self._relay_direct("GET")
            return
        if p in ("/apk", "/download", "/fast.apk") or raw_path.startswith("/dl/"):
            self._relay_apk()
            return
        if p == "/api":
            if not self._guard():
                return
            if not self._authed():
                self._send(401, {"error": "未授权：X-App-Token 不正确"})
                return
            # p/q 必须从**原始**查询串取：p 里带的 & 会被 parse_qs 截断（convert_keys=true 就是这么丢的）
            _rawq = urllib.parse.urlparse(self.path).query
            _qs = urllib.parse.parse_qs(_rawq)
            m = str((_qs.get("m") or ["GET"])[0]).upper()
            pth = _raw_p(_rawq, "p")
            _remember(pth, _raw_p(_rawq, "q"))
            status, headers, body = relay(m, pth, _raw_p(_rawq, "q"), None, "",
                                          _public_base(self), str((_qs.get("u") or [""])[0]))
            self._send(status, None, headers, raw=body)
            return
        if p == "/echo":
            if not self._guard():
                return
            parsed = urllib.parse.urlparse(self.path)
            self._send(200, {"path": parsed.path, "query": parsed.query, "最近请求": list(_RECENT[-10:]),
                             "qs": dict(urllib.parse.parse_qs(parsed.query)),
                             "headers": {k: v for k, v in self.headers.items()
                                         if k.lower() in ("x-app-token", "host")}})
            return
        if p in ("/healthz", "/health", ""):
            if not self._guard():
                return
            with _STATE_LOCK:
                backend = _STATE["write"] or _STATE["read"] or ("oss" if (OSS_AK and OSS_SK) else "github")
            info = {
                "ok": True,
                "func_version": FUNC_VERSION,
                "backend": backend,
                "storage": "oss+github",
                "smtp_user": SMTP_USER,
                "oss_bucket": OSS_BUCKET,
                "oss_configured": bool(OSS_AK and OSS_SK),
                "github_repo": GH_REPO,
                "github_configured": bool(GH_TOKEN),
                "last_read_backend": _STATE["read"],
                "last_write_backend": _STATE["write"],
                "last_error": _safe_err(),
            }
            self._send(200, info)
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        raw_path = self.path.split("?")[0]
        p = raw_path.rstrip("/")
        if p == "/api":
            self._relay_api("POST")
            return
        if p == "/api/upload":
            # 浏览器直传 multipart（走中转时客户端会包一层 /api，这里留作兜底）
            if not self._guard(write=True):
                return
            if not self._authed():
                self._send(401, {"error": "未授权：X-App-Token 不正确"})
                return
            raw = self._read_raw()
            status, headers, body = _handle_upload(raw, str(self.headers.get("Content-Type") or ""))
            self._send(status, None, headers, raw=body)
            return
        if raw_path.startswith("/api/"):
            self._relay_direct("POST")
            return
        try:
            if not self._authed():
                self._send(401, {"error": "未授权：X-App-Token 不正确"})
                return
            data = self._read_json()
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
        except Exception:  # noqa: BLE001
            self._send(500, {"error": "服务器开小差了，请稍后再试"})

    def do_PUT(self):
        raw_path = self.path.split("?")[0]
        if raw_path.rstrip("/") == "/api":
            self._relay_api("PUT")
            return
        if raw_path.startswith("/api/"):
            self._relay_direct("PUT")
            return
        self._send(404, {"error": "not found"})

    def do_DELETE(self):
        raw_path = self.path.split("?")[0]
        if raw_path.rstrip("/") == "/api":
            self._relay_api("DELETE")
            return
        if raw_path.startswith("/api/"):
            self._relay_direct("DELETE")
            return
        self._send(404, {"error": "not found"})

    def do_PATCH(self):
        raw_path = self.path.split("?")[0]
        if raw_path.rstrip("/") == "/api":
            self._relay_api("PATCH")
            return
        if raw_path.startswith("/api/"):
            self._relay_direct("PATCH")
            return
        self._send(404, {"error": "not found"})

    def log_message(self, *args):
        return


def _raw_p(raw_query: str, name: str = "p") -> str:
    """从**原始**查询串里取 p：不能用 parse_qs（p 里的 & 会把它截断）。

    客户端把「路径+查询串」整条塞进 p，例如：
      p=/api/v2/dtables/x/rows/?table_name=社区&limit=1000&convert_keys=true
    parse_qs 会把它截成 "…?table_name=社区"，后面的 limit / convert_keys 全丢。
    这里按「p= 之后到结尾」取值，再切掉中转自己的收尾参数 u/t。
    """
    m = re.search(r"(?:^|&)" + re.escape(name) + "=", raw_query or "")
    if not m:
        return ""
    val = raw_query[m.end():]
    val = re.split(r"&(?=(?:q|m|u|t)=)", val)[0]
    return val


def main():
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("FAST cloud function listening on 0.0.0.0:%d" % PORT, flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
