const fs=require('fs');
const BASE='http://127.0.0.1:8931/editor.html?z='+Date.now();
const PORT=9333;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  let seq=0;
  function cdp(method,params={}){return new Promise((res,rej)=>{const id=++seq;const h=(ev)=>{const m=JSON.parse(ev.data);if(m.id===id){ws.removeEventListener('message',h);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id,method,params}));});}
  async function ev(e){const r=await cdp('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return r.result.value;}
  await cdp('Page.enable'); await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:BASE}); await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='fa';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  async function click(x,y){ await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1}); await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1}); await sleep(700); }
  // 自定义侧栏“控制”按钮（约 48,244）
  const item = await ev(`(function(){ var els=[].slice.call(document.querySelectorAll('*')).filter(function(e){var t=(e.textContent||'').trim(); return t==='控制' && e.children.length===0;});
    var vis=els.map(function(e){return {e:e,r:e.getBoundingClientRect()};}).filter(function(o){return o.r.width>0&&o.r.height>0;}); if(!vis.length) return 'none-visible of '+els.length; var o=vis[0]; return JSON.stringify({x:o.r.x+o.r.width/2,y:o.r.y+o.r.height/2,tag:o.e.className,parent:o.e.parentElement.className}); })()`);
  console.log('控制 item:', item);
  const p=JSON.parse(item);
  await click(p.x,p.y);
  const fly = await ev(`(function(){
    var fb=blocklyWs.getFlyout ? blocklyWs.getFlyout().getWorkspace() : null;
    if(!fb) return 'no flyout ws';
    var bl=fb.getTopBlocks(true);
    return 'count='+bl.length+'\\n'+bl.map(function(b){ var ren=fb.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
      var dr=ren.makeDrawer_(b,info); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      return b.type+':pathL='+(+bb.x.toFixed(1))+(b.type==='controls_if'?(':edges='+JSON.stringify(info.__ifEdges)):''); }).join('\\n');
  })()`);
  console.log('FLYOUT:\n'+fly);
  const shot=await cdp('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(process.argv[2]+'\\flyout2.png',Buffer.from(shot.data,'base64'));
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
