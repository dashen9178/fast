// 诊断：A 简单if(参照,无缝) B if/elseif/else+AND(用户场景) C if/elseif/else 无AND(隔离)
const fs = require('fs');
const OUTDIR = __dirname + '/shots';
fs.mkdirSync(OUTDIR, { recursive: true });
const tag = process.argv[2] || 'diag';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  function cdp(method, params = {}) { return new Promise((res, rej) => { const id = ++seq; const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method, params })); }); }
  async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result.value; }
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 2700, height: 820, deviceScaleFactor: 1, mobile: false });
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
   <block type="controls_if" x="60" y="120">
     <statement name="DO0">${toast}</statement>
   </block>
   <block type="controls_if" x="720" y="60"><mutation elseif="1" else="1"/>
     <value name="IF0"><block type="logic_operation"><field name="OP">AND</field></block></value>
     <statement name="DO0">${toast}</statement>
   </block>
   <block type="controls_if" x="1500" y="60"><mutation elseif="1" else="1"/>
     <statement name="DO0">${toast}</statement>
   </block>
  </xml>`;
  await ev(`blocklyWs.clear(); Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}), blocklyWs); 'ok'`);
  await sleep(700);

  const dump = await ev(`(function(){
    var tops=blocklyWs.getTopBlocks(true).filter(function(b){return b.type==='controls_if';});
    function rbb(b){var r=b.getSvgRoot().getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}
    function child(b,n){var inp=b.getInput(n); var tb=inp&&inp.connection?inp.connection.targetBlock():null; return tb?rbb(tb):null;}
    var out=tops.map(function(b){
      var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
      var dr=ren.makeDrawer_(b,info); dr.drawOutline_();
      return {elseif:b.elseifCount_, else:!!b.elseCount_, and:!!b.getInputTargetBlock('IF0'),
        bb:rbb(b), toastBB: child(b,'DO0'),
        path: dr.outlinePath_};
    });
    window.__dump=out; return JSON.stringify(out);
  })()`);
  fs.writeFileSync(OUTDIR + '/' + tag + '_path.json', dump);
  const meta = JSON.parse(dump).map(o => ({ elseif: o.elseif, and: o.and, bb: o.bb, toast: o.toastBB }));
  console.log('META', JSON.stringify(meta));
  const s = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUTDIR + '/' + tag + '.png', Buffer.from(s.data, 'base64'));
  console.log('SHOT', tag);
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
