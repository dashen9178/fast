// 动态齿轮增删分支验证：加载用户场景后程序化增/删“否则如果/否则”，检查子块保留与几何
const fs = require('fs');
const OUTDIR = __dirname + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  function cdp(m, p = {}) { return new Promise((res, rej) => { const id = ++seq; const h = (ev) => { const x = JSON.parse(ev.data); if (x.id === id) { ws.removeEventListener('message', h); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result.value; }
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(2600);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='g';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1300);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
   <block type="controls_if" x="120" y="80"><mutation elseif="1" else="1"/>
     <value name="IF0"><block type="logic_operation"><field name="OP">AND</field></block></value>
     <statement name="DO0"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">提示内容</field></block></value><value name="DUR"><block type="math_number"><field name="NUM">2</field></block></value></block></statement>
   </block></xml>`;
  await ev(`blocklyWs.clear(); Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}), blocklyWs); 'ok'`);
  await sleep(500);

  // 每步：改 extraState（blocks.js 重写为保存连接→重建→重连），渲染，回报几何与子块保留
  async function step(label, state) {
    const stateJson = JSON.stringify(state);
    const rep = await ev(`(function(){
      var b=blocklyWs.getTopBlocks(true).find(function(x){return x.type==='controls_if';});
      b.loadExtraState(${stateJson});
      b.render();
      var info=blocklyWs.getRenderer().makeRenderInfo_(b); info.measure();
      var toast=b.getInputTargetBlock('DO0');
      return JSON.stringify({label:${JSON.stringify(label)}, elseif:b.elseifCount_, else:!!b.elseCount_,
        inputs:b.inputList.map(function(i){return i.name;}).join(','),
        toastKept:!!toast, pockets:info.__ifPocketEdges.map(function(x){return Math.round(x);}),
        andKept:!!b.getInputTargetBlock('IF0')});
    })()`);
    console.log(rep);
    await sleep(250);
  }
  await step('初始 1elseif+else', { elseIfCount: 1, hasElse: true });
  await step('加到 2elseif', { elseIfCount: 2, hasElse: true });
  await step('加到 3elseif', { elseIfCount: 3, hasElse: true });
  await step('减到 0elseif 保留else', { elseIfCount: 0, hasElse: true });
  await step('去掉 else', { elseIfCount: 0, hasElse: false });
  await step('再加 2elseif+else', { elseIfCount: 2, hasElse: true });
  await sleep(400);
  const s = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUTDIR + '/mutate_final.png', Buffer.from(s.data, 'base64'));
  console.log('SHOT mutate_final');
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
