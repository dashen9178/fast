// 回归矩阵：多种 controls_if / C 形块布局，截图 + 子块包含性几何断言
// 用法: node matrix_if.js <out.png>
const fs = require('fs');
const http = require('http');
const HTTP = 'http://127.0.0.1:9222';
const out = process.argv[2] || 'matrix.png';
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
    if (r.exceptionDetails) console.log('EXC', JSON.stringify(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails).slice(0, 700));
    return r.result.value;
  };
  await send('Page.navigate', { url: 'http://127.0.0.1:8932/editor.html' });
  await sleep(2000);
  await ev(`document.getElementById('btnNewApp').click();1`); await sleep(400);
  await ev(`var i=document.getElementById('newAppName');i.value='矩阵';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`); await sleep(1100);
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(800);
  await ev(`blocklyWs.clear();1`); await sleep(200);

  const longText = '这是一段非常非常非常长的文字内容用来把执行口袋撑得很宽很宽';
  const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
<block type="controls_if" x="60" y="40"><mutation elseif="2" else="1"></mutation>
  <value name="IF0"><block type="logic_operation"><field name="OP">AND</field></block></value>
  <statement name="DO0"><block type="act_back"></block></statement>
  <statement name="DO1"><block type="act_vibrate"><value name="MS"><block type="math_number"><field name="NUM">30</field></block></value></block></statement>
  <statement name="DO2"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">80</field></block></value></block></statement>
</block>
<block type="controls_if" x="60" y="460"><mutation elseif="2" else="1"></mutation>
  <value name="IF0"><block type="logic_compare" inline="true"><field name="OP">NEQ</field>
    <value name="A"><block type="math_number"><field name="NUM">12345678</field></block></value>
    <value name="B"><block type="math_number"><field name="NUM">10</field></block></value></block></value>
</block>
<block type="controls_if" x="60" y="700"><mutation elseif="1" else="1"></mutation>
  <statement name="ELSE"><block type="text_print"><value name="TEXT"><block type="text"><field name="TEXT">${longText}</field></block></value></block></statement>
</block>
<block type="controls_if" x="60" y="900"><mutation elseif="1"></mutation>
  <value name="IF1"><block type="logic_compare" inline="true"><field name="OP">EQ</field>
    <value name="A"><block type="math_number"><field name="NUM">99999999</field></block></value>
    <value name="B"><block type="math_number"><field name="NUM">1</field></block></value></block></value>
</block>
<block type="controls_if" x="60" y="1120">
  <statement name="DO0"><block type="controls_if" x="100" y="1180"><mutation else="1"></mutation>
    <statement name="DO0"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">66</field></block></value></block></statement>
  </block></statement>
</block>
<block type="controls_if" x="60" y="1460">
  <statement name="DO0"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">77</field></block></value></block></statement>
</block>
<block type="controls_repeat_ext" x="60" y="1700">
  <value name="TIMES"><block type="math_number"><field name="NUM">10</field></block></value>
  <statement name="DO"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">55</field></block></value></block></statement>
</block>
<block type="controls_if" x="60" y="1940"><mutation elseif="2" else="1"></mutation></block>
</xml>`;
  await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);1`);
  await sleep(700);
  await ev(`blocklyWs.zoomToFit&&blocklyWs.zoomToFit();1`); await sleep(500);

  // 几何断言：每个语句口袋里的子块右缘必须落在口袋右缘之内（允许 8px 外凸圆角）
  const report = await ev(`(function(){
    var bad=[];
    blocklyWs.getAllBlocks(false).forEach(function(b){
      if(b.type!=='controls_if') return;
      var info=b.workspace.getRenderer().makeRenderInfo_(b); info.measure();
      var E=info.__ifRowEdges; if(!E) {bad.push({b:b.type,why:'no edges'});return;}
      var stmtRows=info.rows.filter(function(r){return r.hasStatement;});
      var stmtInputs=b.inputList.filter(function(inp){return inp.type===Blockly.inputTypes.STATEMENT;});
      stmtInputs.forEach(function(inp,k){
        var tb=inp.connection.targetBlock(); if(!tb) return;
        var row=stmtRows[k]; if(!row) {bad.push({input:inp.name,why:'no row'});return;}
        var idx=info.rows.indexOf(row);
        var want=E[idx];
        var childRight=(row.statementEdge||0)+tb.getHeightWidth().width;
        if(childRight > want+9) bad.push({input:inp.name,childRight:Math.round(childRight),edge:Math.round(want),over:Math.round(childRight-want)});
      });
    });
    return JSON.stringify({violations:bad, count:blocklyWs.getAllBlocks(false).length});
  })()`);
  console.log('GEOMETRY', report);

  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(s.data, 'base64'));
  console.log('full shot ->', out);

  // 逐块截图（只截 controls_if 们，便于细看）
  const boxes = await ev(`JSON.stringify(blocklyWs.getTopBlocks(true).filter(b=>b.type==='controls_if').map(b=>{var r=b.getSvgRoot().getBoundingClientRect();return {x:Math.round(r.left-14),y:Math.round(r.top-14),w:Math.round(r.width+28),h:Math.round(r.height+28)};}))`);
  const arr = JSON.parse(boxes);
  for (let k = 0; k < arr.length; k++) {
    const p = arr[k];
    const s2 = await send('Page.captureScreenshot', { format: 'png', clip: { x: p.x, y: p.y, width: p.w, height: p.h, scale: 1.6 } });
    const fn = out.replace(/\.png$/, '_b' + k + '.png');
    fs.writeFileSync(fn, Buffer.from(s2.data, 'base64'));
    console.log('block shot', k, JSON.stringify(p), '->', fn);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
