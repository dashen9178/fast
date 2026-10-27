// 复现：齿轮上拖动 vs 纯点击。参数 scenario=drag|click
const fs = require('fs');
const scenario = process.argv[2] || 'drag';
const OUTDIR = __dirname + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ptr(type, x, y, id = 1) {
  return { type, x, y, id };
}
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  function cdp(m, p = {}) { return new Promise((res, rej) => { const id = ++seq; const h = (ev) => { const x = JSON.parse(ev.data); if (x.id === id) { ws.removeEventListener('message', h); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result.value; }
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: true, touch: true });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(2600);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='m';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1300);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
   <block type="controls_if" x="200" y="160"><mutation elseif="1" else="1"/></block></xml>`;
  await ev(`blocklyWs.clear(); Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}), blocklyWs); 'ok'`);
  await sleep(500);

  // 安装 hook 并取齿轮中心、block初始位置
  const setup = await ev(`(function(){
    var b=blocklyWs.getTopBlocks(true)[0];
    var grp=b.pathObject.svgRoot; var mut=grp.querySelector('.blockly-icon-mutator');
    var r=mut.getBoundingClientRect();
    var ic=b.getIcons().find(function(x){return x.getType().toString().indexOf('mutator')>=0;});
    window.__b=b; window.__ic=ic; window.__mut=mut;
    window.__openLog=[];
    var orig=ic.setBubbleVisible.bind(ic);
    ic.setBubbleVisible=function(v){ window.__openLog.push({v:v, stack:(new Error().stack.split('\\n').slice(1,6).join(' || '))}); return orig(v); };
    var p0=b.getRelativeToSurfaceXY();
    return JSON.stringify({cx:r.x+r.width/2, cy:r.y+r.height/2, x0:p0.x, y0:p0.y});
  })()`);
  const g = JSON.parse(setup);
  console.log('gear center', g.cx.toFixed(1), g.cy.toFixed(1), 'block0', g.x0, g.y0);

  // 用合成 PointerEvent（target=齿轮，move/up 发往 document）
  async function fire(type, x, y, target) {
    await ev(`(function(){
      var el=${target ? 'window.__mut' : 'document'};
      var ev=new PointerEvent('pointer${type}',{bubbles:true,cancelable:true,pointerId:1,pointerType:'touch',clientX:${x},clientY:${y},isTrusted:undefined});
      el.dispatchEvent(ev);
      if('${type}'==='down'){ try{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:1,pointerType:'touch',clientX:${x},clientY:${y}}));}catch(e){} }
      return 1;
    })()`);
  }
  // 直接构造完整序列在页面内执行，避免跨调用时序问题
  const dx = scenario === 'drag' ? 60 : 0, dy = scenario === 'drag' ? 40 : 0;
  await ev(`(function(){
    var cx=${g.cx}, cy=${g.cy}, dx=${dx}, dy=${dy};
    function pe(t,x,y,target){var e=new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:1,pointerType:'touch',clientX:x,clientY:y,button:0,buttons:t==='pointerup'?0:1});(target||document).dispatchEvent(e);}
    pe('pointerdown',cx,cy,window.__mut);
    if(dx||dy){ var steps=8; for(var i=1;i<=steps;i++){ pe('pointermove',cx+dx*i/steps,cy+dy*i/steps,document); } }
    pe('pointerup',cx+dx,cy+dy,document);
    return 1;
  })()`);
  await sleep(500);
  const result = await ev(`(function(){
    var p=window.__b.getRelativeToSurfaceXY();
    return JSON.stringify({scenario:'${scenario}', bubbleOpened: window.__ic.bubbleIsVisible(),
      openCalls: window.__openLog.map(function(x){return x.v;}),
      blockMoved: {x:p.x, y:p.y},
      stack: window.__openLog.length? window.__openLog[0].stack : null});
  })()`);
  console.log('RESULT', result);
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
