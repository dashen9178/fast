// 复现「如果/否则如果/否则」阶梯积木渲染 bug（Windows + Edge CDP 版）
// 用法: node repro_if.js <out.png>
const fs = require('fs');
const http = require('http');
const HTTP = 'http://127.0.0.1:9222';
const out = process.argv[2] || 'repro_if.png';
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
    if (r.exceptionDetails) console.log('EXC', JSON.stringify(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  await send('Page.navigate', { url: 'http://127.0.0.1:8932/editor.html' });
  await sleep(2200);
  await ev(`document.getElementById('btnNewApp').click();1`); await sleep(500);
  await ev(`var i=document.getElementById('newAppName');i.value='复现工程';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();1`); await sleep(900);
  await ev(`blocklyWs.clear();1`); await sleep(200);
  const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
<block type="controls_if" x="120" y="80">
  <mutation elseif="2" else="1"></mutation>
  <value name="IF0">
    <block type="logic_operation"><field name="OP">AND</field></block>
  </value>
  <statement name="DO0"><block type="act_back"></block></statement>
  <statement name="DO1"><block type="act_vibrate"><value name="MS"><block type="math_number"><field name="NUM">30</field></block></value></block></statement>
  <statement name="DO2"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">80</field></block></value></block></statement>
</block>
</xml>`;
  await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);1`);
  await sleep(500);

  // 几何探针：重建一份 RenderInfo，dump 每行类型/宽/yPos 与阶梯右缘 E
  const probe = await ev(`(function(){
    var b=blocklyWs.getBlocksByType('controls_if')[0];
    var out={block:{w:b.width,h:b.height}};
    try{
      var info=b.workspace.getRenderer().makeRenderInfo_(b);
      info.measure();
      var rows=info.rows.map(function(r,i){
        var type=r.constructor.name;
        return {i:i,type:type,w:Math.round(r.width),h:Math.round(r.height),y:Math.round(r.yPos||0),
          hasStmt:!!r.hasStatement,pre:!!r.precedesStatement,fol:!!r.followsStatement,
          edge: info.__ifRowEdges?Math.round(info.__ifRowEdges[i]):null};
      });
      out.rows=rows; out.edges=info.__ifRowEdges;
    }catch(e){out.err=String(e&&e.stack||e);}
    var path=b.pathObject.svgPath.getAttribute('d');
    out.path=path;
    out.children=b.getChildren(false).map(function(c){return {type:c.type,x:Math.round(c.x),y:Math.round(c.y),w:Math.round(c.width),h:Math.round(c.height),right:Math.round(c.x+c.width)};});
    return JSON.stringify(out,null,1);
  })()`);
  console.log(probe);

  const q = await ev(`(function(){var b=blocklyWs.getBlocksByType('controls_if')[0];var r=b.getSvgRoot().getBoundingClientRect();return JSON.stringify({x:Math.round(r.left-14),y:Math.round(r.top-14),w:Math.round(r.width+28),h:Math.round(r.height+28)});})()`);
  const p = JSON.parse(q);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: p.x, y: p.y, width: p.w, height: p.h, scale: 2 } });
  fs.writeFileSync(out, Buffer.from(s.data, 'base64'));
  console.log('shot', JSON.stringify(p), '->', out);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
