// 用 CDP 真实触摸事件复现：齿轮上拖动 vs 纯点击。参数 scenario=drag|click
const scenario = process.argv[2] || 'drag';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  function cdp(m, p = {}) { return new Promise((res, rej) => { const id = ++seq; const h = (ev) => { const x = JSON.parse(ev.data); if (x.id === id) { ws.removeEventListener('message', h); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result.value; }
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile:false});
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(2600);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='m';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1300);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
   <block type="text_join" x="200" y="160"/></xml>`;
  await ev(`blocklyWs.clear(); Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}), blocklyWs); 'ok'`);
  await sleep(500);

  const setup = await ev(`(function(){
    var b=blocklyWs.getTopBlocks(true)[0];
    var grp=b.pathObject.svgRoot; var mut=grp.querySelector('.blockly-icon-mutator');
    var r=mut.getBoundingClientRect();
    var ic=b.getIcons().find(function(x){return x.getType().toString().indexOf('mutator')>=0;});
    window.__b=b; window.__ic=ic;
    window.__openLog=[];
    var orig=ic.setBubbleVisible.bind(ic);
    ic.setBubbleVisible=function(v){ window.__openLog.push({v:v, stack:(new Error().stack.split('\\n').slice(1,7).join(' || '))}); return orig(v); };
    var p0=b.getRelativeToSurfaceXY();
    window.__pd=0; window.__pu=0; window.__md=0;
    ['pointerdown','mousedown'].forEach(function(t){document.addEventListener(t,function(){window.__pd++;},true);});
    document.addEventListener('mouseup',function(){window.__pu++;},true);
    var el=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
    window.__hit=(el? (el.getAttribute('class')||el.tagName):'null');
    return JSON.stringify({cx:r.x+r.width/2, cy:r.y+r.height/2, x0:p0.x, y0:p0.y, hit:window.__hit});
  })()`);
  const g = JSON.parse(setup);
  console.log('gear center', g.cx.toFixed(1), g.cy.toFixed(1), 'block0', g.x0, g.y0);

  const cx = Math.round(g.cx), cy = Math.round(g.cy);
  const dx = scenario === 'drag' ? 80 : 0, dy = scenario === 'drag' ? 50 : 0;
  await cdp('Input.dispatchMouseEvent', { type:'mousePressed', x:cx, y:cy, button:'left', buttons:1, clickCount:1 });
  await sleep(120);
  if (dx || dy) {
    for (let i = 1; i <= 10; i++) {
      await cdp('Input.dispatchMouseEvent', { type:'mouseMoved', x:Math.round(cx + dx*i/10), y:Math.round(cy + dy*i/10), button:'none', buttons:1 });
      await sleep(40);
    }
    await sleep(150);
  } else {
    await sleep(180);
  }
  await cdp('Input.dispatchMouseEvent', { type:'mouseReleased', x:Math.round(cx+dx), y:Math.round(cy+dy), button:'left', buttons:0, clickCount:1 });
  await sleep(600);

  const result = await ev(`(function(){
    var p=window.__b.getRelativeToSurfaceXY();
    var me=document.getElementById('ifMutMenu'); var menuOpen=!!(me&&!me.classList.contains('hidden'));
    return JSON.stringify({scenario:'${scenario}', menuOpen:menuOpen, nativeBubble:window.__ic.bubbleIsVisible(),
      openCalls: window.__openLog.map(function(x){return x.v;}),
      blockMoved: {x:Math.round(p.x), y:Math.round(p.y)},
      pd:window.__pd, pu:window.__pu, hit:window.__hit,
      stack: window.__openLog.length? window.__openLog[window.__openLog.length-1].stack : null});
  })()`);
  console.log('RESULT', result);
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
