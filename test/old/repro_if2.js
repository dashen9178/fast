// 多路径复现：模拟用户齿轮加分支 + 逐块拖入的交互顺序
// 用法: node repro_if2.js <outPrefix>
const fs = require('fs');
const http = require('http');
const path = require('path');
const HTTP = 'http://127.0.0.1:9222';
// 默认输出前缀落在工程内 test/ 目录，不再指向开发机上的绝对路径
const prefix = process.argv[2] || path.join(__dirname, 'case');
function get(p) {
  return new Promise((res, rej) => http.get(HTTP + p, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
(async () => {
  const l = await get('/json/list');
  const t = l.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const P = {};
  await new Promise(r => ws.onopen = r);
  ws.onmessage = e => {
    const o = JSON.parse(e.data);
    if (o.id && P[o.id]) o.error ? P[o.id].j(new Error(JSON.stringify(o.error))) : P[o.id].r(o.result);
  };
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; P[i] = { r, j }; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) console.log('EXC', JSON.stringify(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  // 场景构造器（纯 API，模拟手工搭建）：先齿轮加 2 个否则如果+否则，再逐块连入
  const buildInteractive = `(function(){
    blocklyWs.clear();
    var ws0=blocklyWs,B=Blockly;
    function mk(type,fields,values){
      var b=ws0.newBlock(type); b.initSvg(); b.render();
      if(fields)Object.keys(fields).forEach(function(k){b.setFieldValue(fields[k],k);});
      if(values)Object.keys(values).forEach(function(k){
        var c=mk(values[k].type,values[k].fields,values[k].values);
        b.getInput(k).connection.connect(c.outputConnection);
      });
      return b;
    }
    var top=ws0.newBlock('controls_if'); top.initSvg(); top.render();
    top.moveBy(120,80);
    // 齿轮：先加两个否则如果，再加否则（走 mutator 正规流程）
    top.elseifCount_=2; top.elseCount_=1;
    if(top.rebuildShape_) top.rebuildShape_(); else top.updateShape_();
    top.render();
    // IF0 条件：并且（两个空布尔槽）
    var cond=mk('logic_operation',{OP:'AND'});
    top.getInput('IF0').connection.connect(cond.outputConnection);
    // DO0 返回上一页
    top.getInput('DO0').connection.connect(mk('act_back').previousConnection);
    // DO1 震动30
    var vib=mk('act_vibrate');
    vib.getInput('MS').connection.connect(mk('math_number',{NUM:'30'}).outputConnection);
    top.getInput('DO1').connection.connect(vib.previousConnection);
    // DO2 设置亮度80
    var bri=mk('act_set_brightness');
    bri.getInput('V').connection.connect(mk('math_number',{NUM:'80'}).outputConnection);
    top.getInput('DO2').connection.connect(bri.previousConnection);
    top.render();
    return 1;
  })()`;

  // 场景2：先把宽块放进 DO0（只有一个分支时），再齿轮扩展到 elseif=2+else
  const buildLate = `(function(){
    blocklyWs.clear();
    var ws0=blocklyWs,B=Blockly;
    function mk(type,fields,values){
      var b=ws0.newBlock(type); b.initSvg(); b.render();
      if(fields)Object.keys(fields).forEach(function(k){b.setFieldValue(fields[k],k);});
      if(values)Object.keys(values).forEach(function(k){
        var c=mk(values[k].type,values[k].fields,values[k].values);
        b.getInput(k).connection.connect(c.outputConnection);
      });
      return b;
    }
    var top=ws0.newBlock('controls_if'); top.initSvg(); top.render();
    top.moveBy(120,80);
    var bri=mk('act_set_brightness');
    bri.getInput('V').connection.connect(mk('math_number',{NUM:'80'}).outputConnection);
    top.getInput('DO0').connection.connect(bri.previousConnection);
    top.render();
    // 之后齿轮加分支
    top.elseifCount_=2; top.elseCount_=1;
    if(top.rebuildShape_) top.rebuildShape_(); else top.updateShape_();
    top.render();
    // 把宽块从 DO0 改放到 DO2（模拟用户调整）
    var do2=top.getInput('DO2').connection;
    var old=top.getInput('DO0').connection.targetBlock();
    do2.connect(old.previousConnection);
    var cond=mk('logic_operation',{OP:'AND'});
    top.getInput('IF0').connection.connect(cond.outputConnection);
    top.getInput('DO0').connection.connect(mk('act_back').previousConnection);
    var vib=mk('act_vibrate');
    vib.getInput('MS').connection.connect(mk('math_number',{NUM:'30'}).outputConnection);
    top.getInput('DO1').connection.connect(vib.previousConnection);
    top.render();
    return 1;
  })()`;

  const probe = `(function(){
    var b=blocklyWs.getBlocksByType('controls_if')[0];
    var info=b.workspace.getRenderer().makeRenderInfo_(b);
    info.measure();
    var rows=info.rows.map(function(r,i){return {i:i,t:r.constructor.name.slice(0,10),w:Math.round(r.width),
      pre:!!r.precedesStatement,fol:!!r.followsStatement,stmt:!!r.hasStatement,
      e:info.__ifRowEdges?Math.round(info.__ifRowEdges[i]):null};});
    return JSON.stringify({bw:b.width,bh:b.height,rows:rows});
  })()`;

  async function shot(name, buildExpr) {
    await send('Page.navigate', { url: 'http://127.0.0.1:8932/editor.html' });
    await sleep(2000);
    await ev(`document.getElementById('btnNewApp').click();1`); await sleep(400);
    await ev(`var i=document.getElementById('newAppName');i.value='c';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`); await sleep(1100);
    await ev(`document.getElementById('tabBlocks').click();1`); await sleep(800);
    await ev(buildExpr); await sleep(500);
    console.log('==', name, await ev(probe));
    const q = await ev(`(function(){var b=blocklyWs.getBlocksByType('controls_if')[0];var r=b.getSvgRoot().getBoundingClientRect();return JSON.stringify({x:Math.round(r.left-14),y:Math.round(r.top-14),w:Math.round(r.width+28),h:Math.round(r.height+28)});})()`);
    const p = JSON.parse(q);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: p.x, y: p.y, width: p.w, height: p.h, scale: 2 } });
    fs.writeFileSync(prefix + '_' + name + '.png', Buffer.from(s.data, 'base64'));
    console.log('  ->', prefix + '_' + name + '.png');
  }

  await shot('interactive', buildInteractive);
  await shot('late', buildLate);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
