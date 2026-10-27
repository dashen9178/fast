const WebSocket=require('ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{
 const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
 const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
 await new Promise(r=>ws.on('open',r));
 ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
 const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
 await send('Page.enable');await send('Runtime.enable');
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result?r.result.value:undefined;};
 await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(700);
 const code="RT.on('start', async function(){ await new Promise(function(r){setTimeout(r,1500);}); var keys=['fps','refreshRate','cpuCores','cpuUsage','gpuUsage','memUsage','memTotalGB','memAvailGB','battery','batteryTemp','deviceTemp','netType','online','charging','brightness','screenWidth','screenHeight','density','model','androidVersion','language']; var txt=keys.map(function(k){return k+' = '+RT.deviceVal(k);}).join('\\n'); RT.setText('t1',txt); });";
 const proj={startScreen:'s1',orientation:'portrait',screens:[{id:'s1',name:'页面1',orientation:'portrait',components:[
   {id:'t1',type:'text',value:'加载中…',fs:13,w:400,h:700}
 ],code:code}]};
 await ev(`localStorage.setItem('__previewProject',${JSON.stringify(JSON.stringify(proj))});1`);
 await send('Page.navigate',{url:'http://127.0.0.1:8931/runtime.html'});await send('Page.bringToFront');
 await sleep(2200);  // 等 fps 采样
 const out=await ev(`(function(){var t=document.querySelector('[data-id="t1"] .v-text');return t?t.textContent:'无';})()`);
 console.log('设备信息（浏览器兜底）:\n'+out);
 // toast 时长测试
 const toastTest=await ev(`(function(){
   // 直接触发 toast（通过注入一段 code 不方便，改测 showToast 计时逻辑：连续调用，读 class）
   var ev2=new CustomEvent('x'); return 'runtime ready';
 })()`);
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
