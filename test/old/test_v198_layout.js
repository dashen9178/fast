/* 诊断：布局页拖动新控件时其他控件补位 */
const WebSocket = require('ws');
const fs = require('fs');
const HTTP = 'http://127.0.0.1:9222';
function get(p) { return new Promise((res, rej) => { require('http').get(HTTP + p, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
function conn(u) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(u, { perMessageDeflate: false }); const pend = {}, hand = [];
    ws.on('open', () => res({
      send: (m, p = {}) => new Promise((r, j) => { const i = ++id; pend[i] = { r, j }; ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      on: (m, f) => hand.push({ m, f })
    }));
    ws.on('message', d => { const o = JSON.parse(d); if (o.id && pend[o.id]) o.error ? pend[o.id].j(new Error(JSON.stringify(o.error))) : pend[o.id].r(o.result); hand.forEach(h => h.m === o.m && h.f(o.params)); });
    ws.on('error', rej);
  });
}
(async () => {
  const l = await get('/json/list'); let t = l.find(x => x.type === 'page'); const c = await conn(t.webSocketDebuggerUrl); const send = c.send;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) { console.log('EXC', r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text); return undefined; } return r.result.value; };
  async function load(url) { await send('Page.navigate', { url }); await sleep(900); }
  async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/' + name + '.png', Buffer.from(r.data, 'base64')); }
  function items() {
    return ev(`(function(){var sr=document.getElementById('layStage').getBoundingClientRect();var k=parseFloat(document.getElementById('layStage').dataset.scale)||1;return [].slice.call(document.querySelectorAll('#layStage .litem')).map(function(n){var r=n.getBoundingClientRect();return {id:n.dataset.id,x:Math.round((r.left-sr.left)/k),y:Math.round((r.top-sr.top)/k),w:Math.round(r.width/k),h:Math.round(r.height/k),tag:n.querySelector('.li-tag').textContent};});})()`);
  }
  function ptr(seq) { // seq: [{x,y,phase}] phases down/move/up; use mouse events (pointer)
    return send('Input.dispatchMouseEvent', seq);
  }
  async function dragItem(index, dx, dy) {
    const ps = await items();
    const it = ps[index];
    const sr = await ev(`(function(){var r=document.getElementById('layStage').getBoundingClientRect();var k=parseFloat(document.getElementById('layStage').dataset.scale)||1;return {l:r.left,t:r.top,k:k};})()`);
    const cx = sr.l + (it.x + it.w / 2) * sr.k, cy = sr.t + (it.y + it.h / 2) * sr.k;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1, pointerType: 'touch' });
    await sleep(60);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + dx * sr.k * i / steps, y: cy + dy * sr.k * i / steps, button: 'left', pointerType: 'touch' });
      await sleep(40);
    }
    await sleep(100);
    const during = await items();
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + dx * sr.k, y: cy + dy * sr.k, button: 'left', clickCount: 1, pointerType: 'touch' });
    await sleep(700);
    return during;
  }

  await load('http://127.0.0.1:8931/editor.html?t=' + Date.now());
  await ev(`localStorage.clear();1`); await load('http://127.0.0.1:8931/editor.html?t=' + Date.now());
  await ev(`(function(){document.getElementById('btnNewApp').click();var i=document.getElementById('newAppName');i.value='拖测';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();})()`);
  await sleep(500);
  // 加 5 个按钮
  for (let i = 0; i < 5; i++) { await ev(`document.querySelector('[data-add=button]').click();1`); await sleep(80); }
  const comps = await ev(`(function(){return EditorApp && window.__bbDbg ? 1 : 1;})()`);
  const compData = await ev(`JSON.stringify(JSON.parse(localStorage.getItem('__bb_projects_v2')).items.find(function(x){return x.id===localStorage.getItem('__bb_open_id');}).project.screens[0].components.map(function(c){return {id:c.id,type:c.type,w:c.w,h:c.h,x:c.x,y:c.y,text:c.text};}))`);
  console.log('新建控件数据:', compData);
  // 进布局
  await ev(`document.getElementById('btnLayout').click();1`);
  await sleep(1200);
  const before = await items();
  console.log('拖动前各控件:'); before.forEach((p, i) => console.log('  #' + i, p.id, p.tag, 'x=' + p.x, 'y=' + p.y, 'w=' + p.w, 'h=' + p.h));
  await shot('lay_before');
  // 拖第3个（index 2）向右下移动 120,150 设计像素
  const during = await dragItem(2, 130, 160);
  console.log('拖动中（未松手）各控件:'); during.forEach((p, i) => console.log('  #' + i, p.id, 'x=' + p.x, 'y=' + p.y));
  await shot('lay_during');
  await sleep(200);
  const after = await items();
  console.log('松手后各控件:'); after.forEach((p, i) => console.log('  #' + i, p.id, 'x=' + p.x, 'y=' + p.y, 'w=' + p.w, 'h=' + p.h));
  await shot('lay_after');
  const compData2 = await ev(`(function(){var s=JSON.parse(localStorage.getItem('__bb_projects_v2')).items;var it=s[s.length-1];return JSON.stringify(it.project.screens[0].components.map(function(c){return {id:c.id,w:c.w,h:c.h,x:c.x,y:c.y};}));})()`);
  console.log('松手后控件数据:', compData2);
  let pass = 0, failc = 0;
  function chk(name, cond, extra) { if (cond) { pass++; console.log('  ✓', name); } else { failc++; console.log('  ✗', name, extra || ''); } }
  [0, 1, 3, 4].forEach(i => chk('保持原位 ' + after[i].id, after[i].x === before[i].x && after[i].y === before[i].y,
    JSON.stringify({ got: [after[i].x, after[i].y], exp: [before[i].x, before[i].y] })));
  chk('被拖控件落在新位置', Math.abs(after[2].x - 146) <= 6 && Math.abs(after[2].y - 300) <= 6, [after[2].x, after[2].y]);
  chk('全部控件已绝对定位(都有x/y)', after.every(p => p.x != null && p.y != null));
  console.log(`\n布局结果：${pass} 通过，${failc} 失败`);
  process.exit(failc ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
