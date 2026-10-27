// 用 CDP 驱动无头 Edge，对编辑器做一次冒烟体检
// 运行：ELECTRON_RUN_AS_NODE=1 "DSH Desktop.exe" cdp-smoke.mjs
const CDP = 'http://127.0.0.1:9222';
const TARGET_HINT = process.argv[2] || 'editor.html';

const list = await (await fetch(CDP + '/json/list')).json();
const page = list.find(t => t.type === 'page' && t.url.includes(TARGET_HINT));
if (!page) {
  console.error('找不到页面目标，当前目标：');
  list.filter(t => t.type === 'page').forEach(t => console.error('  ' + t.url));
  process.exit(2);
}
console.log('目标页面: ' + page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const errors = [];
const logs = [];

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('ws error')); });

ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errors.push('EXCEPTION: ' + (d.exception?.description || d.text || JSON.stringify(d)).split('\n')[0]);
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
    logs.push(m.params.type + ': ' + txt);
    if (m.params.type === 'error') errors.push('CONSOLE.error: ' + txt);
  }
};

const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});

const evalJs = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').split('\n')[0] };
  return r.result.value;
};

await send('Runtime.enable');
await send('Page.enable');

for (let i = 0; i < 60; i++) {
  if ((await evalJs('document.readyState')) === 'complete') break;
  await new Promise(r => setTimeout(r, 250));
}
await new Promise(r => setTimeout(r, 1500)); // 等 init() 跑完

const rep = {};
rep.readyState      = await evalJs('document.readyState');
rep.title           = await evalJs('document.title');
rep.blockly         = await evalJs('typeof window.Blockly');
rep.blocklyVersion  = await evalJs('window.Blockly ? (window.Blockly.Version || "") : null');
rep.idElementCount  = await evalJs('document.querySelectorAll("[id]").length');
rep.bodyChildren    = await evalJs('Array.from(document.body.children).map(function(e){return (e.id||". "+e.className)+(e.classList.contains("hidden")?" [hidden]":"")})');
rep.visibleMasks    = await evalJs('Array.from(document.querySelectorAll(".mask,.m3-mask,#modalMask")).filter(function(e){return !e.classList.contains("hidden")}).map(function(e){return e.id||e.className})');
rep.workspaceInited = await evalJs('(function(){try{return !!(window.Blockly && Blockly.getMainWorkspace && Blockly.getMainWorkspace())}catch(e){return "err:"+e.message}})()');
rep.errorCount      = errors.length;
rep.errors          = errors.slice(0, 12);
rep.logCount        = logs.length;

console.log(JSON.stringify(rep, null, 2));
ws.close();
process.exit(errors.length ? 1 : 0);
