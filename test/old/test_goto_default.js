/* 编辑器：跳转积木默认目标（XML 装载触发 create 事件）+ 删页改写 */
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
  const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, JSON.stringify(e)); } };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) console.log('EXC', r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(700);
  await ev(`(function(){document.getElementById('btnNewApp').click();var i=document.getElementById('newAppName');i.value='默认目标';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();return 1;})()`); await sleep(400);
  const addScreen = async () => { await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(150); await ev(`document.getElementById('menuAddScreen').click();1`); await sleep(350); };
  const gotoScreen = async i => { await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(150); await ev(`(function(){var it=document.querySelectorAll('#screenMenuList .menu-item');it[${i}].click();return 1;})()`); await sleep(300); };
  const blocksTab = async () => { await ev(`document.getElementById('tabBlocks').click();1`); await sleep(700); };
  const designTab = async () => { await ev(`document.getElementById('tabDesign').click();1`); await sleep(300); };
  const createGoto = async () => {
    await ev(`(function(){
      var ws=Blockly.common.getMainWorkspace();
      var dom=Blockly.utils.xml.textToDom('<xml><block type="act_goto" x="60" y="120"></block></xml>');
      Blockly.Xml.domToWorkspace(dom, ws);
      return 1;
    })()`);
    await sleep(300);   // Blockly 事件异步派发，等默认值校正 listener 执行
    return await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var b=ws.getTopBlocks(true).filter(x=>x.type==='act_goto').pop();return b?b.getFieldValue('PAGE'):null;})()`);
  };
  const project = () => ev(`(function(){var p=JSON.parse(localStorage.getItem('__bb_projects_v2'));var cur=localStorage.getItem('__bb_open_id');return p.items.find(x=>x.id===cur).project;})()`);

  // 单页时：默认页面1
  await blocksTab();
  let pr = await project(); const s1id = pr.screens[0].id;
  let v1 = await createGoto();
  ok('单页时默认页面1', v1 === s1id, v1);
  await designTab();
  await addScreen(); // 现在在 s2
  pr = await project(); const s2id = pr.screens[1].id;
  await blocksTab();
  let v2 = await createGoto();
  ok('在 s2 新建跳转默认指向 s1', v2 === s1id, v2);
  await designTab();
  await gotoScreen(0);
  await blocksTab();
  let v3 = await createGoto();
  ok('在 s1 新建跳转默认指向 s2', v3 === s2id, v3);
  // 回设计页（保存 s1 积木），删除 s2
  await designTab();
  await gotoScreen(1);
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
  await ev(`[].slice.call(document.querySelectorAll('#screenMenu .danger')).pop().click();1`); await sleep(300);
  const shown = await ev(`(function(){var m=document.getElementById('confirmMask');var s=m&&!m.classList.contains('hidden');if(s)document.getElementById('confirmOk').click();return s;})()`);
  ok('删除确认弹窗出现', shown === true, shown);
  await sleep(500);
  const after = await ev(`(function(){
    var p=JSON.parse(localStorage.getItem('__bb_projects_v2'));var cur=localStorage.getItem('__bb_open_id');
    var pr=p.items.find(x=>x.id===cur).project;
    var xml=pr.screens[0].blocksXml||'';
    return {n:pr.screens.length, xml:xml.replace(/\\s+/g,' ')};
  })()`);
  // 上面的 hasDeadRef 写法绕，直接在表达式里 indexOf
  const hasDead = await ev(`(function(){var p=JSON.parse(localStorage.getItem('__bb_projects_v2'));var cur=localStorage.getItem('__bb_open_id');var pr=p.items.find(x=>x.id===cur).project;return (pr.screens[0].blocksXml||'').indexOf(${JSON.stringify(s2id)})>=0;})()`);
  console.log('删页后 s1 XML:', after.xml.slice(0, 400));
  ok('删除后只剩 1 页', after.n === 1, after.n);
  ok('s1 跳转积木已改写、无死链', hasDead === false, hasDead);

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
