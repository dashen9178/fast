# -*- coding: utf-8 -*-
"""本地自测：把合并后的函数跑起来，验证
   ① 验证码接口还在（不被中转抢路由）
   ② 中转 GET 读行能用
   ③ 中转 POST 写行能用（JSON 体）
   ④ 中转附件上传能用（multipart 体按 latin-1 还原）
   ⑤ 白名单外的路径被拒
上游 SeaTable 用假服务顶替，绝不碰真表。
"""
import json
import os
import sys
import threading
import urllib.request

os.environ.setdefault("APP_TOKEN", "TESTTOKEN")
os.environ.setdefault("SEATABLE_TOKEN", "FAKE-SEATABLE-TOKEN")
os.environ.setdefault("SEATABLE_UUID", "712bc4e0-a7b0-48ff-b5ea-098ce7eb3252")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
import importlib.machinery

spec = importlib.util.spec_from_file_location("fn", os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.py.new"),
                                              loader=importlib.machinery.SourceFileLoader("fn", os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.py.new")))
fn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fn)

# ---- 假上游 ----
收到 = []


class FakeResp:
    def __init__(self, status, body, ctype="application/json"):
        self.status = status
        self._body = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.headers = {"Content-Type": ctype}

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_urlopen(req, timeout=None, context=None):
    # fn 内部有的地方传 Request，有的地方直接传 URL 字符串，两个都要接住
    if hasattr(req, "full_url"):
        url, method = req.full_url, req.get_method()
        auth, ct, data = req.get_header("Authorization"), req.get_header("Content-type"), req.data
    else:
        url, method, auth, ct, data = str(req), "GET", None, None, None
    收到.append({"url": url, "method": method, "auth": auth, "ct": ct, "data": data})
    if "/app-access-token/" in url:
        return FakeResp(200, {"access_token": "ACC", "dtable_server": "https://cloud.seatable.cn/api-gateway"})
    if "/app-download-link/" in url:
        return FakeResp(200, {"download_link": "https://cloud.seatable.cn/seafhttp/files/tok/x.fast"})
    if "/seafhttp/" in url:
        return FakeResp(200, b"FASTFILE-CONTENT", "application/octet-stream")
    if "/rows/" in url:
        if method == "GET":
            return FakeResp(200, {"rows": [{"用户邮箱": "a@b.com", "作品iD": "x-1"}]})
        return FakeResp(200, {"inserted_row_count": 1, "first_row": {"_id": "R1"}})
    return FakeResp(404, {"error": "unknown"})


真正的urlopen = urllib.request.urlopen      # 先留一份：测试自己还要发请求给本地服务
fn.urllib.request.urlopen = fake_urlopen     # 只让"函数内部"走假上游


def 起服务():
    srv = fn.ThreadingHTTPServer(("127.0.0.1", 0), fn.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def 请求(port, path, method="GET", body=None, token="TESTTOKEN"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("X-App-Token", token)
    try:
        with 真正的urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


srv, port = 起服务()
ok = 0
bad = []

# ① 健康检查 + 验证码接口还在
s, b = 请求(port, "/healthz")
if s == 200 and b"ok" in b:
    ok += 1
else:
    bad.append("健康检查: %s %s" % (s, b[:80]))

# 验证码：未知 action 应该回 400 的"未知 action"，说明路由没被中转抢走
s, b = 请求(port, "/", "POST", {"action": "什么鬼"})
if s == 400 and "未知 action" in b.decode("utf-8", "ignore"):
    ok += 1
else:
    bad.append("验证码路由: %s %s" % (s, b[:120]))

# ② 中转 GET 读行
s, b = 请求(port, "/api?p=/api/v2/dtables/x/rows/&q=table_name=%E8%B4%A6%E5%8F%B7&m=GET")
d = json.loads(b.decode("utf-8"))
if s == 200 and d.get("rows"):
    ok += 1
    # UUID 必须被换成服务端的
    if "712bc4e0" not in 收到[-1]["url"]:
        bad.append("UUID 没被换成服务端白名单: " + 收到[-1]["url"])
else:
    bad.append("中转读行: %s %s" % (s, b[:120]))

# ③ 中转 POST 写行
s, b = 请求(port, "/api", "POST", {"p": "/api/v2/dtables/x/rows/", "m": "POST", "q": "", "b": {"table_name": "账号", "rows": [{"用户邮箱": "a@b.com"}]}})
d = json.loads(b.decode("utf-8"))
if s == 200 and d.get("inserted_row_count") == 1:
    ok += 1
else:
    bad.append("中转写行: %s %s" % (s, b[:120]))

# ④ 中转附件上传（multipart 体按一字符=一字节还原）
mp = '----b\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\n\r\nyes\r\n----b--\r\n'
s, b = 请求(port, "/api", "POST", {"p": "/seafhttp/upload?ret-json=1", "m": "POST", "q": "", "b": mp, "ct": "multipart/form-data; boundary=----b"})
上传体 = 收到[-1]["data"]
if s == 200 and 上传体 == mp.encode("latin-1"):
    ok += 1
else:
    bad.append("附件上传体不对: %s 体长度=%s 期望=%s" % (s, len(上传体 or b""), len(mp)))

# ⑤ 白名单外必须 403
s, b = 请求(port, "/api", "POST", {"p": "/api/v1/别的接口", "m": "GET", "q": ""})
if s == 403:
    ok += 1
else:
    bad.append("白名单外没被拒: %s %s" % (s, b[:120]))

# ⑥ 口令不对必须 401
s, b = 请求(port, "/api", "POST", {"p": "/api/v2/dtables/x/rows/", "m": "GET", "q": ""}, token="WRONGTOKEN")
if s == 401:
    ok += 1
else:
    bad.append("错误口令没被拒: %s %s" % (s, b[:120]))

# ⑦ 附件下载：能把文件流回来
s, b = 请求(port, "/api/download?path=files/2026-09/x.fast")
if s == 200 and b == b"FASTFILE-CONTENT":
    ok += 1
else:
    bad.append("中转下载: %s %s" % (s, b[:80]))

# ⑧ **直达式**中转：GET /api/v2/dtables/...?table_name=… （客户端真实用法，
#    生产上就是这条路径 404 过一次，所以必须有用例守住）
s, b = 请求(port, "/api/v2/dtables/712bc4e0-x/rows/?table_name=%E7%A4%BE%E5%8C%BA&limit=1000&convert_keys=true")
try:
    d = json.loads(b.decode("utf-8"))
except Exception:
    d = {}
if s == 200 and d.get("rows"):
    ok += 1
    if "712bc4e0" not in 收到[-1]["url"]:
        bad.append("直达式：UUID 没换: " + 收到[-1]["url"])
    # 认证头必须对：数据接口用 Bearer，用 Token 会被 SeaTable 当成"没这个页面"回 404
    if 收到[-1]["auth"] != "Bearer ACC":
        bad.append("数据接口认证头不对（必须 Bearer access_token）：%s  实际请求=%s"
                   % (收到[-1]["auth"], 收到[-1]["url"]))
else:
    bad.append("直达式中转读表: %s %s" % (s, b[:120]))

print("通过 %d / 7" % ok)
if bad:
    print("失败项：")
    for x in bad:
        print("  ✗ " + x)
    sys.exit(1)
print("合并后的函数：验证码 + 云中转 都正常")
