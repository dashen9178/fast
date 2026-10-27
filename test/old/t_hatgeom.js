const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');let t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(2500);
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,400));return r.result.value;};
// 新建工程
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(600);
await ev(`var i=document.getElementById('newAppName');i.value='测帽';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`);await sleep(1200);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(1000);
// 拖一个 ev_start 到画布
await ev(`(function(){var xml='<xml xmlns="https://developers.google.com/blockly/xml"><block type="ev_start" x="300" y="120"></block></xml>';var dom=Blockly.utils.xml.textToDom(xml);Blockly.Xml.domToWorkspace(dom,blocklyWs);return 1;})()`);await sleep(500);
const geom=await ev(`(function(){
  var b=blocklyWs.getTopBlocks(true)[0];
  var info=b.rendererCreateInfo?null:null;
  var ri=(b.pathObject&&b.pathObject.info_)?b.pathObject.info_:null;
  var out={type:b.type,height:b.height,width:b.width,hat:b.hat};
  if(ri){
    out.infoHeight=ri.height;out.startY=ri.startY;out.topY=ri.topRow.yPos;
    out.topRowHeight=ri.topRow.height;
    out.topEls=ri.topRow.elements.map(function(e){return {k:e.constructor.name,w:Math.round(e.width),h:Math.round(e.height),x:Math.round(e.xPos),y:Math.round(e.yPos),cy:e.centerline!=null?Math.round(e.centerline):null};});
  }
  // 文字位置
  var texts=[].slice.call(b.getSvgRoot().querySelectorAll('text.blocklyText')).map(function(t){var r=t.getBoundingClientRect();return {t:t.textContent,x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};});
  out.texts=texts;
  var knob=b.getSvgRoot().querySelector('.hat-knob-outer');
  if(knob){out.knob={cx:+knob.getAttribute('cx'),cy:+knob.getAttribute('cy'),r:+knob.getAttribute('r')};}
  // 块在屏幕上的包围盒
  var br=b.getSvgRoot().getBoundingClientRect();out.box={x:Math.round(br.left),y:Math.round(br.top),w:Math.round(br.width),h:Math.round(br.height)};
  out.hatInfo=window.__hatInfo||null;return JSON.stringify(out,null,1);
})()`);
console.log(geom);
const s=await send('Page.captureScreenshot',{format:'png',clip:{x:300,y:150,width:520,height:260,scale:2}});
fs.writeFileSync('/tmp/t_hatgeom.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
