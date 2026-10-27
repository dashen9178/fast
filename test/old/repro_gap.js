// 复现：IF0 接“并且”(logic_operation AND, 双空布尔槽) 导致 DO0 弹出提示下方缝隙 + 延伸细条
const fs = require('fs');
const OUTDIR = __dirname + '/shots';
fs.mkdirSync(OUTDIR, { recursive: true });
const tag = process.argv[2] || 'repro';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  function cdp(method, params = {}) { return new Promise((res, rej) => { const id = ++seq; const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method, params })); }); }
  async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result.value; }
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(2600);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='g';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1300);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);

  const toast = `<block type="act_toast">
      <value name="MSG"><block type="text"><field name="TEXT">提示内容</field></block></value>
      <value name="DUR"><block type="math_number"><field name="NUM">2</field></block></value>
    </block>`;
  const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
   <block type="controls_if" x="60" y="60"><mutation elseif="1" else="1"/>
     <value name="IF0"><block type="logic_operation"><field name="OP">AND</field></block></value>
     <statement name="DO0">${toast}</statement>
   </block>
   <block type="controls_if" x="1020" y="60">
     <statement name="DO0">${toast}</statement>
   </block>
  </xml>`;
  await ev(`blocklyWs.clear(); Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}), blocklyWs); 'ok'`);
  await sleep(700);
  await ev(`blocklyWs.zoomToFit && blocklyWs.zoomToFit(); 'z'`); await sleep(500);

  const geom = await ev(`(function(){
    function bboxOf(b){var p=b.getSvgRoot().querySelector('.blocklyPath');var bb=p.getBBox();
      return {x:+bb.x.toFixed(1),y:+bb.y.toFixed(1),w:+bb.width.toFixed(1),h:+bb.height.toFixed(1),r:+(bb.x+bb.width).toFixed(1),b:+(bb.y+bb.height).toFixed(1)};}
    var tops=blocklyWs.getTopBlocks(true).filter(function(b){return b.type==='controls_if';});
    return JSON.stringify(tops.map(function(b){
      var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
      var rows=info.rows.map(function(r){return {y:+r.yPos.toFixed(1),h:+r.height.toFixed(1),w:+r.width.toFixed(1),
        stmt:!!r.hasStatement, spacer:!!(r.isSpacer&&r.isSpacer()),
        edge: info.__ifRowEdge.has(r)?+info.__ifRowEdge.get(r).toFixed(1):null,
        name: (r.getLastInput&&r.getLastInput()&&r.getLastInput().input)?r.getLastInput().input.name:null};});
      var toast0=b.getInputTargetBlock('DO0');
      return {id:b.id, elseif:b.elseifCount_, else:!!b.elseCount_,
        topEdge:+info.__ifTopEdge.toFixed(1), bottomEdge:+info.__ifBottomEdge.toFixed(1),
        edges:info.__ifEdges.map(function(x){return +x.toFixed(1);}),
        pockets:info.__ifPocketEdges.map(function(x){return +x.toFixed(1);}),
        blockW:+info.width.toFixed(1),
        toast: toast0?bboxOf(toast0):null, toastW: toast0?+toast0.getHeightWidth().width.toFixed(1):null,
        rows:rows};
    }), null, 1);
  })()`);
  console.log(geom);
  fs.writeFileSync(OUTDIR + '/' + tag + '_geom.json', geom);
  const s = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUTDIR + '/' + tag + '.png', Buffer.from(s.data, 'base64'));
  console.log('SHOT', OUTDIR + '/' + tag + '.png');
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
