// verify-dark.mjs —— 验证深色模式下画布（Blockly 工作区）底色跟着主题走。
// 起因：三个工作区都用内置 `Blockly.Themes.Zelos`，它把工作区底色写死 #fff，
// 所以深色模式下画布是一块白板（用户报的）。修法见 editor.css 的 .blocklyMainBackground。
import { mkdirSync } from 'node:fs';

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
// 进代码页（画布在这里），返回画布相关颜色（每一项都取成**字符串**，
// 之前返回对象导致判定函数拿到 [object Object]，等于没判 —— 踩过一次）
const 量 = `(function(){
  function str(el, prop) { if (!el) return '(没有这个节点)'; return String(getComputedStyle(el)[prop]); }
  var root = getComputedStyle(document.documentElement);
  return {
    主题: String(document.documentElement.getAttribute('data-theme')),
    surface变量: String(root.getPropertyValue('--surface')).trim(),
    onSurface变量: String(root.getPropertyValue('--on-surface')).trim(),
    页面底色: str(document.body, 'backgroundColor'),
    画布底色: str(document.querySelector('.blocklyMainBackground'), 'fill'),
    画布svg底色: str(document.querySelector('.blocklySvg'), 'backgroundColor'),
    工具箱浮层: str(document.querySelector('.blocklyFlyoutBackground'), 'fill'),
    画布容器: str(document.getElementById('blocklyDiv'), 'backgroundColor'),
    还在白名单: (function(){
      var a = [];
      [['画布', document.querySelector('.blocklyMainBackground'), 'fill'],
       ['页面', document.body, 'backgroundColor'],
       ['浮层', document.querySelector('.blocklyFlyoutBackground'), 'fill'],
       ['画布容器', document.getElementById('blocklyDiv'), 'backgroundColor']].forEach(function (x) {
        if (!x[1]) return;
        var v = String(getComputedStyle(x[1])[x[2]]);
        if (/^#fff/i.test(v) || /rgb\\(255,\\s*255,\\s*255\\)/.test(v) || /^white$/i.test(v)) a.push(x[0] + '=' + v);
      });
      return a;
    })()
  };
})()`;

async function 跑一轮(mode) {
  await js(`(function(){ localStorage.setItem('__bb_theme_v1', JSON.stringify({ seed:'#6750A4', mode:'${mode}' })); return 1; })()`);
  await js(`location.href = 'editor.html?v=' + Date.now(); 1`);
  await waitFor(`document.readyState === 'complete' && !!window.EditorApp`, 20000);
  await sleep(700);
  // 没有工程时先进一个：点创建
  const 有编辑器 = await js(`document.getElementById('viewEditor') && !document.getElementById('viewEditor').classList.contains('hidden')`);
  if (!有编辑器) {
    await js(`document.getElementById('btnNewApp').click(); 1`);
    await sleep(400);
    await js(`(function(){ var i=document.getElementById('newAppName'); i.value='深色自检'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
    await sleep(200);
    await js(`document.getElementById('createGo').click(); 1`);
    await waitFor(`document.getElementById('viewEditor') && !document.getElementById('viewEditor').classList.contains('hidden')`, 20000);
  }
  await js(`(function(){ var b=document.getElementById('tabBlocks'); if (b) b.click(); return 1; })()`);
  await waitFor(`!!document.querySelector('.blocklyMainBackground')`, 15000);
  await sleep(900);
  return await js(量);
}

(async () => {
  const t = await pickTarget();
  await open(t.webSocketDebuggerUrl);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await waitFor(`document.readyState === 'complete' && !!window.EditorApp`, 20000);
  await js(`(function(){ localStorage.clear(); return 1; })()`);

  const 浅 = await 跑一轮('light');
  console.log('=== 浅色 ===\n' + JSON.stringify(浅, null, 2));
  const 深 = await 跑一轮('dark');
  console.log('=== 深色 ===\n' + JSON.stringify(深, null, 2));

  // 判定：深色下画布底色不能是白的
  const isWhite = s => /^#fff/i.test(String(s)) || /rgb\(255,\s*255,\s*255\)/.test(String(s)) || /^white$/i.test(String(s));
  let fail = 0;
  const 判 = (名, 值, 不能白) => {
    const 白 = isWhite(值);
    const ok = 不能白 ? !白 : true;
    if (!ok) fail++;
    console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${名} = ${值}${白 ? '  ← 白色！' : ''}`);
  };
  console.log('\n=== 判定 ===');
  if (深.主题 !== 'dark') { fail++; console.log('[FAIL] 没进深色模式：' + 深.主题); } else console.log('[OK]  主题 = dark');
  判('深色画布底色', 深.画布底色, true);
  判('深色页面底色', 深.页面底色, true);
  判('深色工具箱浮层', 深.工具箱浮层, true);
  console.log(`\n结果：${fail ? '有 ' + fail + ' 项不合格' : '全部通过 ✓'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('失败: ' + e.message); process.exit(1); });
