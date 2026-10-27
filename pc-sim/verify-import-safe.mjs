// verify-import-safe.mjs —— 验证「外来作品里的手写代码会被洗掉」这条安全加固。
//
// 背景（2026-09-26 漏洞扫描发现的高危项）：
//   运行时是 `new Function('RT', sc.code)(RT)` 直接执行页面里那段字符串，而 `.fast` 文件里
//   带着 `code` 字段 —— 分享者可以把它改成任意 JS，别人一「运行」就在对方手机上执行了。
//   修法：外来作品一律按 blocksXml 重新生成 code（见 editor.js 的 洗掉外来代码）。
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

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log(`  [OK]   ${n}${extra ? ' :: ' + extra : ''}`); } else { fail++; console.log(`  [FAIL] ${n}${extra ? ' :: ' + extra : ''}`); } };

(async () => {
  const t = await pickTarget();
  await open(t.webSocketDebuggerUrl);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await waitFor(`document.readyState === 'complete' && !!window.EditorApp && !!window.EditorApp.__importFast`, 20000);
  console.log('===== 外来作品的代码必须被洗掉 =====');

  // 造一份"夹带私货"的作品：blocksXml 里只有一个空事件（生成不出任何 JS），
  // 但 code 字段被改成一段会写全局变量的 JS。
  const 恶意 = JSON.stringify({
    fast: 1, kind: 'project', appName: '夹带私货的作品',
    project: {
      appName: '夹带私货的作品', orientation: 'portrait', version: '1.0', startScreen: 's1',
      screens: [{
        id: 's1', name: '页面1', components: [],
        blocksXml: '<xml xmlns="https://developers.google.com/blockly/xml"></xml>',
        code: 'window.__PWNED = 1; try { Native.toast("pwned"); } catch(e) {}',
      }],
      clouds: [],
    },
    media: {},
  });

  const r = await js(`(function(){ window.__PWNED = 0; return window.EditorApp.__importFast(${JSON.stringify(恶意)}); })()`);
  ok('导入成功', r && r.ok === true, JSON.stringify(r));
  if (!r || !r.ok) { console.log('\n无法继续'); process.exit(1); }

  const screens = await js(`JSON.stringify(window.EditorApp.__itemScreens(${JSON.stringify(r.id)}))`);
  let arr = [];
  try { arr = JSON.parse(screens) || []; } catch (e) { }
  const code = arr.length ? String(arr[0].code || '') : '';
  console.log('  导入后存的 code = ' + JSON.stringify(code.slice(0, 120)));
  ok('夹带的 JS 不见了', code.indexOf('__PWNED') < 0 && code.indexOf('Native.toast') < 0);
  ok('code 是按代码块重算的（空代码块 → 空代码）', code.trim() === '');

  // 对照：合法作品（有真代码块）导入后 code 应该**照常生成**
  const 合法 = JSON.stringify({
    fast: 1, kind: 'project', appName: '正常作品',
    project: {
      appName: '正常作品', orientation: 'portrait', version: '1.0', startScreen: 's1',
      screens: [{ id: 's1', name: '页面1', components: [],
        blocksXml: '<xml xmlns="https://developers.google.com/blockly/xml"><block type="event_start"><next><block type="act_toast"><value name="TEXT"><shadow type="text"><field name="TEXT">你好</field></shadow></value></block></next></block></xml>',
        code: 'window.__PWNED = 2;' }],
      clouds: [],
    },
    media: {},
  });
  const r2 = await js(`(function(){ return window.EditorApp.__importFast(${JSON.stringify(合法)}); })()`);
  ok('合法作品也能导入', r2 && r2.ok === true, JSON.stringify(r2));
  const s2 = await js(`JSON.stringify(window.EditorApp.__itemScreens(${JSON.stringify(r2.id)}))`);
  let arr2 = []; try { arr2 = JSON.parse(s2) || []; } catch (e) { }
  const code2 = arr2.length ? String(arr2[0].code || '') : '';
  console.log('  合法作品生成的 code 片段 = ' + JSON.stringify(code2.slice(0, 140)));
  ok('合法作品仍然生成了代码（功能没被误伤）', code2.length > 0);
  ok('合法作品里原有的假 code 也被换掉了', code2.indexOf('__PWNED') < 0);

  console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('失败: ' + e.message); process.exit(1); });
