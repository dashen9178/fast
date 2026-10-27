const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(2200);
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,300));return r.result.value;};
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(500);
await ev(`var i=document.getElementById('newAppName');i.value='帽测';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`);await sleep(1200);
// 加按钮控件
await ev(`document.getElementById('tabDesign').click();1`);await sleep(400);
await ev(`document.querySelector('[data-add="button"]').click();1`);await sleep(400);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(900);
await ev(`(function(){var xml='<xml xmlns="https://developers.google.com/blockly/xml"><block type="ev_start" x="120" y="80"></block><block type="v_button_click" x="120" y="200"></block></xml>';Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml),blocklyWs);return 1;})()`);await sleep(600);
async function shot(type,file){ const pad=16;
  const q=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='${type}');var r=b.getSvgRoot().getBoundingClientRect();
    var kn=b.getSvgRoot().querySelector('.hat-knob-outer');var k=kn?kn.getBoundingClientRect():null;
    return JSON.stringify({x:Math.round(r.left-16),y:Math.round(Math.min(r.top,k?k.top:r.top)-16),w:Math.round(r.width+32),h:Math.round(r.bottom-(k?Math.min(r.top,k.top):r.top)+32),ktop:k?Math.round(k.top-r.top):null});})()`);
  const p=JSON.parse(q);
  const s=await send('Page.captureScreenshot',{format:'png',clip:{x:p.x,y:p.y,width:p.w,height:p.h,scale:2}});
  fs.writeFileSync(file,Buffer.from(s.data,'base64'));console.log(type,JSON.stringify(p));
}
await shot('ev_start','/tmp/t_hat_start.png');
await shot('v_button_click','/tmp/t_hat_click.png');
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
