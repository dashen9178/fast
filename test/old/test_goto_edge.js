/* 复现边缘场景：保存重载、删除页面、改名、控制积木内跳转的 codegen */
const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:9222';
function get(p) { return new Promise((res, rej) => { require('http').get(HTTP + p, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
(async () => {
  const l = await get('/json/list'); const t = l.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false }); const pend = {};
  ws.on('message', d => { const o = JSON.parse(d); if (o.id && pend[o.id]) o.error ? pend[o.id].j(new Error(JSON.stringify(o.error))) : pend[o.id].r(o.result); });
  await new Promise(r => ws.on('open', r));
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; pend[i] = { r, j }; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  let pass = 0, fail = 0;
  const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, e !== undefined ? JSON.stringify(e) : ''); } };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { const d = r.exceptionDetails; console.log('  !! EXC', d.exception && d.exception.description || d.text); return undefined; } return r.result.value; };
  const load = async u => { await send('Page.navigate', { url: u + '?z=' + Date.now() }); await sleep(700); };
  const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); require('fs').writeFileSync('/tmp/' + n + '.png', Buffer.from(r.data, 'base64')); };

  await load('http://127.0.0.1:8931/editor.html');
  await ev(`(function(){document.getElementById('btnNewApp').click();var i=document.getElementById('newAppName');i.value='边缘复现';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();return 1;})()`);
  await sleep(400);
  await ev(`document.querySelector('[data-add=button]').click();1`); await sleep(200);
  const btnId = await ev(`document.querySelector('#compList [data-id]').getAttribute('data-id')`);
  async function addScreen() {
    await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
    await ev(`document.getElementById('menuAddScreen').click();1`); await sleep(400);
  }
  async function gotoScreen(idx) {
    await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
    await ev(`(function(){var items=document.querySelectorAll('#screenMenuList .menu-item');items[${idx}].click();return 1;})()`); await sleep(350);
  }
  async function screensInfo() {
    return ev(`(function(){var p=JSON.parse(localStorage.getItem('__bb_projects_v2'));var cur=localStorage.getItem('__bb_open_id');var pr=p.items.find(x=>x.id===cur).project;return {ids:pr.screens.map(s=>s.id),titles:pr.screens.map(s=>s.title),xml:pr.screens.map(s=>s.blocksXml||'')};})()`);
  }
  await addScreen(); // s2
  await gotoScreen(0); // 回 s1
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(900);
  // 搭：ev_click -> act_goto(s2)
  await ev(`(function(){
    var ws=Blockly.common.getMainWorkspace();
    var hat=ws.newBlock('ev_click');hat.initSvg();hat.render();hat.moveBy(40,60);
    var g=ws.newBlock('act_goto');g.initSvg();g.render();
    hat.getInput('DO').connection.connect(g.previousConnection);
    hat.setFieldValue(${JSON.stringify(btnId)},'COMP');
    g.setFieldValue('SMU2','PAGE'); // 先设不存在的值
    return 1;})()`);
  const badDisplay = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var g=ws.getAllBlocks(false).find(x=>x.type==='act_goto');var f=g.getField('PAGE');return {value:f.getValue(),text:f.getText(),displayText:f.getText()};})()`);
  console.log('失效值时字段显示:', JSON.stringify(badDisplay));
  // 设成 s2
  const s2 = (await screensInfo()).ids[1];
  await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var g=ws.getAllBlocks(false).find(x=>x.type==='act_goto');g.setFieldValue(${JSON.stringify(s2)},'PAGE');return 1;})()`);
  const okDisplay = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var g=ws.getAllBlocks(false).find(x=>x.type==='act_goto');return {value:g.getFieldValue('PAGE'),text:g.getField('PAGE').getText()};})()`);
  console.log('正常值时字段显示:', JSON.stringify(okDisplay));
  ok('正常时下拉显示页面标题', okDisplay.text === '页面2', okDisplay);

  // 切设计页（触发 saveCurrentWs），再回积木页：值是否保留
  await ev(`document.getElementById('tabDesign').click();1`); await sleep(400);
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(700);
  const afterToggle = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var g=ws.getAllBlocks(false).find(x=>x.type==='act_goto');return g?{value:g.getFieldValue('PAGE'),text:g.getField('PAGE').getText()}:null;})()`);
  ok('设计/积木切换后跳转目标保留', afterToggle && afterToggle.value === s2 && afterToggle.text === '页面2', afterToggle);

  // 回首页再重新打开工程（完整持久化重载）
  await ev(`document.getElementById('tabDesign').click();1`); await sleep(300);
  await ev(`document.getElementById('btnHome').click();1`); await sleep(500);
  await shot('goto_home_list');
  // 重新打开工程（点第一个工程卡片）
  await ev(`(function(){var c=document.querySelector('.proj-card');if(c){c.click();return c.className;}return 'NOCARD';})()`); await sleep(700);
  const where = await ev(`location.hash+'|'+document.getElementById('viewEditor').className`);
  console.log('重开后:', where);
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(800);
  const afterReopen = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var g=ws.getAllBlocks(false).find(x=>x.type==='act_goto');return g?{value:g.getFieldValue('PAGE'),text:g.getField('PAGE').getText()}:null;})()`);
  ok('回首页重开工程后跳转目标保留', afterReopen && afterReopen.value === s2, afterReopen);
  await shot('goto_after_reopen');

  // 删除 s2：页面菜单里找删除入口
  await ev(`document.getElementById('tabDesign').click();1`); await sleep(300);
  await gotoScreen(1); // 切到 s2
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(300);
  const menuHtml = await ev(`document.getElementById('screenMenu').innerText`);
  console.log('页面菜单内容:', menuHtml);
  await shot('goto_screen_menu');
  // 关闭菜单
  await ev(`document.body.dispatchEvent(new MouseEvent('click',{bubbles:true}));1`);

  // 控制积木内嵌跳转的 codegen：if 内、等待后、for 内
  await gotoScreen(0);
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(700);
  const codegenCases = await ev(`(function(){
    var ws=Blockly.common.getMainWorkspace();ws.clear();
    var out={};
    function build(type){
      ws.clear();
      var hat=ws.newBlock('ev_click');hat.initSvg();hat.render();
      var b=ws.newBlock(type);b.initSvg();b.render();
      hat.getInput('DO').connection.connect(b.previousConnection);
      return b;
    }
    // 1) 等待后跳转
    var b1=build('act_wait');
    var g1=ws.newBlock('act_goto');g1.initSvg();g1.render();
    b1.nextConnection.connect(g1.previousConnection);
    out.waitThenGoto=window.generateEventCode(ws);
    // 2) if 内跳转
    ws.clear();
    var hat=ws.newBlock('ev_click');hat.initSvg();hat.render();
    var iff=ws.newBlock('controls_if');iff.initSvg();iff.render();
    hat.getInput('DO').connection.connect(iff.previousConnection);
    var g2=ws.newBlock('act_goto');g2.initSvg();g2.render();
    iff.getInput('DO0').connection.connect(g2.previousConnection);
    out.ifGoto=window.generateEventCode(ws);
    return out;
  })()`);
  console.log('--- 等待后跳转 code ---\n' + codegenCases.waitThenGoto);
  console.log('--- if 内跳转 code ---\n' + codegenCases.ifGoto);
  ok('等待后跳转含 await RT.wait 与 gotoPage', /await RT\.wait/.test(codegenCases.waitThenGoto) && /RT\.gotoPage/.test(codegenCases.waitThenGoto));
  ok('if 内含 gotoPage', /if[\s\S]*RT\.gotoPage/.test(codegenCases.ifGoto), codegenCases.ifGoto);

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
