const WebSocket=require('ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2,mobile:true});
await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
await send('Runtime.evaluate',{expression:'localStorage.clear()'});
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});setTimeout(r,1300);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(250);
await ev(`document.getElementById('createGo').click();1`);await sleep(400);
for (const t of ['progress','slider','checkbox','switch','list','input','button','text']) { await ev(`document.querySelector('[data-add="${t}"]').click();1`);await sleep(100); }
await sleep(400);
await ev(`document.getElementById('btnLayout').click();1`);await sleep(1500);
// 把列表拖到右上
const d=await ev(`(function(){const st=document.getElementById('layStage');const sr=st.getBoundingClientRect();const k=parseFloat(st.dataset.scale);const n=[].slice.call(st.querySelectorAll('.litem')).find(n=>n.className.indexOf('t-list')>=0);const r=n.getBoundingClientRect();return JSON.stringify({l:sr.left,t:sr.top,k,w:st.clientWidth,h:st.clientHeight,cx:r.left+r.width/2,cy:r.top+r.height/2,iw:r.width,ih:r.height});})()`);
const z=JSON.parse(d);
const tx=z.l+(z.w-260/2-30)*z.k, ty=z.t+(60)*z.k;
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:z.cx,y:z.cy}]});
for(let i=1;i<=12;i++){await sleep(40);await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:z.cx+(tx-z.cx)*i/12,y:z.cy+(ty-z.cy)*i/12}]});}
await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await sleep(900);
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/shot_layout.png',Buffer.from(s.data,'base64'));
// 运行
await ev(`document.getElementById('layBack').click();1`);await sleep(500);
await ev(`document.getElementById('btnRun').click();1`);await sleep(1600);
s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/shot_runtime.png',Buffer.from(s.data,'base64'));
console.log('shots saved');process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
