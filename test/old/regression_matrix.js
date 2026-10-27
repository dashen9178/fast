// 全面回归矩阵：宽布尔头(AND/compare)在 IF0/IF1、多分支、空块、嵌套、普通 repeat、简单if
// 输出整图 + 逐块高清 clip + 几何/白缝检测元数据
const fs = require('fs');
const OUTDIR = __dirname + '/shots';
fs.mkdirSync(OUTDIR, { recursive: true });
const tag = process.argv[2] || 'matrix';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  function cdp(method, params = {}) { return new Promise((res, rej) => { const id = ++seq; const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method, params })); }); }
  async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result.value; }
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 3000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(2600);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='m';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1300);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);

  const toast = `<block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">提示内容</field></block></value><value name="DUR"><block type="math_number"><field name="NUM">2</field></block></value></block>`;
  const longTxt = '这是一段非常非常非常长的文字内容用来把子块撑得很宽很宽很宽';
  const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
   <block type="controls_if" x="60" y="30"><mutation elseif="1" else="1"/>
     <value name="IF0"><block type="logic_operation"><field name="OP">AND</field></block></value>
     <statement name="DO0">${toast}</statement>
   </block>
   <block type="controls_if" x="60" y="330"><mutation elseif="2" else="1"/>
     <value name="IF0"><block type="logic_operation"><field name="OP">AND</field></block></value>
     <statement name="DO0">${toast}</statement>
     <value name="IF1"><block type="logic_compare" inline="true"><field name="OP">NEQ</field><value name="A"><block type="math_number"><field name="NUM">12345678</field></block></value><value name="B"><block type="math_number"><field name="NUM">1</field></block></value></block></value>
     <statement name="DO1"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">80</field></block></value></block></statement>
     <statement name="DO2"><block type="act_vibrate"><value name="MS"><block type="math_number"><field name="NUM">30</field></block></value></block></statement>
     <statement name="ELSE"><block type="text_print"><value name="TEXT"><block type="text"><field name="TEXT">${longTxt}</field></block></value></block></statement>
   </block>
   <block type="controls_if" x="60" y="900"><mutation elseif="2" else="1"/></block>
   <block type="controls_if" x="60" y="1180"><mutation elseif="1" else="1"/>
     <value name="IF1"><block type="logic_operation"><field name="OP">AND</field></block></value>
     <statement name="DO0">${toast}</statement>
   </block>
   <block type="controls_if" x="60" y="1520"><mutation else="1"/>
     <statement name="DO0"><block type="controls_if" x="120" y="1580"><mutation else="1"/>
       <statement name="DO0"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">66</field></block></value></block></statement>
     </block></statement>
   </block>
   <block type="controls_repeat_ext" x="60" y="1900">
     <value name="TIMES"><block type="math_number"><field name="NUM">10</field></block></value>
     <statement name="DO"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">55</field></block></value></block></statement>
   </block>
   <block type="controls_if" x="60" y="2150"><statement name="DO0">${toast}</statement></block>
   <block type="controls_if" x="60" y="2420"><mutation elseif="1" else="1"/>
     <value name="IF0"><block type="logic_operation"><field name="OP">AND</field>
       <value name="A"><block type="logic_operation"><field name="OP">AND</field></block></value>
     </block></value>
   </block>
  </xml>`;
  await ev(`blocklyWs.clear(); Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}), blocklyWs); 'ok'`);
  await sleep(300);
  await ev(`blocklyWs.scroll && blocklyWs.scroll(0,0); 's'`);
  await sleep(500);

  // 几何 + 白缝检测元数据
  const meta = await ev(`(function(){
    function rbb(b){if(!b)return null;var r=b.getSvgRoot().getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};}
    var tops=blocklyWs.getTopBlocks(true);
    return JSON.stringify(tops.map(function(b){
      var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
      var stmts=[];
      b.inputList.forEach(function(inp){
        if(inp.type===Blockly.inputTypes.STATEMENT){
          var tb=inp.connection&&inp.connection.targetBlock();
          stmts.push({name:inp.name, child:tb?rbb(tb):null});
        }
      });
      return {type:b.type, bb:rbb(b), infoW:Math.round(info.width),
        pockets: info.__ifPocketEdges?info.__ifPocketEdges.map(function(x){return Math.round(x);}):null,
        edges: info.__ifEdges?info.__ifEdges.map(function(x){return Math.round(x);}):null,
        stmts:stmts};
    }));
  })()`);
  fs.writeFileSync(OUTDIR + '/' + tag + '_meta.json', meta);
  console.log('META', meta);

  const s = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUTDIR + '/' + tag + '.png', Buffer.from(s.data, 'base64'));
  // 逐块 clip 高清
  const boxes = JSON.parse(meta).map(o => ({ x: o.bb.x - 16, y: o.bb.y - 16, width: Math.min(o.bb.w + 32, 1400), height: o.bb.h + 32 }));
  for (let k = 0; k < boxes.length; k++) {
    const p = boxes[k];
    const s2 = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0,p.x), y: Math.max(0,p.y), width: p.width, height: p.height, scale: 1.5 } });
    fs.writeFileSync(OUTDIR + '/' + tag + '_b' + k + '.png', Buffer.from(s2.data, 'base64'));
  }
  console.log('SHOTS', boxes.length);
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
