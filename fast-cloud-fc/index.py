#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FAST 云中转（阿里云函数计算 FC · Web 函数）

为什么需要它
------------
以前编辑器把 SeaTable 的 API Token 硬编码在 `editor.js` 里。`editor.js` 会被打进 APK，
所以**任何拿到 APK 的人都能从包里抠出这个 token**，直接读写整张「账号」表和「社区」表
（所有用户邮箱 + 全部作品）。这是一个必须修掉的凭据泄露。

现在改成：编辑器所有云请求都打到这个函数，SeaTable 的 token 只作为**函数的环境变量**存在
（`SEATABLE_TOKEN`），APK 里一个凭据都没有。就算这个函数地址被外人知道，他能做的最多
是调用这个函数（消耗免费额度），拿不到 token、也越不过下面的路径白名单。

调用方式
--------
POST/GET  函数地址
Header:   X-App-Token: <APP_TOKEN>          # 和邮箱函数同一个口令
Body(JSON): {"p": "/api/v2/dtables/<uuid>/rows/", "m": "GET", "q": "table_name=社区&convert_keys=true", "b": null}

白名单只放行账号/社区用得到的几个接口，别的一律 403 —— 不会变成开放代理。

环境变量（在 FC 控制台配，别写进代码）
--------------------------------------
  APP_TOKEN        与邮箱函数一致的口令（必填）
  SEATABLE_TOKEN   SeaTable API Token（必填，服务端密钥）
  SEATABLE_UUID    基础表 UUID（可选，有默认值）
  SEATABLE_SRV     服务器地址（可选，默认 https://cloud.seatable.cn）
"""

import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_TOKEN = os.environ.get("APP_TOKEN", "")
SEATABLE_TOKEN = os.environ.get("SEATABLE_TOKEN", "")
SEATABLE_UUID = os.environ.get("SEATABLE_UUID", "712bc4e0-a7b0-48ff-b5ea-098ce7eb3252")
SEATABLE_SRV = os.environ.get("SEATABLE_SRV", "https://cloud.seatable.cn").rstrip("/")

# 只放行这些前缀。顺序无所谓，命中即通过。
ALLOW = (
    "/api/v2.1/dtable/app-access-token/",
    "/api/v2.1/dtable/app-upload-link/",
    "/api/v2.1/dtable/app-download-link/",
    "/api/v2/dtables/",
    "/seafhttp/",
    "/files/",
)

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,X-App-Token",
    "Access-Control-Max-Age": "86400",
}

_SSL = ssl.create_default_context()


def _allowed(path: str) -> bool:
    return any(path.startswith(a) for a in ALLOW)


def _json(status: int, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    return status, {"Content-Type": "application/json; charset=utf-8"}, body


def proxy(method: str, path: str, query: str, body_raw: bytes, content_type: str):
    """把请求原样转给 SeaTable，再把响应原样带回来。"""
    if not SEATABLE_TOKEN:
        return _json(500, {"error": "服务端还没配置 SEATABLE_TOKEN"})
    if not path.startswith("/"):
        path = "/" + path
    if not _allowed(path):
        return _json(403, {"error": "path not allowed"})
    # 表 UUID 一律以服务端为准：客户端就算传了别的库也会被换回来
    parts = path.split("/")
    # /api/v2/dtables/<uuid>/...
    if len(parts) > 4 and parts[1] == "api" and parts[2] == "v2" and parts[3] == "dtables":
        parts[4] = SEATABLE_UUID
        path = "/".join(parts)
    url = SEATABLE_SRV + path + (("?" + query.lstrip("?")) if query else "")
    req = urllib.request.Request(url, data=body_raw if method in ("POST", "PUT", "DELETE", "PATCH") else None, method=method)
    req.add_header("Authorization", "Token " + SEATABLE_TOKEN)
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


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 少打日志，FC 上没意义
        pass

    def _send(self, status, headers, body):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802
        self._send(204, {}, b"")

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/", "/health"):
            self._send(200, {"Content-Type": "application/json; charset=utf-8"},
                       json.dumps({"ok": True, "service": "fast-cloud"}).encode())
            return
        if parsed.path != "/api":
            self._send(404, {"Content-Type": "application/json; charset=utf-8"},
                       json.dumps({"error": "not found"}).encode())
            return
        if APP_TOKEN and self.headers.get("X-App-Token") != APP_TOKEN:
            self._send(401, {"Content-Type": "application/json; charset=utf-8"},
                       json.dumps({"error": "bad app token"}).encode())
            return
        qs = urllib.parse.parse_qs(parsed.query)
        p = (qs.get("p") or [""])[0]
        q = (qs.get("q") or [""])[0]
        m = ((qs.get("m") or ["GET"])[0] or "GET").upper()
        status, headers, body = proxy(m, p, q, None, "")
        self._send(status, headers, body)

    def do_POST(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/", "/health"):
            self._send(200, {"Content-Type": "application/json; charset=utf-8"},
                       json.dumps({"ok": True, "service": "fast-cloud"}).encode())
            return
        if parsed.path != "/api":
            self._send(404, {"Content-Type": "application/json; charset=utf-8"},
                       json.dumps({"error": "not found"}).encode())
            return
        if APP_TOKEN and self.headers.get("X-App-Token") != APP_TOKEN:
            self._send(401, {"Content-Type": "application/json; charset=utf-8"},
                       json.dumps({"error": "bad app token"}).encode())
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:  # noqa: BLE001
            self._send(400, {"Content-Type": "application/json; charset=utf-8"},
                       json.dumps({"error": "bad json"}).encode())
            return
        p = payload.get("p") or ""
        q = payload.get("q") or ""
        m = str(payload.get("m") or "POST").upper()
        b = payload.get("b")
        body_raw, ctype = None, ""
        if b is not None and m != "GET":
            if isinstance(b, str):
                # 附件上传：JS 侧把二进制体按"一字符=一字节"（Latin-1）传过来，这里原样还原
                body_raw = b.encode("latin-1", "ignore")
                ctype = self.headers.get("X-Fast-CT") or "multipart/form-data"
            else:
                body_raw = json.dumps(b, ensure_ascii=False).encode("utf-8")
                ctype = "application/json"
        status, headers, body = proxy(m, p, q, body_raw, ctype)
        self._send(status, headers, body)


if __name__ == "__main__":
    port = int(os.environ.get("FC_SERVER_PORT") or os.environ.get("PORT") or 9000)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
