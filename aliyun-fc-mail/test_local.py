# -*- coding: utf-8 -*-
"""本地端到端测试：启动函数 HTTP 服务，用假 SMTP 截获验证码，覆盖各类场景。"""
import json
import os
import re
import threading
import time
import urllib.request
import urllib.error

os.environ["APP_TOKEN"] = "test-token-123"
os.environ["SMTP_PASS"] = "dummy-auth-code"
os.environ["SEND_COOLDOWN"] = "60"
os.environ["CODE_TTL"] = "300"
os.environ["FC_SERVER_PORT"] = "9911"

import index  # noqa:E402

captured = {}


class FakeSMTP:
    def __init__(self, host, port, timeout=None):
        pass

    def login(self, user, pwd):
        captured["login"] = (user, pwd)

    def sendmail(self, frm, to, msg):
        import email
        from email.header import decode_header
        captured["msg"] = msg
        mo = email.message_from_string(msg)
        chunks = []
        subj = mo.get("Subject", "")
        chunks.append("".join(
            (b.decode(c or "utf-8") if isinstance(b, bytes) else b)
            for b, c in decode_header(subj)))
        for part in mo.walk():
            payload = part.get_payload(decode=True)
            if payload:
                chunks.append(payload.decode("utf-8", "ignore"))
        text = "\n".join(chunks)
        m = re.search(r"验证码[是：:\s]*(\d{6})", text)
        captured["code"] = m.group(1) if m else None

    def quit(self):
        pass


index.smtplib.SMTP_SSL = FakeSMTP  # 打桩，不真正连 SMTP

# 后台启动服务
srv = index.ThreadingHTTPServer(("127.0.0.1", 9911), index.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
time.sleep(0.3)

BASE = "http://127.0.0.1:9911"
results = []


def call(path, payload=None, token="test-token-123", method="POST"):
    headers = {}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    if token is not None:
        headers["X-App-Token"] = token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def check(name, cond, extra=""):
    results.append((name, cond))
    print(("PASS" if cond else "FAIL"), "-", name, extra)


# 1. 健康检查
st, d = call("/healthz", token=None, method="GET")
check("健康检查 200", st == 200 and d.get("smtp_user") == "3457525474@qq.com")

# 2. 无 token 发码被拒
st, d = call("/", {"action": "send", "email": "user@qq.com"}, token=None)
check("缺少 X-App-Token 返回 401", st == 401)

# 3. 错误 token 被拒
st, d = call("/", {"action": "send", "email": "user@qq.com"}, token="wrong")
check("错误 X-App-Token 返回 401", st == 401)

# 4. 正常发码
st, d = call("/", {"action": "send", "email": "user@qq.com"})
check("发码 200 且返回 challenge", st == 200 and bool(d.get("challenge")) and captured.get("code"))
challenge = d.get("challenge")
code = captured.get("code")
check("发件邮箱登录用的是配置账号", captured.get("login", ("",))[0] == "3457525474@qq.com")

# 5. 冷却限流
st, d = call("/", {"action": "send", "email": "user@qq.com"})
check("冷却期内重复发码返回 429", st == 429 and d.get("wait", 0) > 0)

# 6. 错误验证码
st, d = call("/", {"action": "verify", "email": "user@qq.com", "code": "000000", "challenge": challenge})
check("错误验证码返回 400", st == 400)

# 7. 篡改 challenge
st, d = call("/", {"action": "verify", "email": "user@qq.com", "code": code,
                   "challenge": challenge[:-3] + "aaa"})
check("篡改令牌返回 400", st == 400)

# 8. 邮箱与令牌不一致
st, d = call("/", {"action": "verify", "email": "other@qq.com", "code": code, "challenge": challenge})
check("令牌邮箱不匹配返回 400", st == 400)

# 9. 正确验证码
st, d = call("/", {"action": "verify", "email": "user@qq.com", "code": code, "challenge": challenge})
check("正确验证码返回 200", st == 200 and d.get("ok") is True)

# 10. 过期令牌（直接构造一个已过期的 challenge）
old = index.make_challenge("exp@qq.com", "123456", -10)
ok = index.parse_challenge(old, "exp@qq.com", "123456")
check("过期令牌验码失败", ok is False)

# 11. 邮箱格式校验
st, d = call("/", {"action": "send", "email": "not-an-email"})
check("非法邮箱返回 400", st == 400)

# 12. 大小写邮箱归一：用另一个邮箱发（避开冷却），大写收件
st, d = call("/", {"action": "send", "email": "Case@QQ.com"})
code2 = captured.get("code")
ch2 = d.get("challenge")
st, d = call("/", {"action": "verify", "email": "case@qq.com", "code": code2, "challenge": ch2})
check("邮箱大小写归一后仍可验码", st == 200 and d.get("ok") is True)

srv.shutdown()
total = len(results)
passed = sum(1 for _, c in results if c)
print("\n%d/%d 通过" % (passed, total))
raise SystemExit(0 if passed == total else 1)
