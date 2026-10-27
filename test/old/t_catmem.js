const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1000);});
await send('Page.enable');
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(600);
// 添加一个按钮控件
await ev(`document.querySelector('[data-add="button"]').click();1`);await sleep(300);
// 进积木页
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
// 切到控件积木模式
await ev(`(function(){var b=document.querySelector('#bbCats .bb-bot-wrap .bb-switch');b.click();return 1;})()`);await sleep(300);
const mode1=await ev(`document.querySelector('#bbCats').className`);
// 选中“按钮”分类
await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>x.title==='按钮');if(b)b.click();return 1;})()`);await sleep(400);
const sel1=await ev(`(function(){var on=document.querySelector('#bbCats .bb-cat.on');return on?on.title:null;})()`);
// 切到设计页再回积木页
await ev(`document.getElementById('tabDesign').click();1`);await sleep(500);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(1000);
const mode2=await ev(`document.querySelector('#bbCats').className`);
const sel2=await ev(`(function(){var on=document.querySelector('#bbCats .bb-cat.on');return on?on.title:null;})()`);
const flyoutVisible=await ev(`(function(){var fl=blocklyWs.getFlyout();return fl.isVisible();})()`);
console.log(JSON.stringify({mode1:mode1,sel1:sel1,mode2:mode2,sel2:sel2,flyoutAfterReturn:flyoutVisible}));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
