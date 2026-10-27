// verify-comm-open.mjs —— 验证「作品从开源改成不开源后，社区卡片要跟着变」
//
// 用户 2026-10-28 报的现象：发布时选了开源，后来更新改成不开源；
// 后台（SeaTable）里那一行已经是「否」，但社区卡片还挂着「开源」标签，点刷新也不变。
//
// 根因还是 drawCommunity 的「内容指纹」：它包含 作品iD/作品名/作者名/时间，
// 但「是否开源」变了不动指纹 → 判定「内容没变」直接 return，新数据没画出来。
//
// 本用例按真人操作走：进社区（开源）→ 后台改成不开源 → 点刷新 → 「开源」标签必须消失，
// 且「保存本地」按钮要变灰（未开源不能保存）。旧代码会在这一步失败。
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

// 假网络：社区表两行，「是否开源」取自 __fakeOpen（用例中途改成 '否'）
const 装假网络 = `(function(){
  window.__fakeOpen = '是';
  window.__authSetHttp(function (method, url, body, token, opts) {
    var u = String(url || '');
    try { u = decodeURIComponent(u); } catch (e) {}
    if (u.indexOf('app-access-token') >= 0) {
      return Promise.resolve({ access_token: 'T1', dtable_server: 'https://gw.example', dtable_uuid: 'D-UUID-1' });
    }
    var 表 = (body && body.table_name) || ((/[?&]table_name=([^&]*)/.exec(u) || [])[1] || '');
    if (表 === '账号') {
      return Promise.resolve({ rows: [{ _id: 'R1', '用户邮箱': 'small@qq.com', '账号名': '小明',
        '作品iD': 's1, s2', '作品': [] }] });
    }
    if (表 === '社区') {
      return Promise.resolve({ rows: [
        { _id: 'C1', '作品iD': 's1', '作品名': '甲作品', '_ctime': '2026-10-20T10:00:00+08:00',
          '是否开源': window.__fakeOpen, '用户名': '小明', '用户邮箱': 'small@qq.com' },
        { _id: 'C2', '作品iD': 's2', '作品名': '乙作品', '_ctime': '2026-10-21T10:00:00+08:00',
          '是否开源': window.__fakeOpen, '用户名': '小明', '用户邮箱': 'small@qq.com' }
      ] });
    }
    return Promise.resolve({ rows: [] });
  });
  return 1;
})()`;

// 卡片上「开源」标签的数量 + 「保存本地」按钮被禁用的数量
const 读开源状态 = `(function(){
  var cs = Array.prototype.slice.call(document.querySelectorAll('#acctComm .comm-card'));
  return {
    卡片: cs.length,
    标签: cs.filter(function (c) { return !!c.querySelector('.comm-tag'); }).length,
    存本地禁用: cs.filter(function (c) {
      var b = Array.prototype.slice.call(c.querySelectorAll('.comm-ops .tb'))
        .filter(function (x) { return String(x.textContent||'').indexOf('保存本地') >= 0; })[0];
      return !!(b && b.disabled);
    }).length
  };
})()`;

(async () => {
  const t = await pickTarget();
  await open(t.webSocketDebuggerUrl);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  await waitFor(`document.readyState === 'complete' && !!window.EditorApp`, 20000);
  await js(`(function(){ localStorage.clear(); localStorage.setItem('__bb_user_v1', JSON.stringify({ email:'small@qq.com', name:'小明' })); return 1; })()`);
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
  const 前 = await js(读开源状态);

  // 模拟「后台把这条作品改成不开源」，然后点刷新（真人就是这么操作的）
  await js(`window.__fakeOpen = '否'; 1`);
  await js(`document.getElementById('acctRefresh').click(); 1`);
  const 变了 = await waitFor(`(${读开源状态}).标签 === 0`, 15000);
  const 后 = await js(读开源状态);

  const ok = 前.标签 === 2 && 前.存本地禁用 === 0 && 变了 && 后.标签 === 0 && 后.存本地禁用 === 2;
  console.log(JSON.stringify({ 刷新前: 前, 刷新后: 后, 期望: '开源标签 2→0，保存本地 0→2 个禁用' }, null, 2));
  console.log(ok ? '\n[OK] 改成不开源后社区卡片跟着变 ✓' : '\n[FAIL] 刷新后卡片还显示开源 / 保存本地还能点');

  try {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, 'comm-open.png'), Buffer.from(s.data, 'base64'));
  } catch (e) { }
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('失败: ' + e.message); process.exit(1); });
