// 探测齿轮(mutator icon)元素与坐标，并挂钩 setBubbleVisible 统计弹窗
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: true, touch: true, mobile: true });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(2600);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='m';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1300);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
   <block type="controls_if" x="200" y="160"><mutation elseif="1" else="1"/></block></xml>`;
  await ev(`blocklyWs.clear(); Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}), blocklyWs); 'ok'`);
  await sleep(500);
  const info = await ev(`(function(){
    var b=blocklyWs.getTopBlocks(true)[0];
    var icon=b.getIcon ? null : null;
    // 找齿轮 DOM
    var grp=b.pathObject.svgRoot;
    var mut=grp.querySelector('.blockly-icon-mutator');
    var r=mut.getBoundingClientRect();
    var br=grp.getBoundingClientRect();
    // hook setBubbleVisible
    if(!window.__hooked){
      window.__openCount=0; window.__log=[];
      var ic=b.getIcons().find(function(x){return x.setBubbleVisible && x.bubbleIsVisible && x.miniWorkspaceBubble!==undefined || (x.getType&&x.getType()&&x.getType().toString().indexOf('mutator')>=0);});
      window.__icon=ic;
      var orig=ic.setBubbleVisible.bind(ic);
      ic.setBubbleVisible=function(v){ window.__openCount++; window.__log.push('setBubbleVisible('+v+') stack='+(new Error().stack.split('\\n').slice(1,5).join(' | '))); return orig(v); };
      window.__hooked=true;
    }
    return JSON.stringify({mutRect:{x:r.x,y:r.y,w:r.width,h:r.height}, blockRect:{x:br.x,y:br.y,w:br.width,h:br.height},
      iconType: window.__icon.getType().toString(), hasDoIconClick:true});
  })()`);
  console.log('GEAR', info);
  fs.writeFileSync(OUTDIR + '/gear_info.json', info);
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
