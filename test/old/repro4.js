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
(async()=>{
  const send=(await conn()).send;
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text));return r.result.value;};
  await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});setTimeout(r,1400);});
  await ev(`document.getElementById('btnNewApp').click();1`);await sleep(300);
  await ev(`document.getElementById('createGo').click();1`);await sleep(500);
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(1600);
  async function catBtn(label){return ev(`(function(){const b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>(x.querySelector('.bb-cat-lb')||{}).textContent===${JSON.stringify(label)});const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);}
  async function tap(p){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  async function click(p){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});}
  let p=await catBtn('数据列表'); await tap(p);await sleep(700);
  const lb=await ev(`(function(){const g=document.querySelector('.blocklyFlyout .blocklyBlockCanvas');const b=[].slice.call(g.children).filter(x=>(x.getAttribute('class')||'').indexOf('blocklyDraggable')>=0)[0];const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+20)};})()`);
  await click(lb); await sleep(700);
  const gear=await ev(`(function(){const gs=[].slice.call(document.querySelectorAll('#blocklyDiv .blocklyIconGroup.blockly-icon-mutator')).filter(g=>{const r=g.getBoundingClientRect();return r.width>0&&!g.closest('.blocklyFlyout');});const g=gs[gs.length-1];const r=g.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await click(gear); await sleep(800);
  // 枚举 bubbleCanvas 内所有“可命中”的元素类，逐个检查排除选择器
  const report=await ev(`(function(){const SEL='.blocklyToolboxDiv,.blocklyFlyout,.blocklyBubble,.blocklyBubbleCanvas,.blocklyWidgetDiv,.blocklyDropDownDiv,.blocklyZoom,.blocklyIconGroup';const bc=document.querySelector('.blocklyBubbleCanvas');const out={};const all=bc.querySelectorAll('*');for(const n of all){let r=n.getBoundingClientRect();if(r.width<2||r.height<2)continue;const cx=r.left+r.width/2,cy=r.top+r.height/2;const hit=document.elementFromPoint(cx,cy);if(!hit||!bc.contains(hit))continue;const cls=(hit.getAttribute&&hit.getAttribute('class')||hit.nodeName)+'';let ex=null;try{const m=hit.closest(SEL);ex=m?(m.className.baseVal||m.className||m.nodeName)+'':null;}catch(e){ex='ERR '+e;}if(!(cls in out))out[cls]={ex:ex,pt:[Math.round(cx),Math.round(cy)]};}return out;})()`);
  console.log('小框内可命中元素 → 排除判定:');
  Object.entries(report).forEach(([k,v])=>console.log(` ${v.ex?'OK ':'FAIL'} ${k} -> ${v.ex} @${v.pt}`));
  process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
