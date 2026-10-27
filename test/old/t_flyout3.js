const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>x.title==='事件');if(b)b.click();return 1;})()`);
await sleep(600);
const m1=await ev(`(function(){var fl=blocklyWs.getFlyout();var b=fl.getWorkspace().getTopBlocks(true)[0];var r=b.getSvgRoot().getBoundingClientRect();var svg=document.querySelector('.blocklyFlyout').getBoundingClientRect();return JSON.stringify({mainScale:blocklyWs.scale,flScale:fl.getWorkspace().scale,flW:fl.width_,blockRight:Math.round(r.right),flRight:Math.round(svg.right)});})()`);
console.log('before zoom:',m1);
// 模拟用户把工作区放大到 1.1（持久化缩放）
await ev(`blocklyWs.setScale(1.1);blocklyWs.resize();1`);
await sleep(400);
const m2=await ev(`(function(){var fl=blocklyWs.getFlyout();var b=fl.getWorkspace().getTopBlocks(true)[0];var r=b.getSvgRoot().getBoundingClientRect();var svg=document.querySelector('.blocklyFlyout').getBoundingClientRect();return JSON.stringify({mainScale:blocklyWs.scale,flScale:fl.getWorkspace().scale,flW:fl.width_,blockRight:Math.round(r.right),flRight:Math.round(svg.right),overhang:Math.round(r.right-svg.right)});})()`);
console.log('after zoom:',m2);
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/t_flyout_zoom.png',Buffer.from(s.data,'base64'));
// 切换分类再切回来，看 reflow 是否自愈
await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>x.title==='控制');b.click();return 1;})()`);
await sleep(400);
await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>x.title==='事件');b.click();return 1;})()`);
await sleep(600);
const m3=await ev(`(function(){var fl=blocklyWs.getFlyout();var b=fl.getWorkspace().getTopBlocks(true)[0];var r=b.getSvgRoot().getBoundingClientRect();var svg=document.querySelector('.blocklyFlyout').getBoundingClientRect();return JSON.stringify({flScale:fl.getWorkspace().scale,flW:fl.width_,overhang:Math.round(r.right-svg.right)});})()`);
console.log('after reselect:',m3);
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
