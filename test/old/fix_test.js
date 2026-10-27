const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:9222';
function get(path){return new Promise((res,rej)=>{require('http').get(HTTP+path,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let msgId=0;
async function conn(){const list=await get('/json/list');const t=list.find(x=>x.type==='page')||list[0];
  return new Promise((res,rej)=>{const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const pending={};
    ws.on('open',()=>res({send(m,p={}){return new Promise((r,j)=>{const id=++msgId;pending[id]={r,j};ws.send(JSON.stringify({id,method:m,params:p}));});}}));
    ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&pending[o.id])o.error?pending[o.id].j(new Error(JSON.stringify(o.error))):pending[o.id].r(o.result);});
    ws.on('error',rej);});}
let pass=0, fail=0;
function ok(name,cond,extra){ if(cond){pass++;console.log('  ✓',name);} else {fail++;console.log('  ✗',name,extra!==undefined?JSON.stringify(extra):'');} }
(async()=>{
  const send=(await conn()).send;
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text));return r.result.value;};
  async function click(p){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});}
  async function tap(p){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  async function tdrag(a,b,n=10,dt=45){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x,y:a.y}]});for(let i=1;i<=n;i++){await sleep(dt);await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.round(a.x+(b.x-a.x)*i/n),y:Math.round(a.y+(b.y-a.y)*i/n)}]});}await sleep(120);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  async function centerOf(sel){return ev(`(function(){const n=document.querySelector(${JSON.stringify(sel)});if(!n)return null;const r=n.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);}
  const layItems=()=>ev(`(function(){const st=document.getElementById('layStage');const sr=st.getBoundingClientRect();const k=parseFloat(st.dataset.scale)||1;return [].slice.call(st.querySelectorAll('.litem')).map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.id,t:n.className.match(/t-(\\w+)/)[1],x:Math.round((r.left-sr.left)/k),y:Math.round((r.top-sr.top)/k),w:Math.round(r.width/k),h:Math.round(r.height/k)};});})()`);
  const rtItems=()=>ev(`(function(){const sc=document.getElementById('screen');const sr=sc.getBoundingClientRect();const m=sc.style.transform.match(/scale\\(([\\d.]+)\\)/);const k=m?parseFloat(m[1]):1;return [].slice.call(sc.querySelectorAll('.comp')).map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.id,t:n.className.match(/comp (\\w+)/)[1],x:Math.round((r.left-sr.left)/k),y:Math.round((r.top-sr.top)/k),w:Math.round(r.width/k),h:Math.round(r.height/k)};});})()`);

  await send('Runtime.evaluate',{expression:'localStorage.clear()'});await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});setTimeout(r,1400);});
  await ev(`document.getElementById('btnNewApp').click();1`);await sleep(300);
  await ev(`document.getElementById('createGo').click();1`);await sleep(500);

  /* ============ BUG 1：删除提示 ============ */
  console.log('【BUG1 删除提示残留】');
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(1600);
  async function catBtn(label){return ev(`(function(){const b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>(x.querySelector('.bb-cat-lb')||{}).textContent===${JSON.stringify(label)});const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);}
  let p=await catBtn('控制'); await tap(p); await sleep(700);
  const fb=await ev(`(function(){const g=document.querySelector('.blocklyFlyout .blocklyBlockCanvas');const b=[].slice.call(g.children).filter(x=>(x.getAttribute('class')||'').indexOf('blocklyDraggable')>=0)[0];const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(20,r.height/2))};})()`);
  await click(fb); await sleep(700);
  ok('浮层点取积木到画布',await ev('window.blocklyWs.getTopBlocks(false).length')===1);
  const wb=await ev(`(function(){const b=window.blocklyWs.getTopBlocks(false)[0];const r=b.getSvgRoot().getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(24,r.height/2))};})()`);
  const tb=await ev(`(function(){const t=document.querySelector('.blocklyToolboxDiv');const r=t.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:wb.x,y:wb.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:wb.x,y:wb.y,button:'left',clickCount:1});
  for(let i=1;i<=8;i++){await sleep(40);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:Math.round(wb.x+(tb.x-wb.x)*i/8),y:Math.round(wb.y+(tb.y-wb.y)*i/8),buttons:1});}
  await sleep(150);
  ok('拖到左侧栏时出现删除提示',await ev(`document.getElementById('delZone').classList.contains('on')`)===true);
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:tb.x,y:tb.y,button:'left',clickCount:1});
  await sleep(500);
  ok('松手删除后提示消失',await ev(`document.getElementById('delZone').classList.contains('on')`)===false);
  ok('积木确实被删除',await ev('window.blocklyWs.getTopBlocks(false).length')===0);
  // 再取一块，在画布内拖放：提示不应出现/残留
  p=await catBtn('控制'); await tap(p); await sleep(700);
  const fb2=await ev(`(function(){const g=document.querySelector('.blocklyFlyout .blocklyBlockCanvas');const b=[].slice.call(g.children).filter(x=>(x.getAttribute('class')||'').indexOf('blocklyDraggable')>=0)[0];const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+20)};})()`);
  await click(fb2); await sleep(600);
  const wb2=await ev(`(function(){const b=window.blocklyWs.getTopBlocks(false)[0];const r=b.getSvgRoot().getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+20)};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:wb2.x,y:wb2.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:wb2.x,y:wb2.y,button:'left',clickCount:1});
  for(let i=1;i<=6;i++){await sleep(40);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:wb2.x+30*i,y:wb2.y+20*i,buttons:1});}
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:wb2.x+180,y:wb2.y+120,button:'left',clickCount:1});
  await sleep(400);
  ok('画布内拖放不显示删除提示',await ev(`document.getElementById('delZone').classList.contains('on')`)===false);
  ok('画布内拖放积木保留',await ev('window.blocklyWs.getTopBlocks(false).length')===1);

  /* ============ BUG 3：mutator 小框 ============ */
  console.log('【BUG3 齿轮框拖动关闭】');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await sleep(300);
  p=await catBtn('数据列表'); await tap(p); await sleep(700);
  const lb=await ev(`(function(){const g=document.querySelector('.blocklyFlyout .blocklyBlockCanvas');const b=[].slice.call(g.children).filter(x=>(x.getAttribute('class')||'').indexOf('blocklyDraggable')>=0)[0];const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+20)};})()`);
  await click(lb); await sleep(700);
  const gear=await ev(`(function(){const gs=[].slice.call(document.querySelectorAll('#blocklyDiv .blocklyIconGroup.blockly-icon-mutator')).filter(g=>{const r=g.getBoundingClientRect();return r.width>0&&!g.closest('.blocklyFlyout');});const g=gs[gs.length-1];const r=g.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await click(gear); await sleep(800);
  const mutW=()=>ev(`(function(){const m=document.querySelector('.blocklyMutatorBackground');return m?Math.round(m.getBoundingClientRect().width):0;})()`);
  ok('齿轮点开小框',await mutW()>0);
  // 关键回归：主工作区收到非 UI 事件（mutator 组合积木时必然发生）→ autosave → 小框不得关闭
  await ev(`(function(){const ws=window.blocklyWs;if(ws.fireChangeListener){ws.fireChangeListener({type:'change',isUiEvent:false});}return 1;})()`);
  await sleep(450);
  ok('自动保存后小框不关闭',await mutW()>0);
  // 触摸：把浮层“项目”拖进右侧工作区（会触发组合→主工作区事件）
  const mb=await ev(`(function(){const mut=document.querySelector('.blocklyMutatorBackground');const svg=mut.closest('svg');const fl=svg.querySelector('g.blocklyFlyout');const blk=fl.querySelector('g.blocklyBlockCanvas > g.blocklyDraggable');const r=blk.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await tdrag(mb,{x:mb.x+150,y:mb.y+30});
  await sleep(500);
  ok('触摸拖入项目块后小框不关闭',await mutW()>0);
  // 再拖一次工作区里的块
  const wblk=await ev(`(function(){const mut=document.querySelector('.blocklyMutatorBackground');const svg=mut.closest('svg');let best=null;[].slice.call(svg.querySelectorAll('g.blocklyBlockCanvas > g.blocklyDraggable')).forEach(b=>{if(b.closest('.blocklyFlyout'))return;const r=b.getBoundingClientRect();if(r.width>0&&(!best||r.width>best.w))best={x:r.left+r.width/2,y:r.top+r.height/2,w:r.width};});return best;})()`);
  if(wblk){await tdrag({x:wblk.x,y:wblk.y},{x:wblk.x+20,y:wblk.y+60});await sleep(400);}
  ok('再次拖动后小框仍在',await mutW()>0);
  // 离开积木页时小框应收起（显式路径仍生效）
  await ev(`document.getElementById('tabDesign').click();1`);await sleep(400);
  ok('切回设计页小框收起',await mutW()===0);

  /* ============ BUG 2：布局 vs 运行 位置一致 ============ */
  console.log('【BUG2 布局/运行位置一致】');
  // 添加一组控件（新控件 unshift 到最上，故按反序点）
  for (const t of ['progress','slider','checkbox','switch','list','input','button','text']) {
    await ev(`document.querySelector('[data-add="${t}"]').click();1`);await sleep(120);
  }
  await sleep(400);
  const nComp=await ev(`JSON.parse(localStorage.getItem('__bb_projects_v2')).items[JSON.parse(localStorage.getItem('__bb_projects_v2')).items.length-1].project.screens[0].components.length`);
  ok('已添加 8 个控件',nComp===8,nComp);
  // 进入拖动布局
  await tap(await centerOf('#btnLayout')); await sleep(1400);
  let lay=await layItems();
  ok('布局舞台渲染全部控件',lay.length===8,lay.length);
  const dsz=await ev(`(function(){const st=document.getElementById('layStage');return {w:st.clientWidth,h:st.clientHeight,k:parseFloat(st.dataset.scale)};})()`);
  // 第一个自动控件原点应为 (16,16)
  const first=lay[0];
  ok('首个自动控件原点=(16,16)',Math.abs(first.x-16)<=1&&Math.abs(first.y-16)<=1,{x:first.x,y:first.y});
  // 找一个中间控件（list）拖到右上区域
  const target=lay.find(x=>x.t==='list');
  const sr=await ev(`(function(){const r=document.getElementById('layStage').getBoundingClientRect();return {l:r.left,t:r.top};})()`);
  const toScreen=(x,y)=>({x:Math.round(sr.l+x*dsz.k),y:Math.round(sr.t+y*dsz.k)});
  const from=toScreen(target.x+target.w/2,target.y+target.h/2);
  const destX=dsz.w-target.w-14, destY=24;
  const to=toScreen(destX+target.w/2,destY+target.h/2);
  await tdrag(from,to,12,40);
  await sleep(800);
  lay=await layItems();
  const moved=lay.find(x=>x.id===target.id);
  ok('拖动后控件位于目标点',Math.abs(moved.x-destX)<=3&&Math.abs(moved.y-destY)<=3,{got:[moved.x,moved.y],want:[destX,destY]});
  // 返回并试运行
  await tap(await centerOf('#layBack')); await sleep(600);
  await tap(await centerOf('#btnRun')); await sleep(1600);
  const rt=await rtItems();
  ok('运行时渲染全部控件',rt.length===8,rt.length);
  // 设计尺寸一致
  const rtDesign=await ev(`(function(){const sc=document.getElementById('screen');return {w:sc.clientWidth,h:sc.clientHeight};})()`);
  ok('运行时设计画布尺寸与布局一致',rtDesign.w===dsz.w&&rtDesign.h===dsz.h,{layout:dsz,rt:rtDesign});
  // 逐控件比较（容差 2 设计像素）
  let maxErr=0, bad=[];
  lay.forEach(L=>{const R=rt.find(r=>r.id===L.id);if(!R){bad.push(L.id+' missing');return;}
    const e=Math.max(Math.abs(L.x-R.x),Math.abs(L.y-R.y),Math.abs(L.w-R.w),Math.abs(L.h-R.h));
    maxErr=Math.max(maxErr,e); if(e>2)bad.push(L.t+': lay'+JSON.stringify([L.x,L.y,L.w,L.h])+' rt'+JSON.stringify([R.x,R.y,R.w,R.h]));});
  ok('所有控件布局/运行位置尺寸一致(误差≤2px)',bad.length===0,'maxErr='+maxErr+' '+bad.join('; '));
  // 被拖到右上的控件精确落在放置点
  const rtMoved=rt.find(r=>r.id===target.id);
  ok('被拖动控件运行时位置=布局位置',Math.abs(rtMoved.x-destX)<=2&&Math.abs(rtMoved.y-destY)<=2,{got:[rtMoved.x,rtMoved.y],want:[destX,destY]});
  // 自动控件不被绝对定位组件挤位：自动控件 x 都应是 16
  const autoX=lay.filter(L=>L.id!==target.id).map(L=>{const R=rt.find(r=>r.id===L.id);return Math.abs(L.x-16)<=1&&Math.abs(R.x-16)<=1;});
  ok('其余自动控件左缘均=16',autoX.every(Boolean)&&autoX.length===7);

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
