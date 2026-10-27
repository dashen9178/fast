// verify-comm-rename.mjs —— 验证「账号改名后，社区卡片上的作者名要跟着变」
//
// 用户 2026-10-27 报的现象：后台（SeaTable）里那一行的「用户名」已经是新名字，
// 但 App 里的社区卡片还显示原名，怎么点刷新都不变（重启 App 才好）。
//
// 根因在 drawCommunity 的「内容指纹」：以前只比 作品iD / 作品名 / 条数，
// 账号改名时这三样一个都没变 → 判定「内容没变」直接 return，新数据根本没画出来。
//
// 本用例按真人的操作走：进社区 → 后台把作者名换掉 → 点刷新 → 卡片必须变成新名字。
// 旧代码在这一步会失败（卡片停在原名），修好后通过。
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

// 假网络：社区表两行，作者名从 __fakeAuthor 取（用例中途会把它改成新名字）
const 装假网络 = `(function(){
  window.__fakeAuthor = '原名';
  window.__authSetHttp(function (method, url, body, token, opts) {
    var u = String(url || '');
    try { u = decodeURIComponent(u); } catch (e) {}
    if (u.indexOf('app-access-token') >= 0) {
      return Promise.resolve({ access_token: 'T1', dtable_server: 'https://gw.example', dtable_uuid: 'D-UUID-1' });
    }
    var 表 = (body && body.table_name) || ((/[?&]table_name=([^&]*)/.exec(u) || [])[1] || '');
    if (表 === '账号') {
      return Promise.resolve({ rows: [{ _id: 'R1', '用户邮箱': 'small@qq.com', '账号名': window.__fakeAuthor,
        '作品iD': 's1, s2', '作品': [] }] });
    }
    if (表 === '社区') {
      return Promise.resolve({ rows: [
        { _id: 'C1', '作品iD': 's1', '作品名': '甲作品', '_ctime': '2026-10-20T10:00:00+08:00',
          '是否开源': '是', '用户名': window.__fakeAuthor, '用户邮箱': 'small@qq.com' },
        { _id: 'C2', '作品iD': 's2', '作品名': '乙作品', '_ctime': '2026-10-21T10:00:00+08:00',
          '是否开源': '是', '用户名': window.__fakeAuthor, '用户邮箱': 'small@qq.com' }
      ] });
    }
    return Promise.resolve({ rows: [] });
  });
  return 1;
})()`;

const 读作者名 = `(function(){
  var cs = Array.prototype.slice.call(document.querySelectorAll('#acctComm .comm-card'));
  return cs.map(function (c) {
    var subs = Array.prototype.slice.call(c.querySelectorAll('.comm-sub'));
    var s = subs.map(function (x) { return String(x.textContent || '').trim(); })
                .filter(function (t) { return t.indexOf('作者：') === 0; })[0] || '';
    return s.replace('作者：', '');
  });
})()`;

(async () => {
  const t = await pickTarget();
  await open(t.webSocketDebuggerUrl);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  await waitFor(`document.readyState === 'complete' && !!window.EditorApp`, 20000);
  await js(`(function(){ localStorage.clear(); localStorage.setItem('__bb_user_v1', JSON.stringify({ email:'small@qq.com', name:'原名' })); return 1; })()`);
  await js(`location.href = 'editor.html?v=' + Date.now(); 1`);
  await waitFor(`document.readyState === 'complete' && !!window.EditorApp && typeof window.__authSetHttp === 'function'`, 20000);
  await sleep(500);
  await js(装假网络);

  // 进账号页 → 切到「社区」栏
  await js(`document.getElementById('btnUser').click(); 1`);
  await sleep(400);
  await js(`document.getElementById('acctNavComm').click(); 1`);
  if (!await waitFor(`document.querySelectorAll('#acctComm .comm-card').length >= 2`, 15000)) {
    console.log(JSON.stringify({ 失败: '社区卡片没渲染出来',
      现场: await js(`String((document.getElementById('acctCommEmpty')||{}).textContent||'')`) }, null, 2));
    process.exit(1);
  }
  const 前 = await js(读作者名);

  // 模拟「后台改名」：社区行的用户名换成新名字，然后点刷新（真人就是这么操作的）
  await js(`window.__fakeAuthor = '新名字'; 1`);
  await js(`document.getElementById('acctRefresh').click(); 1`);
  const 变了 = await waitFor(`(${读作者名}).join('|').indexOf('新名字') >= 0`, 15000);
  const 后 = await js(读作者名);

  const ok = 前.join('|') === '原名|原名' && 变了 && 后.join('|') === '新名字|新名字';
  console.log(JSON.stringify({ 刷新前: 前, 刷新后: 后, 期望: '原名 → 新名字' }, null, 2));
  console.log(ok ? '\n[OK] 改名后社区卡片跟着变 ✓' : '\n[FAIL] 刷新后卡片还是旧作者名');

  try {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, 'comm-rename.png'), Buffer.from(s.data, 'base64'));
  } catch (e) { }
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('失败: ' + e.message); process.exit(1); });
