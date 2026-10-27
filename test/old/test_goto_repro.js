/* 复现：切换屏幕（跳转到页面）积木全链路：编辑器下拉→codegen→运行 */
const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:9222';
function get(p) { return new Promise((res, rej) => { require('http').get(HTTP + p, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
(async () => {
  const l = await get('/json/list'); const t = l.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false }); const pend = {};
  const errs = [];
  ws.on('message', d => { const o = JSON.parse(d); if (o.id && pend[o.id]) o.error ? pend[o.id].j(new Error(JSON.stringify(o.error))) : pend[o.id].r(o.result);
    if (o.method === 'Runtime.exceptionThrown') errs.push((o.params.exceptionDetails.exception && o.params.exceptionDetails.exception.description) || o.params.exceptionDetails.text); });
  await new Promise(r => ws.on('open', r));
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; pend[i] = { r, j }; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  let pass = 0, fail = 0;
  const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, e !== undefined ? JSON.stringify(e) : ''); } };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { const d = r.exceptionDetails; console.log('  !! EXC', d.exception && d.exception.description || d.text); return undefined; } return r.result.value; };
  const load = async u => { await send('Page.navigate', { url: u + '?z=' + Date.now() }); await sleep(700); };

  await load('http://127.0.0.1:8931/editor.html');
  // 新建工程
  await ev(`(function(){document.getElementById('btnNewApp').click();var i=document.getElementById('newAppName');i.value='跳转复现';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();return 1;})()`);
  await sleep(400);
  // s1 加按钮
  await ev(`document.querySelector('[data-add=button]').click();1`); await sleep(200);
  const btnId = await ev(`document.querySelector('#compList [data-id]').getAttribute('data-id')`);
  console.log('按钮 id =', btnId);
  // 新增页面 s2
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
  await ev(`document.getElementById('menuAddScreen').click();1`); await sleep(400);
  const s2id = await ev(`Blockly.common.getMainWorkspace?'':''`); // noop
  // 取两个页面 id
  const ids = await ev(`(function(){var p=JSON.parse(localStorage.getItem('__bb_projects_v2'));var cur=localStorage.getItem('__bb_open_id');return {screens:p.items.find(x=>x.id===cur).project.screens.map(s=>s.id),open:cur};})()`);
  console.log('页面 ids =', ids);
  const s1 = ids.screens[0], s2 = ids.screens[1];

  // 回到 s1，进积木视图
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
  ok('页面菜单列出2页', await ev(`document.querySelectorAll('#screenMenuList .menu-item, #screenMenuList [data-screen]').length`) === 2);
  await ev(`(function(){var items=document.querySelectorAll('#screenMenuList .menu-item, #screenMenuList [data-screen]');items[0].click();return 1;})()`); await sleep(300);
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(900);

  // 用 Blockly API 搭：ev_click -> act_goto
  const built = await ev(`(function(){
    var ws = Blockly.common.getMainWorkspace();
    var hat = ws.newBlock('ev_click'); hat.initSvg(); hat.render(); hat.moveBy(40,60);
    var gotoB = ws.newBlock('act_goto'); gotoB.initSvg(); gotoB.render();
    var conn = hat.getInput('DO').connection; conn.connect(gotoB.previousConnection);
    hat.setFieldValue(${JSON.stringify(btnId)}, 'COMP');
    gotoB.setFieldValue(${JSON.stringify(s2)}, 'PAGE');
    return {hat:hat.type, goto:gotoB.type, page:gotoB.getFieldValue('PAGE'),
            opts:gotoB.getField('PAGE').getOptions(true).map(o=>o[0]+'='+o[1])};
  })()`);
  ok('搭出 ev_click+act_goto', built && built.goto === 'act_goto', built);
  ok('跳转下拉含两个页面', built && built.opts.length === 2, built && built.opts);
  ok('下拉值为 s2 id', built && built.page === s2, built && built.page);

  // codegen
  const code = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();return window.generateEventCode(ws);})()`);
  console.log('生成代码:\n' + code);
  ok('code 含 gotoPage(s2)', code.indexOf("RT.gotoPage(" + JSON.stringify(s2) + ")") >= 0, code);
  ok('code 含 onClick(按钮)', code.indexOf("RT.onClick(" + JSON.stringify(btnId)) >= 0, code);

  // 关键复现点1：再新增 s3，已存在的跳转积木下拉是否动态出现 s3
  await ev(`document.getElementById('tabDesign').click();1`); await sleep(400);
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
  await ev(`document.getElementById('menuAddScreen').click();1`); await sleep(400);
  const ids2 = await ev(`(function(){var p=JSON.parse(localStorage.getItem('__bb_projects_v2'));var cur=localStorage.getItem('__bb_open_id');return p.items.find(x=>x.id===cur).project.screens.map(s=>s.id);})()`);
  const s3 = ids2[2];
  // 新建页面后当前停在 s3，切回 s1
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
  await ev(`(function(){var items=document.querySelectorAll('#screenMenuList .menu-item');items[0].click();return 1;})()`); await sleep(300);
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(900);
  const opts3 = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var b=ws.getAllBlocks(false).find(x=>x.type==='act_goto');return b?b.getField('PAGE').getOptions(true).map(o=>o[1]):null;})()`);
  ok('新增 s3 后下拉动态刷新含3页', Array.isArray(opts3) && opts3.length === 3, opts3);

  // 关键复现点2：真实 UI 点下拉能否弹出并选择（移动端 widget 定位/点击）
  const uiPick = await ev(`(function(){
    var ws=Blockly.common.getMainWorkspace();var b=ws.getAllBlocks(false).find(x=>x.type==='act_goto');
    var r=b.getField('PAGE').getAbsoluteXY_();
    var svg=ws.getInjectionDiv().getBoundingClientRect();
    var sc=ws.getScale();
    var x=(r.x/sc)+svg.left, y=(r.y/sc)+svg.top;
    window.__pickAt={x:Math.round(x),y:Math.round(y)};
    var el=document.elementFromPoint(x,y);
    // Blockly 字段点击通过 editor 打开
    b.getField('PAGE').showEditor();
    var menu=document.querySelector('.blocklyMenu');
    return {at:window.__pickAt, menuShown:!!menu, items:menu?[].slice.call(menu.querySelectorAll('.blocklyMenuItem')).map(m=>m.textContent):[]};
  })()`);
  console.log('下拉菜单:', JSON.stringify(uiPick));
  ok('下拉菜单弹出', uiPick && uiPick.menuShown === true, uiPick);
  ok('菜单含3个页面项', uiPick && uiPick.items.length === 3, uiPick && uiPick.items);
  if (uiPick && uiPick.menuShown) {
    const picked = await ev(`(function(){
      var items=[].slice.call(document.querySelectorAll('.blocklyMenu .blocklyMenuItem'));
      var target=items.find(m=>m.textContent.indexOf('页面3')>=0||m.textContent.indexOf('s3')>=0)||items[2];
      var r=target.getBoundingClientRect();
      return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),label:target.textContent};
    })()`);
    console.log('点选项:', JSON.stringify(picked));
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: picked.x, y: picked.y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
    const after = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var b=ws.getAllBlocks(false).find(x=>x.type==='act_goto');return {val:b.getFieldValue('PAGE'),menuStill:!!document.querySelector('.blocklyMenu')};})()`);
    ok('触摸选择后值变为 s3', after && after.val === s3, after);
    ok('选择后菜单关闭', after && after.menuStill === false, after);
  }
  // 关闭可能残留的菜单
  await ev(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));1`);

  // 关键复现点3：删除 s2/s3 后，指向失效页面的积木运行时表现（先把值设回 s2 再删 s3 之外的页测不了，
  // 这里测指向已删除页：选 s3，然后删 s3）
  // 切设计页删除 s3
  await ev(`document.getElementById('tabDesign')&&document.getElementById('tabDesign').click();1`); await sleep(400);
  const delRes = await ev(`(function(){
    // 顶栏菜单进页面管理
    document.getElementById('btnScreenMenu').click();
    return 1;
  })()`); await sleep(300);
  // 直接用数据层删除当前页（s3 是当前页）：找删除按钮
  const delUi = await ev(`(function(){var d=document.getElementById('screenMenu');return d?d.outerHTML.slice(0,600):'NO MENU';})()`);
  console.log('页面菜单 HTML 片段:', delUi.slice(0, 300));

  // 保存工程并真实运行（此时跳转目标 s3）
  await ev(`document.body.dispatchEvent(new MouseEvent('click',{bubbles:true}));1`); await sleep(200);
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(500);
  // 切到从头运行
  await ev(`document.getElementById('btnRunCaret').click();1`); await sleep(250);
  await ev(`document.getElementById('runFromStart').click();1`); await sleep(250);
  await ev(`document.getElementById('btnRun').click();1`); await sleep(1500);
  const landed = await ev(`(function(){var t=document.querySelector('#screen [data-id] .v-text');return location.href.indexOf('runtime')>=0?'runtime:'+(t?t.textContent:'?'):'editor';})()`);
  ok('进入运行时', landed.indexOf('runtime:') === 0, landed);
  // 点按钮跳转
  await ev(`(function(){var w=document.querySelector('[data-id=${btnId}]');var b=w&&(w.querySelector('button')||w);b&&b.click();return 1;})()`);
  await sleep(700);
  const curPg = await ev(`(function(){
    // 运行时当前页标识：看 #screen 里组件 data-screen 或标题；用 RT 内部不可得，改用页面组件差异
    return document.querySelector('#screen').innerHTML.length;
  })()`);
  // s3 是空页（无组件），跳转后 #screen 内组件数应为 0（flow 空）
  const compCount = await ev(`document.querySelectorAll('#screen [data-id]').length`);
  const toast = await ev(`(function(){var t=document.getElementById('toast');return t.classList.contains('show')?t.textContent:'';})()`);
  console.log('点击后组件数=', compCount, ' toast=', toast);
  ok('点击按钮跳到空 s3（组件数0）', compCount === 0, { compCount, toast });
  ok('跳转无报错提示', toast === '', toast);
  ok('全程无未捕获异常', errs.length === 0, errs.slice(0, 3));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
