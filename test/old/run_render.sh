#!/usr/bin/env bash
# 自包含渲染测试：启动静态服务 + headless chromium，运行指定 node 脚本，最后清理。
# 用法: bash run_render.sh <node脚本相对test/路径> [脚本参数...]
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)/assets/www"
PORT=8931; CDP=9333
pkill -f "serve.js $ROOT" 2>/dev/null
pkill -f "remote-debugging-port=$CDP" 2>/dev/null
/opt/nodejs/22/bin/node test/serve.js "$ROOT" $PORT >/tmp/srv.log 2>&1 &
SRV=$!
/usr/local/bin/chromium --headless=new --remote-debugging-port=$CDP \
  --no-sandbox --disable-gpu --hide-scrollbars --window-size=1680,1000 \
  --force-device-scale-factor=1 --remote-allow-origins=* about:blank >/tmp/chr.log 2>&1 &
CHR=$!
cleanup(){ kill $SRV $CHR 2>/dev/null; pkill -f "remote-debugging-port=$CDP" 2>/dev/null; }
trap cleanup EXIT
# 等待 CDP 就绪
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:$CDP/json/version >/dev/null 2>&1; then break; fi
  sleep 0.5
done
SCRIPT="$1"; shift
/opt/nodejs/22/bin/node "test/$SCRIPT" "$@"
