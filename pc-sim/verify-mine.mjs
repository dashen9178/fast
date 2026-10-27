// verify-mine.mjs —— 验证「我分享到社区的作品」的顺序：最新在最上。
// 用假网络造 3 件分享：账号表里的 作品iD 按**分享先后**写（s1,s2,s3），
// 其中 s3 的分享时间最新 —— 渲染出来必须是 s3, s2, s1（最新在上）。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || process.env.TEMP || '.';
const CDP = `http://127.0.0.1:${process.env.CDP_PORT || 9222}`;
mkdirSync(OUT, { recursive: true });

let ws = null, closed = true, seq = 0;
const pending = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function pickTarget() {
  for (let i = 0; i < 40; i++) {
    try { const l = await (await fetch(CDP + '/json/list')).json();
      const t = l.find(x => x.type === 'page' && x.url.includes('editor.html')); if (t) return t; } catch { }
    await sleep(300);
  }
  throw new Error('找不到 editor.html');
}
async function open(url) {
  await new Promise((res, rej) => {
    const s = new WebSocket(url);
    const to = setTimeout(() => rej(new Error('WS 超时')), 10000);
    s.onopen = () => { clearTimeout(to); ws = s; closed = false; res(); };
    s.onerror = () => { clearTimeout(to); rej(new Error('WS 失败')); };
    s.onclose = () => { closed = true; for (const p of pending.values()) p.rej(new Error('CDP 断开')); pending.clear(); };
    s.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  });
}
function send(method, params = {}, timeoutMs = 20000) {
  if (closed || !ws) return Promise.reject(new Error('CDP 未连接'));
  const id = ++seq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error('CDP 超时: ' + method)); }, timeoutMs);
    pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').split('\n')[0]);
  return r.result?.value;
}
async function waitFor(expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await js(expr)) return true; } catch { } await sleep(200); }
  return false;
}

// 假网络：造 3 件分享，分享时间 s3 > s2 > s1
const 装假网络 = `(function(){
  window.__authSetHttp(function (method, url, body, token, opts) {
    var u = String(url || '');
    try { u = decodeURIComponent(u); } catch (e) {}
    if (u.indexOf('app-access-token') >= 0) {
      return Promise.resolve({ access_token: 'T1', dtable_server: 'https://gw.example', dtable_uuid: 'D-UUID-1' });
    }
    var 表 = (body && body.table_name) || ((/[?&]table_name=([^&]*)/.exec(u) || [])[1] || '');
    if (表 === '账号') {
      return Promise.resolve({ rows: [{ _id: 'R1', '用户邮箱': 'small@qq.com', '账号名': '小小',
        '作品iD': 's1, s2, s3' }] });
    }
    if (表 === '社区') {
      // s3 最新、s1 最老；_ctime 用本机时区的可解析写法
      return Promise.resolve({ rows: [
        { _id: 'C1', '作品iD': 's1', '作品名': '最老的 s1', '_ctime': '2026-09-20T10:00:00+08:00', '是否开源': '是', '用户名': '小小' },
        { _id: 'C2', '作品iD': 's2', '作品名': '中间的 s2', '_ctime': '2026-09-22T10:00:00+08:00', '是否开源': '是', '用户名': '小小' },
        { _id: 'C3', '作品iD': 's3', '作品名': '最新的 s3', '_ctime': '2026-09-25T10:00:00+08:00', '是否开源': '是', '用户名': '小小' }
      ] });
    }
    return Promise.resolve({ rows: [] });
  });
  return 1;
})()`;

(async () => {
  const t = await pickTarget();
  await open(t.webSocketDebuggerUrl);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  await waitFor(`document.readyState === 'complete' && !!window.EditorApp`, 20000);
  await js(`(function(){ localStorage.clear(); localStorage.setItem('__bb_user_v1', JSON.stringify({ email:'small@qq.com', name:'小小' })); return 1; })()`);
  await js(`location.href = 'editor.html?v=' + Date.now(); 1`);
  await waitFor(`document.readyState === 'complete' && !!window.EditorApp && typeof window.__authSetHttp === 'function'`, 20000);
  await sleep(500);
  await js(装假网络);

  // 已登录点「账号」→ 进账号页
  await js(`document.getElementById('btnUser').click(); 1`);
  if (!await waitFor(`document.getElementById('acctMine') && document.querySelectorAll('#acctMine .mine-row').length >= 1`, 15000)) {
    console.log(JSON.stringify({ 失败: '「我分享到社区的作品」没渲染出来',
      现场: await js(`String((document.getElementById('acctMine')||{}).textContent||'').slice(0,120)`) }, null, 2));
    process.exit(1);
  }
  await sleep(400);
  const r = await js(`(function(){
    var rows = Array.prototype.slice.call(document.querySelectorAll('#acctMine .mine-row'));
    return { 顺序: rows.map(function (x) { return String((x.querySelector('.mine-name')||{}).textContent||'').trim(); }),
             时间: rows.map(function (x) { return String((x.querySelector('.mine-meta')||{}).textContent||'').trim(); }) };
  })()`);
  console.log(JSON.stringify(r, null, 2));
  const 期望 = ['最新的 s3', '中间的 s2', '最老的 s1'];
  const ok = JSON.stringify(r.顺序) === JSON.stringify(期望);
  console.log(ok ? '\n[OK] 最新在最上 ✓' : '\n[FAIL] 顺序不对，期望 ' + JSON.stringify(期望));

  // 顺带拍一张账号页的图
  try {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, 'acct-mine.png'), Buffer.from(s.data, 'base64'));
    console.log('截图 ' + join(OUT, 'acct-mine.png'));
  } catch (e) { }
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('失败: ' + e.message); process.exit(1); });
