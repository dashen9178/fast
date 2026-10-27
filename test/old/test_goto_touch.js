/* 真实触摸：从工具箱拖出"跳转到页面"积木并选页面（模拟手机操作，非 API） */
const WebSocket = require('ws'); const fs = require('fs');
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
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { const d = r.exceptionDetails; console.log('  !! EXC', d.exception && d.exception.description || d.text); return undefined; } return r.result.value; };
  const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/' + n + '.png', Buffer.from(r.data, 'base64')); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(700);
  await ev(`(function(){document.getElementById('btnNewApp').click();var i=document.getElementById('newAppName');i.value='触摸复现';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();return 1;})()`); await sleep(400);
  await ev(`document.querySelector('[data-add=button]').click();1`); await sleep(200);
  // 新建 s2
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
  await ev(`document.getElementById('menuAddScreen').click();1`); await sleep(400);
  // 回 s1
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
  await ev(`(function(){var items=document.querySelectorAll('#screenMenuList .menu-item');items[0].click();return 1;})()`); await sleep(300);
  // 进积木视图
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(1000);
  await shot('goto_touch_1_blocks');
  // 列出分类
  const cats = await ev(`[].slice.call(document.querySelectorAll('.bb-cat')).map(c=>c.textContent.trim()).slice(0,20)`);
  console.log('分类:', cats);
  // 打开"事件"分类，拖一个 ev_click；再打开"页面"分类拖 act_goto
  // 先看页面分类的 flyout 块
  const openCat = async name => ev(`(function(){var b=[].slice.call(document.querySelectorAll('.bb-cat')).find(x=>x.textContent.trim().indexOf(${JSON.stringify(name)})>=0);b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));b.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 1;})()`);
  await openCat('页面'); await sleep(600);
  await shot('goto_touch_2_pageCat');
  const flyBlocks = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var fw=ws.getFlyout().getWorkspace();return fw.getTopBlocks(true).map(b=>b.type);})()`);
  console.log('页面分类 flyout 块:', flyBlocks);
  const gotoPos = await ev(`(function(){
    var ws=Blockly.common.getMainWorkspace();var fw=ws.getFlyout().getWorkspace();
    var b=fw.getTopBlocks(true).find(x=>x.type==='act_goto');
    if(!b)return null;
    var svg=b.pathObject.svgPath.ownerSVGElement;
    var r=b.pathObject.svgPath.getBoundingClientRect();
    // svgPath 只是路径，取整个块组
    var g=b.getSvgRoot();var rg=g.getBoundingClientRect();
    return {x:Math.round(rg.left+rg.width/2),y:Math.round(rg.top+rg.height/2),w:Math.round(rg.width),h:Math.round(rg.height)};
  })()`);
  console.log('flyout act_goto 位置:', gotoPos);
  if (gotoPos) {
    // 真实触摸拖拽：flyout 块中心 → 工作区 (200,400)
    const tx = 200, ty = 420;
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gotoPos.x, y: gotoPos.y }] });
    await sleep(120);
    for (let i=1;i<=8;i++){
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(gotoPos.x+(tx-gotoPos.x)*i/8), y: Math.round(gotoPos.y+(ty-gotoPos.y)*i/8) }] });
      await sleep(45);
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
    await shot('goto_touch_3_dragged');
    const cnt = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();return ws.getTopBlocks(true).map(b=>b.type);})()`);
    console.log('拖出后顶层块:', cnt);
    const defVal = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var b=ws.getTopBlocks(true).find(x=>x.type==='act_goto');return {v:b.getFieldValue('PAGE'),t:b.getField('PAGE').getText()};})()`);
    console.log('默认目标:', JSON.stringify(defVal));
    const s2id = await ev(`(function(){var p=JSON.parse(localStorage.getItem('__bb_projects_v2'));var cur=localStorage.getItem('__bb_open_id');return p.items.find(x=>x.id===cur).project.screens[1].id;})()`);
    if (defVal.v !== s2id) { console.log('  ✗ 默认目标应为页面2'); process.exitCode=1; } else console.log('  ✓ 拖出跳转积木默认指向页面2（非当前页）');
  }
  // 真实触摸点下拉字段
  const ddPos = await ev(`(function(){
    var ws=Blockly.common.getMainWorkspace();
    var b=ws.getTopBlocks(true).find(x=>x.type==='act_goto');
    var f=b.getField('PAGE');
    var g=f.fieldGroup_;var r=g.getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
  })()`);
  console.log('下拉字段热区:', ddPos);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ddPos.x, y: ddPos.y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
  await shot('goto_touch_4_menu');
  const menuInfo = await ev(`(function(){var m=document.querySelector('.blocklyMenu');if(!m)return null;return [].slice.call(m.querySelectorAll('.blocklyMenuItem')).map(it=>{var r=it.getBoundingClientRect();return {label:it.textContent,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};});})()`);
  console.log('下拉菜单项:', JSON.stringify(menuInfo));
  if (menuInfo && menuInfo.length >= 2) {
    const p2 = menuInfo[1];
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p2.x, y: p2.y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
    const val = await ev(`(function(){var ws=Blockly.common.getMainWorkspace();var b=ws.getTopBlocks(true).find(x=>x.type==='act_goto');return {v:b.getFieldValue('PAGE'),t:b.getField('PAGE').getText(),menu:!!document.querySelector('.blocklyMenu')};})()`);
    console.log('选择后:', JSON.stringify(val));
    await shot('goto_touch_5_picked');
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
