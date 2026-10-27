// 齿轮交互综合回归：拖动不弹窗、轻点弹窗、阈值边界、+/−功能、本体拖动、状态复位
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function rec(o) { results.push(o); console.log('CASE', JSON.stringify(o)); }
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  function cdp(m, p = {}) { return new Promise((res, rej) => { const id = ++seq; const h = (ev) => { const x = JSON.parse(ev.data); if (x.id === id) { ws.removeEventListener('message', h); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result.value; }
  const mouse = async (type, x, y, btn = 'left') => {
    const buttons = type === 'mouseReleased' ? 0 : 1;
    await cdp('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: btn, buttons, clickCount: 1 });
  };
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8931/editor.html?z=' + Date.now() }); await sleep(2600);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='m';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1300);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);

  async function closeMenu() {
    // 菜单遮罩 position:fixed;inset:0 透明且层级最高：点远离菜单的右下空白即命中遮罩→closeMenu
    await mouse('mousePressed', 1250, 820); await sleep(30); await mouse('mouseReleased', 1250, 820); await sleep(250);
    await ev(`(function(){var m=document.getElementById('ifMutMenu');if(m)m.classList.add('hidden');return 1;})()`);
  }
  async function freshBlock(typeXml) {
    await closeMenu();
    await ev(`(function(){blocklyWs.clear();var mm=document.getElementById('ifMutMenu');if(mm)mm.classList.add('hidden');return 1;})()`);
    await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(typeXml)}), blocklyWs); 'ok'`);
    await sleep(300);
  }
  async function geom() {
    return JSON.parse(await ev(`(function(){
      var b=blocklyWs.getTopBlocks(true)[0]; var grp=b.pathObject.svgRoot;
      var mut=grp.querySelector('.blockly-icon-mutator'); var r=mut.getBoundingClientRect();
      var br=grp.getBoundingClientRect(); var p=b.getRelativeToSurfaceXY();
      return JSON.stringify({gx:r.x+r.width/2, gy:r.y+r.height/2, bx:br.x+br.width*0.5, by:br.y+12, x:p.x, y:p.y,
        branches:(b.elseifCount_||0)+(b.elseCount_?1:0), itemCount:b.itemCount_});
    })()`));
  }
  async function menuOpen() { return await ev(`(function(){var m=document.getElementById('ifMutMenu');return !!(m&&!m.classList.contains('hidden'));})()`); }
  async function nativeOpen() { return await ev(`(function(){var b=blocklyWs.getTopBlocks(true)[0];return !!(b.mutator&&b.mutator.bubbleIsVisible&&b.mutator.bubbleIsVisible());})()`); }
  // 在齿轮上 press->move(dx,dy)->release
  async function gearGesture(dx, dy, steps) {
    const g = await geom();
    await mouse('mousePressed', g.gx, g.gy); await sleep(80);
    const n = steps || 6;
    for (let i = 1; i <= n; i++) { await mouse('mouseMoved', g.gx + dx * i / n, g.gy + dy * i / n); await sleep(30); }
    await sleep(120);
    await mouse('mouseReleased', g.gx + dx, g.gy + dy); await sleep(450);
    return g;
  }
  const IF = `<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="200" y="160"><mutation elseif="1" else="1"/></block></xml>`;

  // T1 齿轮大拖动
  await freshBlock(IF); let g0 = await geom();
  await gearGesture(120, 80);
  let p1 = await geom();
  rec({ name: 'T1 齿轮大拖动', menu: await menuOpen(), native: await nativeOpen(), moved: (Math.abs(p1.x - g0.x) > 30 || Math.abs(p1.y - g0.y) > 30) });
  await closeMenu();

  // T2 齿轮纯点击
  await freshBlock(IF); g0 = await geom();
  await gearGesture(0, 0, 0);
  p1 = await geom();
  rec({ name: 'T2 齿轮纯点击', menu: await menuOpen(), native: await nativeOpen(), moved: (Math.abs(p1.x - g0.x) > 5 || Math.abs(p1.y - g0.y) > 5) });
  await closeMenu();

  // T3 齿轮小抖动 3px（视为轻点）
  await freshBlock(IF); g0 = await geom();
  await gearGesture(3, 2, 3);
  p1 = await geom();
  rec({ name: 'T3 齿轮小抖动3px', menu: await menuOpen(), native: await nativeOpen(), moved: (Math.abs(p1.x - g0.x) > 5 || Math.abs(p1.y - g0.y) > 5) });
  await closeMenu();

  // T4 临界 7px（Blockly 半径5，应判拖动，不弹窗）
  await freshBlock(IF); g0 = await geom();
  await gearGesture(7, 0, 5);
  p1 = await geom();
  rec({ name: 'T4 临界7px', menu: await menuOpen(), native: await nativeOpen(), moved: (Math.abs(p1.x - g0.x) > 5) });
  await closeMenu();

  // T5 点击齿轮开菜单，点 ＋ 增加分支
  await freshBlock(IF); const before = (await geom()).branches;
  await gearGesture(0, 0, 0);
  const plusRect = JSON.parse(await ev(`(function(){var b=document.getElementById('ifMutPlus').getBoundingClientRect();return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2});})()`));
  await mouse('mousePressed', plusRect.x, plusRect.y); await sleep(40); await mouse('mouseReleased', plusRect.x, plusRect.y); await sleep(300);
  const after = (await geom()).branches;
  rec({ name: 'T5 菜单+增分支', menuWasOpen: await menuOpen(), before: before, after: after, plusWorks: after === before + 1 });
  await closeMenu();

  // T6 从积木本体实体横条（避开齿轮/输入槽/口袋空洞）拖动
  await freshBlock(IF); g0 = await geom();
  const bodyPt = JSON.parse(await ev(`(function(){
    var b=blocklyWs.getTopBlocks(true)[0]; var br=b.pathObject.svgRoot.getBoundingClientRect();
    var hits=[];
    // 在积木范围内网格采样，找命中积木、非齿轮、非输入槽的点（含实体形状与文字标签）
    for(var yy=br.y+10; yy<br.y+br.height-6; yy+=5){
      for(var xx=br.x+12; xx<br.x+100; xx+=5){
        var el=document.elementFromPoint(xx,yy);
        if(!el||!el.closest) continue;
        if(el.closest('.blockly-icon-mutator')) continue;
        if(el.closest('.blocklyEditableField')||el.closest('.blocklyFieldButton')) continue;
        var drag=el.closest('.blocklyDraggable');
        var tag=el.tagName.toLowerCase();
        if(drag && (tag==='path'||tag==='rect'||tag==='text'||tag==='g')){
          hits.push(tag+':'+(el.getAttribute('class')||''));
          // 偏好横条/标签：取第一个 text（字段标签，必在实体横条上）
          if(tag==='text') return JSON.stringify({x:xx,y:yy,tag:tag,cls:el.getAttribute('class')||''});
        }
      }
    }
    return JSON.stringify({x:br.x+20,y:br.y+20,tag:'fallback',cls:(hits.slice(0,4).join('|'))});
  })()`));
  await mouse('mousePressed', bodyPt.x, bodyPt.y); await sleep(80);
  for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', bodyPt.x + 90 * i / 6, bodyPt.y + 50 * i / 6); await sleep(30); }
  await mouse('mouseReleased', bodyPt.x + 90, bodyPt.y + 50); await sleep(400);
  p1 = await geom();
  rec({ name: 'T6 本体拖动', tag: bodyPt.tag, menu: await menuOpen(), native: await nativeOpen(), moved: (Math.abs(p1.x - g0.x) > 30) });
  await closeMenu();

  // T7 拖动后再点击齿轮，菜单仍能正常打开（状态复位）
  await freshBlock(IF);
  await gearGesture(100, 60); await closeMenu();
  await freshBlock(IF);
  await gearGesture(0, 0, 0);
  rec({ name: 'T7 拖动后再点击', menu: await menuOpen(), native: await nativeOpen() });
  await closeMenu();

  const pass = results.every(r => {
    switch (r.name) {
      case 'T1 齿轮大拖动': return !r.menu && !r.native && r.moved;
      case 'T2 齿轮纯点击': return r.menu && !r.native && !r.moved;
      case 'T3 齿轮小抖动3px': return r.menu && !r.native;
      case 'T4 临界7px': return !r.menu && !r.native && r.moved;
      case 'T5 菜单+增分支': return r.plusWorks;
      case 'T6 本体拖动': return !r.menu && r.moved;
      case 'T7 拖动后再点击': return r.menu && !r.native;
      default: return false;
    }
  });
  console.log(pass ? 'ALL_PASS' : 'FAIL');
  ws.close(); process.exit(pass ? 0 : 2);
})().catch(e => { console.error('ERR', e); process.exit(1); });
