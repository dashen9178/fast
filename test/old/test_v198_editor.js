/* v1.9.13 编辑器侧：运行拆分按钮 / 当前页运行 / 返回恢复当前页与视图 / 首次启动积木 */
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
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } }
(async () => {
  const l = await get('/json/list'); let t = l.find(x => x.type === 'page'); const c = await conn(t.webSocketDebuggerUrl); const send = c.send;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) { console.log('EXC', r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text); return undefined; } return r.result.value; };
  async function load(url) { await send('Page.navigate', { url }); await sleep(800); }
  async function shot(n) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/' + n + '.png', Buffer.from(r.data, 'base64')); }

  /* 建工程：s1 放按钮，新增 s2 放开关，用于区分当前页 */
  await load('http://127.0.0.1:8931/editor.html?t=' + Date.now());
  await ev(`localStorage.clear();1`); await load('http://127.0.0.1:8931/editor.html?t=' + Date.now());
  await ev(`(function(){document.getElementById('btnNewApp').click();var i=document.getElementById('newAppName');i.value='运行测试';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();})()`);
  await sleep(500);
  await ev(`document.querySelector('[data-add=button]').click();1`); await sleep(150);
  // 新增页面
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(250);
  await ev(`document.getElementById('menuAddScreen').click();1`); await sleep(400);
  const s2id = await ev(`(function(){return JSON.parse(localStorage.getItem('__bb_projects_v2')).items.find(function(x){return x.id===localStorage.getItem('__bb_open_id');}).project.screens[1].id;})()`);
  ok('已切到新页面 s2', (await ev(`document.getElementById('btnScreenMenu').textContent`)).indexOf('页面2') >= 0);
  await ev(`document.querySelector('[data-add=switch]').click();1`); await sleep(150);

  console.log('— 运行拆分按钮 —');
  const geom = await ev(`(function(){var m=document.getElementById('btnRun').getBoundingClientRect();var ca=document.getElementById('btnRunCaret').getBoundingClientRect();var rs=document.getElementById('runSplit').getBoundingClientRect();var cs=getComputedStyle(document.getElementById('btnRunCaret'));var ms=getComputedStyle(document.getElementById('btnRun'));return {main:Math.round(m.width),caret:Math.round(ca.width),joined:Math.abs(m.right-ca.left)<=1.5,total:Math.round(rs.width),caretBg:cs.backgroundColor,mainBg:ms.backgroundColor};})()`);
  ok('主按钮+▾小按钮连体', geom && geom.joined && geom.caret >= 28 && geom.caret < geom.main, geom);
  ok('▾按钮颜色与主按钮区分', geom && geom.caretBg !== geom.mainBg, geom);
  await ev(`document.getElementById('btnRunCaret').click();1`); await sleep(250);
  const menu = await ev(`(function(){var m=document.getElementById('runMenu');return {vis:!m.classList.contains('hidden'),items:[].map.call(m.querySelectorAll('.menu-item'),function(b){return b.textContent.trim();})};})()`);
  ok('▾菜单两项', menu && menu.vis && menu.items.length === 2 && menu.items[0].indexOf('从头开始运行') >= 0 && menu.items[1].indexOf('当前页面运行') >= 0, menu);
  await shot('run_menu');
  // 默认选中“从头开始运行”
  ok('默认勾选从头开始', await ev(`document.getElementById('runFromStart').classList.contains('on')`) === true && await ev(`document.getElementById('runCurrent').classList.contains('on')`) === false);
  // 点“当前页面运行”：只切换模式，不立即运行（仍在编辑器页）
  await ev(`document.getElementById('runCurrent').click();1`); await sleep(300);
  ok('选模式后菜单关闭', await ev(`document.getElementById('runMenu').classList.contains('hidden')`));
  ok('勾选切到当前页面运行', await ev(`document.getElementById('runCurrent').classList.contains('on')`) === true && await ev(`document.getElementById('runFromStart').classList.contains('on')`) === false);
  ok('主按钮图标随模式切换为▶', await ev(`document.getElementById('runMainIco').textContent`) === '▶');
  ok('模式已持久化', await ev(`localStorage.getItem('__bb_run_mode_v1')`) === 'current');
  ok('选模式后不立即运行（仍在编辑器）', /editor\.html/.test(await ev(`location.pathname`)));

  console.log('— 当前页面运行（在 s2，点主按钮才运行） —');
  await ev(`document.getElementById('btnRun').click();1`);
  await sleep(1800);
  const pageKind = await ev(`JSON.stringify({sw:!!document.querySelector('#screen .comp.switch'),btn:!!document.querySelector('#screen .comp.button'),path:location.pathname})`);
  const pk = pageKind ? JSON.parse(pageKind) : {};
  ok('主按钮按当前模式打开 s2（有开关无按钮）', pk.sw === true && pk.btn === false && /runtime\.html/.test(pk.path || ''), pageKind);
  ok('运行时已消费 __previewStartScreen', await ev(`localStorage.getItem('__previewStartScreen')`) === null);
  ok('记住返回页面=s2', await ev(`localStorage.getItem('__previewReturnScreen')`) === s2id);

  console.log('— 返回编辑器：恢复到 s2 设计页，模式沿用 —');
  await load('http://127.0.0.1:8931/editor.html?back=' + Date.now());
  await sleep(1200);
  ok('返回后停在 s2', (await ev(`document.getElementById('btnScreenMenu').textContent`)).indexOf('页面2') >= 0, await ev(`document.getElementById('btnScreenMenu').textContent`));
  const listText = await ev(`document.getElementById('compList').textContent`) || '';
  ok('设计列表显示 s2 的开关', /开关/.test(listText), listText.slice(0, 40));
  ok('返回页面标记已消费', await ev(`localStorage.getItem('__previewReturnScreen')`) === null);
  ok('运行模式沿用=当前页面', await ev(`document.getElementById('runCurrent').classList.contains('on')`) === true);

  console.log('— 切回从头运行 + 积木视图返回恢复 —');
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(1000);
  ok('已切到积木视图', await ev(`!document.getElementById('viewBlocks').classList.contains('hidden')`));
  await ev(`document.getElementById('btnRunCaret').click();1`); await sleep(250);
  await ev(`document.getElementById('runFromStart').click();1`); await sleep(300);
  ok('主按钮图标切回⏮', await ev(`document.getElementById('runMainIco').textContent`) === '⏮');
  await ev(`document.getElementById('btnRun').click();1`); await sleep(1500);
  const pageKind2 = await ev(`JSON.stringify({sw:!!document.querySelector('#screen .comp.switch'),btn:!!document.querySelector('#screen .comp.button')})`);
  ok('从头运行打开 s1（有按钮无开关）', pageKind2 === '{"sw":false,"btn":true}', pageKind2);
  await load('http://127.0.0.1:8931/editor.html?back2=' + Date.now());
  await sleep(1300);
  ok('返回后仍在积木视图', await ev(`!document.getElementById('viewBlocks').classList.contains('hidden')`));
  // 返回编辑器始终回到“正在编辑的页面”（s2），与试运行从哪个页面开始无关
  ok('从头运行后返回仍停在编辑页 s2', (await ev(`document.getElementById('btnScreenMenu').textContent`)).indexOf('页面2') >= 0, await ev(`document.getElementById('btnScreenMenu').textContent`));

  console.log('— 首次启动积木 —');
  const fly = await ev(`(function(){
    var ws=Blockly.getMainWorkspace();
    var cats=ws.getToolbox().toolboxDef_ ? 1 : 1;
    var tl=ws.getToolbox().getToolboxItems ? ws.getToolbox().getToolboxItems().map(function(i){return i.name_;}) : [];
    return tl.join(',');
  })()`);
  // 通过分类轨道打开“事件”浮层
  await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .bb-panel-general .bb-cat')).find(function(x){return x.querySelector('.bb-cat-lb').textContent==='事件';});b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));b.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 1;})()`);
  await sleep(700);
  const types = await ev(`Blockly.getMainWorkspace().getFlyout().getWorkspace().getTopBlocks(true).map(function(b){return b.type;}).join(',')`);
  ok('事件浮层含 ev_start 与 ev_first_start', types.indexOf('ev_start') >= 0 && types.indexOf('ev_first_start') >= 0, types);
  // 代码生成
  const gen = await ev(`(function(){
    var ws=new Blockly.Workspace();
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="ev_first_start" x="20" y="20"><statement name="DO"><block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">hi</field></shadow></value></block></statement></block></xml>'),ws);
    var code=generateEventCode(ws); ws.dispose(); return code;
  })()`);
  ok('首次启动积木生成 RT.on(firstStart', /RT\.on\('firstStart'/.test(gen), gen);
  ok('帮助页含首次启动说明', await ev(`(function(){document.getElementById('btnHelp').click();var t=document.body.textContent;document.getElementById('btnHelpBack').click();return t.indexOf('当页面首次启动时')>=0;})()`));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
