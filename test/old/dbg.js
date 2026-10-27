const WebSocket=require('ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true});
await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});setTimeout(r,1200);});
await ev(`localStorage.clear();1`);
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(300);
await ev(`document.getElementById('createGo').click();1`);await sleep(500);
for (const t of ['progress','slider','checkbox','switch','list','input','button','text']) { await ev(`document.querySelector('[data-add="${t}"]').click();1`);await sleep(120); }
await sleep(600);
console.log('OPEN_KEY:',await ev(`localStorage.getItem('__bb_open')`));
console.log('store keys:',await ev(`Object.keys(JSON.parse(localStorage.getItem('__bb_projects_v2')))`));
console.log('items count:',await ev(`JSON.parse(localStorage.getItem('__bb_projects_v2')).items.length`));
console.log('comps:',await ev(`(function(){const oid=localStorage.getItem('__bb_open');const it=JSON.parse(localStorage.getItem('__bb_projects_v2')).items.find(x=>x.id===oid);return it.project.screens[0].components.map(c=>c.type+':'+(c.x||'auto')+','+(c.y||'auto')).join(' | ');})()`));
await ev(`document.getElementById('btnLayout').click();1`);
await sleep(1600);
console.log('litems:',await ev(`document.querySelectorAll('#layStage .litem').length`));
console.log('stage:',await ev(`(function(){const st=document.getElementById('layStage');return JSON.stringify({w:st.clientWidth,h:st.clientHeight,k:st.dataset.scale,rect:st.getBoundingClientRect().toJSON?.()||{l:st.getBoundingClientRect().left,t:st.getBoundingClientRect().top}});})()`));
console.log('items:',await ev(`(function(){const st=document.getElementById('layStage');const sr=st.getBoundingClientRect();const k=parseFloat(st.dataset.scale)||1;return [].slice.call(st.querySelectorAll('.litem')).map(n=>{const r=n.getBoundingClientRect();return n.className.match(/t-(\\w+)/)[1]+':'+Math.round((r.left-sr.left)/k)+','+Math.round((r.top-sr.top)/k)+' '+Math.round(r.width/k)+'x'+Math.round(r.height/k);}).join(' | ');})()`));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
